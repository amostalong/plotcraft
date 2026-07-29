//! 项目文件夹 IO Tauri commands
//!
//! v0.1 实现：
//! - create_project(folder, name) -> 落 4 个 starter md
//! - list_projects(folder) -> 扫描子文件夹（有 README.md 算项目）

use std::path::PathBuf;
use tokio::fs;

use crate::console::console_log;
use crate::error::{AppError, AppResult};
use crate::project::templates::{starter_files, ProjectMeta};

/// 玩家新建项目：folder/{name}/ 落 4 个 starter md
#[tauri::command]
pub async fn create_project(
    app: tauri::AppHandle,
    folder: String,
    name: String,
) -> AppResult<ProjectMeta> {
    if name.is_empty() || name.contains('/') || name.contains('\\') {
        let err = AppError::Config(format!("invalid project name: {}", name));
        console_log(&app, "error", "project", err.to_string());
        return Err(err);
    }

    let project_dir = PathBuf::from(&folder).join(&name);
    if project_dir.exists() {
        let err = AppError::Config(format!("项目文件夹已存在: {}", project_dir.display()));
        console_log(&app, "error", "project", err.to_string());
        return Err(err);
    }

    // 落 4 个 starter md
    for (rel_path, content) in starter_files(&name) {
        let full = project_dir.join(rel_path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).await.map_err(|e| {
                let err = AppError::Config(format!("create_dir_all {}: {}", full.display(), e));
                console_log(&app, "error", "project", err.to_string());
                err
            })?;
        }
        fs::write(&full, content).await.map_err(|e| {
            let err = AppError::Config(format!("write {}: {}", full.display(), e));
            console_log(&app, "error", "project", err.to_string());
            err
        })?;
    }

    console_log(
        &app,
        "info",
        "project",
        format!("project created: {}", project_dir.display()),
    );
    Ok(ProjectMeta {
        name,
        folder: project_dir.to_string_lossy().to_string(),
        created_at: String::new(),
        updated_at: String::new(),
    })
}

/// 扫描 folder 的子文件夹，含 README.md 的算项目
#[tauri::command]
pub async fn list_projects(folder: String) -> AppResult<Vec<ProjectMeta>> {
    let dir = PathBuf::from(&folder);
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut projects = vec![];
    let mut entries = fs::read_dir(&dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let readme = path.join("README.md");
        if readme.exists() {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            projects.push(ProjectMeta {
                name,
                folder: path.to_string_lossy().to_string(),
                created_at: String::new(),
                updated_at: String::new(),
            });
        }
    }
    Ok(projects)
}
