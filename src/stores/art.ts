// art pinia store —— 设定图图库（v0.2+）
//
// 依赖 useProjectStore().current：有项目才能扫 art/
// 玩家手改文件后点"刷新"重扫（不做文件监听，对齐 DESIGN）
//
// 反卡顿惯例：entries 用 shallowRef 包（大列表不深 reactive）；
// image base64 缓存走普通 Map（不放 reactive state，几 MB 字符串不进依赖追踪）

import { defineStore } from 'pinia'
import { shallowRef, ref } from 'vue'

import {
  createArtEntry,
  deleteArtEntry,
  listArt,
  readArtImage,
  saveArtPrompt,
  type ArtCategory,
  type ArtEntry,
} from '@/lib/art'
import { useProjectStore } from './project'

export const useArtStore = defineStore('art', () => {
  const entries = shallowRef<ArtEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** 图片 data URL 内存缓存：`${category}/${name}` → dataUrl */
  const imageCache = new Map<string, string>()

  function cacheKey(entry: Pick<ArtEntry, 'category' | 'name'>): string {
    return `${entry.category}/${entry.name}`
  }

  /** 扫描当前项目 art/ —— 无项目 → 清空（不报错） */
  async function load(): Promise<void> {
    const project = useProjectStore()
    if (!project.current) {
      entries.value = []
      imageCache.clear()
      return
    }
    loading.value = true
    error.value = null
    try {
      entries.value = await listArt(project.current.folder)
      // 重扫后图片可能变了（玩家手换图）→ 清缓存重拉
      imageCache.clear()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      console.error('[art.load] failed:', e)
    } finally {
      loading.value = false
    }
  }

  /** 新建 entry —— 失败抛错让 UI inline 显示（非法名 / 重名） */
  async function create(category: ArtCategory, name: string): Promise<ArtEntry> {
    const project = useProjectStore()
    if (!project.current) throw new Error('没有打开的项目')
    const entry = await createArtEntry(project.current.folder, category, name)
    entries.value = [...entries.value, entry]
    return entry
  }

  /** 保存 prompt（自动落盘：view 层 blur / debounce 调这个）
   *  成功更新本地 entry（不重扫）；失败抛错让 UI 提示 */
  async function savePrompt(entry: ArtEntry, prompt: string): Promise<void> {
    const project = useProjectStore()
    if (!project.current) throw new Error('没有打开的项目')
    await saveArtPrompt(project.current.folder, entry.category as ArtCategory, entry.name, prompt)
    const updated: ArtEntry = { ...entry, prompt, updated_at: new Date().toISOString() }
    entries.value = entries.value.map((e) =>
      e.category === entry.category && e.name === entry.name ? updated : e,
    )
  }

  /** 删除 entry（prompt.txt + 同名图片）—— 失败抛错 */
  async function remove(entry: ArtEntry): Promise<void> {
    const project = useProjectStore()
    if (!project.current) throw new Error('没有打开的项目')
    await deleteArtEntry(project.current.folder, entry.category as ArtCategory, entry.name)
    imageCache.delete(cacheKey(entry))
    entries.value = entries.value.filter(
      (e) => !(e.category === entry.category && e.name === entry.name),
    )
  }

  /** 懒拉图片 data URL（带缓存）；无图 / 拉取失败 → null（UI 回落占位 tile） */
  async function imageUrl(entry: ArtEntry): Promise<string | null> {
    if (!entry.has_image) return null
    const key = cacheKey(entry)
    const hit = imageCache.get(key)
    if (hit) return hit
    const project = useProjectStore()
    if (!project.current) return null
    try {
      const url = await readArtImage(
        project.current.folder,
        entry.category as ArtCategory,
        entry.name,
      )
      imageCache.set(key, url)
      return url
    } catch (e) {
      console.warn(`[art.imageUrl] ${key} failed:`, e)
      return null
    }
  }

  return { entries, loading, error, load, create, savePrompt, remove, imageUrl }
})
