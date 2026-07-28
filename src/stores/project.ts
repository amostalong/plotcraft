// project pinia store —— 当前项目 + 列表

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { createProject, listProjects, pickFolder, type ProjectMeta } from '@/lib/project'

export const useProjectStore = defineStore('project', () => {
  const current = ref<ProjectMeta | null>(null)
  const projects = ref<ProjectMeta[]>([])

  /** 新建项目：选文件夹 + 输名字 + createProject 落 4 个 starter md */
  async function createNew(): Promise<ProjectMeta | null> {
    const folder = await pickFolder('选择项目根目录（你的游戏文件夹会放在这里）')
    if (!folder) return null
    const name = window.prompt('项目名（英文 / 拼音，作为文件夹名）')
    if (!name || !name.trim()) return null
    const trimmed = name.trim()
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      window.alert('项目名不能包含 / 或 \\')
      return null
    }
    try {
      const meta = await createProject(folder, trimmed)
      current.value = meta
      return meta
    } catch (e) {
      window.alert(`创建失败: ${e}`)
      return null
    }
  }

  /** 打开项目：选文件夹 + 列出子项目 + 选一个 */
  async function openExisting(): Promise<ProjectMeta | null> {
    const folder = await pickFolder('选择项目根目录（扫描子文件夹找项目）')
    if (!folder) return null
    try {
      const list = await listProjects(folder)
      projects.value = list
      if (list.length === 0) {
        window.alert('没找到项目（含 README.md 的子文件夹）')
        return null
      }
      const names = list.map((p) => p.name).join('\n  - ')
      const name = window.prompt(`发现 ${list.length} 个项目：\n  - ${names}\n\n输入要打开的名字：`)
      if (!name) return null
      const found = list.find((p) => p.name === name.trim())
      if (!found) {
        window.alert(`没找到: ${name}`)
        return null
      }
      current.value = found
      return found
    } catch (e) {
      window.alert(`打开失败: ${e}`)
      return null
    }
  }

  function close() {
    current.value = null
  }

  return { current, projects, createNew, openExisting, close }
})
