//! OpenAI Responses API 流式实现
//!
//! 协议：
//! - POST `{endpoint}/v1/responses`
//! - Header：`Authorization: Bearer <apiKey>`
//! - 请求体：`{model, input, instructions?, stream: true, (tools: [...])?}`
//! - SSE 格式：
//!   ```
//!   event: response.created
//!   data: {"type":"response.created","response":{...}}
//!
//!   event: response.output_item.added
//!   data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_xxx","name":"...","arguments":""}}
//!
//!   event: response.function_call_arguments.delta
//!   data: {"type":"response.function_call_arguments.delta","item_id":"fc_xxx","output_index":0,"delta":"{\"q"}
//!
//!   event: response.function_call_arguments.done
//!   data: {"type":"response.function_call_arguments.done","item_id":"fc_xxx","output_index":0,"arguments":"...完整 JSON"}
//!
//!   event: response.output_item.done
//!   data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc_xxx","name":"...","arguments":"...完整 JSON"}}
//!
//!   event: response.completed
//!   data: {"type":"response.completed","response":{...}}
//!   ```
//!
//! v0.1 只关心 `response.output_text.delta`，提取 `delta`。
//! v0.4+ tool calling 扩：
//! - `response.output_item.added` + `item.type == "function_call"` → start（id + name）
//! - `response.function_call_arguments.delta` → arguments 累积
//! - `response.function_call_arguments.done` → 最终完整 arguments（前端可一次性拿到完整 JSON）
//!
//! 反卡顿模式跟 [streaming] 一致：spawn_blocking 解析 + mpsc 解耦 + 16ms emit 节流。

use std::time::Duration;

use futures::StreamExt;
use reqwest::Client;
use tauri::AppHandle;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::config::LlmConfig;
use super::streaming::{emit_chat_error, emit_throttled, StreamEvent, ToolCallPartial};
use super::types::{ChatMessage, MessageRole, ToolDefinition};
use crate::error::{AppError, AppResult};

const RESPONSES_PATH: &str = "/v1/responses";
const OUTPUT_TEXT_DELTA_EVENT: &str = "response.output_text.delta";
const OUTPUT_ITEM_ADDED_EVENT: &str = "response.output_item.added";
const FUNCTION_CALL_ARGS_DELTA_EVENT: &str = "response.function_call_arguments.delta";
const FUNCTION_CALL_ARGS_DONE_EVENT: &str = "response.function_call_arguments.done";

/// OpenAI Responses API SSE 事件
#[derive(Debug, Default)]
struct ResponsesSseEvent {
    event_type: Option<String>,
    data: Option<String>,
}

/// 启动 OpenAI Responses API 流式回复
///
/// v0.4+ `tools`: 注入到 request body 的 `tools` 字段（OpenAI Responses 协议级）
pub async fn stream_chat_openai_responses(
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
        RESPONSES_PATH
    );
    let (instructions, input_messages) = split_system_messages(&messages);
    let body = build_openai_responses_body(
        config.effective_model(),
        instructions.as_deref(),
        &input_messages,
        config.effort,
        tools.as_deref(),
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

    // 3. parse / emit 走 mpsc channel —— v0.4+ channel 改 StreamEvent
    let (tx, mut rx) = mpsc::channel::<StreamEvent>(64);
    let cancel_parse = cancel.clone();
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
                let events = parse_responses_sse_buffer(&mut buf);
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
/// v0.4+ 同时解析：
/// - `response.output_text.delta` → `Text(delta)`
/// - `response.output_item.added` + `item.type == "function_call"` → `ToolCalls` start（id + name + index）
/// - `response.function_call_arguments.delta` → `ToolCalls` arguments 累积
/// - `response.function_call_arguments.done` → 暂不单独发（前端 arguments 累积到合法 JSON 时识别）
pub(crate) fn parse_responses_sse_buffer(buffer: &mut String) -> Vec<StreamEvent> {
    let mut events = Vec::new();
    while let Some(end) = buffer.find("\n\n") {
        let event: String = buffer.drain(..end + 2).collect();
        let parsed = parse_sse_event(&event);
        let Some(event_type_str) = parsed.event_type.as_deref() else {
            continue;
        };

        match event_type_str {
            OUTPUT_TEXT_DELTA_EVENT => {
                if let Some(data) = &parsed.data {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                        if let Some(delta) = value.get("delta").and_then(|d| d.as_str()) {
                            if !delta.is_empty() {
                                events.push(StreamEvent::Text(delta.to_string()));
                            }
                        }
                    }
                }
            }
            OUTPUT_ITEM_ADDED_EVENT => {
                // v0.4+ function_call start: item.type == "function_call" → 拿 id + name + index
                if let Some(data) = &parsed.data {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                        let item_type = value
                            .get("item")
                            .and_then(|i| i.get("type"))
                            .and_then(|t| t.as_str());
                        if item_type == Some("function_call") {
                            let index = value
                                .get("output_index")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0)
                                as usize;
                            let id = value
                                .get("item")
                                .and_then(|i| i.get("id"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            let name = value
                                .get("item")
                                .and_then(|i| i.get("name"))
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
            }
            FUNCTION_CALL_ARGS_DELTA_EVENT => {
                // v0.4+ arguments 累积
                if let Some(data) = &parsed.data {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                        let index = value
                            .get("output_index")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0)
                            as usize;
                        let delta = value
                            .get("delta")
                            .and_then(|d| d.as_str())
                            .unwrap_or("")
                            .to_string();
                        if !delta.is_empty() {
                            events.push(StreamEvent::ToolCalls(vec![ToolCallPartial {
                                index,
                                id: None,
                                name: None,
                                arguments_delta: delta,
                            }]));
                        }
                    }
                }
            }
            // done 事件暂不单独发；前端 arguments 累积到合法 JSON 时识别（AiChatPanel.vue 处理）
            FUNCTION_CALL_ARGS_DONE_EVENT => {}
            _ => {
                // 其他事件（response.created / response.completed / etc）跳过
            }
        }
    }
    events
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
    tools: Option<&[ToolDefinition]>,
) -> serde_json::Value {
    let input: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            let mut obj = serde_json::json!({
                "role": match m.role {
                    MessageRole::System => "user", // 已 split，不会到这里
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                    MessageRole::Tool => "tool",
                }
            });
            if m.role == MessageRole::Tool {
                if let Some(ref tcid) = m.tool_call_id {
                    obj["tool_call_id"] = serde_json::Value::String(tcid.clone());
                }
            } else {
                obj["content"] = serde_json::Value::String(m.content.clone());
            }
            if m.role == MessageRole::Assistant {
                if let Some(ref tcs) = m.tool_calls {
                    obj["tool_calls"] = serde_json::to_value(tcs).unwrap_or(serde_json::Value::Null);
                }
            }
            obj
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
    // v0.4+ tools：OpenAI Responses 协议级 `tools: [...]`（同 Chat Completions 的格式）
    if let Some(tools) = tools {
        if !tools.is_empty() {
            body["tools"] = serde_json::to_value(tools).unwrap_or(serde_json::Value::Null);
        }
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::config::EffortLevel;
    use crate::llm::types::ToolCallInfo;

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
    fn parse_responses_sse_extracts_text_deltas() {
        let mut buf = String::new();
        let event1 = "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_1\",\"output_index\":0,\"content_index\":0,\"delta\":\"Hello\"}\n\n";
        buf.push_str(event1);
        let events = parse_responses_sse_buffer(&mut buf);
        assert_eq!(events.len(), 1);
        match &events[0] {
            StreamEvent::Text(t) => assert_eq!(t, "Hello"),
            _ => panic!("expected text event"),
        }
    }

    #[test]
    fn parse_responses_sse_extracts_function_call_start() {
        let mut buf = String::new();
        let event = "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"type\":\"function_call\",\"id\":\"fc_abc\",\"name\":\"ask_user_question\",\"arguments\":\"\"}}\n\n";
        buf.push_str(event);
        let events = parse_responses_sse_buffer(&mut buf);
        assert_eq!(events.len(), 1);
        match &events[0] {
            StreamEvent::ToolCalls(calls) => {
                assert_eq!(calls.len(), 1);
                assert_eq!(calls[0].index, 0);
                assert_eq!(calls[0].id.as_deref(), Some("fc_abc"));
                assert_eq!(calls[0].name.as_deref(), Some("ask_user_question"));
                assert_eq!(calls[0].arguments_delta, "");
            }
            _ => panic!("expected tool_calls event"),
        }
    }

    #[test]
    fn parse_responses_sse_extracts_function_call_arguments_delta() {
        let mut buf = String::new();
        // JSON value: delta = "{\"q\"}"  （4 字符 `{` `"` `q` `}` —— 含闭合花括号）
        // Rust literal "\"{\\\"q\\\"}\"" → memory "{\"q\"}" (9 chars 含两端引号)
        let event = "event: response.function_call_arguments.delta\ndata: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_abc\",\"output_index\":0,\"delta\":\"{\\\"q\\\"}\"}\n\n";
        buf.push_str(event);
        let events = parse_responses_sse_buffer(&mut buf);
        assert_eq!(events.len(), 1);
        match &events[0] {
            StreamEvent::ToolCalls(calls) => {
                assert_eq!(calls[0].index, 0);
                assert!(calls[0].id.is_none());
                assert!(calls[0].name.is_none());
                assert_eq!(calls[0].arguments_delta, "{\"q\"}");
            }
            _ => panic!("expected tool_calls event"),
        }
    }

    #[test]
    fn build_responses_body_no_effort_omits_reasoning() {
        let body = build_openai_responses_body("o1", Some("sys"), &[mk_user("hi")], None, None);
        let json = serde_json::to_string(&body).unwrap();
        assert!(!json.contains("reasoning"));
        assert!(!json.contains("tools"));
    }

    #[test]
    fn build_responses_body_with_tools_adds_field() {
        use crate::llm::types::ToolFunctionDef;
        let tools = vec![ToolDefinition {
            r#type: "function".to_string(),
            function: ToolFunctionDef {
                name: "ask_user_question".to_string(),
                description: "ask".to_string(),
                parameters: serde_json::json!({"type": "object"}),
            },
        }];
        let body = build_openai_responses_body("gpt-4o", None, &[mk_user("hi")], None, Some(&tools));
        let json = serde_json::to_string(&body).unwrap();
        assert!(json.contains("\"tools\""));
        assert!(json.contains("\"name\":\"ask_user_question\""));
    }

    #[test]
    fn build_responses_body_tool_message_includes_tool_call_id() {
        let tool_msg = ChatMessage {
            role: MessageRole::Tool,
            content: "answer".to_string(),
            partial: None,
            tool_calls: None,
            tool_call_id: Some("fc_abc".to_string()),
        };
        let body = build_openai_responses_body("gpt-4o", None, &[mk_user("hi"), tool_msg], None, None);
        let json = serde_json::to_string(&body).unwrap();
        assert!(json.contains("\"role\":\"tool\""));
        assert!(json.contains("\"tool_call_id\":\"fc_abc\""));
    }

    #[test]
    fn build_responses_body_assistant_tool_calls_replayed() {
        let assistant_msg = ChatMessage {
            role: MessageRole::Assistant,
            content: String::new(),
            partial: None,
            tool_calls: Some(vec![ToolCallInfo {
                id: "fc_xyz".to_string(),
                name: "ask_user_question".to_string(),
                arguments: "{\"question\":\"x\"}".to_string(),
            }]),
            tool_call_id: None,
        };
        let body = build_openai_responses_body("gpt-4o", None, &[mk_user("hi"), assistant_msg], None, None);
        let json = serde_json::to_string(&body).unwrap();
        assert!(json.contains("\"role\":\"assistant\""));
        assert!(json.contains("\"tool_calls\""));
    }

    // 抑制 unused warnings：保留 EffortLevel 引用（未来测试用）
    #[allow(dead_code)]
    fn _force_effort_use() -> EffortLevel {
        EffortLevel::Low
    }
}
