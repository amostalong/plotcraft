// PlotCraft v0.1 LLM 客户端（前端 wrapper）
// 详细见 [CHAT_LLM_DESIGN.md §3 反制 1]

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type {
  ChatMessage,
  ChatChunkPayload,
  ChatDonePayload,
  ChatErrorPayload,
} from '@/types/chat'

// --- Tauri commands ---

export async function startChat(messages: ChatMessage[]): Promise<string> {
  return invoke<string>('start_chat', { messages })
}

export async function cancelChat(runId: string): Promise<void> {
  await invoke('cancel_chat', { runId })
}

export async function plotcraftVersion(): Promise<string> {
  return invoke<string>('plotcraft_version')
}

// --- Tauri event subscriptions ---

export async function onChatChunk(
  handler: (payload: ChatChunkPayload) => void,
): Promise<UnlistenFn> {
  return listen<ChatChunkPayload>('chat:chunk', (e) => handler(e.payload))
}

export async function onChatDone(
  handler: (payload: ChatDonePayload) => void,
): Promise<UnlistenFn> {
  return listen<ChatDonePayload>('chat:done', (e) => handler(e.payload))
}

export async function onChatError(
  handler: (payload: ChatErrorPayload) => void,
): Promise<UnlistenFn> {
  return listen<ChatErrorPayload>('chat:error', (e) => handler(e.payload))
}
