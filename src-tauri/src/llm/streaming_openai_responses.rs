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
use super::streaming::{emit_chat_error, emit_throttled, ChatErrorContext, StreamEvent, ToolCallPartial};
use super::types::{ChatMessage, MessageRole, ToolDefinition};
use crate::console::console_log;
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
    // v0.4.1+ 错误诊断上下文 —— 4 个错误路径共用 + body preview 给玩家复制
    let body_preview = serde_json::to_string(&body)
        .map(|s| s.chars().take(800).collect::<String>())
        .unwrap_or_else(|_| "(serialize failed)".to_string());
    console_log(
        &app,
        "info",
        "stream",
        format!("[stream] openai_responses body preview: {}", body_preview),
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
                    let msg = format!("[openai_responses parse] stream error: {}", e);
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
                    // DEBUG (临时) —— 打印 function_call start event 完整 item 字段
                    // 玩家 2026-07-31 deepseek openai_responses 报 "No tool output found for tool call XXX"
                    // 不知道 deepseek 实际 SSE event 的 item 字段长啥样（call_id / id / 其他字段）
                    // → 玩家跑一次失败 case，paste 此 log 给 AI 反推字段
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                        if value.get("item").and_then(|i| i.get("type")).and_then(|t| t.as_str()) == Some("function_call") {
                            eprintln!("[DEBUG plotcraft] function_call start item = {}",
                                serde_json::to_string(value.get("item").unwrap_or(&serde_json::Value::Null))
                                    .unwrap_or_default());
                        }
                    }
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
                            // v0.4.1+ OpenAI Responses 协议 `item` 字段有两个 ID 概念：
                            // - `item.call_id` = tool call 关联 ID（input 数组里 function_call /
                            //   function_call_output 配对的依据）
                            // - `item.id` = item 内部追踪 ID（OpenAI 用它在 output 数组定位 message）
                            //
                            // 之前 v0.4+ 只解析 `item.id` 当 tc.id，写 input 时塞 `call_id` 字段——
                            // deepseek openai_responses 中转报 "No tool output found for tool call XXX"，
                            // 因为 `item.id` ≠ `item.call_id`，LLM 找不到配对的 function_call_output。
                            // 优先 `call_id`（OpenAI Responses 标准），fallback `id`（老 Responses / 中转兼容）。
                            let id = value
                                .get("item")
                                .and_then(|i| i.get("call_id").or_else(|| i.get("id")))
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
    // v0.4.1+ OpenAI Responses 协议标准 input 数组
    //
    // 4 种 item 类型（不是 Chat Completions 那种 `role: tool` message）：
    //   - user  → `{type: "message", role: "user", content: [{type: "input_text", text}]}`
    //   - assistant text  → `{type: "message", role: "assistant", content: [{type: "output_text", text}]}`
    //   - assistant tool_call  → `{type: "function_call", id, call_id, name, arguments}`
    //     (text 空时只出 function_call item，不出空 message item)
    //   - tool (tool result)  → `{type: "function_call_output", id, call_id, tool_call_id, output}`
    //     **v0.4.4+ 三重 id 同值**：id + call_id + tool_call_id。
    //     OpenAI Responses 2025-09+ 标准用 `call_id`；deepseek openai_responses + 老 Responses
    //     用 `id` 关联（玩家 2026-08-02 撞坑实证）；`tool_call_id` 是 Chat Completions 风格兼容别名。
    //
    // 之前 v0.4+ 直接套 Chat Completions 格式发 Responses API → deepseek openai_responses
    // 中转报 `unknown variant 'tool', expected one of 'user','assistant','system','developer'`
    // (2026-07-31 玩家截图，错误信息明确 deserializer 不认 role=tool)
    //
    // v0.4.2+ function_call / function_call_output **同时写 `id` + `call_id`**（兼容策略）：
    //   - OpenAI Responses 2025-09+ 标准用 `call_id` 字段
    //   - deepseek openai_responses 中转 + 早期 Responses 仍用 `id` 字段
    //   - SSE event 解析也 fallback `item.id` (v0.4.1+)，但写 input 时**两个都写**让任意解析器都能配对
    //   - 同款策略见 v0.4.1+ tools 字段 flatten 修复（写 Responses 标准 + 兼容中转）
    //   - 玩家实测：2026-07-31 deepseek openai_responses 报 "No tool output found for tool call 6665f39f-..."
    //     是因为只写 `call_id` 而 deepseek 用 `id` 关联 → 加写 `id` 解决
    //
    // system 已经被 split_system_messages 抽走 → instructions 字段
    let input: Vec<serde_json::Value> = messages
        .iter()
        .flat_map(|m| -> Vec<serde_json::Value> {
            match m.role {
                MessageRole::System => Vec::new(), // split 过了，不会到这里
                MessageRole::User => vec![serde_json::json!({
                    "type": "message",
                    "role": "user",
                    "content": [{
                        "type": "input_text",
                        "text": m.content,
                    }],
                })],
                MessageRole::Assistant => {
                    // v0.4.3+ OpenAI Responses 协议 input 数组 —— assistant 消息
                    //
                    // 双轨兼容策略（v0.4.3 新增）：
                    // 1. **预先归并** —— assistant message 嵌 `tool_calls` 字段（Chat Completions 风格）
                    //    deepseek Responses API spec（https://api-docs.deepseek.com/zh-cn/guides/responses_api）
                    //    说 `function_call` item "归并到相邻 assistant 消息"——但实际归并逻辑有 bug / 顺序敏感，
                    //    plotcraft 预先归并让 deepseek 不需要做归并（避免 "No tool output found" bug）
                    // 2. **同时**发独立 `function_call` item（OpenAI Responses 2025-09+ 标准）——
                    //    真 OpenAI Responses API strict parser 直接认；deepseek 看到两个也 work（多一份冗余）
                    //
                    // 关键修复：assistant text 为空 + tool_calls 存在时，**也发 minimal message**（content="")
                    // 让 deepseek 归并有目标（之前 v0.4.2 不发，deepseek 找不到相邻 message 归并失败）
                    let mut items: Vec<serde_json::Value> = Vec::new();
                    let has_text = !m.content.is_empty();
                    let has_tools = m.tool_calls.is_some();
                    if has_text || has_tools {
                        let mut msg_obj = serde_json::json!({
                            "type": "message",
                            "role": "assistant",
                        });
                        if has_text {
                            msg_obj["content"] = serde_json::json!([{
                                "type": "output_text",
                                "text": m.content,
                            }]);
                        } else {
                            // minimal message：让 deepseek 归并有目标
                            msg_obj["content"] = serde_json::json!("");
                        }
                        // 嵌 tool_calls 字段（Chat Completions 风格，deepseek 直接用）
                        if let Some(ref tcs) = m.tool_calls {
                            msg_obj["tool_calls"] = serde_json::to_value(tcs)
                                .unwrap_or(serde_json::Value::Null);
                        }
                        items.push(msg_obj);
                    }
                    // 同时发独立 function_call items（OpenAI Responses 风格，deepseek 也会归并）
                    if let Some(ref tcs) = m.tool_calls {
                        for tc in tcs {
                            items.push(serde_json::json!({
                                "type": "function_call",
                                "id": tc.id,
                                "call_id": tc.id,
                                "name": tc.name,
                                "arguments": tc.arguments,
                            }));
                        }
                    }
                    items
                }
                MessageRole::Tool => {
                    // v0.4.4+ 三重 id 兼容：`id` + `call_id` + `tool_call_id` 同值
                    // - OpenAI Responses 2025-09+ 标准用 `call_id` 字段
                    // - **deepseek openai_responses 中转 + 早期 Responses 用 `id` 字段关联**
                    //   （玩家 2026-08-02 撞 "No tool output found for tool call call_00_xxx" 实证：
                    //    只写 call_id 不够，deepseek 配对要 `id`）
                    // - `tool_call_id` 字段是 Chat Completions 风格兼容别名
                    // 之前 v0.4.2+ 这边只写 `call_id` + `tool_call_id`——漏了 `id`，
                    // 老测试也只 assert `call_id`，没 assert `id`，bug 漏到现在。
                    let mut obj = serde_json::json!({
                        "type": "function_call_output",
                        "output": m.content,
                    });
                    if let Some(ref tcid) = m.tool_call_id {
                        obj["id"] = serde_json::Value::String(tcid.clone());
                        obj["call_id"] = serde_json::Value::String(tcid.clone());
                        obj["tool_call_id"] = serde_json::Value::String(tcid.clone());
                    }
                    // DEBUG (临时) —— 打印 function_call_output item 实际发的字段
                    eprintln!("[DEBUG plotcraft] function_call_output item = {}",
                        serde_json::to_string(&obj).unwrap_or_default());
                    vec![obj]
                }
            }
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
    // v0.4+ tools：OpenAI Responses 协议级 `tools: [...]`
    // - 输入是 Chat Completions 格式 `{type, function: {name, description, parameters}}`
    // - **OpenAI Responses API 是平铺** `{type, name, description, parameters}`（不在 function 嵌套里）
    //   v0.4.1+ 之前用 `to_value(tools)` 直发 → 中转代理 / 官方 OpenAI 报 `tools[0]: missing field 'name'`
    //   （玩家 paste 诊断信息后定位的，2026-07-31 deepseek openai_responses 撞坑）
    if let Some(tools) = tools {
        if !tools.is_empty() {
            let flat: Vec<serde_json::Value> = tools
                .iter()
                .map(|t| {
                    serde_json::json!({
                        "type": t.r#type,
                        "name": t.function.name,
                        "description": t.function.description,
                        "parameters": t.function.parameters,
                    })
                })
                .collect();
            body["tools"] = serde_json::Value::Array(flat);
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
        // OpenAI Responses 协议新格式：item 用 call_id 字段
        let mut buf = String::new();
        let event = "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"type\":\"function_call\",\"call_id\":\"fc_abc\",\"name\":\"ask_user_question\",\"arguments\":\"\"}}\n\n";
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
    fn parse_responses_sse_falls_back_to_item_id_for_legacy() {
        // 老 Responses / 某些中转用 `item.id` 而不是 `item.call_id` —— 兼容 fallback
        let mut buf = String::new();
        let event = "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"type\":\"function_call\",\"id\":\"fc_legacy\",\"name\":\"ask_user_question\",\"arguments\":\"\"}}\n\n";
        buf.push_str(event);
        let events = parse_responses_sse_buffer(&mut buf);
        assert_eq!(events.len(), 1);
        match &events[0] {
            StreamEvent::ToolCalls(calls) => {
                assert_eq!(calls[0].id.as_deref(), Some("fc_legacy"));
            }
            _ => panic!("expected tool_calls event"),
        }
    }

    #[test]
    fn parse_responses_sse_prefers_call_id_over_id() {
        // 同一 item 同时有 id 和 call_id —— 优先 call_id（OpenAI Responses 标准）
        let mut buf = String::new();
        let event = "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"type\":\"function_call\",\"id\":\"internal_id_xyz\",\"call_id\":\"fc_real\",\"name\":\"ask_user_question\",\"arguments\":\"\"}}\n\n";
        buf.push_str(event);
        let events = parse_responses_sse_buffer(&mut buf);
        assert_eq!(events.len(), 1);
        match &events[0] {
            StreamEvent::ToolCalls(calls) => {
                assert_eq!(calls[0].id.as_deref(), Some("fc_real"), "call_id 必须覆盖 id");
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

    /// v0.4.1+ OpenAI Responses API tools 必须平铺（`{type, name, ...}`），
    /// 不能是 Chat Completions 嵌套格式 `{type, function: {name, ...}}`。
    /// 之前用 `to_value(tools)` 直发撞 deepseek `tools[0]: missing field 'name'` 报错
    /// （2026-07-31 玩家 copy 诊断信息后定位到）
    #[test]
    fn build_responses_body_tools_flattened_for_responses_api() {
        use crate::llm::types::ToolFunctionDef;
        let tools = vec![ToolDefinition {
            r#type: "function".to_string(),
            function: ToolFunctionDef {
                name: "ask_user_question".to_string(),
                description: "ask a question".to_string(),
                parameters: serde_json::json!({"type": "object", "properties": {}}),
            },
        }];
        let body = build_openai_responses_body("gpt-4o", None, &[mk_user("hi")], None, Some(&tools));
        let tools_val = body.get("tools").expect("tools field missing");
        let tools_arr = tools_val.as_array().expect("tools should be array");
        assert_eq!(tools_arr.len(), 1);
        let tool = &tools_arr[0];
        // 关键：name / description / parameters 必须在 tool 顶层（不在 function 嵌套里）
        assert_eq!(tool.get("type").and_then(|v| v.as_str()), Some("function"));
        assert_eq!(tool.get("name").and_then(|v| v.as_str()), Some("ask_user_question"));
        assert_eq!(
            tool.get("description").and_then(|v| v.as_str()),
            Some("ask a question")
        );
        assert!(tool.get("parameters").is_some(), "parameters must be at top-level");
        // Chat Completions 嵌套格式（`function: {...}`）绝对不能出现
        assert!(tool.get("function").is_none(), "must NOT wrap in 'function' key for Responses API");
    }

    #[test]
    fn build_responses_body_tool_message_becomes_function_call_output() {
        let tool_msg = ChatMessage {
            role: MessageRole::Tool,
            content: "answer".to_string(),
            partial: None,
            tool_calls: None,
            tool_call_id: Some("fc_abc".to_string()),
        };
        let body = build_openai_responses_body("gpt-4o", None, &[mk_user("hi"), tool_msg], None, None);
        let input = body.get("input").and_then(|v| v.as_array()).expect("input array");
        assert_eq!(input.len(), 2, "user message + tool result = 2 items");
        let tool_item = &input[1];
        assert_eq!(tool_item.get("type").and_then(|v| v.as_str()), Some("function_call_output"));
        // v0.4.4+ 三重 id 兼容：id + call_id + tool_call_id 同值
        // - OpenAI Responses 2025-09+ 标准用 `call_id`
        // - deepseek openai_responses 中转 + 早期 Responses 用 `id`（玩家 2026-08-02 撞 "No tool output found" 实证）
        // - `tool_call_id` 字段是 Chat Completions 风格兼容别名
        // 之前 v0.4.2+ 这边只 assert call_id + tool_call_id，漏了 id 字段的 assert，
        // bug 一直漏到现在。
        assert_eq!(tool_item.get("id").and_then(|v| v.as_str()), Some("fc_abc"));
        assert_eq!(tool_item.get("call_id").and_then(|v| v.as_str()), Some("fc_abc"));
        assert_eq!(tool_item.get("tool_call_id").and_then(|v| v.as_str()), Some("fc_abc"));
        assert_eq!(tool_item.get("output").and_then(|v| v.as_str()), Some("answer"));
        // 严格：不能有 Chat Completions 风格的 role 字段（type 已表达）
        assert!(tool_item.get("role").is_none(), "Responses API 不认 role 字段（type 已表达）");
    }

    #[test]
    fn build_responses_body_assistant_tool_calls_become_function_call_items() {
        // v0.4.3+ 行为：text 空 + tool_calls 存在 → 发 minimal message (content="") 嵌 tool_calls + 独立 function_call item
        // 原因：deepseek Responses API spec 说 function_call "归并到相邻 assistant 消息"——plotcraft 预先归并
        // 让 deepseek 不需要做归并（避免归并逻辑 bug）
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
        let input = body.get("input").and_then(|v| v.as_array()).expect("input array");
        // user + minimal message (with tool_calls) + function_call = 3 items
        assert_eq!(input.len(), 3, "user + minimal message (with tool_calls) + function_call = 3 items");
        // [0] = user message
        let user_item = &input[0];
        assert_eq!(user_item.get("type").and_then(|v| v.as_str()), Some("message"));
        assert_eq!(user_item.get("role").and_then(|v| v.as_str()), Some("user"));
        // [1] = minimal assistant message (content="", with tool_calls 字段)
        let msg_item = &input[1];
        assert_eq!(msg_item.get("type").and_then(|v| v.as_str()), Some("message"));
        assert_eq!(msg_item.get("role").and_then(|v| v.as_str()), Some("assistant"));
        assert_eq!(msg_item.get("content").and_then(|v| v.as_str()), Some(""), "minimal message content=''");
        // 嵌 tool_calls 字段（Chat Completions 风格，deepseek 直接用）
        let tool_calls = msg_item.get("tool_calls").and_then(|v| v.as_array()).expect("tool_calls 字段");
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].get("id").and_then(|v| v.as_str()), Some("fc_xyz"));
        // [2] = 独立 function_call item（OpenAI Responses 风格兜底）
        let fc_item = &input[2];
        assert_eq!(fc_item.get("type").and_then(|v| v.as_str()), Some("function_call"));
        assert_eq!(fc_item.get("call_id").and_then(|v| v.as_str()), Some("fc_xyz"));
        assert_eq!(fc_item.get("id").and_then(|v| v.as_str()), Some("fc_xyz"));
        assert_eq!(fc_item.get("name").and_then(|v| v.as_str()), Some("ask_user_question"));
        assert_eq!(fc_item.get("arguments").and_then(|v| v.as_str()), Some("{\"question\":\"x\"}"));
        // 严格：function_call item 不应该嵌 tool_calls 字段
        assert!(fc_item.get("tool_calls").is_none(), "function_call item 不嵌 tool_calls 字段");
        assert!(fc_item.get("role").is_none(), "function_call item 没有 role 字段");
    }

    #[test]
    fn build_responses_body_user_message_uses_input_text() {
        let body = build_openai_responses_body("gpt-4o", None, &[mk_user("hi")], None, None);
        let input = body.get("input").and_then(|v| v.as_array()).expect("input array");
        assert_eq!(input.len(), 1);
        let user_item = &input[0];
        assert_eq!(user_item.get("type").and_then(|v| v.as_str()), Some("message"));
        assert_eq!(user_item.get("role").and_then(|v| v.as_str()), Some("user"));
        let content = user_item.get("content").and_then(|v| v.as_array()).expect("content array");
        assert_eq!(content.len(), 1);
        assert_eq!(content[0].get("type").and_then(|v| v.as_str()), Some("input_text"));
        assert_eq!(content[0].get("text").and_then(|v| v.as_str()), Some("hi"));
    }

    #[test]
    fn build_responses_body_assistant_text_uses_output_text() {
        let assistant_msg = ChatMessage {
            role: MessageRole::Assistant,
            content: "好的".to_string(),
            partial: None,
            tool_calls: None,
            tool_call_id: None,
        };
        let body = build_openai_responses_body("gpt-4o", None, &[assistant_msg], None, None);
        let input = body.get("input").and_then(|v| v.as_array()).expect("input array");
        assert_eq!(input.len(), 1);
        let asst_item = &input[0];
        assert_eq!(asst_item.get("type").and_then(|v| v.as_str()), Some("message"));
        assert_eq!(asst_item.get("role").and_then(|v| v.as_str()), Some("assistant"));
        let content = asst_item.get("content").and_then(|v| v.as_array()).expect("content array");
        assert_eq!(content[0].get("type").and_then(|v| v.as_str()), Some("output_text"));
        assert_eq!(content[0].get("text").and_then(|v| v.as_str()), Some("好的"));
    }

    #[test]
    fn build_responses_body_assistant_text_plus_tool_calls_emits_both() {
        let assistant_msg = ChatMessage {
            role: MessageRole::Assistant,
            content: "我先问一下".to_string(),
            partial: None,
            tool_calls: Some(vec![ToolCallInfo {
                id: "fc_mix".to_string(),
                name: "ask_user_question".to_string(),
                arguments: "{}".to_string(),
            }]),
            tool_call_id: None,
        };
        let body = build_openai_responses_body("gpt-4o", None, &[mk_user("hi"), assistant_msg], None, None);
        let input = body.get("input").and_then(|v| v.as_array()).expect("input array");
        // v0.4.3+ 行为：text + tool_calls 都存在 → message(text) 嵌 tool_calls + 独立 function_call item
        // user + message(text, with tool_calls) + function_call = 3 items
        assert_eq!(input.len(), 3);
        let msg_item = &input[1];
        assert_eq!(msg_item.get("type").and_then(|v| v.as_str()), Some("message"));
        assert_eq!(msg_item.get("role").and_then(|v| v.as_str()), Some("assistant"));
        // content 是 output_text 块
        let content = msg_item.get("content").and_then(|v| v.as_array()).expect("content array");
        assert_eq!(content[0].get("type").and_then(|v| v.as_str()), Some("output_text"));
        assert_eq!(content[0].get("text").and_then(|v| v.as_str()), Some("我先问一下"));
        // 嵌 tool_calls 字段（v0.4.3+ 新增）
        let tool_calls = msg_item.get("tool_calls").and_then(|v| v.as_array()).expect("tool_calls 字段");
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].get("id").and_then(|v| v.as_str()), Some("fc_mix"));
        // 独立 function_call item（兜底）
        let fc_item = &input[2];
        assert_eq!(fc_item.get("type").and_then(|v| v.as_str()), Some("function_call"));
        assert_eq!(fc_item.get("call_id").and_then(|v| v.as_str()), Some("fc_mix"));
    }

    // 抑制 unused warnings：保留 EffortLevel 引用（未来测试用）
    #[allow(dead_code)]
    fn _force_effort_use() -> EffortLevel {
        EffortLevel::Low
    }
}
