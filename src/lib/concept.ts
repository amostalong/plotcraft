// PlotCraft 概念设计（concept/ 目录）前端 wrapper
//
// 数据约定（镜像 Rust `src-tauri/src/concept.rs`，snake_case 跨 boundary）：
//   <project>/concept/<seed|core-story|world-rules|locations|character-functions|core-gameplay>.md
// - 6 层抽象蒸馏模型（v0.5.3+）：L1 立意 → L2 核心故事 → L3 世界规则 → L4 地点（可选）→ L5 人物 → L6 核心玩法
// - 懒创建：缺文件 → status="empty" + 空内容；save 时自动建目录和文件
// - 旧项目零迁移兼容（v0.5+ 7 步 → v0.5.3+ 6 步）：
//   - 旧 pillars.md + three-act.md → 合并为 core-story.md
//   - 旧 core-fantasy.md → 改名为 core-gameplay.md
//   - 文件级迁移在 Rust 端 `scan_concept` 入口一次性跑（`migrate_legacy_concept`）

import { invoke } from '@tauri-apps/api/core'

import type { ConceptStep } from '@/types/concept'

/** 扫描项目 concept/ 6 步，缺文件返回 status="empty" + 空内容（不报错）
 *  v0.5.3+ 入口自动跑 v0.5+ 7 步 → 6 步 文件级迁移 */
export async function listConceptSteps(projectRoot: string): Promise<ConceptStep[]> {
  return invoke<ConceptStep[]>('list_concept_steps', { projectRoot })
}

/** 保存一步内容（atomic write）；markConfirmed=true → status=confirmed，否则 draft
 *  v0.5.3+ 删 maturity 参数（L2 核心故事 不再有 4 态成熟度）
 *  stepId 不在 6 步内 → 后端抛错 */
export async function saveConceptStep(
  projectRoot: string,
  stepId: string,
  content: string,
  markConfirmed: boolean,
): Promise<ConceptStep> {
  return invoke<ConceptStep>('save_concept_step', {
    projectRoot,
    stepId,
    content,
    markConfirmed,
  })
}

/** 汇总 status != empty 的步骤（每步截断 500 字）—— 给 chat system prompt 宪法注入用
 *  格式：6 层分组标签 [L1 立意] / [L2 核心故事] / [L4 地点（可选）] 等
 *  全部 empty → 返回空串 */
export async function getConceptSummary(projectRoot: string): Promise<string> {
  return invoke<string>('get_concept_summary', { projectRoot })
}
