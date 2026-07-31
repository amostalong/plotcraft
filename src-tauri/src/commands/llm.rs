use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::console::console_log;
use crate::error::{AppError, AppResult};
use crate::llm::config::{ApiFormat, EffortLevel, LlmConfig};
use crate::llm::streaming::stream_chat;
use crate::llm::types::{ChatMessage, ToolDefinition};

/// run_id → CancellationToken 映射
///
/// 存 Tauri state，前端 cancel_chat 通过 run_id 找到对应 token 触发取消
pub type RunMap = Arc<Mutex<HashMap<String, CancellationToken>>>;

/// `start_chat` 第二个参数（per-run 选项）
///
/// 镜像 TS 端 `ChatRunOptions`。`None` / 字段 null → 用 config.json 的默认
///
/// v0.4+ 取消 v0.3+ 的 `force_json` 字段：
/// - 老逻辑 force_json=true → `response_format: json_object` → LLM 返 JSON 字符串
/// - v0.4+ 改走 tool calling：schema 本身就是协议级结构化约束，不需要 response_format
/// - response_format 跟 tools 在 OpenAI 协议里互斥，强制开 response_format 会让 LLM 忽略 tools
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRunOptions {
    /// 临时覆盖 model id（不写回 config.json）
    pub model: Option<String>,
    /// reasoning effort / thinking level
    pub effort: Option<EffortLevel>,
    /// v0.4+ tool calling: 注入到 LLM request 的 tools 字段
    /// - 关闭的 tool 不传（用户硬要求）→ 传 None / 空数组时整个 tools 字段不下发
    /// - 协议级 tool 注入，build body 时按 api_format 转 schema
    /// - 玩家通过 Settings tab 控制开关（前端 lib/llm-connection.ts 的 resolveEnabledTools 过滤）
    #[serde(default)]
    pub tools: Option<Vec<ToolDefinition>>,
}

/// 启动一次 chat run
///
/// 立即返回 `run_id`，实际流式 chunk 通过 `chat:chunk` / `chat:tool_call` / `chat:done` / `chat:error` event 推
#[tauri::command]
pub async fn start_chat(
    app: AppHandle,
    state: tauri::State<'_, RunMap>,
    messages: Vec<ChatMessage>,
    options: Option<ChatRunOptions>,
) -> AppResult<String> {
    let mut config = LlmConfig::from_app_config(&app)?;
    // API key 空 + 非本地端点 → 拒
    if config.api_key.is_empty() && !config.endpoint.contains("localhost") {
        let err = AppError::Config("API key is empty (and endpoint is not localhost)".to_string());
        console_log(&app, "error", "llm", &err.to_string());
        return Err(err);
    }

    // 套用 per-run 选项
    let mut tools: Option<Vec<ToolDefinition>> = None;
    if let Some(opts) = options {
        if let Some(m) = opts.model {
            let trimmed = m.trim();
            if !trimmed.is_empty() {
                config.model_override = Some(trimmed.to_string());
            }
        }
        config.effort = opts.effort;
        // v0.4+ tools: 空数组规范化成 None（让 build body 整字段不下发）
        if let Some(t) = opts.tools {
            if !t.is_empty() {
                tools = Some(t);
            }
        }
    }

    // model_override 空 + 主 model 空 → 没 model 不能跑
    if config.effective_model().is_empty() {
        let err = AppError::Config("model is empty".to_string());
        console_log(&app, "error", "llm", &err.to_string());
        return Err(err);
    }

    let run_id = Uuid::new_v4().to_string();
    let cancel = CancellationToken::new();
    {
        let mut map = state.lock().await;
        map.insert(run_id.clone(), cancel.clone());
    }

    // 启动轨迹: 一行把关键选项 (model / api_format / effort / tools / msgs 数量) 全打出来
    // 排查 "为什么用错 model" / "为什么 LLM 没出 tool call" 第一站
    console_log(
        &app,
        "info",
        "llm",
        format!(
            "[start_chat] {} started: model={}, api_format={:?}, effort={:?}, tools={}, messages={}",
            run_id,
            config.effective_model(),
            config.api_format,
            config.effort,
            tools.as_ref().map(|t| t.len()).unwrap_or(0),
            messages.len()
        ),
    );

    let app_clone = app.clone();
    let run_id_clone = run_id.clone();
    console_log(
        &app,
        "info",
        "llm",
        format!("[start_chat] {} spawning stream_chat task", run_id_clone),
    );
    tokio::spawn(async move {
        console_log(
            &app_clone,
            "info",
            "llm",
            format!("[start_chat] {} task entered runtime", run_id_clone),
        );
        let result = stream_chat(
            app_clone.clone(),
            run_id_clone.clone(),
            config,
            messages,
            cancel,
            tools,
        )
        .await;
        if let Err(e) = result {
            eprintln!("[start_chat] error: {}", e);
            console_log(&app_clone, "error", "llm", format!("[start_chat] {}: {}", run_id_clone, e));
        } else {
            console_log(
                &app_clone,
                "info",
                "llm",
                format!("[start_chat] {} completed OK", run_id_clone),
            );
        }
        // 清理 run map
        let state: tauri::State<RunMap> = app_clone.state();
        let mut map = state.lock().await;
        map.remove(&run_id_clone);
        console_log(
            &app_clone,
            "info",
            "llm",
            format!("[start_chat] {} run map cleaned", run_id_clone),
        );
    });

    Ok(run_id)
}

/// 取消一次 chat run
#[tauri::command]
pub async fn cancel_chat(
    app: AppHandle,
    state: tauri::State<'_, RunMap>,
    run_id: String,
) -> AppResult<()> {
    let map = state.lock().await;
    if let Some(token) = map.get(&run_id) {
        token.cancel();
        console_log(
            &app,
            "info",
            "llm",
            format!("[cancel_chat] {} token cancelled", run_id),
        );
    } else {
        console_log(
            &app,
            "warn",
            "llm",
            format!("[cancel_chat] {} token NOT found (already done?)", run_id),
        );
    }
    Ok(())
}

// === test_provider ===
//
// 非流式 ping 一次 endpoint+apiKey+model 组合
// 不读 config.json —— 参数直接传，UI 端能测任意临时组合

/// `test_provider` 命令参数
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestProviderParams {
    pub endpoint: String,
    pub api_key: String,
    pub api_format: ApiFormat,
    pub model: String,
}

/// `test_provider` 命令返回值
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestProviderResult {
    pub ok: bool,
    pub status: Option<u16>,
    pub error: Option<String>,
    /// 模型实际返回的片段（ok=true 时给玩家看）
    pub response: Option<String>,
    pub endpoint: String,
    pub model: String,
    pub api_format: ApiFormat,
}

/// 构造三种 API 的非流式 chat body
///
/// - OpenAI chat / responses：messages 原样进 `messages` / `input`
/// - Anthropic：system 消息抠出来进顶层 `system` 字段（Anthropic 不允许 messages 里带 system），
///   其余消息进 `messages`
fn build_chat_body(
    api_format: ApiFormat,
    model: &str,
    messages: &[ChatMessage],
    max_tokens: u32,
) -> serde_json::Value {
    match api_format {
        ApiFormat::OpenaiChat => serde_json::json!({
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "stream": false,
        }),
        ApiFormat::OpenaiResponses => serde_json::json!({
            "model": model,
            "input": messages,
            "max_tokens": max_tokens,
            "stream": false,
        }),
        ApiFormat::AnthropicMessages => {
            let system: Vec<&str> = messages
                .iter()
                .filter(|m| matches!(m.role, crate::llm::types::MessageRole::System))
                .map(|m| m.content.as_str())
                .collect();
            let rest: Vec<&ChatMessage> = messages
                .iter()
                .filter(|m| !matches!(m.role, crate::llm::types::MessageRole::System))
                .collect();
            serde_json::json!({
                "model": model,
                "max_tokens": max_tokens,
                "system": system.join("\n\n"),
                "messages": rest,
            })
        }
    }
}

/// test_provider 的 body：一条 "hi" + max_tokens=1（行为跟泛化前一致）
fn build_test_body(api_format: ApiFormat, model: &str) -> serde_json::Value {
    let messages = [ChatMessage {
        role: crate::llm::types::MessageRole::User,
        content: "hi".to_string(),
        partial: None,
        tool_calls: None,
        tool_call_id: None,
    }];
    build_chat_body(api_format, model, &messages, 1)
}

/// test_provider 三种 API 的 URL path
fn test_endpoint_path(api_format: ApiFormat) -> &'static str {
    match api_format {
        ApiFormat::OpenaiChat => "/chat/completions",
        ApiFormat::OpenaiResponses => "/v1/responses",
        ApiFormat::AnthropicMessages => "/v1/messages",
    }
}

/// 从三种 API 的非流式响应里抠 first content text
fn extract_response_text(api_format: ApiFormat, body: &serde_json::Value) -> Option<String> {
    match api_format {
        ApiFormat::OpenaiChat => body
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .map(|s| s.to_string()),
        ApiFormat::OpenaiResponses => body
            .get("output")
            .and_then(|o| o.get(0))
            .and_then(|o| o.get("content"))
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("text"))
            .and_then(|t| t.as_str())
            .map(|s| s.to_string()),
        ApiFormat::AnthropicMessages => body
            .get("content")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("text"))
            .and_then(|t| t.as_str())
            .map(|s| s.to_string()),
    }
}

/// 构造 test_provider 用的 auth header（跟 streaming 实现一致）
fn apply_auth(
    req: reqwest::RequestBuilder,
    api_format: ApiFormat,
    api_key: &str,
) -> reqwest::RequestBuilder {
    if api_key.is_empty() {
        return req;
    }
    match api_format {
        ApiFormat::AnthropicMessages => req.header("x-api-key", api_key),
        ApiFormat::OpenaiChat | ApiFormat::OpenaiResponses => {
            req.header("Authorization", format!("Bearer {}", api_key))
        }
    }
}

/// Test connection —— 非流式 ping 一次，验证 endpoint+apiKey+model 端到端可用
#[tauri::command]
pub async fn test_provider(
    app: AppHandle,
    params: TestProviderParams,
) -> AppResult<TestProviderResult> {
    let endpoint = params.endpoint.trim().to_string();
    let model = params.model.trim().to_string();
    let api_format = params.api_format;
    console_log(
        &app,
        "info",
        "llm",
        format!(
            "[test_provider] starting: endpoint={}, model={}, api_format={:?}",
            endpoint, model, api_format
        ),
    );

    // 客户端共用（保持跟 streaming 一样的超时配置）
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::Llm(format!("reqwest builder: {}", e)))?;

    let api_url = format!("{}{}", endpoint.trim_end_matches('/'), test_endpoint_path(api_format));
    let body = build_test_body(api_format, &model);
    let request_bytes = serde_json::to_vec(&body)
        .map_err(|e| AppError::Llm(format!("request serialization: {}", e)))?;

    let mut req = client
        .post(&api_url)
        .header("Content-Type", "application/json");
    req = apply_auth(req, api_format, &params.api_key);
    if matches!(api_format, ApiFormat::AnthropicMessages) {
        req = req.header("anthropic-version", "2023-06-01");
    }
    let req = req.body(request_bytes);

    let result = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            console_log(
                &app,
                "error",
                "llm",
                format!("[test_provider] req.send FAILED: {}", e),
            );
            return Ok(TestProviderResult {
                ok: false,
                status: None,
                error: Some(format!("request failed: {}", e)),
                response: None,
                endpoint,
                model,
                api_format,
            });
        }
    };

    let status = result.status();
    let status_code = status.as_u16();
    let body_text = result.text().await.unwrap_or_default();
    console_log(
        &app,
        "info",
        "llm",
        format!("[test_provider] response: status={}, body_len={}", status_code, body_text.len()),
    );

    if !status.is_success() {
        console_log(
            &app,
            "error",
            "llm",
            format!("[test_provider] HTTP non-success: {} body={}", status_code, truncate(&body_text, 500)),
        );
        return Ok(TestProviderResult {
            ok: false,
            status: Some(status_code),
            error: Some(format!("HTTP {}: {}", status_code, truncate(&body_text, 500))),
            response: None,
            endpoint,
            model,
            api_format,
        });
    }

    let parsed: serde_json::Value = match serde_json::from_str(&body_text) {
        Ok(v) => v,
        Err(e) => {
            console_log(
                &app,
                "error",
                "llm",
                format!(
                    "[test_provider] invalid JSON response: {} body={}",
                    e,
                    truncate(&body_text, 200)
                ),
            );
            return Ok(TestProviderResult {
                ok: false,
                status: Some(status_code),
                error: Some(format!(
                    "invalid JSON response: {} (body: {})",
                    e,
                    truncate(&body_text, 200)
                )),
                response: None,
                endpoint,
                model,
                api_format,
            });
        }
    };

    let response_text = extract_response_text(api_format, &parsed);
    console_log(
        &app,
        "info",
        "llm",
        format!(
            "[test_provider] OK: response_len={}, has_text={}",
            response_text.as_ref().map(|s| s.len()).unwrap_or(0),
            response_text.is_some()
        ),
    );

    Ok(TestProviderResult {
        ok: true,
        status: Some(status_code),
        error: None,
        response: response_text.map(|s| truncate(&s, 200)),
        endpoint,
        model,
        api_format,
    })
}

// === generate ===
//
// 非流式一次性问答（concept tab「给 3-5 个备选」用，不适合流式）
// 骨架复用 test_provider：build_chat_body / extract_response_text / apply_auth
// 不读 config.json —— endpoint/apiKey/apiFormat/model 由前端 settings store 传入

/// `generate` 命令参数
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateParams {
    pub endpoint: String,
    pub api_key: String,
    pub api_format: ApiFormat,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub max_tokens: Option<u32>,
}

/// `generate` 命令返回值
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateResult {
    pub text: String,
}

/// 非流式 generate —— 一次性问答，错误处理对齐 test_provider
/// （HTTP 非 2xx / 连接失败 → AppError::Llm，前端走 error-messages.ts 翻玩家文案）
#[tauri::command]
pub async fn generate(app: AppHandle, params: GenerateParams) -> AppResult<GenerateResult> {
    let endpoint = params.endpoint.trim().to_string();
    let model = params.model.trim().to_string();
    let api_format = params.api_format;
    let max_tokens = params.max_tokens.unwrap_or(2048);
    console_log(
        &app,
        "info",
        "llm",
        format!(
            "[generate] starting: endpoint={}, model={}, api_format={:?}, max_tokens={}, messages={}",
            endpoint, model, api_format, max_tokens, params.messages.len()
        ),
    );

    if params.messages.is_empty() {
        console_log(&app, "error", "llm", "[generate] messages is empty");
        return Err(AppError::Llm("messages is empty".to_string()));
    }

    // 跟 test_provider / streaming 同一套超时配置（总时长放宽到 120s：一次性生成比 ping 慢）
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::Llm(format!("reqwest builder: {}", e)))?;

    let api_url = format!("{}{}", endpoint.trim_end_matches('/'), test_endpoint_path(api_format));
    let body = build_chat_body(api_format, &model, &params.messages, max_tokens);
    let request_bytes = serde_json::to_vec(&body)
        .map_err(|e| AppError::Llm(format!("request serialization: {}", e)))?;

    let mut req = client
        .post(&api_url)
        .header("Content-Type", "application/json");
    req = apply_auth(req, api_format, &params.api_key);
    if matches!(api_format, ApiFormat::AnthropicMessages) {
        req = req.header("anthropic-version", "2023-06-01");
    }
    let req = req.body(request_bytes);

    let result = req.send().await.map_err(|e| {
        console_log(
            &app,
            "error",
            "llm",
            format!("[generate] req.send FAILED: {}", e),
        );
        AppError::Llm(format!("request failed: {}", e))
    })?;

    let status = result.status();
    let body_text = result.text().await.unwrap_or_default();
    console_log(
        &app,
        "info",
        "llm",
        format!(
            "[generate] response: status={}, body_len={}",
            status.as_u16(),
            body_text.len()
        ),
    );

    if !status.is_success() {
        console_log(
            &app,
            "error",
            "llm",
            format!(
                "[generate] HTTP non-success: {} body={}",
                status.as_u16(),
                truncate(&body_text, 500)
            ),
        );
        return Err(AppError::Llm(format!(
            "HTTP {}: {}",
            status.as_u16(),
            truncate(&body_text, 500)
        )));
    }

    let parsed: serde_json::Value = serde_json::from_str(&body_text).map_err(|e| {
        console_log(
            &app,
            "error",
            "llm",
            format!(
                "[generate] invalid JSON response: {} body={}",
                e,
                truncate(&body_text, 200)
            ),
        );
        AppError::Llm(format!(
            "invalid JSON response: {} (body: {})",
            e,
            truncate(&body_text, 200)
        ))
    })?;

    let text = extract_response_text(api_format, &parsed)
        .ok_or_else(|| {
            console_log(&app, "error", "llm", "[generate] response has no text content");
            AppError::Llm("response has no text content".to_string())
        })?;

    console_log(
        &app,
        "info",
        "llm",
        format!("[generate] OK: text_len={}", text.len()),
    );

    Ok(GenerateResult { text })
}

/// 字符数安全截断（中文等多字节字符不会切半 → 不会 panic）
fn truncate(s: &str, max: usize) -> String {
    let mut iter = s.chars();
    let out: String = iter.by_ref().take(max).collect();
    if iter.next().is_some() {
        format!("{}…", out)
    } else {
        out
    }
}
