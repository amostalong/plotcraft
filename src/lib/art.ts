// PlotCraft v0.2+ 设定图（art/ 图库）前端 wrapper
//
// 数据约定（镜像 Rust `src-tauri/src/art/mod.rs`，snake_case 跨 boundary）：
//   <project>/art/{characters,scenes,items}/<name>.prompt.txt (+ 可选同名 png/jpg/jpeg/webp)
// - category 固定 3 类，不开放自由目录
// - 占位图不落盘：has_image=false 时 UI 渲染占位 tile

import { invoke } from '@tauri-apps/api/core'

/** 镜像 Rust `ArtEntry`（snake_case） */
export interface ArtEntry {
  /** 文件 stem（如 "hero"） */
  name: string
  /** characters | scenes | items */
  category: string
  /** .prompt.txt 内容（可空） */
  prompt: string
  /** 同名 png/jpg/jpeg/webp 存在 */
  has_image: boolean
  /** prompt.txt 的 fs mtime（RFC3339） */
  updated_at: string
}

/** 固定 3 类（DESIGN 已定，跟 Rust ART_CATEGORIES 一致） */
export const ART_CATEGORIES = ['characters', 'scenes', 'items'] as const

export type ArtCategory = (typeof ART_CATEGORIES)[number]

/** UI 显示名（v0.1 全中文硬编码惯例） */
export const ART_CATEGORY_LABELS: Record<ArtCategory, string> = {
  characters: '人物',
  scenes: '场景',
  items: '物品',
}

// --- Tauri command wrappers ---

/** 扫描项目 art/ 三类目录，返回全部 entry */
export async function listArt(projectPath: string): Promise<ArtEntry[]> {
  return invoke<ArtEntry[]>('list_art', { projectPath })
}

/** 新建 entry：懒建目录 + 写空 prompt.txt；重名 / 非法名 → 抛错 */
export async function createArtEntry(
  projectPath: string,
  category: ArtCategory,
  name: string,
): Promise<ArtEntry> {
  return invoke<ArtEntry>('create_art_entry', { projectPath, category, name })
}

/** 保存 prompt（atomic write），entry 不存在 → 抛错 */
export async function saveArtPrompt(
  projectPath: string,
  category: ArtCategory,
  name: string,
  prompt: string,
): Promise<void> {
  await invoke('save_art_prompt', { projectPath, category, name, prompt })
}

/** 删除 entry：prompt.txt + 同名图片（若有）一起删 */
export async function deleteArtEntry(
  projectPath: string,
  category: ArtCategory,
  name: string,
): Promise<void> {
  await invoke('delete_art_entry', { projectPath, category, name })
}

/** 读 entry 图片 → base64 data URL；无图 → 抛错（调用方 has_image=false 时不该调） */
export async function readArtImage(
  projectPath: string,
  category: ArtCategory,
  name: string,
): Promise<string> {
  return invoke<string>('read_art_image', { projectPath, category, name })
}
