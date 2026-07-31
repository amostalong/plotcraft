//! art/ 图库 —— 设定图 entry 扫描 / IO（v0.2+ 实装：图库 + prompt 管理 + 占位图）
//!
//! 数据约定（DESIGN.md §输出文件夹结构 / §决策 4）：
//! ```text
//! <project>/art/
//!   characters/hero.prompt.txt   # prompt 文本（玩家手填，可为空）
//!   characters/hero.png          # 可选，玩家自放（v0.3+ 真生成也写这里）
//!   scenes/  items/
//! ```
//!
//! - category 固定 3 类（characters / scenes / items），不开放自由目录
//! - entry 名 = 文件 stem（`hero`），filesystem-safe 校验（validate_art_name）
//! - 占位图不落盘：前端在 has_image=false 时渲染占位 tile（v0.3+ 真生成后才有 png）
//! - 不做文件监听 —— 玩家手改后点"刷新"重扫（对齐 DESIGN §"v0.1 不做文件监听"）

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// art 根目录名（项目根下）
pub const ART_DIR: &str = "art";
/// 固定 3 类（DESIGN 已定）
pub const ART_CATEGORIES: [&str; 3] = ["characters", "scenes", "items"];
/// prompt 文件后缀（entry `hero` → `hero.prompt.txt`）
pub const PROMPT_SUFFIX: &str = ".prompt.txt";
/// 识别的图片扩展名（同名文件，优先 png）
const IMAGE_EXTS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];
/// 单张图片读取上限（防玩家丢 100MB 原图把 IPC 打爆）
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

/// 跨 boundary 类型（snake_case，前端 `src/lib/art.ts` 镜像）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtEntry {
    /// 文件 stem（如 "hero"）
    pub name: String,
    /// characters | scenes | items
    pub category: String,
    /// .prompt.txt 内容（可空）
    pub prompt: String,
    /// 同名 png/jpg/jpeg/webp 存在
    pub has_image: bool,
    /// prompt.txt 的 fs mtime（RFC3339）
    pub updated_at: String,
}

/// entry 名校验：非空、≤64 字符、不含路径分隔 / Windows 非法字符
pub fn validate_art_name(name: &str) -> AppResult<()> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::Config("名字不能为空".into()));
    }
    if n.chars().count() > 64 {
        return Err(AppError::Config("名字太长（≤64 字符）".into()));
    }
    if n.chars()
        .any(|c| matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control())
    {
        return Err(AppError::Config(format!(
            "名字含非法字符（不能含 \\ / : * ? \" < > | 和控制字符）: {}",
            n
        )));
    }
    // Windows 保留名（CON / PRN / AUX / NUL / COM1-9 / LPT1-9）—— 创建会失败或行为诡异
    let upper = n.to_uppercase();
    let stem = upper.split('.').next().unwrap_or("");
    if matches!(
        stem,
        "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6"
            | "COM7" | "COM8" | "COM9" | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6"
            | "LPT7" | "LPT8" | "LPT9"
    ) {
        return Err(AppError::Config(format!("名字是 Windows 保留名: {}", n)));
    }
    Ok(())
}

/// category 校验：必须在固定 3 类里
pub fn validate_category(category: &str) -> AppResult<()> {
    if ART_CATEGORIES.contains(&category) {
        Ok(())
    } else {
        Err(AppError::Config(format!(
            "非法 category: {}（只能 {}）",
            category,
            ART_CATEGORIES.join(" / ")
        )))
    }
}

/// category 目录路径：`<project>/art/<category>/`
pub fn category_dir(project_root: &Path, category: &str) -> PathBuf {
    project_root.join(ART_DIR).join(category)
}

/// prompt 文件路径
pub fn prompt_path(project_root: &Path, category: &str, name: &str) -> PathBuf {
    category_dir(project_root, category).join(format!("{}{}", name, PROMPT_SUFFIX))
}

/// 找同名图片（png 优先），存在返回路径
pub fn find_image_path(dir: &Path, name: &str) -> Option<PathBuf> {
    IMAGE_EXTS
        .iter()
        .map(|ext| dir.join(format!("{}.{}", name, ext)))
        .find(|p| p.is_file())
}

/// fs mtime → RFC3339（失败返回空串，UI 容错）
fn mtime_rfc3339(path: &Path) -> String {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .map(|t| {
            let dt: chrono::DateTime<chrono::Utc> = t.into();
            dt.to_rfc3339()
        })
        .unwrap_or_default()
}

/// 扫描 `<project>/art/` 三类目录，聚合 entry（同步 fs —— 调用方走 spawn_blocking）
/// - 有 prompt.txt 的 stem = 一个 entry；有图无 prompt.txt 的也收（prompt 空串）
/// - 排序：category 固定序 → name 字典序
pub fn scan_art(project_root: &Path) -> AppResult<Vec<ArtEntry>> {
    let mut entries = Vec::new();

    for category in ART_CATEGORIES {
        let dir = category_dir(project_root, category);
        if !dir.is_dir() {
            continue;
        }
        let rd = std::fs::read_dir(&dir)
            .map_err(|e| AppError::Config(format!("read dir {}: {}", dir.display(), e)))?;

        // stem → (has_prompt, prompt_path)
        let mut stems: std::collections::BTreeMap<String, Option<PathBuf>> =
            std::collections::BTreeMap::new();
        for entry in rd.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            if let Some(stem) = file_name.strip_suffix(PROMPT_SUFFIX) {
                stems.insert(stem.to_string(), Some(path.clone()));
            } else if let Some(stem) = file_name
                .rsplit_once('.')
                .map(|(s, ext)| (s, ext.to_lowercase()))
                .filter(|(_, ext)| IMAGE_EXTS.contains(&ext.as_str()))
                .map(|(s, _)| s)
            {
                stems.entry(stem.to_string()).or_insert(None);
            }
        }

        for (stem, prompt_file) in stems {
            let prompt = match &prompt_file {
                Some(p) => std::fs::read_to_string(p).unwrap_or_default(),
                None => String::new(),
            };
            entries.push(ArtEntry {
                has_image: find_image_path(&dir, &stem).is_some(),
                updated_at: prompt_file
                    .as_ref()
                    .map(|p| mtime_rfc3339(p))
                    .unwrap_or_default(),
                name: stem,
                category: category.to_string(),
                prompt,
            });
        }
    }

    Ok(entries)
}

/// 读 entry 图片 → base64 data URL（同步 fs —— 调用方走 spawn_blocking）
/// 无图 → AppError::Config("no image")
pub fn read_image_data_url(project_root: &Path, category: &str, name: &str) -> AppResult<String> {
    let dir = category_dir(project_root, category);
    let path = find_image_path(&dir, name).ok_or_else(|| {
        AppError::Config(format!("no image for {}/{}", category, name))
    })?;

    let meta = std::fs::metadata(&path)?;
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(AppError::Config(format!(
            "image too large: {} bytes (max {})",
            meta.len(),
            MAX_IMAGE_BYTES
        )));
    }

    let bytes = std::fs::read(&path)?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    };
    Ok(format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}
