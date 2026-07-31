//! Chat session 持久化 Tauri commands
//!
//! v0.1 单 session（`default.json`）
//! v0.2+ 多 session：
//! - 每个 session 一个文件 `sessions/<id>.json`（SessionFile v2 格式：messages + last_user_message）
//! - index 存 metadata `sessions/_index.json`（Vec<SessionMeta>：id / title / created_at / updated_at / message_count）
//! - v0.1 `default.json` 兼容：第一次启动时如果 _index.json 不存在但 default.json 存在，
//!   自动把 default.json 当成 id="default" 的 session（不真正迁移文件，玩家手动建新 session 时不影响）
//!
//! v0.3+ 路线：
//! - 按项目分组（每个 project 一份 sessions/）
//! - session 搜索 / 标签 / 收藏
//!
//! 详细设计见 [CHAT_LLM_DESIGN.md §8.5]

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tokio::fs;

use crate::error::AppResult;
use crate::llm::types::ChatMessage;

/// v0.2+ session metadata —— 存 _index.json，不存 messages（messages 在 <id>.json）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionMeta {
    /// 文件名 stem（比如 "default" / "abc123"），跟 `sessions/<id>.json` 一一对应
    pub id: String,
    /// 玩家改的显示名
    pub title: String,
    /// ISO 8601 timestamp
    pub created_at: String,
    /// ISO 8601 timestamp（最后一次 save_session 时更新）
    pub updated_at: String,
    /// message 数量（前端 UI 显示 "5 messages" 用；save_session 时更新）
    pub message_count: u32,
}

/// v0.2 on-disk session schema（per-file）
///
/// 字段历史：
/// - v0.1: `version=1, updated_at, messages`
/// - v0.2: 加 `last_user_message: Option<ChatMessage>`（retryLast 跨重启用）
///   - `#[serde(default, skip_serializing_if = "Option::is_none")]` 让 v0.1
///     老文件反序列化时这个字段是 None（不报错），新文件不写冗余字段
/// - v0.2.1+：SessionFile schema 不变；多 session 通过 _index.json 表达
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionFile {
    /// schema 版本（v0.1 = 1, v0.2 = 2）
    pub version: u32,
    /// ISO 8601 timestamp
    pub updated_at: String,
    /// 完整 message 列表
    pub messages: Vec<ChatMessage>,
    /// v0.2+ 上次发的 user message —— retryLast() 拿这个一键重发
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_user_message: Option<ChatMessage>,
}

const SESSIONS_DIR_NAME: &str = "sessions";
const SESSION_INDEX_FILE: &str = "_index.json";
/// v0.1 单 session 文件名（兼容 legacy）—— 保留 default.json，新 session 走 <id>.json
const LEGACY_DEFAULT_FILE: &str = "default.json";
const SESSION_TMP_SUFFIX: &str = ".tmp";
const SESSION_VERSION: u32 = 2;
const MAX_SESSION_BYTES: u64 = 5 * 1024 * 1024;

/// sessions 目录路径：%APPDATA%/PlotCraft/sessions/
fn sessions_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| crate::error::AppError::Config(format!("app_config_dir: {}", e)))?;
    Ok(dir.join(SESSIONS_DIR_NAME))
}

/// 单 session 文件路径
fn session_file_path(dir: &Path, id: &str) -> PathBuf {
    if id == "default" {
        // 兼容 v0.1 legacy 文件
        dir.join(LEGACY_DEFAULT_FILE)
    } else {
        dir.join(format!("{}.json", id))
    }
}

/// index 文件路径
fn index_path(dir: &Path) -> PathBuf {
    dir.join(SESSION_INDEX_FILE)
}

/// 生成新 session id —— 8 字符 UUID hex（短且不易冲突）
fn generate_session_id() -> String {
    let id = uuid::Uuid::new_v4().to_string();
    id.replace('-', "")[..8].to_string()
}

/// 读 _index.json —— 不存在时返回空 Vec
async fn read_index(dir: &Path) -> AppResult<Vec<SessionMeta>> {
    let path = index_path(dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = tokio::task::spawn_blocking(move || std::fs::read(&path))
        .await
        .map_err(|e| crate::error::AppError::Config(format!("read index: join: {}", e)))?
        .map_err(|e| crate::error::AppError::Config(format!("read index: {}", e)))?;
    let idx: Vec<SessionMeta> = serde_json::from_slice(&bytes).unwrap_or_default();
    Ok(idx)
}

/// 写 _index.json
async fn write_index(app: &tauri::AppHandle, dir: &Path, index: &[SessionMeta]) -> AppResult<()> {
    let path = index_path(dir);
    let path_for_log = path.display().to_string();
    let json = serde_json::to_vec_pretty(index)
        .map_err(|e| crate::error::AppError::Config(format!("serialize index: {}", e)))?;
    let tmp_path = path.with_extension(format!("json{}", SESSION_TMP_SUFFIX));
    let app_clone = app.clone();
    let result: Result<(), String> = tokio::task::spawn_blocking(move || {
        std::fs::write(&tmp_path, &json)
            .map_err(|e| format!("write index tmp: {}", e))?;
        std::fs::rename(&tmp_path, &path).map_err(|e| format!("rename index: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| crate::error::AppError::Config(format!("write_index: join: {}", e)))?;
    if let Err(e) = result {
        let err = crate::error::AppError::Config(format!("write_index {}: {}", path_for_log, e));
        crate::console::console_log(&app_clone, "error", "session", err.to_string());
        return Err(err);
    }
    Ok(())
}

/// 读单个 session 文件 —— 不存在 / 损坏 → 返回空 SessionFile
async fn read_session_file(app: &tauri::AppHandle, path: &Path) -> AppResult<SessionFile> {
    if !path.exists() {
        return Ok(SessionFile {
            version: SESSION_VERSION,
            updated_at: String::new(),
            messages: vec![],
            last_user_message: None,
        });
    }
    let path_for_log = path.display().to_string();
    let bytes = tokio::task::spawn_blocking({
        let p = path.to_path_buf();
        move || std::fs::read(&p)
    })
    .await
    .map_err(|e| crate::error::AppError::Config(format!("read session: join: {}", e)))?
    .map_err(|e| crate::error::AppError::Config(format!("read session: {}", e)))?;
    match serde_json::from_slice::<SessionFile>(&bytes) {
        Ok(s) => Ok(s),
        Err(e) => {
            crate::console::console_log(
                app,
                "warn",
                "session",
                format!("failed to parse {}: {}", path_for_log, e),
            );
            Ok(SessionFile {
                version: SESSION_VERSION,
                updated_at: String::new(),
                messages: vec![],
                last_user_message: None,
            })
        }
    }
}

/// 写单个 session 文件（atomic）
async fn write_session_file(
    app: &tauri::AppHandle,
    path: &Path,
    payload: &SessionFile,
) -> AppResult<()> {
    let json = serde_json::to_vec_pretty(payload)
        .map_err(|e| crate::error::AppError::Config(format!("serialize session: {}", e)))?;
    if json.len() as u64 > MAX_SESSION_BYTES {
        let err = crate::error::AppError::Config(format!(
            "session too large: {} bytes (max {})",
            json.len(),
            MAX_SESSION_BYTES
        ));
        crate::console::console_log(app, "error", "session", err.to_string());
        return Err(err);
    }
    let tmp_path = path.with_extension(format!("json{}", SESSION_TMP_SUFFIX));
    let path_for_log = path.display().to_string();
    let result: Result<(), String> = tokio::task::spawn_blocking({
        let p = path.to_path_buf();
        let t = tmp_path.clone();
        move || {
            std::fs::write(&t, &json).map_err(|e| format!("write session tmp: {}", e))?;
            std::fs::rename(&t, &p).map_err(|e| format!("rename session: {}", e))?;
            Ok(())
        }
    })
    .await
    .map_err(|e| crate::error::AppError::Config(format!("write_session: join: {}", e)))?;
    if let Err(e) = result {
        let err = crate::error::AppError::Config(format!("write_session {}: {}", path_for_log, e));
        crate::console::console_log(app, "error", "session", err.to_string());
        return Err(err);
    }
    Ok(())
}

// === Tauri commands ===

/// 列出所有 session —— 第一次启动时 _index.json 不存在但 default.json 存在 → 兼容 v0.1
#[tauri::command]
pub async fn list_sessions(app: tauri::AppHandle) -> AppResult<Vec<SessionMeta>> {
    let dir = sessions_dir(&app)?;
    let mut index = read_index(&dir).await?;

    if index.is_empty() {
        // v0.1 兼容：检查 default.json 存在 → 返回单个 "Default" session
        let default_path = dir.join(LEGACY_DEFAULT_FILE);
        if default_path.exists() {
            let file = read_session_file(&app, &default_path).await?;
            let now = chrono::Utc::now().to_rfc3339();
            let default_meta = SessionMeta {
                id: "default".to_string(),
                title: "Default".to_string(),
                created_at: now.clone(),
                updated_at: file.updated_at.clone(),
                message_count: file.messages.len() as u32,
            };
            index.push(default_meta);
            // 顺手写 _index.json（后续 list 不再走兼容路径）
            write_index(&app, &dir, &index).await?;
            crate::console::console_log(
                &app,
                "info",
                "session",
                "[list_sessions] migrated v0.1 default.json to multi-session index",
            );
        }
    }

    // 按 updated_at 倒序（最新在前）
    index.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(index)
}

/// 创建新 session —— 写空 session 文件 + 加 _index.json entry
#[tauri::command]
pub async fn create_session(app: tauri::AppHandle, title: String) -> AppResult<SessionMeta> {
    let dir = sessions_dir(&app)?;
    fs::create_dir_all(&dir).await.map_err(|e| {
        let err = crate::error::AppError::Config(format!("create_dir_all {}: {}", dir.display(), e));
        crate::console::console_log(&app, "error", "session", err.to_string());
        err
    })?;

    let id = generate_session_id();
    let now = chrono::Utc::now().to_rfc3339();
    let meta = SessionMeta {
        id: id.clone(),
        title,
        created_at: now.clone(),
        updated_at: now.clone(),
        message_count: 0,
    };

    // 写空 session 文件
    let path = session_file_path(&dir, &id);
    let empty = SessionFile {
        version: SESSION_VERSION,
        updated_at: now,
        messages: vec![],
        last_user_message: None,
    };
    write_session_file(&app, &path, &empty).await?;

    // 更新 _index.json
    let mut index = read_index(&dir).await?;
    index.push(meta.clone());
    write_index(&app, &dir, &index).await?;

    crate::console::console_log(
        &app,
        "info",
        "session",
        format!("[create_session] id={} title={}", meta.id, meta.title),
    );
    Ok(meta)
}

/// 删除 session —— 删 <id>.json + 从 _index.json 移除
///
/// v0.2+：移除 'default' session 不能删的 guard。
///   - 后端 `create_session` 生成 UUID，没有 'default' id 自然产生
///   - 唯一的 'default' 来源是 v0.1→v0.2 迁移的 legacy 数据，玩家应能删
///   - 善后（删完没剩余 → 建空 'New Chat'）由前端 store.deleteSessionById 兜底
#[tauri::command]
pub async fn delete_session(app: tauri::AppHandle, id: String) -> AppResult<()> {
    let dir = sessions_dir(&app)?;
    let path = session_file_path(&dir, &id);
    if path.exists() {
        let p = path.clone();
        tokio::task::spawn_blocking(move || std::fs::remove_file(&p))
            .await
            .map_err(|e| crate::error::AppError::Config(format!("delete session: join: {}", e)))?
            .map_err(|e| crate::error::AppError::Config(format!("delete session: {}", e)))?;
    }
    // 从 _index.json 移除
    let mut index = read_index(&dir).await?;
    index.retain(|m| m.id != id);
    write_index(&app, &dir, &index).await?;
    crate::console::console_log(
        &app,
        "info",
        "session",
        format!("[delete_session] id={}", id),
    );
    Ok(())
}

/// 改名 —— 只改 _index.json，session 文件不动
#[tauri::command]
pub async fn rename_session(
    app: tauri::AppHandle,
    id: String,
    new_title: String,
) -> AppResult<SessionMeta> {
    let dir = sessions_dir(&app)?;
    let mut index = read_index(&dir).await?;
    let mut found: Option<SessionMeta> = None;
    for m in index.iter_mut() {
        if m.id == id {
            m.title = new_title.clone();
            found = Some(m.clone());
        }
    }
    match found {
        Some(m) => {
            write_index(&app, &dir, &index).await?;
            crate::console::console_log(
                &app,
                "info",
                "session",
                format!("[rename_session] id={} new_title={}", id, new_title),
            );
            Ok(m)
        }
        None => Err(crate::error::AppError::Config(format!(
            "session not found: {}",
            id
        ))),
    }
}

/// 读 session 文件 —— v0.1 兼容 id="default" 读 default.json
#[tauri::command]
pub async fn load_session(
    app: tauri::AppHandle,
    id: String,
) -> AppResult<SessionFile> {
    let dir = sessions_dir(&app)?;
    let path = session_file_path(&dir, &id);
    read_session_file(&app, &path).await
}

/// 写 session 文件 —— 同步更新 _index.json (updated_at + message_count)
#[tauri::command]
pub async fn save_session(
    app: tauri::AppHandle,
    id: String,
    payload: SessionFile,
) -> AppResult<()> {
    let dir = sessions_dir(&app)?;
    fs::create_dir_all(&dir).await.map_err(|e| {
        let err = crate::error::AppError::Config(format!("create_dir_all {}: {}", dir.display(), e));
        crate::console::console_log(&app, "error", "session", err.to_string());
        err
    })?;

    let now = chrono::Utc::now().to_rfc3339();
    let payload = SessionFile {
        version: SESSION_VERSION,
        updated_at: now.clone(),
        ..payload
    };

    // 写 <id>.json
    let path = session_file_path(&dir, &id);
    write_session_file(&app, &path, &payload).await?;

    // 更新 _index.json (updated_at + message_count)
    let mut index = read_index(&dir).await?;
    let msg_count = payload.messages.len() as u32;
    let mut found = false;
    for m in index.iter_mut() {
        if m.id == id {
            m.updated_at = now.clone();
            m.message_count = msg_count;
            found = true;
        }
    }
    if !found {
        // 第一次写 session 但 index 没 entry（v0.1 legacy default.json 路径）
        // 自动建 entry
        index.push(SessionMeta {
            id: id.clone(),
            title: "Default".to_string(),
            created_at: now.clone(),
            updated_at: now,
            message_count: msg_count,
        });
    }
    write_index(&app, &dir, &index).await?;

    crate::console::console_log(
        &app,
        "info",
        "session",
        format!(
            "[save_session] id={} messages={} bytes={}",
            id,
            payload.messages.len(),
            serde_json::to_vec(&payload).map(|v| v.len()).unwrap_or(0)
        ),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::types::{ChatMessage, MessageRole};

    #[test]
    fn session_file_v2_roundtrip() {
        let original = SessionFile {
            version: 2,
            updated_at: "2026-07-29T17:00:00Z".to_string(),
            messages: vec![
                ChatMessage {
                    role: MessageRole::User,
                    content: "hi".to_string(),
                    partial: None,
                    tool_calls: None,
                    tool_call_id: None,
                },
                ChatMessage {
                    role: MessageRole::Assistant,
                    content: "hello!".to_string(),
                    partial: None,
                    tool_calls: None,
                    tool_call_id: None,
                },
            ],
            last_user_message: Some(ChatMessage {
                role: MessageRole::User,
                content: "hi".to_string(),
                partial: None,
                tool_calls: None,
                tool_call_id: None,
            }),
        };
        let json = serde_json::to_vec_pretty(&original).unwrap();
        let parsed: SessionFile = serde_json::from_slice(&json).unwrap();
        assert_eq!(parsed.version, 2);
        assert_eq!(parsed.messages.len(), 2);
        assert_eq!(
            parsed.last_user_message.as_ref().unwrap().content,
            "hi"
        );
    }

    #[test]
    fn v1_session_file_loads_as_v2() {
        let v1_json = r#"{
            "version": 1,
            "updated_at": "2026-07-28T10:00:00Z",
            "messages": [
                {"role": "user", "content": "old msg"},
                {"role": "assistant", "content": "old reply"}
            ]
        }"#;
        let parsed: SessionFile = serde_json::from_str(v1_json).unwrap();
        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.messages.len(), 2);
        assert!(parsed.last_user_message.is_none());
    }

    #[test]
    fn session_meta_roundtrip() {
        let meta = SessionMeta {
            id: "abc12345".to_string(),
            title: "Test".to_string(),
            created_at: "2026-07-29T17:00:00Z".to_string(),
            updated_at: "2026-07-29T18:00:00Z".to_string(),
            message_count: 5,
        };
        let json = serde_json::to_string(&meta).unwrap();
        let parsed: SessionMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, meta);
    }

    #[test]
    fn generate_session_id_is_8_chars() {
        let id = generate_session_id();
        assert_eq!(id.len(), 8);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
