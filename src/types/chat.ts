// PlotCraft chat 类型
//
// v0.1 砍到 8 字段 / 8 mutation（反 Locus 35+ 卡顿）
// v0.2+ 加 4 字段 / 2 mutation 支持产品级 chat error feedback：
// - ChatMessage.partial: true → 标记"流到一半挂"的 assistant 回复（保留 currentText 不丢）
// - ChatErrorPayload.kind: 玩家文案分类（不直接暴露 OpenSSL/TLS 错误）
// - ChatErrorKind: 8 种错误分类（network/auth/model_not_found/...）
// v0.3+ ChatMessage.preset: 预设 chip 触发的 user 消息；user 气泡显示 label 而非 content
// v0.4+ tool calling：ChatMessage 加 tool_calls / tool_call_id；ChatToolCallPayload 事件
// 详细见 [CHAT_LLM_DESIGN.md §v0.2 章节] / [docs/AI_PANEL_DESIGN.md]

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

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

/** v0.4+ tool definition (OpenAI 协议级 tool 注入)
 *  - 注入到 LLM request 的 `tools` 字段
 *  - 关闭的 tool 不传 → LLM 完全不知道存在（用户硬要求）
 *  - 跨 OpenAI Chat Completions / OpenAI Responses 协议通用
 *  - Anthropic 协议由 Rust 端 build body 时转 `input_schema`
 *  - 详见 [docs/AI_PANEL_DESIGN.md §3.3 tool schema] */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    /** JSON Schema（OpenAI parameters 字段格式） */
    parameters: Record<string, unknown>
  }
}

/** v0.4+ 单个 tool call 信息（assistant message 带）
 *  - 流式累积：start 时 id + name 已知，arguments 后续累积
 *  - done 时 arguments 是完整 JSON 字符串
 *  - 跨 request 回放：tool_calls 字段必填，否则 LLM 不知道 tool_use 上下文
 */
export interface ToolCallInfo {
  /** 协议级 id（OpenAI: call_xxx / Anthropic: toolu_xxx），用于 tool result 关联 */
  id: string
  /** 调的工具名（ask_choose_option / update_doc_item / ask_free_text） */
  name: string
  /** 参数的 JSON 字符串（流式累积；done 时是合法 JSON） */
  arguments: string
}

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
  /** v0.3+ preset 触发的 user 消息：user 气泡显示 label 而非 content
   *  - 仅前端 UI 用，store send 前 strip（后端 ChatMessage 不加这个字段）
   *  - chip 点 = user 气泡 + label 短文本；LLM 收到的是 content（preset 的 prompt 全文）
   *  - AI 面板右栏的 chip 才有，session tab 的普通用户输入永远没这字段
   *  - 详细见 [docs/AI_PANEL_DESIGN.md §3.2]
   */
  preset?: string
  /** v0.3+ preset 的语义形态（前端 only，store send 前 strip；assistant message 也带，渲染分支用）
   *  - 'generate'：备选生成（assistant 走卡片组）
   *  - 'reflect'  ：反思/追问（assistant 走普通气泡 + 写入按钮 = append）
   *  - 'polish'   ：润色（assistant 走气泡 + 采用按钮 = replace）
   *  - 'expand'   ：扩展（assistant 走气泡 + 采用按钮 = replace）
   *  - 'calibrate'：v0.5+ 设计循环校准（assistant 走普通气泡，不写入编辑器，只是反思对话）*/
  action?: 'generate' | 'reflect' | 'polish' | 'expand' | 'calibrate'
  /** v0.3+ 自动重试标记（前端 only）
   *  - true → 这条 user msg 是 AI 面板自动重试生成的, 不是玩家手动触发
   *  - 用于 findChainOriginalIdx 找 chain 的原始 user msg (跳过 retry 标记的, 找到最早的)
   *  - store send 前 strip (后端 ChatMessage 不带这字段) */
  retry?: boolean
  /** v0.4+ assistant 消息的 tool_calls
   *  - 跨 request 回放必填（OpenAI 协议）
   *  - store send 前 strip 同 preset/retry 一样？——否，assistant 消息的 tool_calls 是要发后端的
   *    （用于让 LLM 看到 tool_use 上下文）
   *  - 前端 UI 也用：流式累积 tool call arguments，done 后渲染 AltCard
   */
  tool_calls?: ToolCallInfo[]
  /** v0.4+ tool 消息的 tool_call_id（关联到 assistant 消息的 tool_calls[].id）
   *  - role === 'tool' 时必填
   *  - store send 前保留（后端 ChatMessage 用这个字段关联 tool result 到 tool_use） */
  tool_call_id?: string
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

/** v0.4+ chat:tool_call event payload —— tool call 流式 partial
 *  - 按 `index` 区分多个并发 tool call
 *  - `id` / `name` 在 start chunk 给一次，后续 None
 *  - `arguments_delta` 是本 chunk 的增量（不是完整 arguments），前端按 index 累积
 *  - 流式渲染：收到 start 时建占位 → 累积 arguments → done 时尝试 JSON.parse 识别"完整"
 *    （前端 AiChatPanel.vue 处理；不在此类型层做）
 *  - 完整 tool call 形态参考 [ToolCallInfo]（done 后入库用） */
export interface ToolCallPartial {
  index: number
  id?: string | null
  name?: string | null
  arguments_delta: string
}

export interface ChatToolCallPayload {
  run_id: string
  calls: ToolCallPartial[]
}

/** v0.2+ chat:error event payload
 *  - `error`: 原始错误字符串（TLS / reqwest / HTTP body），玩家默认不直接看
 *  - `kind`: 错误分类（玩家文案 key）
 *  - v0.4.1+ 诊断字段：endpoint / model / api_format / request_body_preview
 *    玩家错误条 "复制诊断信息" 按钮一键打包给开发者，不用反复截图
 */
export interface ChatErrorPayload {
  run_id: string
  error: string
  kind: ChatErrorKind
  endpoint?: string
  model?: string
  api_format?: string
  request_body_preview?: string
}

/** v0.4.1+ 错误诊断包 —— store 派生给 AiChatPanel 错误条用
 *  - kind / errorRaw 已在 StepChatState 里独立暴露（玩家文案 + 折叠的 raw）
 *  - 这里只装 4 个 v0.4.1+ 诊断字段，给"复制诊断信息"按钮
 *  - 全部 optional：老 session / 老 backend 没有这 4 字段时不报错
 */
export interface ChatErrorDiag {
  endpoint: string
  model: string
  api_format: string
  request_body_preview: string
}
