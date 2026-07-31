// PlotCraft step chat 历史落盘（v0.3+ 实装：玩家反馈"想保留" → 关 app 不丢）
//
// 数据约定（镜像 Rust `src-tauri/src/chats/mod.rs`，snake_case 跨 boundary）：
//   <project>/.chats/concept/<stepId>.json
//   <project>/.chats/world/<docId>.json
// - 12 个固定 itemKey（v0.5+ 7 层模型后）：
//     concept:seed/pillars/world-rules/locations/character-functions/three-act/core-fantasy
//     world:overview/geography/history/magic-system/factions
// - 懒创建目录 —— 旧项目没 .chats/ 也正常 load（返回空）
// - atomic write（tmp → rename）—— 跨平台稳定
// - 不做文件监听 —— 玩家手改后点"刷新"重扫（对齐 art/concept 惯例）

import { invoke } from '@tauri-apps/api/core'

import type { ChatMessage } from '@/types/chat'

/** itemType id（"concept" / "world"）—— 写盘路径分类 */
export type ChatItemType = 'concept' | 'world'

/** 跨 boundary 文件格式（镜像 Rust 端 `ChatFile`，snake_case 跨 boundary） */
export interface ChatFile {
  version: number
  messages: ChatMessage[]
  last_user_message: ChatMessage | null
  updated_at: string
}

/** 加载项目所有 chat 历史（缺目录返回空 map，不报错） */
export async function loadChats(projectRoot: string): Promise<Record<string, ChatFile>> {
  return invoke<Record<string, ChatFile>>('load_chats', { projectRoot })
}

/** 保存单个 chat 历史（atomic write） */
export async function saveChat(
  projectRoot: string,
  itemKey: string,
  payload: ChatFile,
): Promise<void> {
  await invoke('save_chat', { projectRoot, itemKey, payload })
}

/** 删除单个 chat 文件（玩家点"清空对话"按钮 / 切项目清理）
 *  - 文件不存在 → 静默成功（幂等）*/
export async function deleteChat(projectRoot: string, itemKey: string): Promise<void> {
  await invoke('delete_chat', { projectRoot, itemKey })
}

/** 清空项目所有 chat（切项目调；不删目录本身） */
export async function deleteAllChats(projectRoot: string): Promise<void> {
  await invoke('delete_all_chats', { projectRoot })
}

/** 拼 itemKey：`<itemType>:<itemId>` —— store 内部用 */
export function makeItemKey(type: ChatItemType, id: string): string {
  return `${type}:${id}`
}

/** 解析 itemKey → (type, id) —— store 加载时反查 */
export function parseItemKey(itemKey: string): { type: ChatItemType; id: string } | null {
  const idx = itemKey.indexOf(':')
  if (idx === -1) return null
  const type = itemKey.slice(0, idx)
  const id = itemKey.slice(idx + 1)
  if (type !== 'concept' && type !== 'world') return null
  return { type, id }
}
