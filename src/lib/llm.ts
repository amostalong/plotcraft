// PlotCraft v0.1 LLM 客户端（前端 wrapper）
// 详细见 [CHAT_LLM_DESIGN.md §3 反制 1]

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type {
  ChatMessage,
  ChatChunkPayload,
  ChatDonePayload,
  ChatErrorPayload,
  ChatToolCallPayload,
  ToolDefinition,
} from '@/types/chat'
import type { ModelCatalog } from '@/types/catalog'
import type { ApiFormat, EffortLevel } from './settings'

/** Chat run 选项（start_chat 第二个参数）
 *
 *  v0.1+ 跟 Locus 对齐：每条消息可以独立选 model + effort/thinking
 *  - `model`：临时覆盖（不写回 settings.config.model）
 *  - `effort`：reasoning effort / thinking level（per run）
 *
 *  v0.4+ `tools`：注入到 LLM request 的 `tools` 字段（tool calling 协议级）
 *  - 关闭的 tool 不传（用户硬要求）→ undefined / 空数组 → 整个 tools 字段不下发，LLM 完全不知道存在
 *  - 概念/世界 store 调用时由 `resolveEnabledTools(settings)` 过滤 Settings 关闭的 tool
 *  - 协议级注入，Rust 端 build body 时按 api_format 转 schema
 *
 *  v0.4+ 取消 v0.3+ 的 `forceJson` 字段：
 *  - 老逻辑 forceJson=true → 后端 `response_format: json_object` → LLM 返 JSON 字符串
 *  - v0.4+ 改走 tool calling，schema 本身就是协议级结构化约束，不需要 response_format
 *  - response_format 跟 tools 在 OpenAI 协议里互斥，强制开 response_format 会让 LLM 忽略 tools
 *
 *  Rust 端 `ChatRunOptions` 镜像
 */
export interface ChatRunOptions {
  /** 临时覆盖 model id（不写回 config.json） */
  model?: string | null
  /** reasoning effort / thinking level（per run） */
  effort?: EffortLevel | null
  /** v0.4+ tool calling: 注入到 LLM request 的 tools 字段
   *  - undefined / 空数组 → Rust 端不写 tools 字段
   *  - 一般前端走 `resolveEnabledTools(settings)` 过滤 Settings 关闭的 tool */
  tools?: ToolDefinition[] | null
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
  // 排查 chain 走哪条路径: print 关键选项 (model / tools)
  console.log(
    `[startChat] msgs=${messages.length}, model=${options?.model ?? '(default)'}, tools=${options?.tools?.length ?? 0}`,
  )
  return invoke<string>('start_chat', { messages, options: options ?? null })
}

export async function cancelChat(runId: string): Promise<void> {
  console.log(`[cancelChat] ${runId}`)
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
  return invoke<TestProviderResult>('test_provider', { params: opts })
}

/** Generate result（镜像 Rust `GenerateResult`） */
export interface GenerateResult {
  text: string
}

/** 非流式一次性问答 —— test_provider 骨架的泛化
 *
 *  v0.3+ **当前无调用方**（备选走流式 chat + JSON parse 内联进消息，详见
 *  [docs/AI_PANEL_DESIGN.md]）。保留为 v0.4+ AI 验收类功能（如"批量检
 *  查所有 step 是否满足宪法"）预留。
 *
 *  - 不读 config.json，参数直接传（跟 test_provider 同一模式，调用方从 settings store 取）
 *  - Rust 端 `GenerateParams` 是 `#[serde(rename_all = "camelCase")]`，
 *    params 内部字段传 camelCase（跟 testProvider 同款约定）
 */
export async function generate(
  messages: ChatMessage[],
  options: {
    endpoint: string
    apiKey: string
    apiFormat: ApiFormat
    model: string
    maxTokens?: number
  },
): Promise<string> {
  const result = await invoke<GenerateResult>('generate', {
    params: {
      endpoint: options.endpoint,
      apiKey: options.apiKey,
      apiFormat: options.apiFormat,
      model: options.model,
      messages,
      maxTokens: options.maxTokens ?? null,
    },
  })
  return result.text
}

/** Get the embedded model catalog (slim models.dev snapshot, ~167 providers)
 *  - Rust 端 lazy parse 一次 + 缓存到 OnceLock（in-process 不再 reparse）
 *  - 优先 cache（player 上次 refresh 写盘的），cache 缺失/旧用 embedded
 *  - App 启动后 5s 背景 refresh 一次（cache > 24h 才真拉）
 *  - 前端按需缓存到内存（player 打开 modal 才拉，避免启动阻塞）
 */
export async function getModelCatalog(): Promise<ModelCatalog> {
  return invoke<ModelCatalog>('get_model_catalog')
}

/** Force a fresh remote refresh (GET https://models.dev/api.json)
 *  - 走 Rust slim + sanity check + 写盘 + 替换 in-memory state
 *  - 失败抛错（UI 给玩家看具体原因） */
export async function refreshModelCatalog(): Promise<ModelCatalog> {
  return invoke<ModelCatalog>('refresh_model_catalog')
}

// === v0.1.5+ Chat session 持久化 ===
//
// v0.2+ 升级到多 session：
// - 后端 `sessions/_index.json` 存 SessionMeta 列表（id / title / created_at / updated_at / message_count）
// - 每个 session 一个文件 `sessions/<id>.json`（SessionFileV2 格式）
// - v0.1 legacy `default.json` 自动当 id="default" 处理
//
// v0.1 简化：单 session 不切换（v0.2+ 多 session + 按项目分组）

import type { ChatMessage } from '@/types/chat'

/** v0.2+ session metadata —— 存 _index.json，不存 messages（messages 在 <id>.json） */
export interface SessionMeta {
  /** session id（= 文件名 stem，比如 "default" / "abc12345"） */
  id: string
  /** 玩家改的显示名 */
  title: string
  /** ISO 8601 timestamp */
  created_at: string
  /** ISO 8601 timestamp（最后一次 save 时更新） */
  updated_at: string
  /** message 数量（UI 显示 "5 messages"） */
  message_count: number
}

/** v0.2+ session 文件结构（镜像 Rust 端 `SessionFile` v2，snake_case 跨 boundary）*/
export interface SessionFileV2 {
  version: number
  updated_at: string
  messages: ChatMessage[]
  last_user_message: ChatMessage | null
}

/** 列出所有 session —— v0.2+ 多 session
 *  第一次启动时如果 legacy default.json 存在 → 自动当 id="default" 处理 */
export async function listSessions(): Promise<SessionMeta[]> {
  return invoke<SessionMeta[]>('list_sessions')
}

/** 创建新 session —— 写空 session 文件 + 加 _index.json entry
 *  @param title 玩家给的初始标题（后续可改名） */
export async function createSession(title: string): Promise<SessionMeta> {
  return invoke<SessionMeta>('create_session', { title })
}

/** 删除 session —— 删 <id>.json + 从 _index.json 移除（"default" session 不能删） */
export async function deleteSession(id: string): Promise<void> {
  await invoke('delete_session', { id })
}

/** 改名 —— 只改 _index.json */
export async function renameSession(id: string, newTitle: string): Promise<SessionMeta> {
  return invoke<SessionMeta>('rename_session', { id, newTitle })
}

/** 拉 chat session —— 无文件 / 损坏 → 返回空 SessionFileV2（不抛错）
 *  v0.2+ 接 id 参数（"default" 走 v0.1 legacy 兼容路径） */
export async function loadSession(id: string): Promise<SessionFileV2> {
  return invoke<SessionFileV2>('load_session', { id })
}

/** 写 chat session —— atomic write（tmp → rename），错误抛给上层
 *  v0.2+ 接 id 参数 + 传整个 SessionFileV2 payload（version 强制 2） */
export async function saveSession(id: string, payload: SessionFileV2): Promise<void> {
  await invoke('save_session', { id, payload })
}

// --- Tauri event subscriptions ---

export async function onChatChunk(
  handler: (payload: ChatChunkPayload) => void,
): Promise<UnlistenFn> {
  return listen<ChatChunkPayload>('chat:chunk', (e) => handler(e.payload))
}

/** v0.4+ tool call 流式事件订阅
 *  - 每次 chunk 推一份 ToolCallPartial 列表（按 `index` 区分）
 *  - 同一 index 多次 chunk：id/name 在 start 才有，后续 None；arguments_delta 累加
 *  - 完整 tool call 形态：累积到 arguments 是合法 JSON 时（前端 `JSON.parse` 成功）
 *    视为"done"，入库用 [ToolCallInfo]（前端 AiChatPanel.vue 处理）
 *  - 详细见 [docs/AI_PANEL_DESIGN.md §3.3] */
export async function onChatToolCall(
  handler: (payload: ChatToolCallPayload) => void,
): Promise<UnlistenFn> {
  return listen<ChatToolCallPayload>('chat:tool_call', (e) => handler(e.payload))
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
