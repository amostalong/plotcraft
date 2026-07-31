//! concept/ 概念设计 —— 7 层严格派生模型 + 螺旋设计循环（v0.5+）
//!
//! 数据约定：
//! ```text
//! <project>/concept/
//!   seed.md                 # L1 立意（1 句核心矛盾 / 主题）
//!   pillars.md              # L2 抽象规则（3-5 条硬约束，演进型）
//!   world-rules.md          # L3 世界（宏观设定）
//!   locations.md            # L4 地点（可选，密室/单场景剧可跳过）
//!   character-functions.md  # L5 人物（角色功能，派生 L3+L4）
//!   three-act.md            # L6 故事（派生 L1-L5）
//!   core-fantasy.md         # L7 核心体验（整合 L1-L6）
//! ```
//!
//! 7 层派生关系：
//! ```text
//! L1 立意（seed）             → 故事的根，1 句哲学
//!   ↓ 派生
//! L2 抽象规则（pillars）      → 设计的硬约束，独立演进
//!   ↓ 派生
//! L3 世界（world-rules）      → 宏观设定
//!   ↓ 派生
//! L4 地点（locations, 可选）  → 具体空间
//!   ↓ 派生
//! L5 人物（character-functions）→ 角色功能
//!   ↓ 派生
//! L6 故事（three-act）        → 时间轴上的展开
//!   ↓ 整合
//! L7 核心体验（core-fantasy） → 玩家视角的 1 句话总结
//! ```
//!
//! 设计哲学根（用户 2026-07-30 ~ 07-31 沉淀）：
//! - 立意第一性：L1 是哲学根，1 句话核心矛盾
//! - 抽象规则独立演进：L2 pillars 很难一次写完，要随设计过程反复精化
//! - 派生链：L3 → L4 → L5 → L6，每一层都是上一层的具象
//! - 整合层：L7 最抽象 + 最后写
//! - 螺旋设计循环：改任何层都触发全链路反思提示（手动校准，不自动改）
//!
//! 每个文件 frontmatter（手写拼接 / 手写解析，不引 serde_yaml）：
//! ```yaml
//! ---
//! title: 立意
//! step: seed
//! group: theme        # 旧 frontmatter 没这字段 → 走 infer_group_level 推断
//! level: 1
//! status: confirmed   # empty | confirmed
//! updated: 2026-07-31T...
//! ---
//! ```
//!
//! L2 pillars 额外字段：
//! ```yaml
//! ---
//! maturity: draft    # empty | draft | evolving | finalized（4 态）
//! ---
//! ```
//!
//! - 懒创建：create_project 不动；scan 缺文件返回 status "empty" + 空内容，
//!   save 时自动建目录和文件 → 旧项目零迁移兼容
//! - 旧项目兼容：旧 frontmatter 无 group/level/maturity 字段 → infer_group_level 按 step_id 推断
//!   - 旧 core-fantasy 归 L7（Group::CoreFantasy, level 7）
//!   - 旧 seed / pillars / world-rules / character-functions / three-act 按 id 推断
//!   - 旧项目无 locations.md → scan 返 empty
//! - 不做文件监听 —— 玩家手改后点"刷新"重扫（对齐 art 模块惯例）

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// concept 根目录名（项目根下）
pub const CONCEPT_DIR: &str = "concept";
/// 摘要里单步内容截断长度（字符数）
const SUMMARY_CONTENT_MAX_CHARS: usize = 500;

/// 步骤分组（v0.5+ 加 group 字段，跨层逻辑归类）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Group {
    Theme,        // L1 立意
    Principles,   // L2 抽象规则
    World,        // L3 世界
    Locations,    // L4 地点
    Character,    // L5 人物
    Story,        // L6 故事
    CoreFantasy,  // L7 核心体验
    #[serde(other)]
    Other,
}

impl Group {
    /// group 字符串（frontmatter 写盘用 / 旧项目解析用）→ Group
    pub fn from_str(s: &str) -> Self {
        match s {
            "theme" => Self::Theme,
            "principles" => Self::Principles,
            "world" => Self::World,
            "locations" => Self::Locations,
            "character" => Self::Character,
            "story" => Self::Story,
            "core-fantasy" => Self::CoreFantasy,
            _ => Self::Other,
        }
    }
    /// Group → group 字符串（写盘）
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Theme => "theme",
            Self::Principles => "principles",
            Self::World => "world",
            Self::Locations => "locations",
            Self::Character => "character",
            Self::Story => "story",
            Self::CoreFantasy => "core-fantasy",
            Self::Other => "other",
        }
    }
}

/// 步骤层级（1-7）
pub type Level = u8;

/// pillars 成熟度（v0.5+ 4 态）
///
/// - Empty：还没写
/// - Draft：玩家初稿（v1）
/// - Evolving：演进中（v2+）—— LLM 跑"反向检验"用 L3-L6 现状反推
/// - Finalized：定型 —— 当硬约束用，注入 LLM 用作 veto
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Maturity {
    #[serde(alias = "")]
    Empty,
    Draft,
    Evolving,
    Finalized,
}

impl Maturity {
    pub fn from_str(s: &str) -> Self {
        match s {
            "empty" => Self::Empty,
            "draft" => Self::Draft,
            "evolving" => Self::Evolving,
            "finalized" => Self::Finalized,
            _ => Self::Empty,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::Draft => "draft",
            Self::Evolving => "evolving",
            Self::Finalized => "finalized",
        }
    }
}

/// 步骤静态定义（7 步固定，不开放自由步骤）
pub struct StepDef {
    pub id: &'static str,
    pub title: &'static str,
    pub filename: &'static str,
    pub group: Group,
    pub level: Level,
    /// 可选 step（L4 地点）
    pub optional: bool,
    /// 该步的写作引导语（前端镜像此文案拼 LLM prompt 的说明部分；
    /// 后端暂不外发 —— ConceptStep 字段表按计划固定为 7 步）
    #[allow(dead_code)]
    pub hint: &'static str,
}

/// 概念设计 7 层定义表（顺序 = stepper 显示顺序，按派生链）
pub const STEPS: [StepDef; 7] = [
    StepDef {
        id: "seed",
        title: "立意",
        filename: "seed.md",
        group: Group::Theme,
        level: 1,
        optional: false,
        hint: "立意是故事的根，1 句话核心矛盾 / 主题。格式：「主角在 X 处境下，想要 Y，但 Z 不可越」。例：「个体在强权秩序下的反抗能否保持纯真」。立意很难一次写准——可以反复改，下游会跟着你校准。",
    },
    StepDef {
        id: "pillars",
        title: "抽象规则",
        filename: "pillars.md",
        group: Group::Principles,
        level: 2,
        optional: false,
        hint: "3-5 条硬约束 / 否决性原则。每条都是「任何方案违反 X 就打回」。这些规则不会一次写完——会在写世界/人物/故事过程中反复回来修改。成熟度：empty / 草稿 v1 / 演进 v2+ / 定型。",
    },
    StepDef {
        id: "world-rules",
        title: "世界",
        filename: "world-rules.md",
        group: Group::World,
        level: 3,
        optional: false,
        hint: "宏观设定——时代 / 物理 / 魔法 / 政治 / 经济。每条 = 是什么 + 造成什么冲突。注意：硬约束（「不能违反」）属于 L2 抽象规则——这里只写普通规则。",
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
        hint: "角色功能——每个人 = 想要什么 + 为什么得不到。人物欲望应追溯到 L3 世界 + L4 地点——不是凭空生成。人物被世界的波浪推到某个位置，他们想要的是对世界压力的回应。",
    },
    StepDef {
        id: "three-act",
        title: "故事",
        filename: "three-act.md",
        group: Group::Story,
        level: 6,
        optional: false,
        hint: "冲突加压序列——每一幕压力比上一幕大，直到终幕爆发。派生 L1-L5——每幕转折点都应服务 L1 立意 + 满足 L2 pillars + 反映 L3 世界 + L4 地点 + L5 人物。",
    },
    StepDef {
        id: "core-fantasy",
        title: "核心体验",
        filename: "core-fantasy.md",
        group: Group::CoreFantasy,
        level: 7,
        optional: false,
        hint: "玩家视角的 1 句话体验——「你扮演 X，在 Y 处境，做 Z」。所有层设计完才能精准定——可以先写粗版（方向感），其他层定下来再回来精化。",
    },
];

/// 跨 boundary 类型（snake_case，前端 `src/types/concept.ts` 镜像）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConceptStep {
    /// 步骤 id（seed / pillars / world-rules / locations / character-functions / three-act / core-fantasy）
    pub id: String,
    /// 步骤中文标题
    pub title: String,
    /// concept/ 下的文件名
    pub filename: String,
    /// group（theme / principles / world / locations / character / story / core-fantasy）
    pub group: String,
    /// level（1-7，派生链位置）
    pub level: Level,
    /// empty | confirmed（v0.3+ 简化）
    pub status: String,
    /// frontmatter 之后的正文
    pub content: String,
    /// frontmatter 的 updated（RFC3339；empty 步骤为空串）
    pub updated: String,
    /// maturity（仅 L2 pillars 用：empty / draft / evolving / finalized；其他步骤为空串）
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub maturity: String,
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
/// 旧 6 步漏斗 → 7 层模型迁移用：
///   - 旧 core-fantasy（v0.3 漏斗第 2 步）→ L7 核心体验
///   - 旧 seed / pillars / world-rules / character-functions / three-act → L1/L2/L3/L5/L6
///   - locations（L4）旧项目不存在 → scan 返 empty
fn infer_group_level(step_id: &str) -> (Group, Level) {
    match step_id {
        "seed" => (Group::Theme, 1),
        "pillars" => (Group::Principles, 2),
        "world-rules" => (Group::World, 3),
        // L4 locations 是 v0.5+ 新加的，旧项目不会有这个文件 → scan 走"缺文件"分支
        // 即便玩家手写也按 (Locations, 4) 走
        "locations" => (Group::Locations, 4),
        "character-functions" => (Group::Character, 5),
        "three-act" => (Group::Story, 6),
        // ★ 关键：旧 core-fantasy 归 L7（不是 L2 也不是空）
        "core-fantasy" => (Group::CoreFantasy, 7),
        _ => (Group::Other, 0),
    }
}

/// 手写 frontmatter 解析：抠 status / updated / group / level / maturity 5 个字段
///
/// 返回 (status, updated, group, level, maturity, body)。
/// 没有 frontmatter → status/updated/group/level/maturity 走推断/默认，body = 全文。
fn parse_frontmatter(text: &str, step_id: &str) -> (String, String, Group, Level, Maturity, String) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let (def_group, def_level) = infer_group_level(step_id);
    if !text.starts_with("---") {
        return (
            String::new(),
            String::new(),
            def_group,
            def_level,
            Maturity::Empty,
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
                Maturity::Empty,
                text.to_string(),
            )
        }
    };
    let mut status = String::new();
    let mut updated = String::new();
    let mut group_str: Option<String> = None;
    let mut level: Option<Level> = None;
    let mut maturity_str: Option<String> = None;
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
                "maturity" => maturity_str = Some(value.to_string()),
                _ => {}
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
    let m = match maturity_str {
        Some(s) => Maturity::from_str(&s),
        None => Maturity::Empty,
    };
    match body_start {
        Some(i) => (status, updated, g, l, m, after_open[i..].to_string()),
        // 没有闭合 `---` → 整个当正文，不写回（玩家手改坏的情况容错）
        None => (
            String::new(),
            String::new(),
            def_group,
            def_level,
            Maturity::Empty,
            text.to_string(),
        ),
    }
}

/// 手写 frontmatter 拼接（title / step / group / level / status / updated / maturity 字段）
fn build_frontmatter(
    def: &StepDef,
    status: &str,
    updated: &str,
    maturity: Option<Maturity>,
) -> String {
    let mut s = format!(
        "---\ntitle: {}\nstep: {}\ngroup: {}\nlevel: {}\nstatus: {}\nupdated: {}\n",
        def.title,
        def.id,
        def.group.as_str(),
        def.level,
        status,
        updated
    );
    // maturity 仅 L2 pillars 写（其他步骤不写）
    if let Some(m) = maturity {
        s.push_str(&format!("maturity: {}\n", m.as_str()));
    }
    s.push_str("---\n\n");
    s
}

/// 扫描 `<project>/concept/` 7 步文件（同步 fs —— 调用方走 spawn_blocking）
/// 缺文件 → status "empty" + 空内容；有文件但 frontmatter 缺 status → "confirmed"
/// 旧项目兼容：缺 group/level 字段 → 走 infer_group_level
pub fn scan_concept(project_root: &Path) -> AppResult<Vec<ConceptStep>> {
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
                maturity: String::new(),
                optional: def.optional,
            });
            continue;
        }

        let text = std::fs::read_to_string(&path)
            .map_err(|e| AppError::Config(format!("read {}: {}", path.display(), e)))?;
        let (mut status, updated, group, level, maturity, body) = parse_frontmatter(&text, def.id);
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
            maturity: maturity.as_str().to_string(),
            optional: def.optional,
        });
    }

    Ok(steps)
}

/// 保存一步（atomic write：tmp → rename，对齐 commands/art.rs:save_art_prompt 写法）
/// - 懒建 `concept/` 目录
/// - mark_confirmed=true → status "confirmed"，否则 "draft"
/// - maturity：仅 L2 pillars 写（其他步骤传 None）
/// - 返回写入后的 ConceptStep（updated 用写入时的 UTC 时间）
#[allow(clippy::too_many_arguments)]
pub fn save_concept_step(
    project_root: &Path,
    step_id: &str,
    content: &str,
    mark_confirmed: bool,
    maturity: Option<&str>,
) -> AppResult<ConceptStep> {
    let def = step_def(step_id)?;
    let status = if mark_confirmed { "confirmed" } else { "draft" };
    let updated = chrono::Utc::now().to_rfc3339();
    // maturity 仅 L2 pillars 接受；其他 step 强制 None（不写盘）
    let maturity_enum: Option<Maturity> = if def.id == "pillars" {
        Some(match maturity {
            Some(s) => Maturity::from_str(s),
            None => Maturity::Draft,
        })
    } else {
        None
    };

    let dir = project_root.join(CONCEPT_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Config(format!("create dir {}: {}", dir.display(), e)))?;

    let path = step_path(project_root, def);
    let full = format!(
        "{}{}",
        build_frontmatter(def, status, &updated, maturity_enum),
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
        maturity: maturity_enum.map(|m| m.as_str().to_string()).unwrap_or_default(),
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

/// 7 层分组标签（concept_summary 注入 LLM 用）
fn group_label(def: &StepDef, maturity_str: &str) -> String {
    let base = format!("[L{} {}]", def.level, group_zh(&def.group));
    if def.id == "pillars" && !maturity_str.is_empty() && maturity_str != "empty" {
        format!("{}（成熟度：{}）", base, maturity_zh(maturity_str))
    } else if def.optional {
        format!("{}（可选）", base)
    } else {
        base
    }
}

fn group_zh(g: &Group) -> &'static str {
    match g {
        Group::Theme => "立意",
        Group::Principles => "抽象规则",
        Group::World => "世界",
        Group::Locations => "地点",
        Group::Character => "人物",
        Group::Story => "故事",
        Group::CoreFantasy => "核心体验",
        Group::Other => "其他",
    }
}

fn maturity_zh(s: &str) -> String {
    match s {
        "draft" => "草稿 v1".to_string(),
        "evolving" => "演进 v2+".to_string(),
        "finalized" => "定型".to_string(),
        _ => s.to_string(),
    }
}

/// 拼接 status != empty 的步骤给 chat 注入用（同步 fs —— 调用方走 spawn_blocking）
///
/// 格式：7 层分组标签 + 标题 + 内容（截断 500 字），按派生链顺序输出：
/// ```text
/// # [L1 立意] 故事的根 —— 核心矛盾 / 主题
/// ## 种子
/// <内容>
///
/// # [L2 抽象规则] 设计的硬约束（成熟度：演进 v2+）
/// ## 抽象规则
/// <内容>
/// ...
/// # [L7 核心体验] 整合所有层
/// ## 核心体验
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
        let label = group_label(def, &step.maturity);
        let hint_tail = match def.id {
            "seed" => " —— 核心矛盾 / 主题",
            "pillars" => " —— 设计的硬约束",
            "world-rules" => " —— 宏观设定",
            "locations" => " —— 具体空间",
            "character-functions" => " —— 角色功能（被世界+地点推到位置）",
            "three-act" => " —— 时间轴上的展开",
            "core-fantasy" => " —— 整合所有层",
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
        let text = "---\ntitle: 种子\nstep: seed\ngroup: theme\nlevel: 1\nstatus: confirmed\nupdated: 2026-07-29T01:02:03+00:00\n---\n\n正文内容\n";
        let (status, updated, group, level, maturity, body) = parse_frontmatter(text, "seed");
        assert_eq!(status, "confirmed");
        assert_eq!(updated, "2026-07-29T01:02:03+00:00");
        assert_eq!(group, Group::Theme);
        assert_eq!(level, 1);
        assert_eq!(maturity, Maturity::Empty);
        assert_eq!(body, "\n正文内容\n");
    }

    #[test]
    fn parse_frontmatter_legacy_no_group() {
        // v0.3 旧 frontmatter 没 group/level 字段 → 走 infer_group_level
        let text = "---\ntitle: 种子\nstep: seed\nstatus: confirmed\nupdated: 2026-07-29T01:02:03+00:00\n---\n\n正文\n";
        let (status, _, group, level, _, _) = parse_frontmatter(text, "seed");
        assert_eq!(status, "confirmed");
        assert_eq!(group, Group::Theme);
        assert_eq!(level, 1);
    }

    #[test]
    fn parse_frontmatter_legacy_core_fantasy_to_l7() {
        // ★ 关键：旧 core-fantasy（v0.3 漏斗第 2 步）→ L7 核心体验
        let text = "---\ntitle: 核心体验\nstep: core-fantasy\nstatus: confirmed\n---\n\n玩家是...\n";
        let (_, _, group, level, _, _) = parse_frontmatter(text, "core-fantasy");
        assert_eq!(group, Group::CoreFantasy);
        assert_eq!(level, 7);
    }

    #[test]
    fn parse_frontmatter_pillars_maturity() {
        let text = "---\ntitle: 抽象规则\nstep: pillars\ngroup: principles\nlevel: 2\nmaturity: evolving\nstatus: confirmed\n---\n\n- 资源稀缺\n";
        let (_, _, group, level, maturity, _) = parse_frontmatter(text, "pillars");
        assert_eq!(group, Group::Principles);
        assert_eq!(level, 2);
        assert_eq!(maturity, Maturity::Evolving);
    }

    #[test]
    fn parse_frontmatter_missing() {
        let (status, _, group, level, maturity, body) =
            parse_frontmatter("没有 frontmatter 的正文", "seed");
        assert_eq!(status, "");
        assert_eq!(group, Group::Theme);
        assert_eq!(level, 1);
        assert_eq!(maturity, Maturity::Empty);
        assert_eq!(body, "没有 frontmatter 的正文");
    }

    #[test]
    fn parse_frontmatter_unclosed() {
        let (status, _, _, _, _, body) = parse_frontmatter("---\nstatus: draft\n没有闭合", "seed");
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
    fn steps_count_is_7() {
        assert_eq!(STEPS.len(), 7);
    }

    #[test]
    fn step_order_is_derivation_chain() {
        // L1 → L2 → L3 → L4 → L5 → L6 → L7
        let ids: Vec<&str> = STEPS.iter().map(|s| s.id).collect();
        assert_eq!(
            ids,
            vec![
                "seed",
                "pillars",
                "world-rules",
                "locations",
                "character-functions",
                "three-act",
                "core-fantasy"
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

        // 空项目 → 7 个 empty
        let steps = scan_concept(&dir).unwrap();
        assert_eq!(steps.len(), 7);
        assert!(steps.iter().all(|s| s.status == "empty"));
        assert!(steps.iter().all(|s| s.maturity.is_empty() || s.maturity == "empty"));
        assert_eq!(concept_summary(&dir).unwrap(), "");

        // save L1 seed → confirmed + group/level 写入
        let saved = save_concept_step(&dir, "seed", "个体在强权下的反抗能否保持纯真", true, None).unwrap();
        assert_eq!(saved.status, "confirmed");
        assert_eq!(saved.group, "theme");
        assert_eq!(saved.level, 1);
        let steps = scan_concept(&dir).unwrap();
        assert_eq!(steps[0].status, "confirmed");
        assert_eq!(steps[0].group, "theme");
        assert_eq!(steps[0].level, 1);

        // save L2 pillars + maturity
        let saved = save_concept_step(&dir, "pillars", "- 资源稀缺\n- 敌人必是威胁", true, Some("evolving")).unwrap();
        assert_eq!(saved.maturity, "evolving");
        let steps = scan_concept(&dir).unwrap();
        assert_eq!(steps[1].maturity, "evolving");

        // save L3 world-rules
        let saved = save_concept_step(&dir, "world-rules", "魔法枯竭 300 年", true, None).unwrap();
        assert_eq!(saved.group, "world");
        assert_eq!(saved.level, 3);

        // save L4 locations（optional）→ 不带 maturity
        let saved = save_concept_step(&dir, "locations", "永安镇：北方边境码头", true, None).unwrap();
        assert_eq!(saved.optional, true);

        // concept_summary 7 层格式
        let summary = concept_summary(&dir).unwrap();
        assert!(summary.contains("[L1 立意]"), "summary 应有 L1 标签: {}", summary);
        assert!(summary.contains("[L2 抽象规则]"), "summary 应有 L2 标签: {}", summary);
        assert!(summary.contains("[L3 世界]"), "summary 应有 L3 标签: {}", summary);
        assert!(summary.contains("[L4 地点]"), "summary 应有 L4 标签: {}", summary);
        assert!(summary.contains("（可选）"), "L4 应标（可选）: {}", summary);
        assert!(summary.contains("（成熟度：演进 v2+）"), "L2 应标成熟度: {}", summary);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_project_6_to_7_compat() {
        // 模拟 v0.3 旧项目：手动写 6 个旧 frontmatter（无 group/level/maturity 字段）
        let dir = std::env::temp_dir().join(format!("plotcraft-legacy-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(CONCEPT_DIR)).unwrap();

        // 旧 seed.md（无 group/level）
        std::fs::write(
            dir.join(CONCEPT_DIR).join("seed.md"),
            "---\ntitle: 种子\nstep: seed\nstatus: confirmed\nupdated: 2026-07-01T00:00:00+00:00\n---\n\n旧 seed 内容\n",
        ).unwrap();
        // 旧 core-fantasy.md（无 group/level）→ ★ 应被识别为 L7
        std::fs::write(
            dir.join(CONCEPT_DIR).join("core-fantasy.md"),
            "---\ntitle: 核心体验\nstep: core-fantasy\nstatus: confirmed\n---\n\n旧 core-fantasy 内容\n",
        ).unwrap();
        // 旧 pillars.md / world-rules.md / character-functions.md / three-act.md 都不写 group/level
        for (step_id, title) in &[
            ("pillars", "设计支柱"),
            ("world-rules", "世界规则"),
            ("character-functions", "人物功能"),
            ("three-act", "三幕骨架"),
        ] {
            std::fs::write(
                dir.join(CONCEPT_DIR).join(format!("{}.md", step_id)),
                format!("---\ntitle: {}\nstep: {}\nstatus: confirmed\n---\n\n内容\n", title, step_id),
            ).unwrap();
        }

        let steps = scan_concept(&dir).unwrap();
        assert_eq!(steps.len(), 7);

        // 旧 seed → L1 Theme
        assert_eq!(steps[0].id, "seed");
        assert_eq!(steps[0].group, "theme");
        assert_eq!(steps[0].level, 1);

        // 旧 pillars → L2 Principles
        assert_eq!(steps[1].id, "pillars");
        assert_eq!(steps[1].group, "principles");
        assert_eq!(steps[1].level, 2);

        // 旧 world-rules → L3 World
        assert_eq!(steps[2].id, "world-rules");
        assert_eq!(steps[2].group, "world");
        assert_eq!(steps[2].level, 3);

        // 旧项目无 locations.md → empty
        assert_eq!(steps[3].id, "locations");
        assert_eq!(steps[3].status, "empty");
        assert_eq!(steps[3].group, "locations");
        assert_eq!(steps[3].level, 4);

        // 旧 character-functions → L5 Character
        assert_eq!(steps[4].id, "character-functions");
        assert_eq!(steps[4].group, "character");
        assert_eq!(steps[4].level, 5);

        // 旧 three-act → L6 Story
        assert_eq!(steps[5].id, "three-act");
        assert_eq!(steps[5].group, "story");
        assert_eq!(steps[5].level, 6);

        // ★ 旧 core-fantasy → L7 CoreFantasy（关键兼容）
        assert_eq!(steps[6].id, "core-fantasy");
        assert_eq!(steps[6].group, "core-fantasy");
        assert_eq!(steps[6].level, 7);

        // summary 应有 L1-L7 标签
        let summary = concept_summary(&dir).unwrap();
        assert!(summary.contains("[L1 立意]"));
        assert!(summary.contains("[L2 抽象规则]"));
        assert!(summary.contains("[L3 世界]"));
        // L4 empty → 跳过
        assert!(!summary.contains("[L4 地点]"));
        assert!(summary.contains("[L5 人物]"));
        assert!(summary.contains("[L6 故事]"));
        assert!(summary.contains("[L7 核心体验]"));
        assert!(summary.contains("旧 core-fantasy 内容"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
