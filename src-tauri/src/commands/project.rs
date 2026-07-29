//! 项目文件夹 IO Tauri commands
//!
//! v0.1 实现：
//! - create_project(folder, name) -> 落 4 个 starter md + plot.cat 标记
//! - list_projects(folder) -> 扫描子文件夹（有 plot.cat 算 PlotCraft 项目）
//!
//! v0.2+ PlotCraft 项目识别规则：
//! - 显式：项目根有 `plot.cat` 文件（JSON，最小空对象 `{}`）
//! - 隐式（v0.1 兼容）：仅有 `world/` 子目录但缺 `plot.cat` → 自动补一个空 plot.cat
//!   老项目迁移在 list_projects 触发（玩家点"打开项目"时静默写盘，无感）

use std::path::PathBuf;
use tokio::fs;

use crate::console::console_log;
use crate::error::{AppError, AppResult};
use crate::project::templates::{plot_cat_content, starter_files, ProjectMeta, PLOT_CAT_FILE};

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

/// 扫描 folder 的子文件夹 —— v0.2+ PlotCraft 标识走 plot.cat 文件存在判断
/// 老项目（v0.1 仅靠 world/ 识别的）自动补一个空 plot.cat，迁移无感。
#[tauri::command]
pub async fn list_projects(
    app: tauri::AppHandle,
    folder: String,
) -> AppResult<Vec<ProjectMeta>> {
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
        // v0.2+ PlotCraft 标识：项目根有 `plot.cat` 文件
        // 老项目（v0.1.5+ 仅有 world/ 的）静默补 plot.cat 一次性迁移
        let is_plotcraft_project = check_or_migrate_plot_cat(&app, &path).await?;
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

/// v0.2+ PlotCraft 项目识别 + 老项目迁移
/// - 有 plot.cat → true
/// - 仅有 world/（v0.1.5+ 旧项目）→ 写一个空 plot.cat 迁移 → true
/// - 都没有 → false
///
/// 迁移失败：warn log + 返回 false（不影响 OpenProjectModal 列出，标识会错但不阻塞）
async fn check_or_migrate_plot_cat(
    app: &tauri::AppHandle,
    project_dir: &std::path::Path,
) -> AppResult<bool> {
    let plot_cat = project_dir.join(PLOT_CAT_FILE);
    if plot_cat.is_file() {
        return Ok(true);
    }
    if project_dir.join("world").is_dir() {
        // 一次性迁移：v0.1.5+ 老项目
        if let Err(e) = fs::write(&plot_cat, plot_cat_content()).await {
            let err = AppError::Config(format!(
                "migrate plot.cat at {}: {}",
                project_dir.display(),
                e
            ));
            console_log(app, "warn", "project", err.to_string());
            // 迁移失败不阻塞 —— 返回 false，OpenProjectModal 正常列出但不标 PlotCraft
            return Ok(false);
        }
        console_log(
            app,
            "info",
            "project",
            format!("migrated legacy project: added plot.cat at {}", project_dir.display()),
        );
        return Ok(true);
    }
    Ok(false)
}
