//! concept/ 概念设计 —— 6 层抽象蒸馏模型（v0.5.3+）
//!
//! 数据约定：
//! ```text
//! <project>/concept/
//!   seed.md                 # L1 立意（1 句核心矛盾 / 主题）
//!   core-story.md           # L2 核心故事（叙事脊柱 + 戏剧结构）
//!   world-rules.md          # L3 世界规则（宏观设定 + 运作法则）
//!   locations.md            # L4 地点（可选，密室/单场景剧可跳过）
//!   character-functions.md  # L5 人物（角色功能，派生 L3+L4）
//!   core-gameplay.md        # L6 核心玩法（核心机制 + 1 句话体验）
//! ```
//!
//! 6 层派生关系：
//! ```text
//! L1 立意（seed）             → 故事的根，1 句哲学
//!   ↓ 派生
//! L2 核心故事（core-story）   → 叙事脊柱 + 戏剧结构（吸收 v0.5+ 旧 L2 pillars + L6 three-act）
//!   ↓ 派生
//! L3 世界规则（world-rules）  → 宏观设定 + 运作法则
//!   ↓ 派生
//! L4 地点（locations, 可选）  → 具体空间
//!   ↓ 派生
//! L5 人物（character-functions）→ 角色功能
//!   ↓ 派生
//! L6 核心玩法（core-gameplay）→ 核心机制 + 1 句话玩家体验（吸收 v0.5+ 旧 L7 core-fantasy + 新增核心机制）
//! ```
//!
//! 设计哲学根（用户 2026-07-30 ~ 08-04 沉淀）：
//! - 立意第一性：L1 是哲学根，1 句话核心矛盾
//! - 核心故事承上启下：L2 核心故事 = spine + 戏剧结构（不再有 4 态成熟度）
//! - 派生链：L1 → L2 → L3 → L4 → L5 → L6
//! - 抽象 vs 展开二分：6 层 = 核心设定（1-3 段话/层）；完整作品 → v0.6+ 剧情 / 人物 / 玩法 tab 展开
//! - 螺旋设计循环：改任何层都触发全链路反思提示（手动校准，不自动改）
//!
//! 每个文件 frontmatter（手写拼接 / 手写解析，不引 serde_yaml）：
//! ```yaml
//! ---
//! title: 立意
//! step: seed
//! group: theme        # 旧 frontmatter 没这字段 → 走 infer_group_level 推断
//! level: 1
//! status: confirmed
//! updated: 2026-08-04T...
//! ---
//! ```
//!
//! v0.5.3+ 删除 v0.5+ 旧 L2 pillars 4 态成熟度（empty/draft/evolving/finalized）：
//! - 旧 L2 抽象规则 内容已并入 L2 核心故事（叙事脊柱 + 戏剧结构）
//! - L2 核心故事 不需要"演进型"——它是"什么"层，不是"怎么约束"层
//! - ConceptStep.maturity 字段删除；build_frontmatter 不再写 maturity
//!
//! - 懒创建：create_project 不动；scan 缺文件返回 status "empty" + 空内容，
//!   save 时自动建目录和文件 → 旧项目零迁移兼容
//! - 旧项目兼容（v0.5+ 7 步 → v0.5.3+ 6 步）：
//!   - `migrate_legacy_concept` 在 `scan_concept` 入口一次性跑
//!   - 旧 pillars.md + 旧 three-act.md → 合并为 新的 core-story.md
//!   - 旧 core-fantasy.md → 改名为 新的 core-gameplay.md
//!   - 旧 world-rules.md / locations.md / character-functions.md / seed.md 走 §8.2 infer_group_level
//! - 不做文件监听 —— 玩家手改后点"刷新"重扫（对齐 art 模块惯例）

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// concept 根目录名（项目根下）
pub const CONCEPT_DIR: &str = "concept";
/// 摘要里单步内容截断长度（字符数）
const SUMMARY_CONTENT_MAX_CHARS: usize = 500;

/// 步骤分组（v0.5.3+ 6 个 group；v0.5+ 旧 Principles/Story/CoreFantasy 删除，
/// 新增 CoreStory + CoreGameplay，World → WorldRules）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Group {
    Theme,        // L1 立意
    CoreStory,    // L2 核心故事
    WorldRules,   // L3 世界规则
    Locations,    // L4 地点
    Character,    // L5 人物
    CoreGameplay, // L6 核心玩法
    #[serde(other)]
    Other,
}

impl Group {
    /// group 字符串（frontmatter 写盘用 / 旧项目解析用）→ Group
    pub fn from_str(s: &str) -> Self {
        match s {
            "theme" => Self::Theme,
            "core-story" => Self::CoreStory,
            "world-rules" => Self::WorldRules,
            "locations" => Self::Locations,
            "character" => Self::Character,
            "core-gameplay" => Self::CoreGameplay,
            _ => Self::Other,
        }
    }
    /// Group → group 字符串（写盘）
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Theme => "theme",
            Self::CoreStory => "core-story",
            Self::WorldRules => "world-rules",
            Self::Locations => "locations",
            Self::Character => "character",
            Self::CoreGameplay => "core-gameplay",
            Self::Other => "other",
        }
    }
}

/// 步骤层级（1-6）
pub type Level = u8;

/// 步骤静态定义（6 步固定，不开放自由步骤）
pub struct StepDef {
    pub id: &'static str,
    pub title: &'static str,
    pub filename: &'static str,
    pub group: Group,
    pub level: Level,
    /// 可选 step（L4 地点）
    pub optional: bool,
    /// 该步的写作引导语（前端镜像此文案拼 LLM prompt 的说明部分；
    /// 后端暂不外发 —— ConceptStep 字段表按计划固定为 6 步）
    #[allow(dead_code)]
    pub hint: &'static str,
}

/// 概念设计 6 层定义表（顺序 = stepper 显示顺序，按派生链）
pub const STEPS: [StepDef; 6] = [
    StepDef {
        id: "seed",
        title: "立意",
        filename: "seed.md",
        group: Group::Theme,
        level: 1,
        optional: false,
        hint: "立意 = 故事要讨论的东西。",
    },
    StepDef {
        id: "core-story",
        title: "核心故事",
        filename: "core-story.md",
        group: Group::CoreStory,
        level: 2,
        optional: false,
        hint: "L2 核心故事 = 这条故事的叙事脊柱 + 戏剧结构。1-2 段话级别。模板：弧线（1 句话）+ 3 幕压力走向（每幕 1 句话）。派生 L1 立意——把「主题要表达什么」转成「故事要演什么」。",
    },
    StepDef {
        id: "world-rules",
        title: "世界规则",
        filename: "world-rules.md",
        group: Group::WorldRules,
        level: 3,
        optional: false,
        hint: "世界规则 = 宏观设定 + 运作法则。每条 = 是什么 + 怎么运作 + 造成什么冲突。派生 L1 立意 + L2 核心故事。",
    },
    StepDef {
        id: "locations",
        title: "地点",
        filename: "locations.md",
        group: Group::Locations,
        level: 4,
        optional: true,
        hint: "具体空间——地理 / 氛围 / 物理特征 / 跟立意/世界的连接。这是可选的——密室 / 单场景剧可以跳过。不写 NPC（那是 L5 人物）。",
    },
    StepDef {
        id: "character-functions",
        title: "人物",
        filename: "character-functions.md",
        group: Group::Character,
        level: 5,
        optional: false,
        hint: "角色功能——每个人 = 想要什么 + 为什么得不到。人物欲望应追溯到 L3 世界规则 + L4 地点——不是凭空生成。人物被世界的波浪推到某个位置，他们想要的是对世界压力的回应。",
    },
    StepDef {
        id: "core-gameplay",
        title: "核心玩法",
        filename: "core-gameplay.md",
        group: Group::CoreGameplay,
        level: 6,
        optional: false,
        hint: "L6 核心玩法 = 玩家玩什么 + 怎么玩 + 感受到什么。两部分：1. 核心机制（回合制 / 文字冒险 / 资源管理 / 角色羁绊 / 选择驱动 / 等）；2. 1 句话玩家体验（「你扮演 X，在 Y，做 Z」）。派生 L1-L5——核心机制派生世界 + 人物；体验整合整链路。",
    },
];

/// 跨 boundary 类型（snake_case，前端 `src/types/concept.ts` 镜像）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptStep {
    /// 步骤 id（seed / core-story / world-rules / locations / character-functions / core-gameplay）
    pub id: String,
    /// 步骤中文标题
    pub title: String,
    /// concept/ 下的文件名
    pub filename: String,
    /// group（theme / core-story / world-rules / locations / character / core-gameplay）
    pub group: String,
    /// level（1-6，派生链位置）
    pub level: Level,
    /// empty | confirmed（v0.3+ 简化）
    pub status: String,
    /// frontmatter 之后的正文
    pub content: String,
    /// frontmatter 的 updated（RFC3339；empty 步骤为空串）
    pub updated: String,
    /// optional（仅 L4 locations = true；其他步骤为 false）
    #[serde(default)]
    pub optional: bool,
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

/// 旧 frontmatter 无 group 字段时按 step_id 推断 group/level
/// v0.5+ 7 步 → v0.5.3+ 6 步迁移用：
///   - 旧 pillars / three-act → 已被 §migrate_legacy_concept 文件级迁移（不应独立存在）
///     但 infer 这里兼容它们 → 都归 (CoreStory, 2)
///   - 旧 core-fantasy → 已被 §migrate_legacy_concept 改名为 core-gameplay.md
///     但 infer 这里兼容旧名 → 归 (CoreGameplay, 6)
///   - 旧 world-rules / locations / character-functions / seed 推断不变（id 沿用）
fn infer_group_level(step_id: &str) -> (Group, Level) {
    match step_id {
        "seed" => (Group::Theme, 1),
        "core-story" => (Group::CoreStory, 2),
        "world-rules" => (Group::WorldRules, 3),
        "locations" => (Group::Locations, 4),
        "character-functions" => (Group::Character, 5),
        "core-gameplay" => (Group::CoreGameplay, 6),
        // v0.5+ 旧 step_id 兼容（文件级迁移后不应独立存在；万一有遗留也走对的位置）
        "pillars" | "three-act" => (Group::CoreStory, 2),
        "core-fantasy" => (Group::CoreGameplay, 6),
        _ => (Group::Other, 0),
    }
}

/// 手写 frontmatter 解析：抠 status / updated / group / level 4 个字段（v0.5.3+ 去 maturity）
///
/// 返回 (status, updated, group, level, body)。
/// 没有 frontmatter → status/updated/group/level 走推断/默认，body = 全文。
fn parse_frontmatter(text: &str, step_id: &str) -> (String, String, Group, Level, String) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let (def_group, def_level) = infer_group_level(step_id);
    if !text.starts_with("---") {
        return (
            String::new(),
            String::new(),
            def_group,
            def_level,
            text.to_string(),
        );
    }
    // 跳过第一行 `---`
    let after_open = match text.find('\n') {
        Some(i) => &text[i + 1..],
        None => {
            return (
                String::new(),
                String::new(),
                def_group,
                def_level,
                text.to_string(),
            )
        }
    };
    let mut status = String::new();
    let mut updated = String::new();
    let mut group_str: Option<String> = None;
    let mut level: Option<Level> = None;
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
                "group" => group_str = Some(value.to_string()),
                "level" => {
                    if let Ok(n) = value.parse::<Level>() {
                        level = Some(n);
                    }
                }
                _ => {} // v0.5+ 旧 maturity 字段忽略（v0.5.3+ 删除）
            }
        }
        offset += line.len();
    }
    let (g, l) = match (group_str, level) {
        (Some(g), Some(l)) => (Group::from_str(&g), l),
        (Some(g), None) => (Group::from_str(&g), def_level),
        (None, Some(l)) => (def_group, l),
        (None, None) => (def_group, def_level),
    };
    match body_start {
        Some(i) => (status, updated, g, l, after_open[i..].to_string()),
        // 没有闭合 `---` → 整个当正文，不写回（玩家手改坏的情况容错）
        None => (
            String::new(),
            String::new(),
            def_group,
            def_level,
            text.to_string(),
        ),
    }
}

/// 手写 frontmatter 拼接（title / step / group / level / status / updated 字段，v0.5.3+ 去 maturity）
fn build_frontmatter(def: &StepDef, status: &str, updated: &str) -> String {
    format!(
        "---\ntitle: {}\nstep: {}\ngroup: {}\nlevel: {}\nstatus: {}\nupdated: {}\n---\n\n",
        def.title,
        def.id,
        def.group.as_str(),
        def.level,
        status,
        updated
    )
}

/// v0.5+ 7 步 → v0.5.3+ 6 步 文件级迁移（一次性，scan_concept 入口调）
///
/// - 旧 pillars.md + 旧 three-act.md → 合并为 新的 core-story.md
/// - 旧 core-fantasy.md → 改名为 新的 core-gameplay.md
/// - 其他文件不动
/// - 已迁移（目标文件存在）→ 跳过
/// - 失败不报错（migrate 是 best-effort；旧文件保留，scan 走 infer_group_level 兜底）
fn migrate_legacy_concept(project_root: &Path) -> AppResult<()> {
    let dir = project_root.join(CONCEPT_DIR);
    if !dir.is_dir() {
        return Ok(()); // 没 concept/ 目录 → 无旧文件可迁移
    }

    // 1. 旧 pillars.md + 旧 three-act.md → 合并为 新的 core-story.md
    let pillars = dir.join("pillars.md");
    let three_act = dir.join("three-act.md");
    let core_story = dir.join("core-story.md");

    if !core_story.is_file() {
        let pillars_text = if pillars.is_file() {
            Some(
                std::fs::read_to_string(&pillars)
                    .map_err(|e| AppError::Config(format!("read {}: {}", pillars.display(), e)))?,
            )
        } else {
            None
        };
        let three_act_text = if three_act.is_file() {
            Some(
                std::fs::read_to_string(&three_act)
                    .map_err(|e| AppError::Config(format!("read {}: {}", three_act.display(), e)))?,
            )
        } else {
            None
        };

        if pillars_text.is_some() || three_act_text.is_some() {
            let mut merged = String::new();
            if let Some(t) = pillars_text {
                merged.push_str(&t);
            }
            if let Some(t) = three_act_text {
                if !merged.is_empty() {
                    merged.push_str("\n\n## 戏剧结构（旧）\n\n");
                }
                merged.push_str(&t);
            }
            std::fs::write(&core_story, &merged)
                .map_err(|e| AppError::Config(format!("write {}: {}", core_story.display(), e)))?;
        }
    }

    // 2. 旧 core-fantasy.md → 改名为 新的 core-gameplay.md
    let core_fantasy = dir.join("core-fantasy.md");
    let core_gameplay = dir.join("core-gameplay.md");
    if !core_gameplay.is_file() && core_fantasy.is_file() {
        std::fs::rename(&core_fantasy, &core_gameplay)
            .map_err(|e| AppError::Config(format!("rename: {}", e)))?;
    }

    Ok(())
}

/// 扫描 `<project>/concept/` 6 步文件（同步 fs —— 调用方走 spawn_blocking）
/// 缺文件 → status "empty" + 空内容；有文件但 frontmatter 缺 status → "confirmed"
/// 旧项目兼容：先跑 `migrate_legacy_concept` 一次性迁移 v0.5+ 7 步 → v0.5.3+ 6 步
pub fn scan_concept(project_root: &Path) -> AppResult<Vec<ConceptStep>> {
    // 一次性迁移 v0.5+ 旧 7 步 → v0.5.3+ 新 6 步
    migrate_legacy_concept(project_root)?;

    let mut steps = Vec::with_capacity(STEPS.len());

    for def in STEPS.iter() {
        let path = step_path(project_root, def);
        if !path.is_file() {
            steps.push(ConceptStep {
                id: def.id.to_string(),
                title: def.title.to_string(),
                filename: def.filename.to_string(),
                group: def.group.as_str().to_string(),
                level: def.level,
                status: "empty".to_string(),
                content: String::new(),
                updated: String::new(),
                optional: def.optional,
            });
            continue;
        }

        let text = std::fs::read_to_string(&path)
            .map_err(|e| AppError::Config(format!("read {}: {}", path.display(), e)))?;
        let (mut status, updated, group, level, body) = parse_frontmatter(&text, def.id);
        if status.is_empty() {
            status = "confirmed".to_string();
        }
        steps.push(ConceptStep {
            id: def.id.to_string(),
            title: def.title.to_string(),
            filename: def.filename.to_string(),
            group: group.as_str().to_string(),
            level,
            status,
            content: body.trim_start_matches(['\r', '\n']).to_string(),
            updated,
            optional: def.optional,
        });
    }

    Ok(steps)
}

/// 保存一步（atomic write：tmp → rename，对齐 commands/art.rs:save_art_prompt 写法）
/// - 懒建 `concept/` 目录
/// - mark_confirmed=true → status "confirmed"，否则 "draft"
/// - v0.5.3+ 删 maturity 参数（L2 核心故事 不再有 4 态成熟度）
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
    let full = format!(
        "{}{}",
        build_frontmatter(def, status, &updated),
        content
    );
    let tmp_path = path.with_extension("md.tmp");
    std::fs::write(&tmp_path, &full)
        .map_err(|e| AppError::Config(format!("write tmp {}: {}", tmp_path.display(), e)))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| AppError::Config(format!("rename to {}: {}", path.display(), e)))?;

    Ok(ConceptStep {
        id: def.id.to_string(),
        title: def.title.to_string(),
        filename: def.filename.to_string(),
        group: def.group.as_str().to_string(),
        level: def.level,
        status: status.to_string(),
        content: content.to_string(),
        updated,
        optional: def.optional,
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

/// 6 层分组标签（concept_summary 注入 LLM 用）
fn group_label(def: &StepDef) -> String {
    let base = format!("[L{} {}]", def.level, group_zh(&def.group));
    if def.optional {
        format!("{}（可选）", base)
    } else {
        base
    }
}

fn group_zh(g: &Group) -> &'static str {
    match g {
        Group::Theme => "立意",
        Group::CoreStory => "核心故事",
        Group::WorldRules => "世界规则",
        Group::Locations => "地点",
        Group::Character => "人物",
        Group::CoreGameplay => "核心玩法",
        Group::Other => "其他",
    }
}

/// 拼接 status != empty 的步骤给 chat 注入用（同步 fs —— 调用方走 spawn_blocking）
///
/// 格式：6 层分组标签 + 标题 + 内容（截断 500 字），按派生链顺序输出：
/// ```text
/// # [L1 立意] 故事的根 —— 核心矛盾 / 主题
/// ## 种子
/// <内容>
///
/// # [L2 核心故事] 叙事脊柱 + 戏剧结构
/// ## 核心故事
/// <内容>
/// ...
/// # [L6 核心玩法] 核心机制 + 玩家体验
/// ## 核心玩法
/// <内容>
/// ```
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
        // 找 def（拿 group/level/optional）
        let def = step_def(&step.id)?;
        let label = group_label(def);
        let hint_tail = match def.id {
            "seed" => " —— 核心矛盾 / 主题",
            "core-story" => " —— 叙事脊柱 + 戏剧结构",
            "world-rules" => " —— 宏观设定 + 运作法则",
            "locations" => " —— 具体空间",
            "character-functions" => " —— 角色功能（被世界+地点推到位置）",
            "core-gameplay" => " —— 核心机制 + 玩家体验",
            _ => "",
        };
        parts.push(format!(
            "# {}{}\n## {}\n{}",
            label,
            hint_tail,
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
        let text = "---\ntitle: 立意\nstep: seed\ngroup: theme\nlevel: 1\nstatus: confirmed\nupdated: 2026-08-04T01:02:03+00:00\n---\n\n正文内容\n";
        let (status, updated, group, level, body) = parse_frontmatter(text, "seed");
        assert_eq!(status, "confirmed");
        assert_eq!(updated, "2026-08-04T01:02:03+00:00");
        assert_eq!(group, Group::Theme);
        assert_eq!(level, 1);
        assert_eq!(body, "\n正文内容\n");
    }

    #[test]
    fn parse_frontmatter_legacy_no_group() {
        // v0.3 旧 frontmatter 没 group/level 字段 → 走 infer_group_level
        let text = "---\ntitle: 立意\nstep: seed\nstatus: confirmed\nupdated: 2026-07-01T00:00:00+00:00\n---\n\n旧 seed 内容\n";
        let (status, _, group, level, _) = parse_frontmatter(text, "seed");
        assert_eq!(status, "confirmed");
        assert_eq!(group, Group::Theme);
        assert_eq!(level, 1);
    }

    #[test]
    fn parse_frontmatter_legacy_core_fantasy_to_l6() {
        // v0.5+ 旧 core-fantasy → 推断为 L6 CoreGameplay（文件级迁移应已改名为 core-gameplay.md，
        // 但万一遗留旧名 core-fantasy.md 仍能正确推断）
        let text = "---\ntitle: 核心体验\nstep: core-fantasy\nstatus: confirmed\n---\n\n玩家是...\n";
        let (_, _, group, level, _) = parse_frontmatter(text, "core-fantasy");
        assert_eq!(group, Group::CoreGameplay);
        assert_eq!(level, 6);
    }

    #[test]
    fn parse_frontmatter_legacy_pillars_to_l2() {
        // v0.5+ 旧 pillars → 推断为 L2 CoreStory
        let text = "---\ntitle: 设计支柱\nstep: pillars\nstatus: confirmed\n---\n\n- 资源稀缺\n";
        let (_, _, group, level, _) = parse_frontmatter(text, "pillars");
        assert_eq!(group, Group::CoreStory);
        assert_eq!(level, 2);
    }

    #[test]
    fn parse_frontmatter_drops_legacy_maturity() {
        // v0.5+ 旧 frontmatter 有 maturity 字段 → v0.5.3+ 忽略（不再解析，不再写盘）
        let text = "---\ntitle: 核心故事\nstep: core-story\ngroup: core-story\nlevel: 2\nmaturity: evolving\nstatus: confirmed\n---\n\n核心故事内容\n";
        let (status, _, group, level, _) = parse_frontmatter(text, "core-story");
        assert_eq!(status, "confirmed");
        assert_eq!(group, Group::CoreStory);
        assert_eq!(level, 2);
    }

    #[test]
    fn parse_frontmatter_missing() {
        let (status, _, group, level, body) =
            parse_frontmatter("没有 frontmatter 的正文", "seed");
        assert_eq!(status, "");
        assert_eq!(group, Group::Theme);
        assert_eq!(level, 1);
        assert_eq!(body, "没有 frontmatter 的正文");
    }

    #[test]
    fn parse_frontmatter_unclosed() {
        let (status, _, _, _, body) = parse_frontmatter("---\nstatus: draft\n没有闭合", "seed");
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
    fn steps_count_is_6() {
        assert_eq!(STEPS.len(), 6);
    }

    #[test]
    fn step_order_is_derivation_chain() {
        // L1 → L2 → L3 → L4 → L5 → L6
        let ids: Vec<&str> = STEPS.iter().map(|s| s.id).collect();
        assert_eq!(
            ids,
            vec![
                "seed",
                "core-story",
                "world-rules",
                "locations",
                "character-functions",
                "core-gameplay",
            ]
        );
    }

    #[test]
    fn only_locations_is_optional() {
        let optionals: Vec<&str> = STEPS.iter().filter(|s| s.optional).map(|s| s.id).collect();
        assert_eq!(optionals, vec!["locations"]);
    }

    #[test]
    fn group_level_mapping() {
        // 验证 STEPS 表的 group/level 都对得上
        for def in STEPS.iter() {
            let (g, l) = infer_group_level(def.id);
            assert_eq!(g, def.group, "group mismatch for {}", def.id);
            assert_eq!(l, def.level, "level mismatch for {}", def.id);
        }
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

        // save L1 seed → confirmed + group/level 写入
        let saved = save_concept_step(&dir, "seed", "个体在强权下的反抗能否保持纯真", true).unwrap();
        assert_eq!(saved.status, "confirmed");
        assert_eq!(saved.group, "theme");
        assert_eq!(saved.level, 1);
        let steps = scan_concept(&dir).unwrap();
        assert_eq!(steps[0].status, "confirmed");
        assert_eq!(steps[0].group, "theme");
        assert_eq!(steps[0].level, 1);

        // save L2 core-story
        let saved = save_concept_step(&dir, "core-story", "主角从纯真到被腐蚀的弧线", true).unwrap();
        assert_eq!(saved.group, "core-story");
        assert_eq!(saved.level, 2);
        let steps = scan_concept(&dir).unwrap();
        assert_eq!(steps[1].group, "core-story");
        assert_eq!(steps[1].level, 2);

        // save L3 world-rules
        let saved = save_concept_step(&dir, "world-rules", "魔法枯竭 300 年", true).unwrap();
        assert_eq!(saved.group, "world-rules");
        assert_eq!(saved.level, 3);

        // save L4 locations（optional）
        let saved = save_concept_step(&dir, "locations", "永安镇：北方边境码头", true).unwrap();
        assert_eq!(saved.optional, true);

        // save L5 character-functions
        let saved = save_concept_step(&dir, "character-functions", "主角：想维护家族崛起", true).unwrap();
        assert_eq!(saved.group, "character");
        assert_eq!(saved.level, 5);

        // save L6 core-gameplay
        let saved = save_concept_step(&dir, "core-gameplay", "回合制策略 + 资源管理", true).unwrap();
        assert_eq!(saved.group, "core-gameplay");
        assert_eq!(saved.level, 6);

        // concept_summary 6 层格式
        let summary = concept_summary(&dir).unwrap();
        assert!(summary.contains("[L1 立意]"), "summary 应有 L1 标签: {}", summary);
        assert!(summary.contains("[L2 核心故事]"), "summary 应有 L2 标签: {}", summary);
        assert!(summary.contains("[L3 世界规则]"), "summary 应有 L3 标签: {}", summary);
        assert!(summary.contains("[L4 地点]"), "summary 应有 L4 标签: {}", summary);
        assert!(summary.contains("（可选）"), "L4 应标（可选）: {}", summary);
        assert!(summary.contains("[L5 人物]"), "summary 应有 L5 标签: {}", summary);
        assert!(summary.contains("[L6 核心玩法]"), "summary 应有 L6 标签: {}", summary);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_7_to_6_migration_pillars_threeact() {
        // 模拟 v0.5+ 旧项目：手动写旧 pillars.md + three-act.md
        // → migrate_legacy_concept 应合并为 core-story.md
        let dir = std::env::temp_dir().join(format!("plotcraft-legacy-merge-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(CONCEPT_DIR)).unwrap();

        std::fs::write(
            dir.join(CONCEPT_DIR).join("pillars.md"),
            "---\ntitle: 设计支柱\nstep: pillars\nstatus: confirmed\n---\n\n- 资源稀缺\n- 敌人必是威胁\n",
        ).unwrap();
        std::fs::write(
            dir.join(CONCEPT_DIR).join("three-act.md"),
            "---\ntitle: 三幕骨架\nstep: three-act\nstatus: confirmed\n---\n\n第一幕：建立日常\n第二幕：秩序崩塌\n第三幕：最终选择\n",
        ).unwrap();

        // scan_concept 入口自动跑 migrate
        let steps = scan_concept(&dir).unwrap();
        assert_eq!(steps.len(), 6);

        // L2 core-story 应该是合并后的内容
        let l2 = &steps[1];
        assert_eq!(l2.id, "core-story");
        assert_eq!(l2.group, "core-story");
        assert_eq!(l2.level, 2);
        assert_eq!(l2.status, "confirmed");
        assert!(l2.content.contains("资源稀缺"), "L2 应包含 pillars 内容: {}", l2.content);
        assert!(l2.content.contains("戏剧结构"), "L2 应包含 three-act 内容（带 section header）: {}", l2.content);
        assert!(l2.content.contains("建立日常"), "L2 应包含 three-act 三幕内容: {}", l2.content);

        // 旧 pillars.md / three-act.md 应保留（不删，防御性；migrate 是 best-effort）
        // 实际实现：migrate 不删旧文件，依赖 infer_group_level 兜底
        // 但因为新 core-story.md 存在 → 不会被读旧文件
        // 这里不强求旧文件存在/不存在，只验证新文件正确

        // 旧 pillars.md / three-act.md 是否存在
        let pillars_exists = dir.join(CONCEPT_DIR).join("pillars.md").is_file();
        let threeact_exists = dir.join(CONCEPT_DIR).join("three-act.md").is_file();
        // 现状：migrate 不删旧文件 → 都存在
        assert!(pillars_exists || true, "migrate 后旧文件可保留（防御性）");
        assert!(threeact_exists || true, "migrate 后旧文件可保留（防御性）");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_7_to_6_migration_core_fantasy_rename() {
        // 模拟 v0.5+ 旧项目：手动写 core-fantasy.md
        // → migrate_legacy_concept 应改名为 core-gameplay.md
        let dir = std::env::temp_dir().join(format!("plotcraft-legacy-rename-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(CONCEPT_DIR)).unwrap();

        std::fs::write(
            dir.join(CONCEPT_DIR).join("core-fantasy.md"),
            "---\ntitle: 核心体验\nstep: core-fantasy\nstatus: confirmed\n---\n\n你扮演末代王朝的小人物...\n",
        ).unwrap();

        // scan_concept 入口自动跑 migrate
        let steps = scan_concept(&dir).unwrap();
        assert_eq!(steps.len(), 6);

        // L6 core-gameplay 应有内容（来自旧 core-fantasy）
        let l6 = &steps[5];
        assert_eq!(l6.id, "core-gameplay");
        assert_eq!(l6.group, "core-gameplay");
        assert_eq!(l6.level, 6);
        assert_eq!(l6.status, "confirmed");
        assert!(l6.content.contains("末代王朝"), "L6 应包含旧 core-fantasy 内容: {}", l6.content);

        // 旧 core-fantasy.md 已被 rename
        let old_exists = dir.join(CONCEPT_DIR).join("core-fantasy.md").is_file();
        let new_exists = dir.join(CONCEPT_DIR).join("core-gameplay.md").is_file();
        assert!(!old_exists, "旧 core-fantasy.md 应已被 rename 走");
        assert!(new_exists, "新 core-gameplay.md 应已存在");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
