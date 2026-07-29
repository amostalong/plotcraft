//! OpenAI Responses API 流式实现
//!
//! 协议：
//! - POST `{endpoint}/v1/responses`
//! - Header：`Authorization: Bearer <apiKey>`
//! - 请求体：`{model, input, instructions?, stream: true}`（input 是消息数组，不是 messages）
//! - SSE 格式：
//!   ```
//!   event: response.created
//!   data: {"type":"response.created","response":{...}}
//!
//!   event: response.output_item.added
//!   data: {"type":"response.output_item.added","output_index":0,"item":{...}}
//!
//!   event: response.content_part.added
//!   data: {"type":"response.content_part.added","item_id":"...","output_index":0,"content_index":0,"part":{...}}
//!
//!   event: response.output_text.delta
//!   data: {"type":"response.output_text.delta","item_id":"...","output_index":0,"content_index":0,"delta":"Hello"}
//!
//!   event: response.output_text.delta
//!   data: {"type":"response.output_text.delta","item_id":"...","output_index":0,"content_index":0,"delta":" world"}
//!
//!   event: response.output_text.done
//!   data: {"type":"response.output_text.done","item_id":"...","output_index":0,"content_index":0,"text":"Hello world"}
//!
//!   event: response.completed
//!   data: {"type":"response.completed","response":{...}}
//!   ```
//!
//! v0.1 只关心 `response.output_text.delta`，提取 `delta`。
//! 其他事件（response.created / output_item.added / content_part.added /
//! output_text.done / response.completed）都跳过。
//!
//! 跟 chat 区别：endpoint 是 `/v1/responses`（不是 `/v1/chat/completions`），
//! 请求体用 `input`（不是 `messages`），可选 `instructions` 字段。
//!
//! 反卡顿模式跟 [streaming] 一致：spawn_blocking 解析 + mpsc 解耦 + 16ms emit 节流。

use std::time::Duration;

use futures::StreamExt;
use reqwest::Client;
use tauri::AppHandle;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::config::LlmConfig;
use super::streaming::{emit_chat_error, emit_throttled};
use super::types::{ChatMessage, MessageRole};
use crate::error::{AppError, AppResult};

const RESPONSES_PATH: &str = "/v1/responses";
const OUTPUT_TEXT_DELTA_EVENT: &str = "response.output_text.delta";

/// OpenAI Responses API SSE 事件
#[derive(Debug, Default)]
struct ResponsesSseEvent {
    event_type: Option<String>,
    data: Option<String>,
}

/// 启动 OpenAI Responses API 流式回复
pub async fn stream_chat_openai_responses(
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
        RESPONSES_PATH
    );
    let (instructions, input_messages) = split_system_messages(&messages);
    let body = build_openai_responses_body(
        config.effective_model(),
        instructions.as_deref(),
        &input_messages,
        config.effort,
    );
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
    let response = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            // v0.2+：跟 streaming.rs 对齐 — send 失败先 emit chat:error 让前端
            // 看到分类错误玩家文案，再 return Err
            let msg = format!("request failed: {}", e);
            emit_chat_error(&app, &run_id, &msg);
            return Err(AppError::Llm(msg));
        }
    };

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        let err_msg = format!("HTTP {}: {}", status, body);
        emit_chat_error(&app, &run_id, &err_msg);
        return Err(AppError::LlmHttp { status, body });
    }

    let mut stream = response.bytes_stream();

    // 3. parse / emit 走 mpsc channel
    let (tx, mut rx) = mpsc::channel::<String>(64);
    let cancel_parse = cancel.clone();
    // v0.2+ 跟 streaming.rs 对齐 — parse 阶段错误 emit chat:error 给前端
    let app_err = app.clone();
    let run_id_err = run_id.clone();

    let parse_handle = tokio::spawn(async move {
        let mut buffer = String::new();
        loop {
            if cancel_parse.is_cancelled() {
                break;
            }
            let chunk = match stream.next().await {
                Some(Ok(c)) => c,
                Some(Err(e)) => {
                    let msg = format!("[openai_responses parse] stream error: {}", e);
                    eprintln!("{}", msg);
                    emit_chat_error(&app_err, &run_id_err, &msg);
                    break;
                }
                None => break,
            };

            let buf_clone = buffer.clone();
            let parsed = tokio::task::spawn_blocking(move || {
                let mut buf = buf_clone;
                let text = String::from_utf8_lossy(&chunk).into_owned();
                buf.push_str(&text);
                let deltas = parse_responses_sse_buffer(&mut buf);
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
                    let msg = format!("[openai_responses parse] spawn_blocking join: {}", e);
                    eprintln!("{}", msg);
                    emit_chat_error(&app_err, &run_id_err, &msg);
                    break;
                }
            }
        }
    });

    // 4. emit task（共用 streaming.rs 的 emit_throttled）
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

/// 解析 OpenAI Responses API SSE buffer
///
/// 格式跟 chat 略不同：用 `event:` 标识事件类型，只关心 `response.output_text.delta`。
/// 提取 `delta` 字段作为 text 流。
pub(crate) fn parse_responses_sse_buffer(buffer: &mut String) -> Vec<String> {
    let mut deltas = Vec::new();
    while let Some(end) = buffer.find("\n\n") {
        let event: String = buffer.drain(..end + 2).collect();
        let parsed = parse_sse_event(&event);
        // 只处理 response.output_text.delta
        if parsed.event_type.as_deref() != Some(OUTPUT_TEXT_DELTA_EVENT) {
            continue;
        }
        if let Some(data) = &parsed.data {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(delta) = value.get("delta").and_then(|d| d.as_str()) {
                    if !delta.is_empty() {
                        deltas.push(delta.to_string());
                    }
                }
            }
        }
    }
    deltas
}

/// 解析单个 SSE 事件块（多行 `key: value`）成 `{event_type, data}`
fn parse_sse_event(event: &str) -> ResponsesSseEvent {
    let mut result = ResponsesSseEvent::default();
    for line in event.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(value) = line.strip_prefix("event: ") {
            result.event_type = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("data: ") {
            result.data = Some(value.to_string());
        }
    }
    result
}

/// 把 PlotCraft 的 `ChatMessage[]` 拆成 Responses API 格式的 `(instructions, input)`
///
/// Responses API 的 `instructions` 是独立字段（系统 prompt），
/// `input` 是消息数组（不带 system role）。
/// 跟 Anthropic 的 system split 逻辑一致（参考 [streaming_anthropic::split_system_messages]）。
fn split_system_messages(messages: &[ChatMessage]) -> (Option<String>, Vec<ChatMessage>) {
    let mut system_parts: Vec<String> = Vec::new();
    let mut rest: Vec<ChatMessage> = Vec::new();
    for m in messages {
        if matches!(m.role, MessageRole::System) {
            system_parts.push(m.content.clone());
        } else {
            rest.push(m.clone());
        }
    }
    let instructions = if system_parts.is_empty() {
        None
    } else {
        Some(system_parts.join("\n\n"))
    };
    (instructions, rest)
}

fn build_openai_responses_body(
    model: &str,
    instructions: Option<&str>,
    messages: &[ChatMessage],
    effort: Option<super::config::EffortLevel>,
) -> serde_json::Value {
    let input: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            serde_json::json!({
                "role": match m.role {
                    MessageRole::System => "user",  // 已 split 走，不会到这里
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                },
                "content": m.content
            })
        })
        .collect();

    let mut body = serde_json::json!({
        "model": model,
        "input": input,
        "stream": true
    });
    if let Some(ins) = instructions {
        body["instructions"] = serde_json::Value::String(ins.to_string());
    }
    // v0.1+ reasoning: Responses API 用嵌套对象 {effort: "low|medium|high"}
    if let Some(effort_val) = effort.and_then(|e| e.to_openai_effort()) {
        body["reasoning"] = serde_json::json!({
            "effort": effort_val,
        });
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::config::EffortLevel;

    #[test]
    fn parse_responses_sse_extracts_text_deltas() {
        let mut buf = String::new();

        // 第一个 delta
        let event1 = "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_1\",\"output_index\":0,\"content_index\":0,\"delta\":\"Hello\"}\n\n";
        buf.push_str(event1);
        let deltas = parse_responses_sse_buffer(&mut buf);
        assert_eq!(deltas, vec!["Hello".to_string()]);

        // 第二个 delta
        let event2 = "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_1\",\"output_index\":0,\"content_index\":0,\"delta\":\" world\"}\n\n";
        buf.push_str(event2);
        let deltas = parse_responses_sse_buffer(&mut buf);
        assert_eq!(deltas, vec![" world".to_string()]);

        // 其他事件类型（response.created / response.completed）应跳过
        let event3 = "event: response.created\ndata: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_1\"}}\n\n";
        buf.push_str(event3);
        let deltas = parse_responses_sse_buffer(&mut buf);
        assert!(deltas.is_empty());

        // response.completed 也跳过
        let event4 = "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\"}}\n\n";
        buf.push_str(event4);
        let deltas = parse_responses_sse_buffer(&mut buf);
        assert!(deltas.is_empty());
        // buffer 应被清空
        assert!(buf.is_empty());
    }

    #[test]
    fn parse_responses_sse_handles_split_chunks() {
        let mut buf = String::new();
        buf.push_str("event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"hel");
        // 还没到 \n\n
        let deltas = parse_responses_sse_buffer(&mut buf);
        assert!(deltas.is_empty());
        assert!(!buf.is_empty());

        buf.push_str("lo\"}\n\n");
        let deltas = parse_responses_sse_buffer(&mut buf);
        assert_eq!(deltas, vec!["hello".to_string()]);
    }

    #[test]
    fn parse_responses_sse_ignores_data_without_event_type() {
        // 没有 event: 行的 data（理论上不应该出现）—— 不解析
        let mut buf = String::new();
        buf.push_str("data: {\"type\":\"something_else\",\"delta\":\"x\"}\n\n");
        let deltas = parse_responses_sse_buffer(&mut buf);
        assert!(deltas.is_empty());
    }

    #[test]
    fn build_responses_body_no_effort_omits_reasoning() {
        let msgs = vec![ChatMessage {
            role: MessageRole::User,
            content: "hi".to_string(),
            partial: None,
        }];
        let body = build_openai_responses_body("o1", Some("sys"), &msgs, None);
        let json = serde_json::to_string(&body).unwrap();
        assert!(!json.contains("reasoning"));
    }

    #[test]
    fn build_responses_body_includes_nested_reasoning_effort() {
        let msgs = vec![ChatMessage {
            role: MessageRole::User,
            content: "hi".to_string(),
            partial: None,
        }];
        for (effort, expected) in [
            (EffortLevel::Low, "\"reasoning\":{\"effort\":\"low\"}"),
            (EffortLevel::Medium, "\"reasoning\":{\"effort\":\"medium\"}"),
            (EffortLevel::High, "\"reasoning\":{\"effort\":\"high\"}"),
        ] {
            let body = build_openai_responses_body("o1", None, &msgs, Some(effort));
            let json = serde_json::to_string(&body).unwrap();
            assert!(json.contains(expected), "expected {} in {}", expected, json);
        }
    }

    #[test]
    fn build_responses_body_skips_unsupported_effort() {
        let msgs = vec![ChatMessage {
            role: MessageRole::User,
            content: "hi".to_string(),
            partial: None,
        }];
        for effort in [
            EffortLevel::None,
            EffortLevel::Xhigh,
            EffortLevel::Max,
        ] {
            let body = build_openai_responses_body("o1", None, &msgs, Some(effort));
            let json = serde_json::to_string(&body).unwrap();
            assert!(!json.contains("reasoning"));
        }
    }
}
