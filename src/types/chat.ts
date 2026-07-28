// PlotCraft v0.1 chat 类型（反 Locus 35 字段 -> 砍到 8 字段 / 8 mutation）
// 详细见 [CHAT_LLM_DESIGN.md §3 反制 2]

export type ChatRole = 'system' | 'user' | 'assistant'

export type ChatStatus = 'idle' | 'streaming' | 'error' | 'cancelled'

export interface ChatMessage {
  role: ChatRole
  content: string
}

// Tauri event payloads（Rust 端 serde 字段是 snake_case，保持原样）
export interface ChatChunkPayload {
  run_id: string
  text: string
}

export interface ChatDonePayload {
  run_id: string
  usage: unknown
}

export interface ChatErrorPayload {
  run_id: string
  error: string
}
