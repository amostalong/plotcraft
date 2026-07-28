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
import type { ApiFormat, EffortLevel } from './settings'

/** Chat run 选项（start_chat 第二个参数）
 *
 *  v0.1+ 跟 Locus 对齐：每条消息可以独立选 model + effort/thinking
 *  - `model`：临时覆盖（不写回 settings.config.model）
 *  - `effort`：reasoning effort / thinking level（per run）
 *
 *  Rust 端 `ChatRunOptions` 镜像
 */
export interface ChatRunOptions {
  /** 临时覆盖 model id（不写回 config.json） */
  model?: string | null
  /** reasoning effort / thinking level（per run） */
  effort?: EffortLevel | null
}

/** Test connection result
 *  - `ok = true` → 完整 round-trip 成功（含 auth + 模型响应）
 *  - `ok = false` → 任意环节失败，`error` 字段给玩家看
 */
export interface TestProviderResult {
  ok: boolean
  /** HTTP status code（如果有） */
  status?: number | null
  /** 错误消息（ok=false 时给玩家看） */
  error?: string | null
  /** 模型实际返回的片段（ok=true 时显示） */
  response?: string | null
  /** 测的 endpoint URL */
  endpoint: string
  /** 测的 model id */
  model: string
  /** 测的 api_format */
  apiFormat: ApiFormat
}

// --- Tauri commands ---

export async function startChat(
  messages: ChatMessage[],
  options?: ChatRunOptions,
): Promise<string> {
  return invoke<string>('start_chat', { messages, options: options ?? null })
}

export async function cancelChat(runId: string): Promise<void> {
  await invoke('cancel_chat', { runId })
}

export async function plotcraftVersion(): Promise<string> {
  return invoke<string>('plotcraft_version')
}

/** Test connection —— 非流式 ping 一次，验证 endpoint + apiKey + model 端到端可用
 *  - 不读 config.json，参数直接传（玩家可以测任意临时组合）
 *  - 三种 apiFormat 都用 `max_tokens: 1` + 一条 "hi" 消息
 *  - 失败原因直接给玩家看（network / auth / model not found / 等）
 */
export async function testProvider(opts: {
  endpoint: string
  apiKey: string
  apiFormat: ApiFormat
  model: string
}): Promise<TestProviderResult> {
  return invoke<TestProviderResult>('test_provider', { opts })
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
