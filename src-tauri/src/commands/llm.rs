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
use crate::llm::types::ChatMessage;

/// run_id → CancellationToken 映射
///
/// 存 Tauri state，前端 cancel_chat 通过 run_id 找到对应 token 触发取消
pub type RunMap = Arc<Mutex<HashMap<String, CancellationToken>>>;

/// `start_chat` 第二个参数（per-run 选项）
///
/// 镜像 TS 端 `ChatRunOptions`。`None` / 字段 null → 用 config.json 的默认
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRunOptions {
    /// 临时覆盖 model id（不写回 config.json）
    pub model: Option<String>,
    /// reasoning effort / thinking level
    pub effort: Option<EffortLevel>,
}

/// 启动一次 chat run
///
/// 立即返回 `run_id`，实际流式 chunk 通过 `chat:chunk` / `chat:done` / `chat:error` event 推
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
    if let Some(opts) = options {
        if let Some(m) = opts.model {
            let trimmed = m.trim();
            if !trimmed.is_empty() {
                config.model_override = Some(trimmed.to_string());
            }
        }
        config.effort = opts.effort;
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

    // console_log 要在 config move 之前拿 model id
    console_log(
        &app,
        "info",
        "llm",
        format!("[start_chat] {} started (model={})", run_id, config.effective_model()),
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
        let result = stream_chat(app_clone.clone(), run_id_clone.clone(), config, messages, cancel).await;
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
pub async fn cancel_chat(state: tauri::State<'_, RunMap>, run_id: String) -> AppResult<()> {
    let map = state.lock().await;
    if let Some(token) = map.get(&run_id) {
        token.cancel();
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

/// 构造三种 API 的非流式 test body（max_tokens=1 + "hi"）
fn build_test_body(api_format: ApiFormat, model: &str) -> serde_json::Value {
    match api_format {
        ApiFormat::OpenaiChat => serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 1,
            "stream": false,
        }),
        ApiFormat::OpenaiResponses => serde_json::json!({
            "model": model,
            "input": [{"role": "user", "content": "hi"}],
            "max_tokens": 1,
            "stream": false,
        }),
        ApiFormat::AnthropicMessages => serde_json::json!({
            "model": model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}],
        }),
    }
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
pub async fn test_provider(params: TestProviderParams) -> AppResult<TestProviderResult> {
    let endpoint = params.endpoint.trim().to_string();
    let model = params.model.trim().to_string();
    let api_format = params.api_format;

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

    if !status.is_success() {
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

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}
