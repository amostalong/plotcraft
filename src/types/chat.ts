// PlotCraft v0.2 chat 类型
//
// v0.1 砍到 8 字段 / 8 mutation（反 Locus 35+ 卡顿）
// v0.2+ 加 4 字段 / 2 mutation 支持产品级 chat error feedback：
// - ChatMessage.partial: true → 标记"流到一半挂"的 assistant 回复（保留 currentText 不丢）
// - ChatErrorPayload.kind: 玩家文案分类（不直接暴露 OpenSSL/TLS 错误）
// - ChatErrorKind: 8 种错误分类（network/auth/model_not_found/...）
// 详细见 [CHAT_LLM_DESIGN.md §v0.2 章节]

export type ChatRole = 'system' | 'user' | 'assistant'

export type ChatStatus = 'idle' | 'streaming' | 'error' | 'cancelled'

/** v0.2+ chat 错误分类（镜像 Rust 端 `ChatErrorKind` snake_case）
 *
 *  玩家视角只看到 `kind` 对应的玩家文案（lib/error-messages.ts 出），
 *  原始 error 字符串（TLS handshake / reqwest ...）默认不直接给玩家看。
 */
export type ChatErrorKind =
  | 'network'
  | 'auth'
  | 'model_not_found'
  | 'bad_request'
  | 'rate_limit'
  | 'server_error'
  | 'stream_protocol'
  | 'unknown'

export interface ChatMessage {
  role: ChatRole
  content: string
  /** v0.2+ true → LLM 流到一半挂，partial 保留的 currentText
   *  - 渲染时末尾加 "(回复中断)" marker
   *  - UI 上区别于完整 assistant 回复（视觉上 fade-out 或 dashed border）
   *  - 后端 ChatMessage 加 `partial: Option<bool>` + `#[serde(default)]`，
   *    老 session 没这个字段也能反序列化
   */
  partial?: boolean
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

/** v0.2+ chat:error event payload
 *  - `error`: 原始错误字符串（TLS / reqwest / HTTP body），玩家默认不直接看
 *  - `kind`: 错误分类（玩家文案 key）
 */
export interface ChatErrorPayload {
  run_id: string
  error: string
  kind: ChatErrorKind
}
