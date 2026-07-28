//! 4 个 starter md 模板（v0.1 最小子集，CHAT_LLM_DESIGN §5.2）
//!
//! 项目文件夹结构：
//! ```text
//! <project>/
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMeta {
    pub name: String,
    pub folder: String,
    pub created_at: String,
    pub updated_at: String,
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

/// 4 个 starter md 文件 (相对路径, 内容)
pub fn starter_files(title: &str) -> Vec<(&'static str, String)> {
    vec![
        ("README.md", README_TEMPLATE.replace("{title}", title)),
        ("world/overview.md", WORLD_OVERVIEW_TEMPLATE.to_string()),
        ("characters/protagonist.md", PROTAGONIST_TEMPLATE.to_string()),
        ("plot/main-arc.md", PLOT_MAIN_ARC_TEMPLATE.to_string()),
    ]
}
