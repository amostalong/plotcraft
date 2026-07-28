//! Anthropic Messages API 流式实现
//!
//! 协议：
//! - POST `{endpoint}/v1/messages`
//! - Header：`x-api-key: <key>` + `anthropic-version: 2023-06-01`
//! - 请求体：`{model, max_tokens, system?, messages, stream: true}`
//! - SSE 格式：
//!   ```
//!   event: message_start
//!   data: {"type":"message_start","message":{...}}
//!
//!   event: content_block_start
//!   data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
//!
//!   event: content_block_delta
//!   data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}
//!
//!   event: content_block_delta
//!   data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}
//!
//!   event: content_block_stop
//!   data: {"type":"content_block_stop","index":0}
//!
//!   event: message_delta
//!   data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},...}
//!
//!   event: message_stop
//!   data: {"type":"message_stop"}
//!   ```
//!
//! v0.1 只关心 `content_block_delta` + `delta.type == "text_delta"`，提取 `delta.text`。
//! 其他事件（message_start / content_block_start / content_block_stop / message_delta
//! / message_stop）都跳过。
//!
//! 跟 Locus 差异：Locus `anthropic.rs` 是 3300+ 行庞然大物（tool calls / thinking /
//! OAuth / web search / thinking signature / prompt caching 全栈），PlotCraft v0.1
//! 简化到只剩流式文本。
//!
//! 反卡顿模式跟 [streaming] 一致：spawn_blocking 解析 + mpsc 解耦 + 16ms emit 节流。

use std::time::Duration;

use futures::StreamExt;
use reqwest::Client;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::config::LlmConfig;
use super::streaming::{emit_throttled, ChatError};
use super::types::{ChatMessage, MessageRole};
use crate::error::{AppError, AppResult};

const MESSAGES_PATH: &str = "/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_MAX_TOKENS: u32 = 4096;

/// Anthropic SSE 事件类型（v0.1 只需要识别 `content_block_delta`）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AnthropicEvent {
    MessageStart,
    ContentBlockStart,
    ContentBlockDelta,
    ContentBlockStop,
    MessageDelta,
    MessageStop,
    /// 未知 / ping / 其他（忽略）
    Unknown,
}

impl AnthropicEvent {
    fn parse(event_type: &str) -> Self {
        match event_type {
            "message_start" => Self::MessageStart,
            "content_block_start" => Self::ContentBlockStart,
            "content_block_delta" => Self::ContentBlockDelta,
            "content_block_stop" => Self::ContentBlockStop,
            "message_delta" => Self::MessageDelta,
            "message_stop" => Self::MessageStop,
            _ => Self::Unknown,
        }
    }
}

/// Anthropic SSE 事件
#[derive(Debug, Default)]
struct AnthropicSseEvent {
    event_type: Option<String>,
    data: Option<String>,
}

/// 启动 Anthropic Messages API 流式回复
pub async fn stream_chat_anthropic(
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
        MESSAGES_PATH
    );
    let (system_text, api_messages) = split_system_messages(&messages);
    let body = build_anthropic_request_body(&config.model, system_text.as_deref(), &api_messages);
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
        .header("anthropic-version", ANTHROPIC_VERSION)
        .body(request_bytes);

    if !config.api_key.is_empty() {
        req = req.header("x-api-key", config.api_key.clone());
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
                    eprintln!("[anthropic parse] stream error: {}", e);
                    break;
                }
                None => break,
            };

            let buf_clone = buffer.clone();
            let parsed = tokio::task::spawn_blocking(move || {
                let mut buf = buf_clone;
                let text = String::from_utf8_lossy(&chunk).into_owned();
                buf.push_str(&text);
                let deltas = parse_anthropic_sse_buffer(&mut buf);
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
                    eprintln!("[anthropic parse] spawn_blocking join: {}", e);
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

/// 解析 Anthropic SSE buffer，返回 text deltas
///
/// Anthropic SSE 格式（每事件多行 `key: value`，空行分隔）：
/// ```
/// event: content_block_delta
/// data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}
///
/// ```
///
/// 只关心 `content_block_delta` + `delta.type == "text_delta"`，提取 `delta.text`。
pub(crate) fn parse_anthropic_sse_buffer(buffer: &mut String) -> Vec<String> {
    let mut deltas = Vec::new();
    while let Some(end) = buffer.find("\n\n") {
        let event: String = buffer.drain(..end + 2).collect();
        let parsed = parse_sse_event(&event);
        if let Some(event_type_str) = &parsed.event_type {
            if AnthropicEvent::parse(event_type_str) != AnthropicEvent::ContentBlockDelta {
                continue;
            }
        }
        if let Some(data) = &parsed.data {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                // 提取 delta.text （前提是 type == text_delta）
                let is_text_delta = value
                    .get("delta")
                    .and_then(|d| d.get("type"))
                    .and_then(|t| t.as_str())
                    == Some("text_delta");
                if !is_text_delta {
                    continue;
                }
                if let Some(text) = value
                    .get("delta")
                    .and_then(|d| d.get("text"))
                    .and_then(|t| t.as_str())
                {
                    if !text.is_empty() {
                        deltas.push(text.to_string());
                    }
                }
            }
        }
    }
    deltas
}

/// 解析单个 SSE 事件块（多行 `key: value`）成 `{event_type, data}`
fn parse_sse_event(event: &str) -> AnthropicSseEvent {
    let mut result = AnthropicSseEvent::default();
    for line in event.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(value) = line.strip_prefix("event: ") {
            result.event_type = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("data: ") {
            result.data = Some(value.to_string());
        }
        // 其他字段（id / retry 等）忽略
    }
    result
}

/// 把 PlotCraft 的 `ChatMessage[]` 拆成 Anthropic 格式的 `(system, messages)`
///
/// Anthropic 的 `system` 是独立字段（不在 messages[] 里）。
/// PlotCraft 的 system message → 合并到 `system` 字符串（多个用 `\n\n` 分隔）。
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
    let system = if system_parts.is_empty() {
        None
    } else {
        Some(system_parts.join("\n\n"))
    };
    (system, rest)
}

fn build_anthropic_request_body(
    model: &str,
    system: Option<&str>,
    messages: &[ChatMessage],
) -> serde_json::Value {
    let api_messages: Vec<serde_json::Value> = messages
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
        "max_tokens": DEFAULT_MAX_TOKENS,
        "messages": api_messages,
        "stream": true
    });
    if let Some(sys) = system {
        body["system"] = serde_json::Value::String(sys.to_string());
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_anthropic_sse_extracts_text_deltas() {
        let mut buf = String::new();
        // 模拟 3 个事件：content_block_delta(text_delta) + content_block_delta(text_delta) + message_stop（忽略）
        let event1 = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n";
        let event2 = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}}\n\n";
        let event3 = "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

        buf.push_str(event1);
        let deltas = parse_anthropic_sse_buffer(&mut buf);
        assert_eq!(deltas, vec!["Hello".to_string()]);

        buf.push_str(event2);
        let deltas = parse_anthropic_sse_buffer(&mut buf);
        assert_eq!(deltas, vec![" world".to_string()]);

        buf.push_str(event3);
        let deltas = parse_anthropic_sse_buffer(&mut buf);
        // message_stop 不产生 delta
        assert!(deltas.is_empty());
        // buffer 应被清空
        assert!(buf.is_empty());
    }

    #[test]
    fn parse_anthropic_sse_ignores_non_text_deltas() {
        let mut buf = String::new();
        // input_json_delta 不是 text_delta → 跳过
        let event = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{}\"}}\n\n";
        buf.push_str(event);
        let deltas = parse_anthropic_sse_buffer(&mut buf);
        assert!(deltas.is_empty());
    }

    #[test]
    fn parse_anthropic_sse_handles_split_chunks() {
        // SSE chunk 可能跨多 byte —— buffer 累积
        let mut buf = String::new();
        buf.push_str("event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"ty");
        let deltas = parse_anthropic_sse_buffer(&mut buf);
        // 还没到 \n\n，不该 pop
        assert!(deltas.is_empty());
        assert!(!buf.is_empty());

        buf.push_str("pe\":\"text_delta\",\"text\":\"hi\"}}\n\n");
        let deltas = parse_anthropic_sse_buffer(&mut buf);
        assert_eq!(deltas, vec!["hi".to_string()]);
    }

    #[test]
    fn split_system_messages_separates_system_from_rest() {
        use super::super::types::MessageRole;
        let messages = vec![
            ChatMessage {
                role: MessageRole::System,
                content: "You are helpful".to_string(),
            },
            ChatMessage {
                role: MessageRole::User,
                content: "Hi".to_string(),
            },
            ChatMessage {
                role: MessageRole::System,
                content: "Be concise".to_string(),
            },
            ChatMessage {
                role: MessageRole::Assistant,
                content: "Hello!".to_string(),
            },
        ];
        let (system, rest) = split_system_messages(&messages);
        assert_eq!(system, Some("You are helpful\n\nBe concise".to_string()));
        assert_eq!(rest.len(), 2);
        assert!(matches!(rest[0].role, MessageRole::User));
        assert!(matches!(rest[1].role, MessageRole::Assistant));
    }
}
