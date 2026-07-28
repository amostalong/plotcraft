//! PlotCraft 项目模块
//!
//! v0.1 范围（见 [CHAT_LLM_DESIGN.md §1]）：
//! - create_project 命令：落 4 个 starter md
//! - list_projects 命令：扫描子文件夹
//!
//! v0.1 简化：
//! - 不做 AI 引导流（v0.2+ 加）
//! - frontmatter created_at 用 TODO 占位（v0.1 玩家自己填）
//! - 不做 frontmatter 校验（v0.1 玩家手编辑 + chat 解析）

pub mod templates;
