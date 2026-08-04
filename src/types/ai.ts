// PlotCraft 通用 AI 面板类型（v0.3+ 重构）
//
// 背景：v0.2 的 StepChatPanel 跟 AlternativesPicker 是两个割裂的 widget，
// 备选和对话分离、step chat ephemeral 切步丢内容。v0.3+ 合成单 AiChatPanel：
// 备选走流式 chat + JSON parse 内联进消息；每步/节预设 chips 一键发送。
//
// 详细设计：见 [docs/AI_PANEL_DESIGN.md]

import type { ComputedRef } from 'vue'

import type { ChatErrorDiag, ChatErrorKind, ChatMessage } from '@/types/chat'

/** 预设动作（chip 一键发送）
 *  - label：chip 显示 + user 气泡显示（短，emoji + 几个字）
 *  - prompt：发给 LLM 的完整指令（玩家看不到全貌，hover chip 看 title）
 *  - action：preset 语义形态（决定 UI 渲染 + adopt mode + assistant 消息分类）
 *    - 'generate'：备选生成（>=2 项走卡片组 → 替换编辑器）
 *    - 'reflect'  ：反思/追问（普通气泡 → 写入编辑器 = 追加）
 *    - 'polish'   ：润色（气泡 → 「采用」= 替换编辑器）
 *    - 'expand'   ：扩展（气泡 → 「采用」= 替换编辑器）
 *    - 'calibrate'：v0.5+ 设计循环校准（普通气泡 → 不写入编辑器，只是反思提问）
 *      玩家点 stepper 黄点 ? 触发；UI 上不显示「采用」按钮，只当反思对话
 *
 *  v0.4+ 取消 `output: 'json' | 'markdown'` 字段：
 *  - 老逻辑 `output: 'json'` → 后端 `response_format: json_object` → LLM 返 JSON 字符串
 *  - v0.4+ 改走 tool calling（schema 本身就是协议级结构化约束，强制 LLM 调 `ask_user_question` tool）
 *  - `response_format` 跟 `tools` 在 OpenAI 协议里互斥，强制开 response_format 会让 LLM 忽略 tools
 *  - 渲染分支由 `msg.tool_calls` 决定（assistant-tool-question / -freetext / -update），
 *    不再由 `output` 字段决定
 */
export interface PresetAction {
  label: string
  prompt: string
  action: 'generate' | 'reflect' | 'polish' | 'expand' | 'calibrate'
  /** v0.4.4+ 玩家在 tool_call 待反应时（ask_choose_option AltCard / ask_free_text 输入框 / update_doc_item 写入确认），
   *  是否允许点这个 chip —— true = 不锁 chip（让 LLM 重新调 tool 出新备选，玩家可换思路），
   *                false（默认）= 锁 chip（会破坏协议 / 重置 LLM 流程）。
   *  玩家 2026-08-02 撞 deepseek "No tool output found" 后加：polish/expand/calibrate 标 true
   *  （让 LLM 重新输出接选项），generate/reflect 保持默认 false（不锁会重置 LLM 上下文）。 */
  allowDuringPending?: boolean
}

/** adopt 事件 payload（v0.3+ 单事件 + mode 派生）
 *  - text：备选 / 气泡的完整内容
 *  - mode：'replace' = 备选卡片「采用」（替换编辑器）；'append' = 气泡「写入编辑器」（追加到末尾）
 */
export interface AdoptPayload {
  text: string
  mode: 'replace' | 'append'
}

/** step chat 状态（v0.3+ Map 化 per-item）
 *
 * 组件只暴露当前 item 的派生 computed + actions；store 内部维护 Map<itemId, ...> 全集。
 * 切 item 自动切派生（按 store 内部 currentXxxId ref，view 同步更新）。
 *
 * 字段：
 *  - messages：当前 item 已完成对话（含 partial 标记的中断回复）
 *  - text：当前 item 流式累积中、未 done 的 assistant 回复
 *  - streaming：当前 item 是否在流
 *  - errorKind / errorRaw：当前 item 最后一次流式错误的分类 + 原始字符串
 *    （组件走 getErrorMessage 出玩家文案）
 *  - send(text, preset?)：发一条；preset 存在 → user 气泡用 label，且 LLM 收到 preset.prompt
 *    （不是 text —— chip 点时 text 是空，preset.prompt 才是真 prompt）
 *  - **v0.4+ sendToolResult(toolCallId, content)**：tool result 喂回 LLM
 *    - 玩家点 AltCard（ask_user_question 选 X）后调 → LLM 第二轮（可能调 update_doc_item）
 *    - 玩家点 update_doc_item "确认写入" 后调 → LLM 看到 tool result 是 "OK" → 走整体采用条
 *  - reset()：清**当前** item 的所有 chat 状态（UI「清空对话」按钮调）
 */
export interface StepChatState {
  messages: ComputedRef<ChatMessage[]>
  text: ComputedRef<string>
  streaming: ComputedRef<boolean>
  errorKind: ComputedRef<ChatErrorKind | null>
  errorRaw: ComputedRef<string | null>
  /** v0.4.1+ 错误诊断包（endpoint / model / api_format / request_body_preview）
   *  - 错误条 "复制诊断信息" 按钮一键打包给开发者，不用反复截图 */
  errorDiag: ComputedRef<ChatErrorDiag | null>
  send(text: string, preset?: PresetAction, isRetry?: boolean): Promise<void>
  /** v0.4+ tool result 喂回 LLM（多轮 tool calling 核心） */
  sendToolResult?(toolCallId: string, content: string): Promise<void>
  reset(): void
  // === v0.4.4.1+ ask_free_text 强制回复协议（UX 整合到 composer，1 round 1 ask_free_text 单问题版）===
  // **v0.4.4.1+ UX 整合到 composer**：REFLECT_TAIL 钉死 1 个问题（不编号多问），
  // 玩家在下方 composer 打字回车 → 走 sendAllAskFreeTextAnswers(playerText) 路径
  // （ask_free_text 强制回复协议保留：1 round 1 ask_free_text → 1 tool_result 配对，
  //   只是答案来源从"bubble 内嵌 N 个 input"改成"composer 1 个输入"）
  // 玩家 2026-08-03 反馈"上下一对输入框看着冗余"——v0.4.4+ 老设计拆 N 个 input + 锁 composer，
  // 现在简化为 1 个 input = composer，UX 跟普通聊天一致
  // - askFreeTextPending: 当前 item 待答的 ask_free_text（map，1 round 1 调用实际 0/1 entry）
  //   - AiChatPanel 据此显示 LLM 问的问题（气泡）+ composer placeholder 提示"回答「xxx」"
  // - sendAllAskFreeTextAnswers: 玩家在 composer 回车时调（onSend 路由），发 1 条 tool message 给 LLM
  // - v0.4.4.1+ 删了 askFreeTextAllAnswered / setAskFreeTextAnswer 字段（多问题版才用，单问题版不需要）
  /** v0.4.4+ 当前 item 的 ask_free_text pending（map，1 round 1 调用实际 0/1 entry）
   *  - v0.4.4.1+ AiChatPanel 据此显示 LLM 问的问题（气泡 + composer placeholder 提示） */
  askFreeTextPending?: ComputedRef<Map<string, { question: string; answer?: string }>>
  /** v0.4.4.1+ 玩家在 composer 回车时调（onSend 路由检测 ask_free_text pending）—— 1 条 function_call_output 喂回 LLM */
  sendAllAskFreeTextAnswers?(playerText?: string): Promise<void>
  // === v0.4.4+ 全 tool 通用 pending（ask_choose_option / ask_user_question / update_doc_item 都在等玩家反应时锁 composer）===
  // - pendingToolCalls: 当前 item 所有等待玩家 tool_result 的 tool_call id 集合
  //   - LLM 调 tool 时 add（onChatDone 扫 tool_calls）
  //   - 玩家反应时 remove（sendToolResult / sendAllAskFreeTextAnswers 内部）
  //   - 玩家"放弃"时 remove（cancelPendingToolCall 内部）
  // - cancelPendingToolCall: 玩家点"放弃备选"按钮 → 1 条 tool_result 喂回 LLM（"玩家放弃，自己写"）
  //   - 不破坏协议（仍然 1 round 1 tool_result 配对）
  //   - LLM 知道玩家不要备选，可以出 text 引导 / 调 update_doc_item 跟玩家的写
  /** v0.4.4+ 当前 item 所有等待玩家反应的 tool_call id 集合（ask_choose_option / ask_user_question / update_doc_item 通用）—— AiChatPanel 据此锁 composer */
  pendingToolCalls?: ComputedRef<Set<string>>
  /** v0.4.4+ 玩家点"放弃备选"按钮时调 —— 1 条 function_call_output 喂回 LLM（reason 默认 "玩家放弃这个备选"）
   *  - **v0.4.4+ silently 模式**：options.silently=true 时**不告诉 LLM**——
   *    清 chatHistories 里 assistant message 的 tool_calls 字段，LLM 看不到 tool_call，
   *    stop 在这里（玩家"放弃直接 stop"语义，LLM 下次 send 时无 tool_call 要配对） */
  cancelPendingToolCall?(
    toolCallId: string,
    reason?: string,
    options?: { silently?: boolean },
  ): Promise<void>
}
