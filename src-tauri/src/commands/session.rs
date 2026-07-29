//! Chat session 持久化 Tauri commands
//!
//! v0.1 简化：
//! - 单 session 持久化（不切换、不按项目分）—— `default.json`
//! - 存 `%APPDATA%/PlotCraft/sessions/default.json`
//! - 格式：JSON `{ "version": 1, "updated_at": ISO8601, "messages": [{role, content}] }`
//! - atomic write（tmp → rename）—— 跟 model_catalog 一样
//!
//! v0.2+ 路线：
//! - 多 session（按 sessionId 切）
//! - 按项目分组（每个 project 一份 session）
//! - session 列表 UI
//!
//! 设计参考：PlotCraft AGENTS.md v0.1 路线 + Locus session_storage 思路

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tokio::fs;

use crate::error::AppResult;
use crate::llm::types::ChatMessage;

/// v0.1 on-disk session schema
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionFile {
    /// schema 版本（v0.1 = 1，v0.2 改了字段能区分）
    pub version: u32,
    /// ISO 8601 timestamp（chrono 序列化）
    pub updated_at: String,
    /// 完整 message 列表
    pub messages: Vec<ChatMessage>,
}

const SESSION_FILE_NAME: &str = "default.json";
const SESSION_TMP_SUFFIX: &str = ".tmp";
const SESSION_VERSION: u32 = 1;
/// v0.1 单文件上限 5MB（约 5K 条 ~1KB 的 message）—— 超过不让 save 防玩家 disk 撑爆
const MAX_SESSION_BYTES: u64 = 5 * 1024 * 1024;

/// session 文件路径：%APPDATA%/PlotCraft/sessions/default.json
fn session_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| crate::error::AppError::Config(format!("app_config_dir: {}", e)))?;
    Ok(dir.join("sessions").join(SESSION_FILE_NAME))
}

/// session 目录路径
fn session_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| crate::error::AppError::Config(format!("app_config_dir: {}", e)))?;
    Ok(dir.join("sessions"))
}

/// Tauri command: 读 session 文件 —— 无文件 / 解析失败 → 返回空 messages（不报错）
///
/// 设计：v0.1 不抛错，让前端能"优雅降级"到空 session。损坏文件留盘 + console
/// 提示，玩家可以手动删 `default.json` 重置。
#[tauri::command]
pub async fn load_session(app: tauri::AppHandle) -> AppResult<Vec<ChatMessage>> {
    let path = session_path(&app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let bytes = fs::read(&path).await.map_err(|e| {
        crate::error::AppError::Config(format!("read session {}: {}", path.display(), e))
    })?;
    // 损坏文件：返回空（前端不感知），错误走 console
    match serde_json::from_slice::<SessionFile>(&bytes) {
        Ok(s) => Ok(s.messages),
        Err(e) => {
            crate::console::console_log(
                &app,
                "warn",
                "session",
                format!("load_session: failed to parse {}: {}", path.display(), e),
            );
            Ok(vec![])
        }
    }
}

/// Tauri command: 写 session 文件 —— atomic write（tmp → rename）
///
/// 设计：
/// - 上限 5MB（防玩家 disk 撑爆）
/// - atomic write（先写 .tmp 再 rename 覆盖）—— 跟 model_catalog 一致
/// - 失败不阻塞前端 UI（前端 console 已经能看到错误）
#[tauri::command]
pub async fn save_session(app: tauri::AppHandle, messages: Vec<ChatMessage>) -> AppResult<()> {
    let path = session_path(&app)?;
    let dir = session_dir(&app)?;
    fs::create_dir_all(&dir).await.map_err(|e| {
        let err = crate::error::AppError::Config(format!(
            "create_dir_all {}: {}",
            dir.display(),
            e
        ));
        crate::console::console_log(&app, "error", "session", err.to_string());
        err
    })?;

    let payload = SessionFile {
        version: SESSION_VERSION,
        updated_at: chrono::Utc::now().to_rfc3339(),
        messages,
    };

    let json = serde_json::to_vec_pretty(&payload).map_err(|e| {
        let err = crate::error::AppError::Config(format!("serialize session: {}", e));
        crate::console::console_log(&app, "error", "session", err.to_string());
        err
    })?;

    if json.len() as u64 > MAX_SESSION_BYTES {
        let err = crate::error::AppError::Config(format!(
            "session too large: {} bytes (max {})",
            json.len(),
            MAX_SESSION_BYTES
        ));
        crate::console::console_log(&app, "error", "session", err.to_string());
        return Err(err);
    }

    // atomic write: tmp → rename
    let tmp_path = path.with_extension(format!("json{}", SESSION_TMP_SUFFIX));
    fs::write(&tmp_path, &json).await.map_err(|e| {
        let err = crate::error::AppError::Config(format!(
            "write session tmp {}: {}",
            tmp_path.display(),
            e
        ));
        crate::console::console_log(&app, "error", "session", err.to_string());
        err
    })?;
    fs::rename(&tmp_path, &path).await.map_err(|e| {
        let err = crate::error::AppError::Config(format!(
            "rename session {} → {}: {}",
            tmp_path.display(),
            path.display(),
            e
        ));
        crate::console::console_log(&app, "error", "session", err.to_string());
        err
    })?;

    crate::console::console_log(
        &app,
        "info",
        "session",
        format!(
            "session saved: {} messages, {} bytes",
            payload.messages.len(),
            json.len()
        ),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::types::MessageRole;

    #[test]
    fn session_file_roundtrip() {
        let original = SessionFile {
            version: SESSION_VERSION,
            updated_at: "2026-07-29T16:00:00Z".to_string(),
            messages: vec![
                ChatMessage {
                    role: MessageRole::User,
                    content: "hi".to_string(),
                },
                ChatMessage {
                    role: MessageRole::Assistant,
                    content: "hello!".to_string(),
                },
            ],
        };
        let json = serde_json::to_vec_pretty(&original).unwrap();
        let parsed: SessionFile = serde_json::from_slice(&json).unwrap();
        assert_eq!(parsed.version, SESSION_VERSION);
        assert_eq!(parsed.messages.len(), 2);
        assert_eq!(parsed.messages[0].content, "hi");
        assert!(matches!(parsed.messages[1].role, MessageRole::Assistant));
    }

    #[test]
    fn empty_session_serializes() {
        let s = SessionFile {
            version: SESSION_VERSION,
            updated_at: "2026-07-29T16:00:00Z".to_string(),
            messages: vec![],
        };
        let json = serde_json::to_vec_pretty(&s).unwrap();
        let parsed: SessionFile = serde_json::from_slice(&json).unwrap();
        assert!(parsed.messages.is_empty());
    }
}
