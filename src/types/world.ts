// PlotCraft 世界设定（world/ 目录）类型
//
// 镜像 Rust `src-tauri/src/docs/mod.rs` 的 `DocEntry`（snake_case 跨 boundary）：
//   <project>/world/<overview|geography|history|magic-system|factions>.md
// - 5 节固定，懒创建：缺文件 → exists=false + 空内容；save 时自动建目录和文件
// - 无 status 状态机（那是概念漏斗的语义）；左栏状态点只看 exists
// - 旧项目零迁移兼容（v0.2 项目只有 world/overview.md 也正常 list）

/** 镜像 Rust `DocEntry`（snake_case） */
export interface DocEntry {
  /** 所属集合（目前只有 'world'） */
  collection: string
  /** 分节 id（如 "overview"） */
  id: string
  /** 显示标题（后端 SectionDef 给，如 "世界观速览"） */
  title: string
  /** world/ 下的文件名（如 "overview.md"） */
  filename: string
  /** 文件是否已存在（false = 懒创建中，save 后变 true） */
  exists: boolean
  /** md 正文（不含 frontmatter）；不存在时为空串 */
  content: string
  /** RFC3339；不存在时为空串 */
  updated: string
}

/** collection 常量（对齐后端 COLLECTIONS 注册表） */
export const WORLD_COLLECTION = 'world'
