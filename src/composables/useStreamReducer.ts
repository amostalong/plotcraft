// useStreamReducer —— 简化版 chat state 状态机
//
// 反 Locus 卡顿核心：
// - 8 字段 / 8 mutation（vs Locus 35+ 字段 / 35+ mutation）
// - identity-stable array：appendChunk 只 append currentText，**不动 messages 数组引用**
// - shallowRef 包 state（vs Locus 深 reactive 35 字段）
// - 详细见 [CHAT_LLM_DESIGN.md §3 反制 2] + [Locus useStreamReducer.ts:410-414 注释]

import { shallowRef, type ShallowRef } from 'vue'

import type { ChatMessage, ChatRole, ChatStatus } from '@/types/chat'

/** 8 字段 chat state */
export interface ChatState {
  sessionId: string | null
  status: ChatStatus
  messages: ChatMessage[]
  currentText: string
  currentRunId: string | null
  error: string | null
  startedAt: number | null
  lastEventAt: number | null
}

/** 8 mutations */
export type StreamMutation =
  | { type: 'start'; sessionId: string; runId: string }
  | { type: 'appendChunk'; runId: string; text: string }
  | { type: 'complete'; runId: string; usage?: unknown }
  | { type: 'fail'; runId: string; error: string }
  | { type: 'cancel'; runId: string }
  | { type: 'addUserMessage'; message: ChatMessage }
  | { type: 'loadSession'; sessionId: string; messages: ChatMessage[] }
  | { type: 'clearSession' }

const initial: ChatState = {
  sessionId: null,
  status: 'idle',
  messages: [],
  currentText: '',
  currentRunId: null,
  error: null,
  startedAt: null,
  lastEventAt: null,
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
          error: null,
          startedAt: now,
          lastEventAt: now,
        }
        return
      }
      case 'appendChunk': {
        // 关键 trick：只 append currentText，**不动 messages 数组引用**
        // （学 Locus useStreamReducer.ts:410-414，但砍掉 thinking/tool 全套）
        if (cur.currentRunId !== m.runId) return // ignore stale chunks
        state.value = {
          ...cur,
          currentText: cur.currentText + m.text,
          lastEventAt: now,
        }
        return
      }
      case 'complete': {
        if (cur.currentRunId !== m.runId) return
        // 把 currentText 推入 messages（一次性），然后清空
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
        state.value = {
          ...cur,
          status: 'error',
          error: m.error,
          currentRunId: null,
          lastEventAt: now,
        }
        return
      }
      case 'cancel': {
        if (cur.currentRunId !== m.runId) return
        // cancel 保留已流的部分作为 assistant message
        const cancelledMessages = cur.currentText
          ? [...cur.messages, { role: 'assistant' as ChatRole, content: cur.currentText }]
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
        state.value = {
          ...cur,
          messages: [...cur.messages, m.message],
          lastEventAt: now,
        }
        return
      }
      case 'loadSession': {
        // v0.1.5+ fix spread precedence：之前 `{...m.sessionId === null ? a : b}` 缺括号
        // runtime 会展开 `...m.sessionId` 当 spread operand（operator precedence bug）
        const base = m.sessionId === null ? initial : { ...initial, sessionId: m.sessionId }
        state.value = {
          ...base,
          sessionId: m.sessionId,
          messages: m.messages,
          lastEventAt: now,
        }
        return
      }
      case 'clearSession': {
        state.value = { ...initial, lastEventAt: now }
        return
      }
    }
  }

  function reset() {
    state.value = { ...initial }
  }

  return { state, reduce, reset }
}
