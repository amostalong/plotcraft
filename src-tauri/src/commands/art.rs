//! 设定图（art/ 图库）Tauri commands（v0.2+）
//!
//! 5 个 command 全部 `async fn` + `AppResult<T>`，同步 fs 走 `spawn_blocking`
//! （对齐 commands/session.rs 模式）。写盘 atomic（tmp → rename）。

use std::path::PathBuf;

use crate::art::{
    category_dir, find_image_path, prompt_path, read_image_data_url, scan_art, validate_art_name,
    validate_category, ArtEntry,
};
use crate::console::console_log;
use crate::error::{AppError, AppResult};

/// 扫描项目 art/ 三类目录，返回全部 entry
#[tauri::command]
pub async fn list_art(project_path: String) -> AppResult<Vec<ArtEntry>> {
    let root = PathBuf::from(project_path);
    tokio::task::spawn_blocking(move || scan_art(&root))
        .await
        .map_err(|e| AppError::Config(format!("list_art: join: {}", e)))?
}

/// 新建 entry：懒建 `art/<category>/` 目录 + 写空 prompt.txt
/// 重名（prompt.txt 或同名图片已存在）→ Err，不覆盖玩家内容
#[tauri::command]
pub async fn create_art_entry(
    app: tauri::AppHandle,
    project_path: String,
    category: String,
    name: String,
) -> AppResult<ArtEntry> {
    validate_category(&category)?;
    let name = name.trim().to_string();
    validate_art_name(&name)?;

    let root = PathBuf::from(&project_path);
    let category_clone = category.clone();
    let name_clone = name.clone();
    let entry = tokio::task::spawn_blocking(move || -> AppResult<ArtEntry> {
        let dir = category_dir(&root, &category_clone);
        std::fs::create_dir_all(&dir)
            .map_err(|e| AppError::Config(format!("create dir {}: {}", dir.display(), e)))?;

        let prompt_file = prompt_path(&root, &category_clone, &name_clone);
        if prompt_file.exists() || find_image_path(&dir, &name_clone).is_some() {
            return Err(AppError::Config(format!(
                "已存在同名 entry: {}/{}",
                category_clone, name_clone
            )));
        }

        std::fs::write(&prompt_file, "")
            .map_err(|e| AppError::Config(format!("write {}: {}", prompt_file.display(), e)))?;

        Ok(ArtEntry {
            name: name_clone,
            category: category_clone,
            prompt: String::new(),
            has_image: false,
            updated_at: {
                let t = std::fs::metadata(&prompt_file)
                    .and_then(|m| m.modified())
                    .ok();
                t.map(|t| {
                    let dt: chrono::DateTime<chrono::Utc> = t.into();
                    dt.to_rfc3339()
                })
                .unwrap_or_default()
            },
        })
    })
    .await
    .map_err(|e| AppError::Config(format!("create_art_entry: join: {}", e)))??;

    console_log(
        &app,
        "info",
        "art",
        format!("[create_art_entry] {}/{}", entry.category, entry.name),
    );
    Ok(entry)
}

/// 保存 prompt（atomic write：tmp → rename，对齐 session.rs Windows 模式）
#[tauri::command]
pub async fn save_art_prompt(
    project_path: String,
    category: String,
    name: String,
    prompt: String,
) -> AppResult<()> {
    validate_category(&category)?;
    validate_art_name(&name)?;

    let root = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let path = prompt_path(&root, &category, &name);
        if !path.exists() {
            return Err(AppError::Config(format!(
                "entry 不存在: {}/{}（可能被外部删了，刷新重试）",
                category, name
            )));
        }
        let tmp_path = path.with_extension(format!("txt.tmp"));
        std::fs::write(&tmp_path, &prompt)
            .map_err(|e| AppError::Config(format!("write tmp {}: {}", tmp_path.display(), e)))?;
        std::fs::rename(&tmp_path, &path)
            .map_err(|e| AppError::Config(format!("rename to {}: {}", path.display(), e)))?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Config(format!("save_art_prompt: join: {}", e)))?
}

/// 删除 entry：prompt.txt + 同名图片（若有）一起删
#[tauri::command]
pub async fn delete_art_entry(
    app: tauri::AppHandle,
    project_path: String,
    category: String,
    name: String,
) -> AppResult<()> {
    validate_category(&category)?;
    validate_art_name(&name)?;

    let root = PathBuf::from(&project_path);
    let category_clone = category.clone();
    let name_clone = name.clone();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let prompt_file = prompt_path(&root, &category_clone, &name_clone);
        if prompt_file.exists() {
            std::fs::remove_file(&prompt_file).map_err(|e| {
                AppError::Config(format!("delete {}: {}", prompt_file.display(), e))
            })?;
        }
        let dir = category_dir(&root, &category_clone);
        if let Some(img) = find_image_path(&dir, &name_clone) {
            std::fs::remove_file(&img)
                .map_err(|e| AppError::Config(format!("delete {}: {}", img.display(), e)))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Config(format!("delete_art_entry: join: {}", e)))??;

    console_log(
        &app,
        "info",
        "art",
        format!("[delete_art_entry] {}/{}", category, name),
    );
    Ok(())
}

/// 读 entry 图片 → base64 data URL（前端 <img src> 直接用）
/// 无图 → Err（前端 has_image=false 时不该调；容错 catch 掉）
#[tauri::command]
pub async fn read_art_image(
    project_path: String,
    category: String,
    name: String,
) -> AppResult<String> {
    validate_category(&category)?;
    validate_art_name(&name)?;

    let root = PathBuf::from(&project_path);
    tokio::task::spawn_blocking(move || read_image_data_url(&root, &category, &name))
        .await
        .map_err(|e| AppError::Config(format!("read_art_image: join: {}", e)))?
}
