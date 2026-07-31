//! Anthropic Messages API 流式实现
//!
//! 协议：
//! - POST `{endpoint}/v1/messages`
//! - Header：`x-api-key: <key>` + `anthropic-version: 2023-06-01`
//! - 请求体：`{model, max_tokens, system?, messages, stream: true, (tools: [...])?}`
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
//!   data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"q"}}
//!
//!   event: content_block_stop
//!   data: {"type":"content_block_stop","index":0}
//!
//!   event: message_delta
//!   data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},...}
//!
//!   event: message_stop
//!   data: {"type":"message_stop"}
//!   ```
//!
//! v0.1 只关心 `content_block_delta` + `delta.type == "text_delta"`，提取 `delta.text`。
//! v0.4+ tool calling 扩：
//! - `content_block_start` + `content_block.type == "tool_use"` → start tool call（id + name）
//! - `content_block_delta` + `delta.type == "input_json_delta"` → 累积 arguments
//! - `content_block_stop` → tool call 结束（前端按 index 标记"完成"）
//!
//! 其他事件（message_start / message_delta / message_stop）都跳过。
//!
//! 跟 Locus 差异：Locus `anthropic.rs` 是 3300+ 行庞然大物（tool calls / thinking /
//! OAuth / web search / thinking signature / prompt caching 全栈），PlotCraft v0.4+
//! 加 tool calls 支持但仍保持精简（只关心 text + tool_use 两种 content_block）。
//!
//! 反卡顿模式跟 [streaming] 一致：spawn_blocking 解析 + mpsc 解耦 + 16ms emit 节流。

use std::time::Duration;

use futures::StreamExt;
use reqwest::Client;
use tauri::AppHandle;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::config::LlmConfig;
use super::streaming::{emit_chat_error, emit_throttled, ChatErrorContext, StreamEvent, ToolCallPartial};
use super::types::{ChatMessage, MessageRole, ToolDefinition};
use crate::console::console_log;
use crate::error::{AppError, AppResult};

const MESSAGES_PATH: &str = "/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_MAX_TOKENS: u32 = 4096;

/// Anthropic SSE 事件类型
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
///
/// v0.4+ `tools`: 注入到 request body 的 `tools` 字段（Anthropic 协议级）
pub async fn stream_chat_anthropic(
    app: AppHandle,
    run_id: String,
    config: LlmConfig,
    messages: Vec<ChatMessage>,
    cancel: CancellationToken,
    tools: Option<Vec<ToolDefinition>>,
) -> AppResult<()> {
    // 1. 构造 request
    let api_url = format!(
        "{}{}",
        config.endpoint.trim_end_matches('/'),
        MESSAGES_PATH
    );
    let (system_text, api_messages) = split_system_messages(&messages);
    let body = build_anthropic_request_body(
        config.effective_model(),
        system_text.as_deref(),
        &api_messages,
        config.effort,
        tools.as_deref(),
    );
    // v0.4.1+ 错误诊断上下文 —— 4 个错误路径共用 + body preview 给玩家复制
    let body_preview = serde_json::to_string(&body)
        .map(|s| s.chars().take(800).collect::<String>())
        .unwrap_or_else(|_| "(serialize failed)".to_string());
    console_log(
        &app,
        "info",
        "stream",
        format!("[stream] anthropic body preview: {}", body_preview),
    );
    let error_ctx = ChatErrorContext::from_config(&config, &body_preview);
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
    let response = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            // v0.2+：跟 streaming.rs 对齐 — send 失败先 emit chat:error 让前端
            // 看到分类错误玩家文案，再 return Err
            let msg = format!("request failed: {}", e);
            // v0.4.1+ 带 error_ctx（endpoint / model / body preview 给玩家复制）
            emit_chat_error(&app, &run_id, error_ctx.clone(), &msg);
            return Err(AppError::Llm(msg));
        }
    };

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        let err_msg = format!("HTTP {}: {}", status, body);
        // v0.4.1+ 带 error_ctx
        emit_chat_error(&app, &run_id, error_ctx.clone(), &err_msg);
        return Err(AppError::LlmHttp { status, body });
    }

    let mut stream = response.bytes_stream();

    // 3. parse / emit 走 mpsc channel —— v0.4+ channel 改 StreamEvent
    let (tx, mut rx) = mpsc::channel::<StreamEvent>(64);
    let cancel_parse = cancel.clone();
    let app_err = app.clone();
    let run_id_err = run_id.clone();
    // v0.4.1+ parse 闭包内也可能 emit 错误，把 error_ctx 也 move 进去
    let error_ctx_parse = error_ctx.clone();

    let parse_handle = tokio::spawn(async move {
        let mut buffer = String::new();
        loop {
            if cancel_parse.is_cancelled() {
                break;
            }
            let chunk = match stream.next().await {
                Some(Ok(c)) => c,
                Some(Err(e)) => {
                    let msg = format!("[anthropic parse] stream error: {}", e);
                    eprintln!("{}", msg);
                    // v0.4.1+ 带 error_ctx
                    emit_chat_error(&app_err, &run_id_err, error_ctx_parse.clone(), &msg);
                    break;
                }
                None => break,
            };

            let buf_clone = buffer.clone();
            let parsed = tokio::task::spawn_blocking(move || {
                let mut buf = buf_clone;
                let text = String::from_utf8_lossy(&chunk).into_owned();
                buf.push_str(&text);
                let events = parse_anthropic_sse_buffer(&mut buf);
                (events, buf)
            })
            .await;

            match parsed {
                Ok((events, new_buf)) => {
                    buffer = new_buf;
                    for event in events {
                        if tx.send(event).await.is_err() {
                            return;
                        }
                    }
                }
                Err(e) => {
                    let msg = format!("[anthropic parse] spawn_blocking join: {}", e);
                    eprintln!("{}", msg);
                    // v0.4.1+ 带 error_ctx
                    emit_chat_error(&app_err, &run_id_err, error_ctx_parse.clone(), &msg);
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

/// 解析 Anthropic SSE buffer，返回 StreamEvent 列表
///
/// v0.4+ 同时解析：
/// - `content_block_delta.type == "text_delta"` → `Text(delta.text)`
/// - `content_block_delta.type == "input_json_delta"` → `ToolCalls([{index, args_delta}])`（无 id/name，start 时已存到 tool_uses）
/// - `content_block_start.type == "tool_use"` → `ToolCalls([{index, id, name, args_delta: ""}])`（start）
/// - `content_block_stop` → 不发事件，累积状态在 message_stop 时统一 emit
pub(crate) fn parse_anthropic_sse_buffer(buffer: &mut String) -> Vec<StreamEvent> {
    let mut events = Vec::new();
    while let Some(end) = buffer.find("\n\n") {
        let event: String = buffer.drain(..end + 2).collect();
        let parsed = parse_sse_event(&event);
        let Some(event_type_str) = &parsed.event_type else {
            continue;
        };
        let ev_type = AnthropicEvent::parse(event_type_str);

        // v0.4+ content_block_start.tool_use → 拿 id + name
        if ev_type == AnthropicEvent::ContentBlockStart {
            if let Some(data) = &parsed.data {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                    let cb_type = value
                        .get("content_block")
                        .and_then(|c| c.get("type"))
                        .and_then(|t| t.as_str());
                    if cb_type == Some("tool_use") {
                        let index = value
                            .get("index")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0)
                            as usize;
                        let id = value
                            .get("content_block")
                            .and_then(|c| c.get("id"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        let name = value
                            .get("content_block")
                            .and_then(|c| c.get("name"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        events.push(StreamEvent::ToolCalls(vec![ToolCallPartial {
                            index,
                            id,
                            name,
                            arguments_delta: String::new(),
                        }]));
                    }
                }
            }
            continue;
        }

        // v0.4+ content_block_delta.input_json_delta → 累积 arguments
        if ev_type == AnthropicEvent::ContentBlockDelta {
            if let Some(data) = &parsed.data {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                    let delta_type = value
                        .get("delta")
                        .and_then(|d| d.get("type"))
                        .and_then(|t| t.as_str());
                    let index = value
                        .get("index")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0)
                        as usize;
                    if delta_type == Some("input_json_delta") {
                        let partial = value
                            .get("delta")
                            .and_then(|d| d.get("partial_json"))
                            .and_then(|p| p.as_str())
                            .unwrap_or("")
                            .to_string();
                        if !partial.is_empty() {
                            events.push(StreamEvent::ToolCalls(vec![ToolCallPartial {
                                index,
                                id: None,
                                name: None,
                                arguments_delta: partial,
                            }]));
                        }
                    } else if delta_type == Some("text_delta") {
                        let text = value
                            .get("delta")
                            .and_then(|d| d.get("text"))
                            .and_then(|t| t.as_str())
                            .unwrap_or("")
                            .to_string();
                        if !text.is_empty() {
                            events.push(StreamEvent::Text(text));
                        }
                    }
                }
            }
            continue;
        }

        // content_block_stop / message_stop / message_delta 等：暂不产生事件
        // tool_use done 标记暂依赖前端 arguments JSON.parse 成功判定（见 AiChatPanel）
        // —— 后续 v0.4+ 迭代可以加 StreamEvent::ToolCallComplete(index) 显式 emit
        let _ = ev_type;
    }
    events
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
    effort: Option<super::config::EffortLevel>,
    tools: Option<&[ToolDefinition]>,
) -> serde_json::Value {
    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            // v0.4+ tool result 消息：Anthropic 协议是 content 数组（[{type: "tool_result", tool_use_id, content}]）
            // 跟 OpenAI 的 role=tool 不同 → 协议层转换
            match m.role {
                MessageRole::Tool => {
                    serde_json::json!({
                        "role": "user",
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": m.tool_call_id.clone().unwrap_or_default(),
                            "content": m.content,
                        }]
                    })
                }
                MessageRole::User => serde_json::json!({
                    "role": "user",
                    "content": m.content
                }),
                MessageRole::Assistant => {
                    // v0.4+ assistant 带 tool_calls 时：content 数组含 text + tool_use 块
                    if let Some(ref tcs) = m.tool_calls {
                        let blocks: Vec<serde_json::Value> = std::iter::once(serde_json::json!({
                            "type": "text",
                            "text": m.content,
                        }))
                        .chain(tcs.iter().map(|tc| {
                            serde_json::json!({
                                "type": "tool_use",
                                "id": tc.id,
                                "name": tc.name,
                                "input": serde_json::from_str::<serde_json::Value>(&tc.arguments)
                                    .unwrap_or(serde_json::Value::Null),
                            })
                        }))
                        .collect();
                        serde_json::json!({
                            "role": "assistant",
                            "content": blocks
                        })
                    } else {
                        serde_json::json!({
                            "role": "assistant",
                            "content": m.content
                        })
                    }
                }
                MessageRole::System => serde_json::json!({
                    "role": "user", // split 已处理过，不会到这里
                    "content": m.content
                }),
            }
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
    // v0.1+ thinking: effort != None → 加 thinking 块（带 budget_tokens）
    if let Some(budget) = effort.and_then(|e| e.to_anthropic_budget()) {
        body["thinking"] = serde_json::json!({
            "type": "enabled",
            "budget_tokens": budget,
        });
    }
    // v0.4+ tools：Anthropic 协议级 `tools: [{name, description, input_schema}]`
    // PlotCraft 统一存 OpenAI 格式 ToolDefinition，这里转 Anthropic schema
    if let Some(tools) = tools {
        if !tools.is_empty() {
            let anthropic_tools: Vec<serde_json::Value> = tools
                .iter()
                .map(|t| {
                    serde_json::json!({
                        "name": t.function.name,
                        "description": t.function.description,
                        "input_schema": t.function.parameters,
                    })
                })
                .collect();
            body["tools"] = serde_json::Value::Array(anthropic_tools);
        }
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::ToolFunctionDef;

    fn mk_user(content: &str) -> ChatMessage {
        ChatMessage {
            role: MessageRole::User,
            content: content.to_string(),
            partial: None,
            tool_calls: None,
            tool_call_id: None,
        }
    }

    #[test]
    fn parse_anthropic_sse_extracts_text_deltas() {
        let mut buf = String::new();
        let event1 = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n";
        let event2 = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" world\"}}\n\n";
        let event3 = "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";

        buf.push_str(event1);
        let events = parse_anthropic_sse_buffer(&mut buf);
        assert_eq!(events.len(), 1);
        match &events[0] {
            StreamEvent::Text(t) => assert_eq!(t, "Hello"),
            _ => panic!("expected text event"),
        }

        buf.push_str(event2);
        let events = parse_anthropic_sse_buffer(&mut buf);
        assert_eq!(events.len(), 1);
        match &events[0] {
            StreamEvent::Text(t) => assert_eq!(t, " world"),
            _ => panic!("expected text event"),
        }

        buf.push_str(event3);
        let events = parse_anthropic_sse_buffer(&mut buf);
        // message_stop 不产生事件
        assert!(events.is_empty());
        assert!(buf.is_empty());
    }

    #[test]
    fn parse_anthropic_sse_extracts_tool_use_start() {
        let mut buf = String::new();
        let event = "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_abc\",\"name\":\"ask_user_question\"}}\n\n";
        buf.push_str(event);
        let events = parse_anthropic_sse_buffer(&mut buf);
        assert_eq!(events.len(), 1);
        match &events[0] {
            StreamEvent::ToolCalls(calls) => {
                assert_eq!(calls.len(), 1);
                assert_eq!(calls[0].index, 0);
                assert_eq!(calls[0].id.as_deref(), Some("toolu_abc"));
                assert_eq!(calls[0].name.as_deref(), Some("ask_user_question"));
                assert_eq!(calls[0].arguments_delta, "");
            }
            _ => panic!("expected tool_calls event"),
        }
    }

    #[test]
    fn parse_anthropic_sse_extracts_input_json_delta() {
        let mut buf = String::new();
        let event = "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"q\"}}\n\n";
        buf.push_str(event);
        let events = parse_anthropic_sse_buffer(&mut buf);
        assert_eq!(events.len(), 1);
        match &events[0] {
            StreamEvent::ToolCalls(calls) => {
                assert_eq!(calls[0].index, 0);
                assert!(calls[0].id.is_none());
                assert!(calls[0].name.is_none());
                assert_eq!(calls[0].arguments_delta, "{\"q");
            }
            _ => panic!("expected tool_calls event"),
        }
    }

    #[test]
    fn split_system_messages_separates_system_from_rest() {
        let messages = vec![
            ChatMessage {
                role: MessageRole::System,
                content: "You are helpful".to_string(),
                partial: None,
                tool_calls: None,
                tool_call_id: None,
            },
            ChatMessage {
                role: MessageRole::User,
                content: "Hi".to_string(),
                partial: None,
                tool_calls: None,
                tool_call_id: None,
            },
        ];
        let (system, rest) = split_system_messages(&messages);
        assert_eq!(system, Some("You are helpful".to_string()));
        assert_eq!(rest.len(), 1);
        assert!(matches!(rest[0].role, MessageRole::User));
    }

    #[test]
    fn build_anthropic_body_no_effort_omits_thinking() {
        let body = build_anthropic_request_body(
            "claude-sonnet-4-5",
            Some("sys"),
            &[mk_user("hi")],
            Some(super::super::config::EffortLevel::None),
            None,
        );
        let json = serde_json::to_string(&body).unwrap();
        assert!(!json.contains("thinking"), "no thinking field expected: {}", json);
        assert!(!json.contains("tools"), "no tools field expected when None: {}", json);
    }

    #[test]
    fn build_anthropic_body_with_tools_adds_anthropic_schema() {
        let tools = vec![ToolDefinition {
            r#type: "function".to_string(),
            function: ToolFunctionDef {
                name: "ask_user_question".to_string(),
                description: "ask".to_string(),
                parameters: serde_json::json!({"type": "object"}),
            },
        }];
        let body = build_anthropic_request_body(
            "claude-sonnet-4-5",
            None,
            &[mk_user("hi")],
            None,
            Some(&tools),
        );
        let json = serde_json::to_string(&body).unwrap();
        // Anthropic 协议：`tools: [{name, description, input_schema}]` —— 不是 OpenAI 的 nested function
        assert!(json.contains("\"input_schema\""));
        assert!(json.contains("\"name\":\"ask_user_question\""));
        // 不能再有 OpenAI 协议的 "function" 嵌套
        assert!(!json.contains("\"function\""), "should not have nested function for Anthropic: {}", json);
    }

    #[test]
    fn build_anthropic_body_tool_message_uses_content_array() {
        let tool_msg = ChatMessage {
            role: MessageRole::Tool,
            content: "selected A".to_string(),
            partial: None,
            tool_calls: None,
            tool_call_id: Some("toolu_abc".to_string()),
        };
        let body = build_anthropic_request_body(
            "claude-sonnet-4-5",
            None,
            &[mk_user("hi"), tool_msg],
            None,
            None,
        );
        let json = serde_json::to_string(&body).unwrap();
        // Anthropic tool result 协议：role=user, content=[{type: tool_result, tool_use_id, content}]
        assert!(json.contains("\"role\":\"user\""));
        assert!(json.contains("\"type\":\"tool_result\""));
        assert!(json.contains("\"tool_use_id\":\"toolu_abc\""));
        assert!(json.contains("\"content\":\"selected A\""));
    }
}
