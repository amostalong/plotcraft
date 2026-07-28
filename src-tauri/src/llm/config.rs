use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::error::{AppError, AppResult};

const CONFIG_FILE: &str = "config.json";

/// 玩家 LLM 配置（v0.1 从 `%APPDATA%/PlotCraft/config.json` 读，commit 6 加 SettingsView UI）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub endpoint: String,
    #[serde(default)]
    pub api_key: String,
    pub model: String,
}

impl LlmConfig {
    pub fn from_app_config(app: &tauri::AppHandle) -> AppResult<Self> {
        let dir = app
            .path()
            .app_config_dir()
            .map_err(|e| AppError::Config(format!("app_config_dir: {}", e)))?;
        let path = dir.join(CONFIG_FILE);

        if !path.exists() {
            return Err(AppError::Config(format!(
                "config.json not found at {}",
                path.display()
            )));
        }

        let raw = std::fs::read_to_string(&path)?;
        let parsed: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| AppError::Config(format!("invalid JSON: {}", e)))?;

        let llm = parsed
            .get("llm")
            .ok_or_else(|| AppError::Config("missing 'llm' key".to_string()))?;

        let endpoint = llm
            .get("endpoint")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Config("missing 'endpoint'".to_string()))?
            .to_string();
        let api_key = llm
            .get("apiKey")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let model = llm
            .get("model")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::Config("missing 'model'".to_string()))?
            .to_string();

        Ok(LlmConfig {
            endpoint,
            api_key,
            model,
        })
    }
}
