//! 4 个 starter md 模板（v0.1 最小子集，CHAT_LLM_DESIGN §5.2）
//!
//! 项目文件夹结构：
//! ```text
//! <project>/
//! ├── plot.cat             # PlotCraft 项目标记（v0.2+ 显式识别，ProjectConfig JSON）
//! ├── README.md
//! ├── world/overview.md
//! ├── characters/protagonist.md
//! └── plot/main-arc.md
//! ```
//!
//! v0.1 简化：
//! - frontmatter created_at / updated_at 用 TODO 占位（玩家手填）
//! - 不依赖 chrono（DESIGN §v0.1 故意不加）
//! - 不做 frontmatter 校验（v0.1 chat 解析失败容错就行）

use serde::{Deserialize, Serialize};

/// v0.2+ PlotCraft 项目标记文件名（项目根下）
/// 存在 = 是 PlotCraft 项目；内容是 ProjectConfig JSON（schema / created_at / created_by）
pub const PLOT_CAT_FILE: &str = "plot.cat";

/// v0.2+ PlotCraft 项目配置 —— 写在 `plot.cat` 里
/// - `schema` 当前固定 1；v0.3+ 改格式时 v2 走新 schema
/// - `created_at` ISO 8601（chrono::Utc::to_rfc3339()）
/// - `created_by` 创建版本标识（"plotcraft-v0.2" 等）
/// 之后想加什么（default_model / last_active_session / 等）也加这里
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfig {
    pub schema: u32,
    pub created_at: String,
    pub created_by: String,
}

/// v0.2+ plot.cat 内容生成 —— 写盘时调这个
/// - 格式化（pretty JSON，玩家手编辑友好）
/// - 字段顺序固定（schema / created_at / created_by）
pub fn plot_cat_content() -> String {
    let cfg = ProjectConfig {
        schema: 1,
        created_at: chrono::Utc::now().to_rfc3339(),
        created_by: format!("plotcraft-{}", env!("CARGO_PKG_VERSION")),
    };
    serde_json::to_string_pretty(&cfg)
        .unwrap_or_else(|_| r#"{"schema":1}"#.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMeta {
    pub name: String,
    pub folder: String,
    pub created_at: String,
    pub updated_at: String,
    /// v0.2+ PlotCraft 项目标识：项目根有 `plot.cat` 文件
    /// 之前版本：`README.md` 判定（git clone 别人的项目误认）→ `world/` 判定（仍会被手建 RPG 目录误认）→ `plot.cat`（显式）
    /// 前端 OpenProjectModal 用这个给玩家视觉提示（"看起来是 PlotCraft 项目"标签）
    /// + 排序时 PlotCraft 项目排前面。
    #[serde(default)]
    pub is_plotcraft_project: bool,
}

const README_TEMPLATE: &str = r#"---
title: {title}
type: rpg  # rpg | vn | hybrid
genre: []  # 奇幻 / 科幻 / 现代 / 架空历史 / 都市奇幻 / 其他
era: []    # 远古 / 中世纪 / 近现代 / 未来 / 后启示录
tone: []   # 黑暗 / 轻松 / 史诗 / 阴谋 / 治愈 / 黑色幽默
created_at: TODO
updated_at: TODO
---

# {title}

> 你的项目从这里开始。打开 chat tab 跟 AI 聊你的设定，AI 会给 3-5 个备选让你挑。
"#;

const WORLD_OVERVIEW_TEMPLATE: &str = r#"---
title: 世界观速览
tags: [world, overview]
status: draft
updated: TODO
---

一句话世界观（≤ 200 字）：

> TODO: 在这里写你的世界观速览 —— genre / era / tone / 一句话核心设定
"#;

const PROTAGONIST_TEMPLATE: &str = r#"---
title: 主角
tags: [character, protagonist]
status: draft
updated: TODO
---

一句话主角：

- 背景：
- 性格：
- 动机：
- 核心冲突：
"#;

const PLOT_MAIN_ARC_TEMPLATE: &str = r#"---
title: 主线三幕
tags: [plot, main-arc]
status: draft
updated: TODO
---

三幕骨架：

- 起（Setup）：开局，介绍世界 + 主角 + 触发事件
- 承（Confrontation）：冲突升级，主角主动/被动应对
- 转（Climax）：高潮对决，核心矛盾摊牌
- 合（Resolution）：收束，新世界状态
"#;

/// starter 文件 (相对路径, 内容)
/// v0.2+：4 个 starter md + 1 个 plot.cat 标记（带 schema / created_at / created_by）
pub fn starter_files(title: &str) -> Vec<(&'static str, String)> {
    vec![
        (PLOT_CAT_FILE, plot_cat_content()),
        ("README.md", README_TEMPLATE.replace("{title}", title)),
        ("world/overview.md", WORLD_OVERVIEW_TEMPLATE.to_string()),
        ("characters/protagonist.md", PROTAGONIST_TEMPLATE.to_string()),
        ("plot/main-arc.md", PLOT_MAIN_ARC_TEMPLATE.to_string()),
    ]
}
