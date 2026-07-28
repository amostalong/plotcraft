use std::collections::HashMap;
use std::sync::Arc;

use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::llm::config::LlmConfig;
use crate::llm::streaming::stream_chat;
use crate::llm::types::ChatMessage;

/// run_id → CancellationToken 映射
///
/// 存 Tauri state，前端 cancel_chat 通过 run_id 找到对应 token 触发取消
pub type RunMap = Arc<Mutex<HashMap<String, CancellationToken>>>;

/// 启动一次 chat run
///
/// 立即返回 `run_id`，实际流式 chunk 通过 `chat:chunk` / `chat:done` / `chat:error` event 推
#[tauri::command]
pub async fn start_chat(
    app: AppHandle,
    state: tauri::State<'_, RunMap>,
    messages: Vec<ChatMessage>,
) -> AppResult<String> {
    let config = LlmConfig::from_app_config(&app)?;
    // API key 空 + 非本地端点 → 拒
    if config.api_key.is_empty() && !config.endpoint.contains("localhost") {
        return Err(AppError::Config(
            "API key is empty (and endpoint is not localhost)".to_string(),
        ));
    }

    let run_id = Uuid::new_v4().to_string();
    let cancel = CancellationToken::new();
    {
        let mut map = state.lock().await;
        map.insert(run_id.clone(), cancel.clone());
    }

    let app_clone = app.clone();
    let run_id_clone = run_id.clone();
    tokio::spawn(async move {
        let result = stream_chat(app_clone.clone(), run_id_clone.clone(), config, messages, cancel).await;
        if let Err(e) = result {
            eprintln!("[start_chat] error: {}", e);
        }
        // 清理 run map
        let state: tauri::State<RunMap> = app_clone.state();
        let mut map = state.lock().await;
        map.remove(&run_id_clone);
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
