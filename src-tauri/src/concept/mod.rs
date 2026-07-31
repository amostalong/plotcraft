//! concept/ 概念设计漏斗 —— 6 步 md 文件扫描 / IO（v0.3 实装：概念 tab + 宪法注入 chat）
//!
//! 数据约定（plans: concept tab）：
//! ```text
//! <project>/concept/
//!   seed.md                 # 种子（画面/情绪/"如果"）
//!   core-fantasy.md         # 核心体验（玩家是谁+处境+做什么）
//!   pillars.md              # 设计支柱（3-5 条，有否决权）
//!   world-rules.md          # 世界规则（每条=是什么+造成什么冲突）
//!   character-functions.md  # 人物功能（想要什么+为什么得不到）
//!   three-act.md            # 三幕骨架（冲突加压序列）
//! ```
//!
//! 每个文件 frontmatter（手写拼接 / 手写解析，不引 serde_yaml）：
//! ```yaml
//! ---
//! title: 设计支柱
//! step: pillars
//! status: draft        # empty | draft | confirmed
//! updated: 2026-07-29T...
//! ---
//! ```
//!
//! - 懒创建：create_project 不动；scan 缺文件返回 status "empty" + 空内容，
//!   save 时自动建目录和文件 → 旧项目零迁移兼容
//! - 不做文件监听 —— 玩家手改后点"刷新"重扫（对齐 art 模块惯例）

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// concept 根目录名（项目根下）
pub const CONCEPT_DIR: &str = "concept";
/// 摘要里单步内容截断长度（字符数）
const SUMMARY_CONTENT_MAX_CHARS: usize = 500;

/// 步骤静态定义（6 步固定，不开放自由步骤）
pub struct StepDef {
    pub id: &'static str,
    pub title: &'static str,
    pub filename: &'static str,
    /// 该步的写作引导语（前端镜像此文案拼 LLM prompt 的说明部分，见 plan §10；
    /// 后端暂不外发 —— ConceptStep 字段表按计划固定为 6 个）
    #[allow(dead_code)]
    pub hint: &'static str,
}

/// 概念设计漏斗 6 步定义表（顺序 = stepper 显示顺序）
pub const STEPS: [StepDef; 6] = [
    StepDef {
        id: "seed",
        title: "种子",
        filename: "seed.md",
        hint: "写下一个画面、一种情绪，或一个「如果……会怎样」的假设。越具体越好，一句话也行。",
    },
    StepDef {
        id: "core-fantasy",
        title: "核心体验",
        filename: "core-fantasy.md",
        hint: "用一句话说清：玩家是谁，在什么处境，做什么。格式参考：玩家是___，在___处境，做___。",
    },
    StepDef {
        id: "pillars",
        title: "设计支柱",
        filename: "pillars.md",
        hint: "列 3-5 条设计支柱。每条都要有否决权：任何方案违背它就该被打回。避免「丰富剧情」这类无法否决任何方案的废话支柱。",
    },
    StepDef {
        id: "world-rules",
        title: "世界规则",
        filename: "world-rules.md",
        hint: "每条规则 = 是什么 + 造成什么冲突。写不出冲突的规则先标记为可疑。",
    },
    StepDef {
        id: "character-functions",
        title: "人物功能",
        filename: "character-functions.md",
        hint: "每个人物 = 想要什么 + 为什么得不到。对手可以是支柱反面的人格化，镜子可以是主角的另一种可能。",
    },
    StepDef {
        id: "three-act",
        title: "三幕骨架",
        filename: "three-act.md",
        hint: "把冲突排成加压序列：每一幕的压力都要比上一幕大，直到终幕爆发。",
    },
];

/// 跨 boundary 类型（snake_case，前端 `src/types/concept.ts` 镜像）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptStep {
    /// 步骤 id（seed / core-fantasy / pillars / world-rules / character-functions / three-act）
    pub id: String,
    /// 步骤中文标题
    pub title: String,
    /// concept/ 下的文件名
    pub filename: String,
    /// empty | draft | confirmed
    pub status: String,
    /// frontmatter 之后的正文
    pub content: String,
    /// frontmatter 的 updated（RFC3339；empty 步骤为空串）
    pub updated: String,
}

/// step_id 校验 + 取定义
pub fn step_def(step_id: &str) -> AppResult<&'static StepDef> {
    STEPS
        .iter()
        .find(|s| s.id == step_id)
        .ok_or_else(|| AppError::Config(format!("非法 concept step: {}", step_id)))
}

/// 步骤文件路径：`<project>/concept/<filename>`
pub fn step_path(project_root: &Path, def: &StepDef) -> PathBuf {
    project_root.join(CONCEPT_DIR).join(def.filename)
}

/// 手写 frontmatter 解析：只从 `---` 块里抠 status 和 updated 两个字段
///
/// 返回 (status, updated, body)。没有 frontmatter → status/updated 空串，body = 全文。
fn parse_frontmatter(text: &str) -> (String, String, String) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    if !text.starts_with("---") {
        return (String::new(), String::new(), text.to_string());
    }
    // 跳过第一行 `---`
    let after_open = match text.find('\n') {
        Some(i) => &text[i + 1..],
        None => return (String::new(), String::new(), text.to_string()),
    };
    // 找闭合 `---` 行
    let mut status = String::new();
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
            let value = value.trim();
            match key.trim() {
                "status" => status = value.to_string(),
                "updated" => updated = value.to_string(),
                _ => {}
            }
        }
        offset += line.len();
    }
    match body_start {
        Some(i) => (status, updated, after_open[i..].to_string()),
        // 没有闭合 `---` → 整个当正文，不写回（玩家手改坏的情况容错）
        None => (String::new(), String::new(), text.to_string()),
    }
}

/// 手写 frontmatter 拼接（title / step / status / updated 固定 4 字段）
fn build_frontmatter(def: &StepDef, status: &str, updated: &str) -> String {
    format!(
        "---\ntitle: {}\nstep: {}\nstatus: {}\nupdated: {}\n---\n\n",
        def.title, def.id, status, updated
    )
}

/// 扫描 `<project>/concept/` 6 步文件（同步 fs —— 调用方走 spawn_blocking）
/// 缺文件 → status "empty" + 空内容；有文件但 frontmatter 缺 status → "draft"
pub fn scan_concept(project_root: &Path) -> AppResult<Vec<ConceptStep>> {
    let mut steps = Vec::with_capacity(STEPS.len());

    for def in STEPS.iter() {
        let path = step_path(project_root, def);
        if !path.is_file() {
            steps.push(ConceptStep {
                id: def.id.to_string(),
                title: def.title.to_string(),
                filename: def.filename.to_string(),
                status: "empty".to_string(),
                content: String::new(),
                updated: String::new(),
            });
            continue;
        }

        let text = std::fs::read_to_string(&path)
            .map_err(|e| AppError::Config(format!("read {}: {}", path.display(), e)))?;
        let (mut status, updated, body) = parse_frontmatter(&text);
        if status.is_empty() {
            status = "draft".to_string();
        }
        steps.push(ConceptStep {
            id: def.id.to_string(),
            title: def.title.to_string(),
            filename: def.filename.to_string(),
            status,
            content: body.trim_start_matches(['\r', '\n']).to_string(),
            updated,
        });
    }

    Ok(steps)
}

/// 保存一步（atomic write：tmp → rename，对齐 commands/art.rs:save_art_prompt 写法）
/// - 懒建 `concept/` 目录
/// - mark_confirmed=true → status "confirmed"，否则 "draft"
/// - 返回写入后的 ConceptStep（updated 用写入时的 UTC 时间）
pub fn save_concept_step(
    project_root: &Path,
    step_id: &str,
    content: &str,
    mark_confirmed: bool,
) -> AppResult<ConceptStep> {
    let def = step_def(step_id)?;
    let status = if mark_confirmed { "confirmed" } else { "draft" };
    let updated = chrono::Utc::now().to_rfc3339();

    let dir = project_root.join(CONCEPT_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Config(format!("create dir {}: {}", dir.display(), e)))?;

    let path = step_path(project_root, def);
    let full = format!("{}{}", build_frontmatter(def, status, &updated), content);
    let tmp_path = path.with_extension("md.tmp");
    std::fs::write(&tmp_path, &full)
        .map_err(|e| AppError::Config(format!("write tmp {}: {}", tmp_path.display(), e)))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| AppError::Config(format!("rename to {}: {}", path.display(), e)))?;

    Ok(ConceptStep {
        id: def.id.to_string(),
        title: def.title.to_string(),
        filename: def.filename.to_string(),
        status: status.to_string(),
        content: content.to_string(),
        updated,
    })
}

/// 字符数安全的截断（中文等多字节字符不会切半）
fn truncate_chars(s: &str, max_chars: usize) -> String {
    let mut iter = s.chars();
    let out: String = iter.by_ref().take(max_chars).collect();
    if iter.next().is_some() {
        format!("{}…", out)
    } else {
        out
    }
}

/// 拼接 status != empty 的步骤给 chat 注入用（同步 fs —— 调用方走 spawn_blocking）
///
/// 格式：`## 种子\n<内容截断 500 字>\n\n## 核心体验\n...`
/// 全部 empty → 空串（前端据此跳过注入）
pub fn concept_summary(project_root: &Path) -> AppResult<String> {
    let steps = scan_concept(project_root)?;
    let mut parts: Vec<String> = Vec::new();
    for step in steps {
        if step.status == "empty" {
            continue;
        }
        let content = step.content.trim();
        if content.is_empty() {
            continue;
        }
        parts.push(format!(
            "## {}\n{}",
            step.title,
            truncate_chars(content, SUMMARY_CONTENT_MAX_CHARS)
        ));
    }
    Ok(parts.join("\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_frontmatter_happy() {
        let text = "---\ntitle: 种子\nstep: seed\nstatus: confirmed\nupdated: 2026-07-29T01:02:03+00:00\n---\n\n正文内容\n";
        let (status, updated, body) = parse_frontmatter(text);
        assert_eq!(status, "confirmed");
        assert_eq!(updated, "2026-07-29T01:02:03+00:00");
        assert_eq!(body, "\n正文内容\n");
    }

    #[test]
    fn parse_frontmatter_missing() {
        let (status, updated, body) = parse_frontmatter("没有 frontmatter 的正文");
        assert_eq!(status, "");
        assert_eq!(updated, "");
        assert_eq!(body, "没有 frontmatter 的正文");
    }

    #[test]
    fn parse_frontmatter_unclosed() {
        let (status, _, body) = parse_frontmatter("---\nstatus: draft\n没有闭合");
        assert_eq!(status, "");
        assert!(body.contains("没有闭合"));
    }

    #[test]
    fn truncate_chars_multibyte_safe() {
        let s = "中".repeat(600);
        let out = truncate_chars(&s, 500);
        assert_eq!(out.chars().count(), 501); // 500 + …
    }

    #[test]
    fn truncate_chars_short() {
        assert_eq!(truncate_chars("abc", 500), "abc");
    }

    #[test]
    fn step_def_rejects_unknown() {
        assert!(step_def("seed").is_ok());
        assert!(step_def("nope").is_err());
    }

    #[test]
    fn scan_and_save_roundtrip() {
        let dir = std::env::temp_dir().join(format!("plotcraft-concept-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // 空项目 → 6 个 empty
        let steps = scan_concept(&dir).unwrap();
        assert_eq!(steps.len(), 6);
        assert!(steps.iter().all(|s| s.status == "empty"));
        assert_eq!(concept_summary(&dir).unwrap(), "");

        // save 一步 → draft + roundtrip
        let saved = save_concept_step(&dir, "seed", "一个雨夜的站台", false).unwrap();
        assert_eq!(saved.status, "draft");
        let steps = scan_concept(&dir).unwrap();
        assert_eq!(steps[0].status, "draft");
        assert_eq!(steps[0].content, "一个雨夜的站台");
        assert!(!steps[0].updated.is_empty());

        // mark_confirmed → confirmed
        let saved = save_concept_step(&dir, "seed", "一个雨夜的站台", true).unwrap();
        assert_eq!(saved.status, "confirmed");
        let summary = concept_summary(&dir).unwrap();
        assert!(summary.contains("## 种子"));
        assert!(summary.contains("一个雨夜的站台"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
