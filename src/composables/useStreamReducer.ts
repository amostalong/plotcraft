// useStreamReducer —— chat state 状态机
//
// v0.1 8 字段 / 8 mutation（反 Locus 35+ 卡顿）
// v0.2+ 12 字段 / 10 mutation —— 加 4 字段 (errorKind / lastUserMessage / lastFailedRunId / lastErrorAt) + 2 mutation (retry / dismissError)
//
// 反 Locus 卡顿核心保留：
// - shallowRef 包 state（vs Locus 深 reactive 35 字段）
// - identity-stable array：appendChunk 只 append currentText，**不动 messages 数组引用**
// - 12 字段仍然远小于 Locus 35 字段（v0.1 是 8 → v0.2 是 12，增加 < 一倍）
//
// 详细见 [CHAT_LLM_DESIGN.md §3 反制 2] + [Locus useStreamReducer.ts:410-414 注释]
// v0.2+ 玩家文案策略：见 [lib/error-messages.ts]

import { shallowRef, type ShallowRef } from 'vue'

import type { ChatErrorKind, ChatMessage, ChatRole, ChatStatus } from '@/types/chat'

/** v0.2+ 12 字段 chat state
 *  v0.1 8 字段 + v0.2 加 4 字段 (errorKind / lastUserMessage / lastFailedRunId / lastErrorAt) */
export interface ChatState {
  sessionId: string | null
  status: ChatStatus
  messages: ChatMessage[]
  currentText: string
  currentRunId: string | null
  error: string | null
  startedAt: number | null
  lastEventAt: number | null
  // ── v0.2+ 新增字段 ──
  /** 错误分类（玩家文案 key），由后端 ChatErrorPayload.kind 给 */
  errorKind: ChatErrorKind | null
  /** 上次发的 user message（成功/失败都记）—— retryLast() 拿这个重发
   *  - sendMessage 时设
   *  - retryLast() 时清掉（避免无限重试同一句）
   *  - loadSession 时从 session schema 恢复（重启 app 不丢） */
  lastUserMessage: ChatMessage | null
  /** 上次失败 run 的 runId（关联 lastErrorAt 用）—— 给 transcript 错误条用 */
  lastFailedRunId: string | null
  /** 上次错误时间戳 —— 给 "X 秒前出错" 显示用 */
  lastErrorAt: number | null
}

/** v0.2+ 10 mutations
 *  v0.1 8 + v0.2 加 2 (retry / dismissError)
 *
 *  retry 不在这里调 start_chat —— store 层 retryLast() 调 addUserMessage + start
 *  2 个 mutation 组合，reducer 只负责更新 state
 */
export type StreamMutation =
  | { type: 'start'; sessionId: string; runId: string }
  | { type: 'appendChunk'; runId: string; text: string }
  | { type: 'complete'; runId: string; usage?: unknown }
  | { type: 'fail'; runId: string; error: string; kind?: ChatErrorKind }
  | { type: 'cancel'; runId: string }
  | { type: 'addUserMessage'; message: ChatMessage }
  | {
      type: 'loadSession'
      sessionId: string
      messages: ChatMessage[]
      /** v0.2+ 恢复 lastUserMessage（重启 app 不丢 retry 上下文） */
      lastUserMessage?: ChatMessage | null
    }
  | { type: 'clearSession' }
  // ── v0.2+ 新增 mutation ──
  | { type: 'retry'; message: ChatMessage }
  | { type: 'dismissError' }

const initial: ChatState = {
  sessionId: null,
  status: 'idle',
  messages: [],
  currentText: '',
  currentRunId: null,
  error: null,
  startedAt: null,
  lastEventAt: null,
  // ── v0.2+ default ──
  errorKind: null,
  lastUserMessage: null,
  lastFailedRunId: null,
  lastErrorAt: null,
}

export function createStreamReducer() {
  // shallowRef 包 state —— 大对象不深 reactive
  const state: ShallowRef<ChatState> = shallowRef({ ...initial })

  function reduce(m: StreamMutation) {
    const now = Date.now()
    const cur = state.value
    switch (m.type) {
      case 'start': {
        state.value = {
          ...cur,
          sessionId: m.sessionId,
          currentRunId: m.runId,
          status: 'streaming',
          currentText: '',
          // v0.2+ retry 时清掉错误状态（UI 反馈"重新在跑"）
          error: null,
          errorKind: null,
          lastFailedRunId: null,
          lastErrorAt: null,
          startedAt: now,
          lastEventAt: now,
        }
        return
      }
      case 'appendChunk': {
        if (cur.currentRunId !== m.runId) return
        state.value = {
          ...cur,
          currentText: cur.currentText + m.text,
          lastEventAt: now,
        }
        return
      }
      case 'complete': {
        if (cur.currentRunId !== m.runId) return
        const finalMessages = cur.currentText
          ? [...cur.messages, { role: 'assistant' as ChatRole, content: cur.currentText }]
          : cur.messages
        state.value = {
          ...cur,
          messages: finalMessages,
          currentText: '',
          currentRunId: null,
          status: 'idle',
          lastEventAt: now,
        }
        return
      }
      case 'fail': {
        if (cur.currentRunId !== m.runId) return
        // v0.2+ fail 行为改：保留 currentText 作为 partial assistant message
        // —— LLM 流到一半挂的情况，玩家至少能看到已经收到的部分
        // partial=true 触发 UI 末尾 "(回复中断)" marker
        const partial = cur.currentText
          ? ([
              ...cur.messages,
              { role: 'assistant' as ChatRole, content: cur.currentText, partial: true },
            ] as ChatMessage[])
          : cur.messages
        state.value = {
          ...cur,
          messages: partial,
          currentText: '',
          currentRunId: null,
          status: 'error',
          error: m.error,
          errorKind: m.kind ?? 'unknown',
          lastFailedRunId: m.runId,
          lastErrorAt: now,
        }
        return
      }
      case 'cancel': {
        if (cur.currentRunId !== m.runId) return
        // v0.2+ cancel 跟 complete 对齐：保留 currentText（player 主动 stop 也要看到
        // 已经收到的部分），用 partial=true 标记 "(已停止)"
        const cancelledMessages = cur.currentText
          ? ([
              ...cur.messages,
              { role: 'assistant' as ChatRole, content: cur.currentText, partial: true },
            ] as ChatMessage[])
          : cur.messages
        state.value = {
          ...cur,
          messages: cancelledMessages,
          currentText: '',
          currentRunId: null,
          status: 'cancelled',
          lastEventAt: now,
        }
        return
      }
      case 'addUserMessage': {
        // v0.2+ 同步存 lastUserMessage（成功路径也存——retry 用 lastUserMessage 重发）
        state.value = {
          ...cur,
          messages: [...cur.messages, m.message],
          lastUserMessage: m.message,
          lastEventAt: now,
        }
        return
      }
      case 'loadSession': {
        const base = m.sessionId === null ? initial : { ...initial, sessionId: m.sessionId }
        state.value = {
          ...base,
          sessionId: m.sessionId,
          messages: m.messages,
          // v0.2+ 恢复 lastUserMessage（fallback null —— 老 v0.1 session 没这个字段）
          lastUserMessage: m.lastUserMessage ?? null,
          lastEventAt: now,
        }
        return
      }
      case 'clearSession': {
        state.value = { ...initial, lastEventAt: now }
        return
      }
      // ── v0.2+ 新增 mutation ──
      case 'retry': {
        // store 调 retryLast() 流程：addUserMessage(retry msg) → start(sessionId, runId)
        //   这里 retry mutation 只确保消息入 messages + lastUserMessage 更新
        //   status 仍由后续 start mutation 切到 'streaming'
        // - state.error/errorKind 留给后续 start mutation 清（start 已经清了）
        state.value = {
          ...cur,
          messages: [...cur.messages, m.message],
          lastUserMessage: m.message,
          lastEventAt: now,
        }
        return
      }
      case 'dismissError': {
        // 玩家点 "X 关闭" 错误条 —— 清 error 状态，**不**清 lastUserMessage
        // （玩家可能想重输而不是 retry）
        state.value = {
          ...cur,
          status: 'idle',
          error: null,
          errorKind: null,
          lastEventAt: now,
        }
        return
      }
    }
  }

  function reset() {
    state.value = { ...initial }
  }

  return { state, reduce, reset }
}
