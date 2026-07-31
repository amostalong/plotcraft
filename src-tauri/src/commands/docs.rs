//! 固定分节文档集合（world/ 等目录）Tauri commands（v0.3）
//!
//! 3 个 command 全部 `async fn` + `AppResult<T>`，同步 fs 走 `spawn_blocking`
//! （照搬 commands/concept.rs 惯例）。写盘 atomic（tmp → rename，在 docs 模块内）。

use std::path::PathBuf;

use crate::docs::{
    docs_summary, save_doc as save_doc_impl, scan_docs, DocEntry, DEFAULT_SUMMARY_MAX_CHARS,
};
use crate::error::{AppError, AppResult};

/// 扫描项目某 collection 的固定分节，缺文件的分节返回 exists: false + 空内容
#[tauri::command]
pub async fn list_docs(project_root: String, collection: String) -> AppResult<Vec<DocEntry>> {
    let root = PathBuf::from(project_root);
    tokio::task::spawn_blocking(move || scan_docs(&root, &collection))
        .await
        .map_err(|e| AppError::Config(format!("list_docs: join: {}", e)))?
}

/// 保存一节（atomic write；懒建 collection 目录 —— 旧项目无目录也能直接 save）
/// frontmatter 只带 title + updated，不带 status
#[tauri::command]
pub async fn save_doc(
    project_root: String,
    collection: String,
    doc_id: String,
    content: String,
) -> AppResult<DocEntry> {
    let root = PathBuf::from(project_root);
    tokio::task::spawn_blocking(move || save_doc_impl(&root, &collection, &doc_id, &content))
        .await
        .map_err(|e| AppError::Config(format!("save_doc: join: {}", e)))?
}

/// 拼接 exists 且内容非空的分节成摘要（前端 AI context 用）
/// 全部缺文件/空内容 → 空串（前端据此跳过注入）
#[tauri::command]
pub async fn get_docs_summary(project_root: String, collection: String) -> AppResult<String> {
    let root = PathBuf::from(project_root);
    tokio::task::spawn_blocking(move || docs_summary(&root, &collection, DEFAULT_SUMMARY_MAX_CHARS))
        .await
        .map_err(|e| AppError::Config(format!("get_docs_summary: join: {}", e)))?
}
