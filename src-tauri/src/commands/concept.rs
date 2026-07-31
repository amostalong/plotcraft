//! 概念设计漏斗（concept/ 目录）Tauri commands（v0.3）
//!
//! 3 个 command 全部 `async fn` + `AppResult<T>`，同步 fs 走 `spawn_blocking`
//! （对齐 commands/art.rs 惯例）。写盘 atomic（tmp → rename，在 concept 模块内）。

use std::path::PathBuf;

use crate::concept::{
    concept_summary, save_concept_step as save_concept_step_impl, scan_concept, ConceptStep,
};
use crate::error::{AppError, AppResult};

/// 扫描项目 concept/ 6 步，缺文件的步骤返回 status "empty" + 空内容
#[tauri::command]
pub async fn list_concept_steps(project_root: String) -> AppResult<Vec<ConceptStep>> {
    let root = PathBuf::from(project_root);
    tokio::task::spawn_blocking(move || scan_concept(&root))
        .await
        .map_err(|e| AppError::Config(format!("list_concept_steps: join: {}", e)))?
}

/// 保存一步（atomic write；mark_confirmed=true → status "confirmed"，否则 "draft"）
/// 懒建 `concept/` 目录 —— 旧项目无目录也能直接 save
#[tauri::command]
pub async fn save_concept_step(
    project_root: String,
    step_id: String,
    content: String,
    mark_confirmed: bool,
) -> AppResult<ConceptStep> {
    let root = PathBuf::from(project_root);
    tokio::task::spawn_blocking(move || {
        save_concept_step_impl(&root, &step_id, &content, mark_confirmed)
    })
    .await
    .map_err(|e| AppError::Config(format!("save_concept_step: join: {}", e)))?
}

/// 拼接 status != empty 的步骤成摘要（chat system prompt 注入用）
/// 全部 empty → 空串（前端据此跳过注入）
#[tauri::command]
pub async fn get_concept_summary(project_root: String) -> AppResult<String> {
    let root = PathBuf::from(project_root);
    tokio::task::spawn_blocking(move || concept_summary(&root))
        .await
        .map_err(|e| AppError::Config(format!("get_concept_summary: join: {}", e)))?
}
