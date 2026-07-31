// PlotCraft 概念设计（concept/ 目录）类型
//
// 镜像 Rust `src-tauri/src/concept/mod.rs`（snake_case 跨 boundary）：
//   <project>/concept/<filename> —— 一步一个 md 文件（frontmatter 存 status/updated/group/level/maturity）
// 7 层严格派生模型（v0.5+）：
//   L1 立意（seed）             → 故事的根，1 句哲学
//   L2 抽象规则（pillars）      → 设计的硬约束，独立演进
//   L3 世界（world-rules）      → 宏观设定
//   L4 地点（locations, 可选）  → 具体空间
//   L5 人物（character-functions）→ 角色功能
//   L6 故事（three-act）        → 时间轴上的展开
//   L7 核心体验（core-fantasy） → 玩家视角的 1 句话总结

/** 步骤状态（v0.3+ 简化：empty / confirmed 2 态）
 *  - empty：内容为空（无文件或空内容，灰色）
 *  - confirmed：有内容（玩家写过/采用过 = 已确认，绿色；玩家主导——继续改仍保持 confirmed）
 *  - 删除 v0.2 的 'draft' 状态：玩家操作 = 自动 confirmed（不再有"标记为已确认"按钮）
 *  - Rust 端 `save_concept_step` 仍接受 mark_confirmed: bool（兼容老项目），
 *    前端 v0.3+ 永远传 true */
export type ConceptStepStatus = 'empty' | 'confirmed'

/** 步骤分组（v0.5+ 加 group 字段，跨层逻辑归类）
 *  - theme: L1 立意
 *  - principles: L2 抽象规则
 *  - world: L3 世界
 *  - locations: L4 地点
 *  - character: L5 人物
 *  - story: L6 故事
 *  - core-fantasy: L7 核心体验 */
export type ConceptGroup =
  | 'theme'
  | 'principles'
  | 'world'
  | 'locations'
  | 'character'
  | 'story'
  | 'core-fantasy'

/** pillars 成熟度（仅 L2 pillars 用；其他步骤 maturity 为空串）
 *  - empty：还没写
 *  - draft：玩家初稿（v1）
 *  - evolving：演进中（v2+）—— LLM 跑"反向检验"用 L3-L6 现状反推
 *  - finalized：定型 —— 当硬约束用，注入 LLM 用作 veto */
export type StepMaturity = 'empty' | 'draft' | 'evolving' | 'finalized'

/** 7 层 step id 联合类型 */
export type ConceptStepId =
  | 'seed'
  | 'pillars'
  | 'world-rules'
  | 'locations'
  | 'character-functions'
  | 'three-act'
  | 'core-fantasy'

/** 镜像 Rust `ConceptStep`（snake_case） */
export interface ConceptStep {
  /** 步骤 id（见 ConceptStepId） */
  id: ConceptStepId
  /** 显示标题（后端 STEPS 表给，如 "立意"） */
  title: string
  /** concept/ 下的文件名（如 "seed.md"） */
  filename: string
  /** 分组（theme / principles / world / locations / character / story / core-fantasy） */
  group: ConceptGroup
  /** 层级 1-7（派生链位置） */
  level: number
  /** empty | confirmed */
  status: ConceptStepStatus
  /** md 正文（不含 frontmatter）；empty 步骤为空串 */
  content: string
  /** RFC3339；empty 步骤为空串 */
  updated: string
  /** maturity：仅 L2 pillars 用；其他步骤为空串 */
  maturity: string
  /** optional：仅 L4 locations = true；其他步骤为 false */
  optional: boolean
}

/** 7 步固定顺序（按派生链：L1 → L2 → L3 → L4 → L5 → L6 → L7） */
export const STEP_IDS: readonly ConceptStepId[] = [
  'seed',
  'pillars',
  'world-rules',
  'locations',
  'character-functions',
  'three-act',
  'core-fantasy',
] as const

/** 派生关系 helper：判断 step X 是否依赖 step Y（即 Y 是 X 的上游） */
export function isUpstreamOf(upstream: ConceptStepId, downstream: ConceptStepId): boolean {
  const u = STEP_IDS.indexOf(upstream)
  const d = STEP_IDS.indexOf(downstream)
  return u >= 0 && d >= 0 && u < d
}
