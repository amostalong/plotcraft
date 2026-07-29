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
        // v0.1.5+ 新建的项目当然含 world/ —— true
        is_plotcraft_project: true,
    })
}

/// 扫描 folder 的子文件夹 —— v0.1.5+ 不再 filter README.md，列所有子目录
/// PlotCraft 标识（`world/` 子目录存在）走 ProjectMeta.is_plotcraft_project，
/// 让前端 OpenProjectModal 给玩家视觉提示（"看起来是 PlotCraft 项目"标签），
/// 玩家自己决定选哪个。
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
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        // 跳过 hidden 目录（.开头，如 .git / .DS_Store 之类）
        if name.starts_with('.') {
            continue;
        }
        // v0.1.5+ PlotCraft 标识：含 `world/` 子目录就算（4 个 starter 之一）
        let is_plotcraft_project = path.join("world").is_dir();
        projects.push(ProjectMeta {
            name,
            folder: path.to_string_lossy().to_string(),
            created_at: String::new(),
            updated_at: String::new(),
            is_plotcraft_project,
        });
    }
    // 按 PlotCraft 项目排前面，其他按名字
    projects.sort_by(|a, b| {
        b.is_plotcraft_project
            .cmp(&a.is_plotcraft_project)
            .then(a.name.cmp(&b.name))
    });
    Ok(projects)
}
