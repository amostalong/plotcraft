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
    let response = req
        .send()
        .await
        .map_err(|e| AppError::Llm(format!("request failed: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        let _ = app.emit(
            "chat:error",
            ChatError {
                run_id: run_id.clone(),
                error: format!("HTTP {}: {}", status, body),
            },
        );
        return Err(AppError::LlmHttp { status, body });
    }

    let mut stream = response.bytes_stream();

    // 3. parse / emit 走 mpsc channel
    let (tx, mut rx) = mpsc::channel::<String>(64);
    let cancel_parse = cancel.clone();

    let parse_handle = tokio::spawn(async move {
        let mut buffer = String::new();
        loop {
            if cancel_parse.is_cancelled() {
                break;
            }
            let chunk = match stream.next().await {
                Some(Ok(c)) => c,
                Some(Err(e)) => {
                    eprintln!("[parse] stream error: {}", e);
                    break;
                }
                None => break,
            };

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
                    buffer = new_buf;
                    for d in deltas {
                        if tx.send(d).await.is_err() {
                            return;
                        }
                    }
                }
                Err(e) => {
                    eprintln!("[parse] spawn_blocking join: {}", e);
                    break;
                }
            }
        }
    });

    // 4. emit task
    let app_emit = app.clone();
    let run_id_emit = run_id.clone();
    let emit_handle = tokio::spawn(async move {
        emit_throttled(&app_emit, &run_id_emit, &mut rx).await;
    });

    // 5. 等 parse 完 + 检查 cancel
    tokio::select! {
        _ = parse_handle => {}
        _ = cancel.cancelled() => {
            let _ = emit_handle;
            return Err(AppError::Cancelled);
        }
    }
    let _ = emit_handle.await;
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
                if let Some(delta) = parsed
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("content"))
                    .and_then(|c| c.as_str())
                {
                    if !delta.is_empty() {
                        deltas.push(delta.to_string());
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
