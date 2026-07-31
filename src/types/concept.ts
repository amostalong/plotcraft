// PlotCraft 概念设计（concept/ 目录）类型
//
// 镜像 Rust `src-tauri/src/concept/mod.rs`（snake_case 跨 boundary）：
//   <project>/concept/<filename> —— 一步一个 md 文件（frontmatter 存 status/updated）
// 6 步概念设计漏斗：种子 → 核心体验 → 设计支柱 → 世界规则 → 人物功能 → 三幕骨架

/** 步骤状态（v0.3+ 简化：empty / confirmed 2 态）
 *  - empty：内容为空（无文件或空内容，灰色）
 *  - confirmed：有内容（玩家写过/采用过 = 已确认，绿色；玩家主导——继续改仍保持 confirmed）
 *  - 删除 v0.2 的 'draft' 状态：玩家操作 = 自动 confirmed（不再有"标记为已确认"按钮）
 *  - Rust 端 `save_concept_step` 仍接受 mark_confirmed: bool（兼容老项目），
 *    前端 v0.3+ 永远传 true */
export type ConceptStepStatus = 'empty' | 'confirmed'

/** 镜像 Rust `ConceptStep`（snake_case） */
export interface ConceptStep {
  /** 步骤 id（见 STEP_IDS） */
  id: string
  /** 显示标题（后端 STEPS 表给，如 "种子"） */
  title: string
  /** concept/ 下的文件名（如 "seed.md"） */
  filename: string
  status: ConceptStepStatus
  /** md 正文（不含 frontmatter）；empty 步骤为空串 */
  content: string
  /** RFC3339；empty 步骤为空串 */
  updated: string
}

/** 6 步固定顺序（概念设计漏斗） */
export const STEP_IDS = [
  'seed',
  'core-fantasy',
  'pillars',
  'world-rules',
  'character-functions',
  'three-act',
] as const

export type ConceptStepId = (typeof STEP_IDS)[number]
