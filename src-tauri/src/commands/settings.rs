//! Settings Tauri commands
//!
//! v0.1 实现 load_config / save_config：
//! - 存 %APPDATA%/PlotCraft/config.json（DESIGN §Configuration v0.1）
//! - 4 字段: llm.{endpoint, apiKey, model} + ui.theme
//! - 不做 atomic write（v0.1 文件小，DESIGN §5 决定）
//! - 不做 schema 校验（v0.1 缺字段补默认，类型错就报错）

use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::fs;

use crate::error::{AppError, AppResult};

const CONFIG_FILE: &str = "config.json";
const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UiConfig {
    #[serde(default)]
    pub theme: String, // "dark" | "light" (v0.1 只用 dark)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LlmConfigDto {
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConfigDto {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub llm: LlmConfigDto,
    #[serde(default)]
    pub ui: UiConfig,
    #[serde(default)]
    pub recent_projects: Vec<String>,
}

fn default_version() -> u32 {
    CONFIG_VERSION
}

fn config_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Config(format!("app_config_dir: {}", e)))?;
    Ok(dir.join(CONFIG_FILE))
}

/// 读 config.json，缺文件返回 default（v0.1 简化：写 default 而不是报错）
#[tauri::command]
pub async fn load_config(app: AppHandle) -> AppResult<ConfigDto> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(ConfigDto {
            version: CONFIG_VERSION,
            ..Default::default()
        });
    }
    let raw = fs::read_to_string(&path).await?;
    let mut config: ConfigDto = serde_json::from_str(&raw)
        .map_err(|e| AppError::Config(format!("invalid JSON: {}", e)))?;
    if config.version == 0 {
        config.version = CONFIG_VERSION;
    }
    Ok(config)
}

/// 写 config.json（直接覆盖，不 atomic，DESIGN §5 v0.1 简化）
#[tauri::command]
pub async fn save_config(app: AppHandle, config: ConfigDto) -> AppResult<()> {
    let path = config_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let mut to_save = config;
    to_save.version = CONFIG_VERSION;
    let json = serde_json::to_string_pretty(&to_save)
        .map_err(|e| AppError::Config(format!("serialize: {}", e)))?;
    fs::write(&path, json).await?;
    Ok(())
}
