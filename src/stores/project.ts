// project pinia store —— 当前项目 + 列表
//
// v0.1.5+ 拆成多步（pickFolder → modal → commit），替代 v0.1.4 之前
// 直接用 `window.prompt` / `window.alert` 的 OS system dialog 流程。
// 详细：components/project/{Open,New}ProjectModal.vue

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { createProject, listProjects, pickFolder, type ProjectMeta } from '@/lib/project'

export const useProjectStore = defineStore('project', () => {
  const current = ref<ProjectMeta | null>(null)
  const projects = ref<ProjectMeta[]>([])

  /**
   * 选父目录（OS dialog），返回路径或 null
   * UI 拿到路径后弹 NewProjectModal 输名字 → confirmCreateNew(name)
   */
  async function pickParentDir(title: string): Promise<string | null> {
    return pickFolder(title)
  }

  /**
   * v0.1.5+ 创建项目：UI 拿到 parentDir + 输完名字后调这个
   * 失败抛错让 UI 显式处理（不弹 OS dialog）
   */
  async function confirmCreateNew(parentDir: string, name: string): Promise<ProjectMeta | null> {
    try {
      const meta = await createProject(parentDir, name)
      current.value = meta
      return meta
    } catch (e) {
      console.error('[project] confirmCreateNew failed:', e)
      throw e
    }
  }

  /**
   * v0.1.5+ 打开项目：选根目录 + 列子文件夹
   * 返回 { parentDir, entries } 让 UI 弹 OpenProjectModal
   * （不自动 commit，UI 选完调 confirmOpenProject）
   */
  async function scanForProjects(parentDir?: string): Promise<{
    parentDir: string
    entries: ProjectMeta[]
  } | null> {
    const folder =
      parentDir ??
      (await pickFolder('选择项目根目录（扫描子文件夹找项目）'))
    if (!folder) return null
    const entries = await listProjects(folder)
    projects.value = entries
    return { parentDir: folder, entries }
  }

  /**
   * v0.1.5+ 玩家在 OpenProjectModal 选完一个 project → 设为 current
   */
  function confirmOpenProject(p: ProjectMeta): void {
    current.value = p
  }

  function close() {
    current.value = null
  }

  return {
    current,
    projects,
    pickParentDir,
    confirmCreateNew,
    scanForProjects,
    confirmOpenProject,
    close,
  }
})
