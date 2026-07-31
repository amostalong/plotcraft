// project pinia store —— 当前项目 + 列表
//
// v0.1.5+ 拆成多步（pickFolder → modal → commit），替代 v0.1.4 之前
// 直接用 `window.prompt` / `window.alert` 的 OS system dialog 流程。
// 详细：components/project/{Open,New}ProjectModal.vue
//
// v0.2+ 启动恢复 last project：
// - main.ts phase 2 调 useProjectStore().init()
// - 读 settings.recentProjects[0] → 后端 open_project(path) 验证 + 拿 meta
// - 成功 → current = meta（玩家直接进项目态）
// - 失败（项目被移走/删了）→ 删 recentProjects[0] + 不设 current
// - 持久化复用 settings.recentProjects：confirmCreateNew / confirmOpenProject 写

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { createProject, listProjects, openProject, pickFolder, type ProjectMeta } from '@/lib/project'
import { useSettingsStore } from './settings'

/** v0.2+ recent projects 上限 —— 防列表无限长 */
const RECENT_PROJECTS_CAP = 10

export const useProjectStore = defineStore('project', () => {
  const current = ref<ProjectMeta | null>(null)
  const projects = ref<ProjectMeta[]>([])

  /**
   * v0.2+ 启动恢复：从 settings.recentProjects[0] 拉 last project，验证后设为 current
   * 幂等：重复调用不会重复读（用 initializing 标志）
   * 失败（项目被移走/删了/plot.cat 损坏）→ 自动从 recentProjects 移除
   */
  let initializing = false
  async function init() {
    if (initializing) return
    initializing = true
    try {
      const settings = useSettingsStore()
      if (!settings.loaded) await settings.init()

      const recents = settings.config.recentProjects
      if (recents.length === 0) {
        console.log('[project.init] no recent projects, skip restore')
        return
      }

      const last = recents[0]
      const meta = await openProject(last)
      if (meta) {
        current.value = meta
        console.log(`[project.init] restored last project: ${meta.folder}`)
      } else {
        // 项目失效（被移走/删了/plot.cat 损坏）→ 删掉这条 recent
        console.warn(`[project.init] last project invalid, removing from recents: ${last}`)
        settings.config.recentProjects = recents.filter((p) => p !== last)
        await settings.save().catch((e) => console.error('[project.init] save recents failed:', e))
      }
    } catch (e) {
      console.error('[project.init] failed:', e)
    } finally {
      initializing = false
    }
  }

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
   * v0.2+ 成功后自动写 settings.recentProjects
   */
  async function confirmCreateNew(parentDir: string, name: string): Promise<ProjectMeta | null> {
    try {
      const meta = await createProject(parentDir, name)
      current.value = meta
      await addToRecents(meta.folder)
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
   *
   * v0.2+：选中的文件夹**本身**就是 PlotCraft 项目（含 plot.cat）时直接打开，
   * 不弹扫描 modal —— 玩家不用再特意选"上一层"。
   * 直接打开时返回 null（跟取消一个形状，调用方本来就不做事）。
   */
  async function scanForProjects(parentDir?: string): Promise<{
    parentDir: string
    entries: ProjectMeta[]
  } | null> {
    const folder =
      parentDir ??
      (await pickFolder('选择项目文件夹（或其父目录，会扫描子文件夹）'))
    if (!folder) return null

    // 本身就是项目 → 直接打开
    const direct = await openProject(folder)
    if (direct) {
      confirmOpenProject(direct)
      return null
    }

    // 否则当父目录扫子文件夹
    const entries = await listProjects(folder)
    projects.value = entries
    return { parentDir: folder, entries }
  }

  /**
   * v0.1.5+ 玩家在 OpenProjectModal 选完一个 project → 设为 current
   * v0.2+ 成功后自动写 settings.recentProjects
   */
  function confirmOpenProject(p: ProjectMeta): void {
    current.value = p
    void addToRecents(p.folder)
  }

  function close() {
    current.value = null
  }

  /**
   * v0.2+ 把 path 写进 settings.recentProjects
   * - unshift 到最前
   * - 去重（如果已在列表里则提到最前）
   * - cap RECENT_PROJECTS_CAP 条
   * - 异步 save settings（fire-and-forget，UI 不阻塞）
   */
  async function addToRecents(path: string) {
    try {
      const settings = useSettingsStore()
      if (!settings.loaded) await settings.init()

      const list = settings.config.recentProjects.filter((p) => p !== path)
      list.unshift(path)
      settings.config.recentProjects = list.slice(0, RECENT_PROJECTS_CAP)
      await settings.save()
    } catch (e) {
      console.error('[project.addToRecents] failed:', e)
    }
  }

  return {
    current,
    projects,
    init,
    pickParentDir,
    confirmCreateNew,
    scanForProjects,
    confirmOpenProject,
    close,
  }
})
