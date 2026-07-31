//! step chat 历史落盘（v0.3+ 实装：玩家反馈"想保留" → 关 app 不丢）
//!
//! 数据约定：
//! ```text
//! <project>/.chats/
//!   concept/
//!     seed.json               # 概念第 1 步「种子」chat 历史
//!     core-fantasy.json
//!     pillars.json
//!     world-rules.json
//!     character-functions.json
//!     three-act.json
//!   world/
//!     overview.json
//!     geography.json
//!     history.json
//!     magic-system.json
//!     factions.json
//! ```
//!
//! 每个文件 = `ChatFile` JSON（v0.3+ 新加，version=1）：
//! ```json
//! {
//!   "version": 1,
//!   "messages": [{ "role": "user|assistant", "content": "...", "partial": true|false }],
//!   "last_user_message": { ... } | null,
//!   "updated_at": "2026-07-30T..."
//! }
//! ```
//!
//! item_key 跨 boundary 格式：`<itemType>:<itemId>`（e.g. `concept:seed` / `world:overview`）
//!
//! - 懒创建 `.chats/<type>/` 目录 —— 旧项目没目录也能直接 save
//! - 不做文件监听 —— 玩家手改后点"刷新"重扫（对齐 art / concept 惯例）
//! - atomic write（tmp → rename）—— 跨平台稳定，对齐 concept / session 惯例

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::llm::types::ChatMessage;

/// .chats/ 顶层目录名（项目根下隐藏目录）
const CHATS_DIR: &str = ".chats";

/// 跨 boundary 文件格式（snake_case，前端 `src/lib/chats.ts` 镜像）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatFile {
    /// schema 版本（v0.3+ 加的；v1 是初版；将来加字段用 v2 迁移）
    pub version: u32,
    /// 完整 message 列表（含 partial 标记的中断回复）
    pub messages: Vec<ChatMessage>,
    /// 上次发的 user message —— 给将来 retryLast() 用（v0.3+ 暂未消费，写盘保持对齐 SessionFile 形态）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_user_message: Option<ChatMessage>,
    /// ISO 8601 timestamp（最后一次 save 时更新）
    pub updated_at: String,
}

/// 解析 item_key（"concept:seed" / "world:overview"）→ (subdir, filename)
/// - "concept" → ".chats/concept/seed.json"
/// - "world"   → ".chats/world/overview.json"
fn parse_item_key(item_key: &str) -> AppResult<(&'static str, String)> {
    let (kind, id) = item_key
        .split_once(':')
        .ok_or_else(|| AppError::Config(format!("非法 chat item_key: {}", item_key)))?;
    let subdir = match kind {
        "concept" => "concept",
        "world" => "world",
        other => return Err(AppError::Config(format!("非法 chat item_type: {}", other))),
    };
    // 防 path traversal：item_id 只允许 [a-z0-9-]
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(AppError::Config(format!("非法 chat item_id: {}", id)));
    }
    Ok((subdir, format!("{}.json", id)))
}

/// 单个 chat 文件路径
fn chat_path(project_root: &Path, item_key: &str) -> AppResult<PathBuf> {
    let (subdir, filename) = parse_item_key(item_key)?;
    Ok(project_root
        .join(CHATS_DIR)
        .join(subdir)
        .join(filename))
}

/// 扫描项目所有 chat 历史（懒创建目录：缺目录返回空 HashMap，不报错）
/// - .chats/concept/*.json → key "concept:seed" 等
/// - .chats/world/*.json   → key "world:overview" 等
/// - 文件损坏 / JSON 解析失败 → 跳过（玩家手改坏的情况容错，单文件失败不影响全局）
pub fn load_all_chats(project_root: &Path) -> AppResult<HashMap<String, ChatFile>> {
    let mut out = HashMap::new();
    let root = project_root.join(CHATS_DIR);
    if !root.is_dir() {
        return Ok(out); // 旧项目零迁移：没 .chats/ 就当空
    }
    for (subdir, item_type) in [("concept", "concept"), ("world", "world")] {
        let dir = root.join(subdir);
        if !dir.is_dir() {
            continue;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) => {
                return Err(AppError::Config(format!(
                    "read_dir {}: {}",
                    dir.display(),
                    e
                )))
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            // 只处理 .json
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            // item_id = 文件名 stem
            let id = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let key = format!("{}:{}", item_type, id);
            let text = match std::fs::read_to_string(&path) {
                Ok(t) => t,
                Err(_) => continue, // 单文件 IO 失败跳过
            };
            match serde_json::from_str::<ChatFile>(&text) {
                Ok(file) => {
                    out.insert(key, file);
                }
                Err(_) => continue, // JSON 损坏跳过
            }
        }
    }
    Ok(out)
}

/// 保存单个 chat 历史（atomic write：tmp → rename，对齐 concept/session 惯例）
/// - 懒建 `.chats/<type>/` 目录
/// - 失败抛 AppError，前端 toast 显示
pub fn save_chat(project_root: &Path, item_key: &str, payload: &ChatFile) -> AppResult<()> {
    let path = chat_path(project_root, item_key)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Config(format!("create dir {}: {}", parent.display(), e)))?;
    }
    let json = serde_json::to_string_pretty(payload)
        .map_err(|e| AppError::Config(format!("serialize chat: {}", e)))?;
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &json)
        .map_err(|e| AppError::Config(format!("write tmp {}: {}", tmp_path.display(), e)))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| AppError::Config(format!("rename to {}: {}", path.display(), e)))?;
    Ok(())
}

/// 删除单个 chat 文件（玩家点"清空对话"按钮 / 切项目清理）
/// - 文件不存在 → 静默成功（幂等）
pub fn delete_chat(project_root: &Path, item_key: &str) -> AppResult<()> {
    let path = chat_path(project_root, item_key)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::Config(format!(
            "delete chat {}: {}",
            path.display(),
            e
        ))),
    }
}

/// 清空项目所有 chat（切项目调；老项目叠加会乱；不删目录本身）
/// - 目录不存在 → 静默成功
pub fn delete_all_chats(project_root: &Path) -> AppResult<()> {
    let root = project_root.join(CHATS_DIR);
    if !root.is_dir() {
        return Ok(());
    }
    for subdir in ["concept", "world"] {
        let dir = root.join(subdir);
        if !dir.is_dir() {
            continue;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) => {
                return Err(AppError::Config(format!(
                    "read_dir {}: {}",
                    dir.display(),
                    e
                )))
            }
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                let _ = std::fs::remove_file(&path); // 静默忽略单文件失败
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("plotcraft-chats-test-{}", std::process::id()))
    }

    #[test]
    fn parse_item_key_happy() {
        assert_eq!(parse_item_key("concept:seed").unwrap(), ("concept", "seed.json".to_string()));
        assert_eq!(parse_item_key("world:overview").unwrap(), ("world", "overview.json".to_string()));
        assert_eq!(parse_item_key("world:magic-system").unwrap(), ("world", "magic-system.json".to_string()));
    }

    #[test]
    fn parse_item_key_rejects() {
        assert!(parse_item_key("nokey").is_err());
        assert!(parse_item_key("foo:bar").is_err());
        assert!(parse_item_key("concept:../etc").is_err());
        assert!(parse_item_key("concept:UPPER").is_err());
    }

    #[test]
    fn empty_when_no_chats_dir() {
        let dir = test_dir();
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let map = load_all_chats(&dir).unwrap();
        assert!(map.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_load_roundtrip() {
        let dir = test_dir();
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let file = ChatFile {
            version: 1,
            messages: vec![
                ChatMessage {
                    role: crate::llm::types::MessageRole::User,
                    content: "用户消息".to_string(),
                    partial: None,
                    tool_calls: None,
                    tool_call_id: None,
                },
                ChatMessage {
                    role: crate::llm::types::MessageRole::Assistant,
                    content: "AI 回复".to_string(),
                    partial: Some(false),
                    tool_calls: None,
                    tool_call_id: None,
                },
            ],
            last_user_message: None,
            updated_at: "2026-07-30T10:00:00+00:00".to_string(),
        };
        save_chat(&dir, "concept:seed", &file).unwrap();

        let map = load_all_chats(&dir).unwrap();
        assert_eq!(map.len(), 1);
        let loaded = map.get("concept:seed").unwrap();
        assert_eq!(loaded.messages.len(), 2);
        assert_eq!(loaded.messages[0].content, "用户消息");
        assert_eq!(loaded.messages[1].content, "AI 回复");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_idempotent() {
        let dir = test_dir();
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // 不存在的 item → 静默成功
        delete_chat(&dir, "concept:seed").unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn delete_all_clears_both_subdirs() {
        let dir = test_dir();
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // 写两个 item
        let file = ChatFile {
            version: 1,
            messages: vec![],
            last_user_message: None,
            updated_at: "2026-07-30T10:00:00+00:00".to_string(),
        };
        save_chat(&dir, "concept:seed", &file).unwrap();
        save_chat(&dir, "world:overview", &file).unwrap();

        let map = load_all_chats(&dir).unwrap();
        assert_eq!(map.len(), 2);

        delete_all_chats(&dir).unwrap();
        let map = load_all_chats(&dir).unwrap();
        assert!(map.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
