//! Settings Tauri commands
//!
//! v0.1 实现 `load_config` / `save_config`：
//! - 存 `%APPDATA%/PlotCraft/config.json`
//! - on-disk 形状 = `AppConfig`（**字面跟 Locus `AppConfig` 顶层兼容**，详见 [llm::config]）
//! - 不做 atomic write（v0.1 文件 ≤ 1KB，DESIGN §5 决定）
//! - 不做 schema 校验（v0.1 缺字段用 serde `#[serde(default)]` 补，类型错就报错）

use std::path::PathBuf;

use tokio::fs;

use crate::error::{AppError, AppResult};
use crate::llm::config::AppConfig;

fn config_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    AppConfig::config_path(app)
}

/// 读 config.json → 缺文件 / 解析失败 → 返回 `AppConfig::default()`（v0.1 简化）
#[tauri::command]
pub async fn load_config(app: tauri::AppHandle) -> AppResult<AppConfig> {
    AppConfig::from_app_config(&app)
}

/// 写 config.json（直接覆盖，不 atomic）
#[tauri::command]
pub async fn save_config(app: tauri::AppHandle, config: AppConfig) -> AppResult<()> {
    let path = config_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| AppError::Config(format!("serialize: {}", e)))?;
    fs::write(&path, json).await?;
    Ok(())
}
