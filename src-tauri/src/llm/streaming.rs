//! LLM 流式管道：dispatcher + OpenAI Chat Completions 实现
//!
//! 架构（v0.1）：
//! - `stream_chat` 是 dispatcher，按 `config.api_format` 路由到不同 streaming 实现
//! - 当前实现：`stream_chat_openai_chat`（OpenAI Chat Completions + SSE）
//! - Anthropic Messages API 见 [streaming_anthropic]
//!
//! 反 Locus 卡顿核心（CHAT_LLM_DESIGN §3 反制 1）：
//! - `tokio::task::spawn_blocking` 隔离 SSE 状态机 + JSON 解析
//! - `tokio::sync::mpsc::channel` 解耦 parse / emit task
//! - emit 按 16ms rAF 节流 + 256 char batch 上限
//! - `CancellationToken` 支持玩家中途点 Stop
//!
//! 与 Locus 差异：
//! - Locus SSE 解析在 tokio runtime 默认线程池（CPU 抢线程）
//! - PlotCraft 拆 3 task（http / parse / emit），每个独立跑不抢资源

use std::time::{Duration, Instant};

use futures::StreamExt;
use reqwest::Client;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::config::{ApiFormat, EffortLevel, LlmConfig};
use super::streaming_anthropic::stream_chat_anthropic;
use super::streaming_openai_responses::stream_chat_openai_responses;
use super::types::{ChatMessage, MessageRole};
use crate::console::console_log;
use crate::error::{AppError, AppResult};

const CHAT_COMPLETIONS_PATH: &str = "/chat/completions";
const EMIT_INTERVAL_MS: u64 = 16;
const EMIT_BATCH_MAX_CHARS: usize = 256;

#[derive(Debug, Clone, Serialize)]
pub struct ChatChunk {
    pub run_id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatDone {
    pub run_id: String,
    pub usage: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatError {
    pub run_id: String,
    pub error: String,
    /// v0.2+ 错误分类 —— 前端根据这个给玩家显示不同文案 / hint / 行动建议
    /// （不直接暴露原始 OpenSSL / reqwest 错误字符串，玩家永远看不到技术细节）
    /// 跨 Tauri boundary 走 snake_case，TS 端 `ChatErrorKind` 镜像
    pub kind: ChatErrorKind,
}

/// v0.2+ chat 错误分类（v0.1 之前所有错误都打成原字符串给玩家，体验差）
///
/// 设计目标：
/// - 玩家视角只看到 `kind` 对应的玩家文案（"AI 暂时连不上"），不直接看 OpenSSL/TLS 错误
/// - 原始 `error` 字段仍然存在，玩家点 "查看详情" 才显示
/// - 行动建议 (hint) 由前端文案 util 跟 kind 一起出（"去 Settings 改 API key" / "等会儿再试"）
///
/// 分类规则：先看 HTTP status（4xx/5xx）再看错误文本前缀（[parse] / request failed）
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatErrorKind {
    /// 网络层失败（connect / TLS / DNS / refused / 30s timeout）
    Network,
    /// HTTP 401/403 — API key 错 / 中转代理不认
    Auth,
    /// HTTP 404 — model id 在 endpoint 不存在
    ModelNotFound,
    /// HTTP 400 — 请求 body 格式错（endpoint 协议不兼容）
    BadRequest,
    /// HTTP 429 — 限流
    RateLimit,
    /// HTTP 5xx — endpoint 上游挂了
    ServerError,
    /// SSE 协议错 — endpoint 流的字节不是标准 OpenAI SSE 格式 / parse 异常
    StreamProtocol,
    /// 未知错误（兜底）
    Unknown,
}

/// 把原始错误字符串分类成 ChatErrorKind
///
/// 规则（按顺序匹配，第一个命中就用）：
/// 1. `HTTP 401` / `HTTP 403` → Auth
/// 2. `HTTP 404` → ModelNotFound
/// 3. `HTTP 429` → RateLimit
/// 4. `HTTP 5xx` → ServerError
/// 5. `HTTP 400` / `HTTP 4xx` → BadRequest
/// 6. `[parse]` 前缀 / 包含 `stream error` → StreamProtocol
/// 7. `request failed` 前缀 / 包含 `connect` / `TLS` / `handshake` → Network
/// 8. 其他 → Unknown
pub(crate) fn classify_error(err: &str) -> ChatErrorKind {
    // HTTP status 优先
    if let Some(status) = extract_http_status(err) {
        return match status {
            401 | 403 => ChatErrorKind::Auth,
            404 => ChatErrorKind::ModelNotFound,
            429 => ChatErrorKind::RateLimit,
            500..=599 => ChatErrorKind::ServerError,
            400 => ChatErrorKind::BadRequest,
            400..=499 => ChatErrorKind::BadRequest,
            _ => ChatErrorKind::Unknown,
        };
    }
    // 错误文本前缀
    if err.starts_with("[parse]") || err.contains("stream error") {
        return ChatErrorKind::StreamProtocol;
    }
    if err.starts_with("request failed")
        || err.contains("connect")
        || err.contains("TLS")
        || err.contains("handshake")
        || err.contains("dns")
    {
        return ChatErrorKind::Network;
    }
    ChatErrorKind::Unknown
}

/// 从 "HTTP 401: ..." / "HTTP 500: ..." 这种格式抠 status code
fn extract_http_status(err: &str) -> Option<u16> {
    let rest = err.strip_prefix("HTTP ")?;
    let end = rest.find(|c: char| !c.is_ascii_digit())?;
    rest[..end].parse().ok()
}

/// v0.2+ 统一 chat:error emit 入口 —— 4 个错误路径共用，自动算 kind
///
/// 调用方只需要给原始 error 字符串，helper 内部调 `classify_error` 算玩家文案
/// 分类 + emit + 返回 Ok(()) 让调用方继续 return Err。
pub(crate) fn emit_chat_error(app: &AppHandle, run_id: &str, error_msg: &str) {
    let kind = classify_error(error_msg);
    let _ = app.emit(
        "chat:error",
        ChatError {
            run_id: run_id.to_string(),
            error: error_msg.to_string(),
            kind,
        },
    );
}

/// 启动 LLM 流式回复（dispatcher）
///
/// 按 `config.api_format` 路由：
/// - `openai_chat` → [`stream_chat_openai_chat`]（OpenAI Chat Completions + SSE）
/// - `openai_responses` → [`stream_chat_openai_responses`]（OpenAI Responses + SSE）
/// - `anthropic_messages` → [`stream_chat_anthropic`]（Anthropic Messages + SSE）
///
/// 完成后 emit `chat:done`（成功）或 `chat:error`（失败）。
/// 不返回完整结果，玩家通过订阅 Tauri event 拿 chunk。
pub async fn stream_chat(
    app: AppHandle,
    run_id: String,
    config: LlmConfig,
    messages: Vec<ChatMessage>,
    cancel: CancellationToken,
) -> AppResult<()> {
    match config.api_format {
        ApiFormat::OpenaiChat => {
            stream_chat_openai_chat(app, run_id, config, messages, cancel).await
        }
        ApiFormat::OpenaiResponses => {
            stream_chat_openai_responses(app, run_id, config, messages, cancel).await
        }
        ApiFormat::AnthropicMessages => {
            stream_chat_anthropic(app, run_id, config, messages, cancel).await
        }
    }
}

/// OpenAI Chat Completions API 流式实现
///
/// 协议：
/// - POST `{endpoint}/chat/completions`
/// - 请求体：`{model, messages, stream: true, stream_options: {include_usage: true}}`
/// - SSE 格式：`data: {"choices":[{"delta":{"content":"..."}}]}` + `data: [DONE]`
/// - Header：`Authorization: Bearer <apiKey>`
pub async fn stream_chat_openai_chat(
    app: AppHandle,
    run_id: String,
    config: LlmConfig,
    messages: Vec<ChatMessage>,
    cancel: CancellationToken,
) -> AppResult<()> {
    // v0.2+ 完整路径 log —— 排查 stream 卡住时直接看 Console tab
    console_log(
        &app,
        "info",
        "stream",
        format!("[stream] openai_chat starting (endpoint={}, model={})", config.endpoint, config.effective_model()),
    );

    // 1. 构造 request
    let api_url = format!(
        "{}{}",
        config.endpoint.trim_end_matches('/'),
        CHAT_COMPLETIONS_PATH
    );
    let body = build_openai_request_body(config.effective_model(), &messages, config.effort);
    let request_bytes = serde_json::to_vec(&body)
        .map_err(|e| AppError::Llm(format!("request serialization: {}", e)))?;

    let client = Client::builder()
        .tcp_keepalive(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Llm(format!("reqwest builder: {}", e)))?;

    let mut req = client
        .post(&api_url)
        .header("Content-Type", "application/json")
        .body(request_bytes);

    if !config.api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", config.api_key));
    }

    // 2. 拿 stream
    console_log(
        &app,
        "info",
        "stream",
        format!("[stream] req.send starting (url={})", api_url),
    );
    let response = match req.send().await {
        Ok(r) => {
            console_log(
                &app,
                "info",
                "stream",
                format!("[stream] req.send ok (status={})", r.status()),
            );
            r
        }
        Err(e) => {
            // v0.1+：之前 send 失败只 return Err，前端永远收不到 chat:error event
            // → UI 卡 streaming 状态无任何反馈。改成先 emit chat:error 再 return。
            let msg = format!("request failed: {}", e);
            console_log(&app, "error", "stream", format!("[stream] req.send FAILED: {}", e));
            emit_chat_error(&app, &run_id, &msg);
            return Err(AppError::Llm(msg));
        }
    };

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        let err_msg = format!("HTTP {}: {}", status, body);
        console_log(&app, "error", "stream", format!("[stream] HTTP non-success: {}", err_msg));
        emit_chat_error(&app, &run_id, &err_msg);
        return Err(AppError::LlmHttp { status, body });
    }

    let mut stream = response.bytes_stream();
    console_log(&app, "info", "stream", "[stream] got bytes_stream, entering parse loop");

    // 3. parse / emit 走 mpsc channel
    let (tx, mut rx) = mpsc::channel::<String>(64);
    let cancel_parse = cancel.clone();
    // v0.1+：parse 阶段两处错误（stream 中断 / spawn_blocking join 失败）之前只 eprintln
    // → 前端收不到 chat:error，UI 永远卡 streaming。clone 一份 app + run_id 准备 emit。
    let app_err = app.clone();
    let run_id_err = run_id.clone();

    let parse_handle = tokio::spawn(async move {
        let mut buffer = String::new();
        // v0.2+ 诊断 log 噪音控制 —— 只在异常路径 (total_deltas=0) 打
        // [stream] first chunk / closed，正常 chat 路径不 spam Console
        let mut chunk_count: u32 = 0;
        let mut total_deltas: usize = 0;
        let mut first_chunk_preview: Option<(usize, String)> = None;
        loop {
            if cancel_parse.is_cancelled() {
                break;
            }
            let chunk = match stream.next().await {
                Some(Ok(c)) => c,
                Some(Err(e)) => {
                    let msg = format!("[parse] stream error: {}", e);
                    eprintln!("{}", msg);
                    emit_chat_error(&app_err, &run_id_err, &msg);
                    break;
                }
                None => break,
            };

            chunk_count += 1;
            // 暂存 first chunk raw preview —— 后面 closed log 决定要不要打
            if first_chunk_preview.is_none() {
                let preview_lossy = String::from_utf8_lossy(&chunk);
                let preview: String = preview_lossy.chars().take(400).collect();
                first_chunk_preview = Some((chunk.len(), preview));
            }

            // CPU 密集解析丢 spawn_blocking
            let buf_clone = buffer.clone();
            let parsed = tokio::task::spawn_blocking(move || {
                let mut buf = buf_clone;
                let text = String::from_utf8_lossy(&chunk).into_owned();
                buf.push_str(&text);
                let deltas = parse_openai_sse_buffer(&mut buf);
                (deltas, buf)
            })
            .await;

            match parsed {
                Ok((deltas, new_buf)) => {
                    total_deltas += deltas.len();
                    buffer = new_buf;
                    for d in deltas {
                        if tx.send(d).await.is_err() {
                            return;
                        }
                    }
                }
                Err(e) => {
                    let msg = format!("[parse] spawn_blocking join: {}", e);
                    eprintln!("{}", msg);
                    emit_chat_error(&app_err, &run_id_err, &msg);
                    break;
                }
            }
        }
        // v0.2+ 异常路径诊断：stream 关闭但 0 个 deltas（最常见的"没回复也没错误"）
        // 打 first chunk raw preview + closed summary。正常 chat 路径不打，console 干净。
        if total_deltas == 0 {
            if let Some((size, preview)) = first_chunk_preview {
                console_log(
                    &app_err,
                    "info",
                    "llm",
                    format!("[stream] first chunk ({} bytes): {}", size, preview),
                );
            }
            let buffer_tail: String = buffer
                .chars()
                .rev()
                .take(200)
                .collect::<String>()
                .chars()
                .rev()
                .collect();
            console_log(
                &app_err,
                "info",
                "llm",
                format!(
                    "[stream] closed, chunks={}, total_deltas=0, buffer_tail={:?}",
                    chunk_count, buffer_tail
                ),
            );
        } else {
            // v0.2.1+ 正常路径也打 closed summary —— 排查"任务卡住"问题需要看任务在哪步
            console_log(
                &app_err,
                "info",
                "llm",
                format!(
                    "[stream] parse loop ended normally, chunks={}, total_deltas={}",
                    chunk_count, total_deltas
                ),
            );
        }
    });

    // 4. emit task
    let app_emit = app.clone();
    let run_id_emit = run_id.clone();
    let app_emit_for_log = app_emit.clone();
    let run_id_emit_for_log = run_id_emit.clone();
    let emit_handle = tokio::spawn(async move {
        console_log(
            &app_emit_for_log,
            "info",
            "stream",
            format!("[emit] starting (run_id={})", run_id_emit_for_log),
        );
        emit_throttled(&app_emit, &run_id_emit, &mut rx).await;
        console_log(
            &app_emit_for_log,
            "info",
            "stream",
            "[emit] emit_throttled returned",
        );
    });

    // 5. 等 parse 完 + 检查 cancel
    console_log(&app, "info", "stream", "[stream] waiting parse_handle or cancel...");
    tokio::select! {
        _ = parse_handle => {
            console_log(&app, "info", "stream", "[stream] parse_handle completed");
        }
        _ = cancel.cancelled() => {
            console_log(&app, "warn", "stream", "[stream] cancelled by token");
            let _ = emit_handle;
            return Err(AppError::Cancelled);
        }
    }
    console_log(&app, "info", "stream", "[stream] waiting emit_handle...");
    let _ = emit_handle.await;
    console_log(&app, "info", "stream", "[stream] finished OK");
    Ok(())
}

/// emit 任务通用实现（OpenAI / Anthropic 共用）
///
/// 16ms rAF 节流 + 256 char batch 上限。
/// stream 关闭后 flush 剩余 + emit `chat:done`。
pub(crate) async fn emit_throttled(
    app_emit: &AppHandle,
    run_id_emit: &str,
    rx: &mut mpsc::Receiver<String>,
) {
    let mut batch = String::new();
    let mut last_emit = Instant::now();
    while let Some(delta) = rx.recv().await {
        batch.push_str(&delta);
        if last_emit.elapsed() >= Duration::from_millis(EMIT_INTERVAL_MS)
            || batch.len() >= EMIT_BATCH_MAX_CHARS
        {
            let _ = app_emit.emit(
                "chat:chunk",
                ChatChunk {
                    run_id: run_id_emit.to_string(),
                    text: std::mem::take(&mut batch),
                },
            );
            last_emit = Instant::now();
        }
    }
    if !batch.is_empty() {
        let _ = app_emit.emit(
            "chat:chunk",
            ChatChunk {
                run_id: run_id_emit.to_string(),
                text: batch,
            },
        );
    }
    let _ = app_emit.emit(
        "chat:done",
        ChatDone {
            run_id: run_id_emit.to_string(),
            usage: None,
        },
    );
}

/// 解析 OpenAI Chat Completions SSE buffer
///
/// 格式：
/// ```text
/// data: {"choices":[{"delta":{"content":"hello"}}]}
///
/// data: {"choices":[{"delta":{"content":" world"}}]}
///
/// data: [DONE]
/// ```
pub(crate) fn parse_openai_sse_buffer(buffer: &mut String) -> Vec<String> {
    let mut deltas = Vec::new();
    while let Some(end) = buffer.find("\n\n") {
        let event: String = buffer.drain(..end + 2).collect();
        for line in event.lines() {
            let Some(data) = line.strip_prefix("data: ") else {
                continue;
            };
            if data == "[DONE]" {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(delta_obj) = parsed
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                {
                    // v0.1+：兼容智谱 GLM reasoning 模型的 `delta.reasoning_content` 扩展字段
                    // —— content 缺/null/空串时 fallback 到 reasoning_content（中转代理翻译的
                    // OpenAI 兼容响应；纯 reasoning 模式）。正常 LLM (只有 content) 行为不变。
                    // filter 处理 `null` 和 `""` 两种 falsy 边界，避免 d.get("content") 返回
                    // Some(&Null) 时 .or_else 不会走 fallback 的坑。
                    let text = delta_obj
                        .get("content")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .or_else(|| {
                            delta_obj
                                .get("reasoning_content")
                                .and_then(|v| v.as_str())
                                .filter(|s| !s.is_empty())
                        });
                    if let Some(t) = text {
                        deltas.push(t.to_string());
                    }
                }
            }
        }
    }
    deltas
}

fn build_openai_request_body(
    model: &str,
    messages: &[ChatMessage],
    effort: Option<EffortLevel>,
) -> serde_json::Value {
    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            serde_json::json!({
                "role": match m.role {
                    MessageRole::System => "system",
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                },
                "content": m.content
            })
        })
        .collect();
    let mut body = serde_json::json!({
        "model": model,
        "messages": api_messages,
        "stream": true,
        "stream_options": { "include_usage": true }
    });
    // v0.1+ reasoning_effort：仅 low/medium/high 真实下发
    if let Some(effort_val) = effort.and_then(|e| e.to_openai_effort()) {
        body["reasoning_effort"] = serde_json::Value::String(effort_val.to_string());
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::types::{ChatMessage, MessageRole};

    #[test]
    fn build_openai_request_body_no_effort_omits_field() {
        let msgs = vec![ChatMessage {
            role: MessageRole::User,
            content: "hi".to_string(),
            partial: None,
        }];
        let body = build_openai_request_body("gpt-4o-mini", &msgs, None);
        let json = serde_json::to_string(&body).unwrap();
        assert!(!json.contains("reasoning_effort"));
        assert!(json.contains("\"stream\":true"));
        assert!(json.contains("\"model\":\"gpt-4o-mini\""));
    }

    #[test]
    fn build_openai_request_body_includes_supported_effort() {
        let msgs = vec![ChatMessage {
            role: MessageRole::User,
            content: "hi".to_string(),
            partial: None,
        }];
        for (effort, expected) in [
            (Some(EffortLevel::Low), "\"reasoning_effort\":\"low\""),
            (Some(EffortLevel::Medium), "\"reasoning_effort\":\"medium\""),
            (Some(EffortLevel::High), "\"reasoning_effort\":\"high\""),
        ] {
            let body = build_openai_request_body("o1", &msgs, effort);
            let json = serde_json::to_string(&body).unwrap();
            assert!(json.contains(expected), "expected {} in {}", expected, json);
        }
    }

    #[test]
    fn build_openai_request_body_skips_unsupported_effort() {
        // None / Xhigh / Max → OpenAI 不支持，field 不下发
        let msgs = vec![ChatMessage {
            role: MessageRole::User,
            content: "hi".to_string(),
            partial: None,
        }];
        for effort in [
            Some(EffortLevel::None),
            Some(EffortLevel::Xhigh),
            Some(EffortLevel::Max),
        ] {
            let body = build_openai_request_body("o1", &msgs, effort);
            let json = serde_json::to_string(&body).unwrap();
            assert!(!json.contains("reasoning_effort"));
        }
    }
}
