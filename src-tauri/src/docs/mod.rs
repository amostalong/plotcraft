//! docs/ 通用"固定分节文档集合"模块（v0.3 实装：世界 tab；人物/剧情 tab 复用）
//!
//! 跟 concept/mod.rs 的区别：concept 是"固定 6 步 + status 状态机"，
//! docs 是"固定分节、无状态机"——状态点只用 exists（有文件=有，无=无）。
//!
//! 数据约定（collection 注册表，先只注册 world）：
//! ```text
//! <project>/world/
//!   overview.md        # 世界观速览（create_project 已生成）
//!   geography.md       # 地理（懒创建）
//!   history.md         # 历史（懒创建）
//!   magic-system.md    # 魔法体系（懒创建）
//!   factions.md        # 阵营（懒创建）
//! ```
//!
//! 每个文件 frontmatter（手写拼接 / 手写解析，不引 serde_yaml）：
//! ```yaml
//! ---
//! title: 地理
//! updated: 2026-07-30T...
//! ---
//! ```
//!
//! - frontmatter 从简：只带 title + updated（不带 status —— 那是概念漏斗的语义）
//! - 兼容 create_project 生成的 world/overview.md（frontmatter 带 title/tags/status/updated）：
//!   parse 只抠 updated，忽略其余字段；正文 = frontmatter 之后的部分
//! - 懒创建：scan 缺文件返回 exists: false + 空内容，save 时自动建目录和文件 → 旧项目零迁移
//! - 不做文件监听 —— 玩家手改后切项目/刷新重扫（对齐 concept / art 模块惯例）

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// 摘要里单节内容截断长度（字符数）
const SUMMARY_CONTENT_MAX_CHARS: usize = 500;

/// 分节静态定义
pub struct SectionDef {
    pub id: &'static str,
    pub title: &'static str,
    pub filename: &'static str,
    /// 该节的写作引导语（前端镜像此文案拼 LLM prompt 的说明部分；
    /// 后端暂不外发 —— DocEntry 字段表按计划固定为 7 个）
    #[allow(dead_code)]
    pub hint: &'static str,
}

/// 集合静态定义（一个 collection = 一个目录 + 固定分节表）
pub struct CollectionDef {
    pub id: &'static str,
    /// 项目根下的目录名
    pub dir: &'static str,
    pub sections: &'static [SectionDef],
}

/// world 集合 5 个分节定义表（顺序 = 左栏显示顺序）
const WORLD_SECTIONS: [SectionDef; 5] = [
    SectionDef {
        id: "overview",
        title: "世界观速览",
        filename: "overview.md",
        hint: "用 ≤200 字说清这个世界的一句话设定。必须体现概念宪法里的核心体验——读者读完应该知道「在这个世界里玩故事是什么感觉」。",
    },
    SectionDef {
        id: "geography",
        title: "地理",
        filename: "geography.md",
        hint: "每个地点都要带「它给故事提供什么舞台/冲突」，拒绝纯百科式罗列。写不出舞台功能的地点先不写。",
    },
    SectionDef {
        id: "history",
        title: "历史",
        filename: "history.md",
        hint: "只写「对现在还有影响」的历史。每条历史都要带「它造成了今天的什么」——跟当下剧情无关的往事删掉。",
    },
    SectionDef {
        id: "magic-system",
        title: "魔法体系",
        filename: "magic-system.md",
        hint: "每条规则必须有代价/限制（对齐概念支柱）。写不出代价的能力先标记为可疑，宁可少写不要写无敌设定。",
    },
    SectionDef {
        id: "factions",
        title: "阵营",
        filename: "factions.md",
        hint: "每个阵营 = 想要什么 + 跟谁的什么冲突。没有冲突对象的阵营是装饰品，先不写。",
    },
];

/// world 集合定义
const WORLD: CollectionDef = CollectionDef {
    id: "world",
    dir: "world",
    sections: &WORLD_SECTIONS,
};

/// collection 注册表（先只注册 world；人物/剧情 tab 时往里加）
pub const COLLECTIONS: &[CollectionDef] = &[WORLD];

/// 跨 boundary 类型（snake_case，前端 `src/types/world.ts` 镜像）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocEntry {
    /// 集合 id（world / 将来的 characters、plot）
    pub collection: String,
    /// 分节 id（overview / geography / history / magic-system / factions）
    pub id: String,
    /// 分节中文标题
    pub title: String,
    /// 集合目录下的文件名
    pub filename: String,
    /// 文件是否已存在（懒创建：缺文件 = false + 空内容）
    pub exists: bool,
    /// frontmatter 之后的正文（exists=false 时为空串）
    pub content: String,
    /// frontmatter 的 updated（RFC3339；exists=false 或老模板 TODO 占位时原样/空串）
    pub updated: String,
}

/// collection_id 校验 + 取定义
pub fn collection_def(collection_id: &str) -> AppResult<&'static CollectionDef> {
    COLLECTIONS
        .iter()
        .find(|c| c.id == collection_id)
        .ok_or_else(|| AppError::Config(format!("非法 docs collection: {}", collection_id)))
}

/// section_id 校验 + 取定义
fn section_def<'a>(collection: &'a CollectionDef, section_id: &str) -> AppResult<&'a SectionDef> {
    collection
        .sections
        .iter()
        .find(|s| s.id == section_id)
        .ok_or_else(|| {
            AppError::Config(format!(
                "非法 docs section: {} (collection {})",
                section_id, collection.id
            ))
        })
}

/// 分节文件路径：`<project>/<dir>/<filename>`
fn section_path(project_root: &Path, collection: &CollectionDef, def: &SectionDef) -> PathBuf {
    project_root.join(collection.dir).join(def.filename)
}

/// 手写 frontmatter 解析：只从 `---` 块里抠 updated 一个字段（title/tags/status 等忽略）
///
/// 返回 (updated, body)。没有 frontmatter → updated 空串，body = 全文。
/// 跟 concept/mod.rs 的 parse_frontmatter 同源（那边抠 status + updated）——
/// 两处刻意各自维护不抽共享：字段集不同，若第三个模块出现再抽共享。
fn parse_frontmatter(text: &str) -> (String, String) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    if !text.starts_with("---") {
        return (String::new(), text.to_string());
    }
    // 跳过第一行 `---`
    let after_open = match text.find('\n') {
        Some(i) => &text[i + 1..],
        None => return (String::new(), text.to_string()),
    };
    // 找闭合 `---` 行
    let mut updated = String::new();
    let mut body_start = None;
    let mut offset = 0;
    for line in after_open.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == "---" {
            body_start = Some(offset + line.len());
            break;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            if key.trim() == "updated" {
                updated = value.trim().to_string();
            }
        }
        offset += line.len();
    }
    match body_start {
        Some(i) => (updated, after_open[i..].to_string()),
        // 没有闭合 `---` → 整个当正文，不写回（玩家手改坏的情况容错）
        None => (String::new(), text.to_string()),
    }
}

/// 手写 frontmatter 拼接（title / updated 固定 2 字段，不带 status）
fn build_frontmatter(def: &SectionDef, updated: &str) -> String {
    format!("---\ntitle: {}\nupdated: {}\n---\n\n", def.title, updated)
}

/// 扫描 `<project>/<dir>/` 固定分节文件（同步 fs —— 调用方走 spawn_blocking）
/// 缺文件 → exists: false + 空内容
pub fn scan_docs(project_root: &Path, collection_id: &str) -> AppResult<Vec<DocEntry>> {
    let collection = collection_def(collection_id)?;
    let mut docs = Vec::with_capacity(collection.sections.len());

    for def in collection.sections.iter() {
        let path = section_path(project_root, collection, def);
        if !path.is_file() {
            docs.push(DocEntry {
                collection: collection.id.to_string(),
                id: def.id.to_string(),
                title: def.title.to_string(),
                filename: def.filename.to_string(),
                exists: false,
                content: String::new(),
                updated: String::new(),
            });
            continue;
        }

        let text = std::fs::read_to_string(&path)
            .map_err(|e| AppError::Config(format!("read {}: {}", path.display(), e)))?;
        let (updated, body) = parse_frontmatter(&text);
        docs.push(DocEntry {
            collection: collection.id.to_string(),
            id: def.id.to_string(),
            title: def.title.to_string(),
            filename: def.filename.to_string(),
            exists: true,
            content: body.trim_start_matches(['\r', '\n']).to_string(),
            updated,
        });
    }

    Ok(docs)
}

/// 保存一节（atomic write：tmp → rename，对齐 concept/mod.rs:save_concept_step 写法）
/// - 懒建 `<dir>/` 目录 —— 旧项目无目录也能直接 save
/// - frontmatter 只带 title + updated（写入时的 UTC 时间），不带 status
/// - 返回写入后的 DocEntry
pub fn save_doc(
    project_root: &Path,
    collection_id: &str,
    doc_id: &str,
    content: &str,
) -> AppResult<DocEntry> {
    let collection = collection_def(collection_id)?;
    let def = section_def(collection, doc_id)?;
    let updated = chrono::Utc::now().to_rfc3339();

    let dir = project_root.join(collection.dir);
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Config(format!("create dir {}: {}", dir.display(), e)))?;

    let path = section_path(project_root, collection, def);
    let full = format!("{}{}", build_frontmatter(def, &updated), content);
    let tmp_path = path.with_extension("md.tmp");
    std::fs::write(&tmp_path, &full)
        .map_err(|e| AppError::Config(format!("write tmp {}: {}", tmp_path.display(), e)))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| AppError::Config(format!("rename to {}: {}", path.display(), e)))?;

    Ok(DocEntry {
        collection: collection.id.to_string(),
        id: def.id.to_string(),
        title: def.title.to_string(),
        filename: def.filename.to_string(),
        exists: true,
        content: content.to_string(),
        updated,
    })
}

/// 字符数安全的截断（中文等多字节字符不会切半）
/// 跟 concept/mod.rs 的 truncate_chars 同源 —— 若第三个模块出现再抽共享。
fn truncate_chars(s: &str, max_chars: usize) -> String {
    let mut iter = s.chars();
    let out: String = iter.by_ref().take(max_chars).collect();
    if iter.next().is_some() {
        format!("{}…", out)
    } else {
        out
    }
}

/// 拼接 exists 且内容非空的分节给前端 AI context 用（同步 fs —— 调用方走 spawn_blocking）
///
/// 格式：`## 世界观速览\n<内容截断 max_chars 字>\n\n## 地理\n...`
/// 全部缺文件/空内容 → 空串（前端据此跳过注入）
pub fn docs_summary(project_root: &Path, collection_id: &str, max_chars: usize) -> AppResult<String> {
    let docs = scan_docs(project_root, collection_id)?;
    let mut parts: Vec<String> = Vec::new();
    for doc in docs {
        if !doc.exists {
            continue;
        }
        let content = doc.content.trim();
        if content.is_empty() {
            continue;
        }
        parts.push(format!("## {}\n{}", doc.title, truncate_chars(content, max_chars)));
    }
    Ok(parts.join("\n\n"))
}

/// command 层用的默认截断长度（get_docs_summary 不带 max_chars 参数）
pub const DEFAULT_SUMMARY_MAX_CHARS: usize = SUMMARY_CONTENT_MAX_CHARS;

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_project(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("plotcraft-docs-test-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn frontmatter_roundtrip() {
        // build → parse 还原 updated + body
        let def = &WORLD_SECTIONS[1]; // geography
        let full = format!("{}正文内容\n第二行", build_frontmatter(def, "2026-07-30T01:02:03+00:00"));
        let (updated, body) = parse_frontmatter(&full);
        assert_eq!(updated, "2026-07-30T01:02:03+00:00");
        assert_eq!(body, "\n正文内容\n第二行");
    }

    #[test]
    fn scan_missing_files_returns_exists_false() {
        let dir = temp_project("missing");

        // 空项目 → 5 节全部 exists: false + 空内容
        let docs = scan_docs(&dir, "world").unwrap();
        assert_eq!(docs.len(), 5);
        assert!(docs.iter().all(|d| !d.exists));
        assert!(docs.iter().all(|d| d.content.is_empty()));
        assert_eq!(docs_summary(&dir, "world", 500).unwrap(), "");

        // 非法 collection / section 报错
        assert!(scan_docs(&dir, "nope").is_err());
        assert!(save_doc(&dir, "world", "nope", "x").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn summary_truncates_long_content() {
        let dir = temp_project("truncate");

        // 写一节超长内容 → summary 截断 + 省略号
        let long = "中".repeat(600);
        save_doc(&dir, "world", "geography", &long).unwrap();
        // 另一节空内容 → 不进 summary
        save_doc(&dir, "world", "history", "   \n").unwrap();

        let summary = docs_summary(&dir, "world", 500).unwrap();
        assert!(summary.contains("## 地理"));
        assert!(summary.contains('…'));
        // 截断后单节 500 字 + …，且空内容的 history 不出现
        assert!(!summary.contains("## 历史"));
        let body = summary.strip_prefix("## 地理\n").unwrap();
        assert_eq!(body.chars().count(), 501);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_legacy_overview_md_compatible() {
        // create_project 生成的 world/overview.md 老格式（title/tags/status/updated 全带）
        let dir = temp_project("legacy");
        let world_dir = dir.join("world");
        std::fs::create_dir_all(&world_dir).unwrap();
        std::fs::write(
            world_dir.join("overview.md"),
            "---\ntitle: 世界观速览\ntags: [world, overview]\nstatus: draft\nupdated: TODO\n---\n\n一句话世界观（≤ 200 字）：\n\n> TODO: 在这里写你的世界观速览\n",
        )
        .unwrap();

        let docs = scan_docs(&dir, "world").unwrap();
        assert_eq!(docs.len(), 5);

        let overview = &docs[0];
        assert_eq!(overview.id, "overview");
        assert!(overview.exists);
        // tags/status 被忽略，updated 原样带出（TODO 占位也原样）
        assert_eq!(overview.updated, "TODO");
        assert!(overview.content.starts_with("一句话世界观"));
        assert!(!overview.content.contains("status:"));

        // 其余 4 节缺文件
        assert!(docs[1..].iter().all(|d| !d.exists));

        // 老格式进 summary（内容非空）
        let summary = docs_summary(&dir, "world", 500).unwrap();
        assert!(summary.contains("## 世界观速览"));
        assert!(summary.contains("一句话世界观"));

        // save 覆盖老格式 → 新 frontmatter 只有 title + updated（无 status/tags）
        let saved = save_doc(&dir, "world", "overview", "新的速览内容").unwrap();
        assert!(saved.exists);
        let raw = std::fs::read_to_string(world_dir.join("overview.md")).unwrap();
        assert!(raw.starts_with("---\ntitle: 世界观速览\nupdated: "));
        assert!(!raw.contains("status:"));
        assert!(!raw.contains("tags:"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
