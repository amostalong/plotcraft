// PlotCraft 概念设计（concept/ 目录）前端 wrapper
//
// 数据约定（镜像 Rust `src-tauri/src/concept/mod.rs`，snake_case 跨 boundary）：
//   <project>/concept/<seed|pillars|world-rules|locations|character-functions|three-act|core-fantasy>.md
// - 7 步严格派生模型（v0.5+）：L1 立意 → L2 抽象规则 → L3 世界 → L4 地点（可选）→ L5 人物 → L6 故事 → L7 核心体验
// - 懒创建：缺文件 → status="empty" + 空内容；save 时自动建目录和文件
// - 旧项目零迁移兼容（v0.3 旧 6 步漏斗自动归位：旧 core-fantasy 归 L7；新 locations.md 旧项目无 → empty）

import { invoke } from '@tauri-apps/api/core'

import type { ConceptStep, StepMaturity } from '@/types/concept'

/** 扫描项目 concept/ 7 步，缺文件返回 status="empty" + 空内容（不报错） */
export async function listConceptSteps(projectRoot: string): Promise<ConceptStep[]> {
  return invoke<ConceptStep[]>('list_concept_steps', { projectRoot })
}

/** 保存一步内容（atomic write）；markConfirmed=true → status=confirmed，否则 draft
 *  maturity：仅 L2 pillars 写（其他步骤传 undefined 不写盘）
 *  stepId 不在 7 步内 → 后端抛错 */
export async function saveConceptStep(
  projectRoot: string,
  stepId: string,
  content: string,
  markConfirmed: boolean,
  maturity?: StepMaturity,
): Promise<ConceptStep> {
  return invoke<ConceptStep>('save_concept_step', {
    projectRoot,
    stepId,
    content,
    markConfirmed,
    maturity: maturity ?? null,
  })
}

/** 汇总 status != empty 的步骤（每步截断 500 字）—— 给 chat system prompt 宪法注入用
 *  格式：7 层分组标签 [L1 立意] / [L2 抽象规则（成熟度：演进 v2+）] / [L4 地点（可选）] 等
 *  全部 empty → 返回空串 */
export async function getConceptSummary(projectRoot: string): Promise<string> {
  return invoke<string>('get_concept_summary', { projectRoot })
}
