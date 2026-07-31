// PlotCraft 概念设计（concept/ 目录）前端 wrapper
//
// 数据约定（镜像 Rust `src-tauri/src/concept/mod.rs`，snake_case 跨 boundary）：
//   <project>/concept/<seed|core-fantasy|pillars|world-rules|character-functions|three-act>.md
// - 6 步固定，懒创建：缺文件 → status="empty" + 空内容；save 时自动建目录和文件
// - 旧项目零迁移兼容（v0.1 项目没 concept/ 也正常 list）

import { invoke } from '@tauri-apps/api/core'

import type { ConceptStep } from '@/types/concept'

/** 扫描项目 concept/ 6 步，缺文件返回 status="empty" + 空内容（不报错） */
export async function listConceptSteps(projectRoot: string): Promise<ConceptStep[]> {
  return invoke<ConceptStep[]>('list_concept_steps', { projectRoot })
}

/** 保存一步内容（atomic write）；markConfirmed=true → status=confirmed，否则 draft
 *  stepId 不在 6 步内 → 后端抛错 */
export async function saveConceptStep(
  projectRoot: string,
  stepId: string,
  content: string,
  markConfirmed: boolean,
): Promise<ConceptStep> {
  return invoke<ConceptStep>('save_concept_step', { projectRoot, stepId, content, markConfirmed })
}

/** 汇总 status != empty 的步骤（每步截断 500 字）—— 给 chat system prompt 宪法注入用
 *  全部 empty → 返回空串 */
export async function getConceptSummary(projectRoot: string): Promise<string> {
  return invoke<string>('get_concept_summary', { projectRoot })
}
