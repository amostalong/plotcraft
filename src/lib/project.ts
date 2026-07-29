// PlotCraft v0.1 项目 wrapper（前端 Tauri command wrapper）

import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

export interface ProjectMeta {
  name: string
  folder: string
  created_at: string
  updated_at: string
  /**
   * v0.2+ PlotCraft 项目标识：项目根有 `plot.cat` 文件
   * （v0.2 之前用 `world/` 判定，仍会被手建 RPG 目录误认；
   *  改成显式 `plot.cat` 标记 —— 内容是 ProjectConfig JSON（schema / created_at / created_by））
   * 前端 OpenProjectModal 用这个给玩家视觉提示 + 排序时 PlotCraft 项目排前面
   * 老项目（v0.2 之前仅有 world/ 的）list_projects 会自动补 plot.cat 迁移
   */
  is_plotcraft_project: boolean
}

/**
 * v0.2+ plot.cat 内容 schema —— 跟后端 `templates.rs:ProjectConfig` 一一对应
 * - `schema` 当前固定 1
 * - `created_at` ISO 8601
 * - `created_by` 创建版本标识
 * v0.3+ 想加什么（default_model / last_active_session / 等）也加这里
 */
export interface ProjectConfig {
  schema: number
  created_at: string
  created_by: string
}

export async function createProject(folder: string, name: string): Promise<ProjectMeta> {
  return invoke<ProjectMeta>('create_project', { folder, name })
}

export async function listProjects(folder: string): Promise<ProjectMeta[]> {
  return invoke<ProjectMeta[]>('list_projects', { folder })
}

/** 弹出系统文件夹选择 dialog，返回选中的绝对路径或 null */
export async function pickFolder(title = '选择文件夹'): Promise<string | null> {
  const result = await open({ directory: true, multiple: false, title })
  if (Array.isArray(result)) return result[0] ?? null
  return result ?? null
}
