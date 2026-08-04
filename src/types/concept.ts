// PlotCraft 概念设计（concept/ 目录）类型
//
// 镜像 Rust `src-tauri/src/concept.rs`（snake_case 跨 boundary）：
//   <project>/concept/<filename> —— 一步一个 md 文件（frontmatter 存 status/updated/group/level）
// 6 层抽象蒸馏模型（v0.5.3+）：
//   L1 立意（seed）             → 故事的根，1 句哲学
//   L2 核心故事（core-story）   → 叙事脊柱 + 戏剧结构（吸收 v0.5+ 旧 L2 pillars + L6 three-act）
//   L3 世界规则（world-rules）  → 宏观设定 + 运作法则
//   L4 地点（locations, 可选）  → 具体空间
//   L5 人物（character-functions）→ 角色功能
//   L6 核心玩法（core-gameplay）→ 核心机制 + 1 句话玩家体验（吸收 v0.5+ 旧 L7 core-fantasy + 新增核心机制）
//
// v0.5.3+ 删除 v0.5+ 旧 L2 pillars 4 态成熟度（empty/draft/evolving/finalized）
// - L2 核心故事 不需要"演进型"——它是"什么"层，不是"怎么约束"层
// - ConceptStep.maturity 字段删除
// - StepMaturity 类型删除

/** 步骤状态（v0.3+ 简化：empty / confirmed 2 态）
 *  - empty：内容为空（无文件或空内容，灰色）
 *  - confirmed：有内容（玩家写过/采用过 = 已确认，绿色；玩家主导——继续改仍保持 confirmed）
 *  - 删除 v0.2 的 'draft' 状态：玩家操作 = 自动 confirmed（不再有"标记为已确认"按钮）
 *  - Rust 端 `save_concept_step` 仍接受 mark_confirmed: bool（兼容老项目），
 *    前端 v0.3+ 永远传 true */
export type ConceptStepStatus = 'empty' | 'confirmed'

/** 步骤分组（v0.5.3+ 6 个 group；v0.5+ 旧 principles/story/core-fantasy 删除，
 *  新增 core-story / core-gameplay，world → world-rules） */
export type ConceptGroup =
  | 'theme'
  | 'core-story'
  | 'world-rules'
  | 'locations'
  | 'character'
  | 'core-gameplay'

/** 6 层 step id 联合类型（v0.5+ 旧 pillars/three-act/core-fantasy 替换为 core-story/core-gameplay） */
export type ConceptStepId =
  | 'seed'
  | 'core-story'
  | 'world-rules'
  | 'locations'
  | 'character-functions'
  | 'core-gameplay'

/** 镜像 Rust `ConceptStep`（snake_case；v0.5.3+ 删 maturity 字段） */
export interface ConceptStep {
  /** 步骤 id（见 ConceptStepId） */
  id: ConceptStepId
  /** 显示标题（后端 STEPS 表给，如 "立意"） */
  title: string
  /** concept/ 下的文件名（如 "seed.md"） */
  filename: string
  /** 分组（theme / core-story / world-rules / locations / character / core-gameplay） */
  group: ConceptGroup
  /** 层级 1-6（派生链位置） */
  level: number
  /** empty | confirmed */
  status: ConceptStepStatus
  /** md 正文（不含 frontmatter）；empty 步骤为空串 */
  content: string
  /** RFC3339；empty 步骤为空串 */
  updated: string
  /** optional：仅 L4 locations = true；其他步骤为 false */
  optional: boolean
}

/** 6 步固定顺序（按派生链：L1 → L2 → L3 → L4 → L5 → L6） */
export const STEP_IDS: readonly ConceptStepId[] = [
  'seed',
  'core-story',
  'world-rules',
  'locations',
  'character-functions',
  'core-gameplay',
] as const

/** 派生关系 helper：判断 step X 是否依赖 step Y（即 Y 是 X 的上游） */
export function isUpstreamOf(upstream: ConceptStepId, downstream: ConceptStepId): boolean {
  const u = STEP_IDS.indexOf(upstream)
  const d = STEP_IDS.indexOf(downstream)
  return u >= 0 && d >= 0 && u < d
}
