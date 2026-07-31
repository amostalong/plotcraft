//! step chat 历史落盘（v0.3+）Tauri commands
//!
//! 4 个 command 全部 `async fn` + `AppResult<T>`，同步 fs 走 `spawn_blocking`
//! （对齐 commands/concept.rs 惯例）。写盘 atomic（在 chats 模块内）。

use std::collections::HashMap;
use std::path::PathBuf;

use crate::chats::{
    delete_all_chats as delete_all_chats_impl, delete_chat as delete_chat_impl,
    load_all_chats as load_all_chats_impl, save_chat as save_chat_impl, ChatFile,
};
use crate::error::{AppError, AppResult};

/// 加载项目所有 chat 历史（懒创建：缺目录返回空 map）
#[tauri::command]
pub async fn load_chats(project_root: String) -> AppResult<HashMap<String, ChatFile>> {
    let root = PathBuf::from(project_root);
    tokio::task::spawn_blocking(move || load_all_chats_impl(&root))
        .await
        .map_err(|e| AppError::Config(format!("load_chats: join: {}", e)))?
}

/// 保存单个 chat 历史（atomic write）
#[tauri::command]
pub async fn save_chat(
    project_root: String,
    item_key: String,
    payload: ChatFile,
) -> AppResult<()> {
    let root = PathBuf::from(project_root);
    tokio::task::spawn_blocking(move || save_chat_impl(&root, &item_key, &payload))
        .await
        .map_err(|e| AppError::Config(format!("save_chat: join: {}", e)))?
}

/// 删除单个 chat 文件（玩家点"清空对话"按钮 / 切项目清理）
/// - 文件不存在 → 静默成功（幂等）
#[tauri::command]
pub async fn delete_chat(project_root: String, item_key: String) -> AppResult<()> {
    let root = PathBuf::from(project_root);
    tokio::task::spawn_blocking(move || delete_chat_impl(&root, &item_key))
        .await
        .map_err(|e| AppError::Config(format!("delete_chat: join: {}", e)))?
}

/// 清空项目所有 chat（切项目调；不删目录本身）
#[tauri::command]
pub async fn delete_all_chats(project_root: String) -> AppResult<()> {
    let root = PathBuf::from(project_root);
    tokio::task::spawn_blocking(move || delete_all_chats_impl(&root))
        .await
        .map_err(|e| AppError::Config(format!("delete_all_chats: join: {}", e)))?
}
