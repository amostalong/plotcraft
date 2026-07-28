// PlotCraft v0.1 项目 wrapper（前端 Tauri command wrapper）

import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

export interface ProjectMeta {
  name: string
  folder: string
  created_at: string
  updated_at: string
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
