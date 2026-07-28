//! LLM 流式管道：spawn_blocking 解析 + mpsc channel + 16ms emit 节流
//!
//! 反 Locus 卡顿核心实现（见 [CHAT_LLM_DESIGN.md §3 反制 1]）：
//! - `tokio::task::spawn_blocking` 隔离 SSE 状态机 + JSON 解析（CPU 密集不占 tokio runtime）
//! - `tokio::sync::mpsc::channel` 解耦 parse / emit task
//! - emit 按 16ms rAF 节流 + 256 char batch 上限（避免 1000 token/秒 = 1000 emit/秒）
//! - `CancellationToken` 支持玩家中途点 Stop
//!
//! 与 Locus 关键差异：
//! - Locus（[src-tauri/src/llm/chat_completions.rs:205-244]）SSE 解析在 tokio runtime 默认线程池
//! - Locus（[src-tauri/src/llm/chat_completions.rs:50-58]）emit 走 on_text_delta 闭包同步调
//! - PlotCraft 拆 3 task（http / parse / emit），每个独立跑不抢资源

use std::time::{Duration, Instant};

use futures::StreamExt;
use reqwest::Client;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::config::LlmConfig;
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

/// 启动 LLM 流式回复
///
/// 完成后会 emit `chat:done`（成功）或 `chat:error`（失败）。
/// 不返回完整结果，玩家通过订阅 Tauri event 拿 chunk。
pub async fn stream_chat(
    app: AppHandle,
    run_id: String,
    config: LlmConfig,
    messages: Vec<ChatMessage>,
    cancel: CancellationToken,
) -> AppResult<()> {
    // 1. 构造 request（CPU 少，async 跑）
    let api_url = format!(
        "{}{}",
        config.endpoint.trim_end_matches('/'),
        CHAT_COMPLETIONS_PATH
    );
    let body = build_request_body(&config.model, &messages);
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

    // 2. 拿 stream（async 拿，不阻塞）
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

    // 3. parse / emit 走 mpsc channel 解耦
    let (tx, mut rx) = mpsc::channel::<String>(64);
    let cancel_parse = cancel.clone();

    // 4. parse task：SSE 解析丢 spawn_blocking
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
                let deltas = parse_sse_buffer(&mut buf);
                (deltas, buf)
            })
            .await;

            match parsed {
                Ok((deltas, new_buf)) => {
                    buffer = new_buf;
                    for d in deltas {
                        if tx.send(d).await.is_err() {
                            return; // emit task 挂了，退出
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

    // 5. emit task：16ms rAF 节流 + 256 char batch
    let app_emit = app.clone();
    let run_id_emit = run_id.clone();
    let emit_handle = tokio::spawn(async move {
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
                        run_id: run_id_emit.clone(),
                        text: std::mem::take(&mut batch),
                    },
                );
                last_emit = Instant::now();
            }
        }
        // flush 剩余
        if !batch.is_empty() {
            let _ = app_emit.emit(
                "chat:chunk",
                ChatChunk {
                    run_id: run_id_emit.clone(),
                    text: batch,
                },
            );
        }
        let _ = app_emit.emit(
            "chat:done",
            ChatDone {
                run_id: run_id_emit,
                usage: None,
            },
        );
    });

    // 6. 等 parse 完 + 检查 cancel
    tokio::select! {
        _ = parse_handle => {}
        _ = cancel.cancelled() => {
            // 关 reqwest 连接 = drop response
            let _ = emit_handle;  // 留给 emit 跑完
            return Err(AppError::Cancelled);
        }
    }

    // 正常完成，emit 跑完就行
    let _ = emit_handle.await;
    Ok(())
}

/// 解析 SSE buffer，返回 deltas，pop 掉已处理的事件
///
/// OpenAI Chat Completions SSE 格式：
/// ```
/// data: {"choices":[{"delta":{"content":"hello"}}]}
///
/// data: {"choices":[{"delta":{"content":" world"}}]}
///
/// data: [DONE]
///
/// ```
fn parse_sse_buffer(buffer: &mut String) -> Vec<String> {
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

fn build_request_body(model: &str, messages: &[ChatMessage]) -> serde_json::Value {
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
    serde_json::json!({
        "model": model,
        "messages": api_messages,
        "stream": true,
        "stream_options": { "include_usage": true }
    })
}
