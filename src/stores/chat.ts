// chat pinia store —— 包装 useStreamReducer + LLM client + Tauri event 订阅

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'

import { createStreamReducer } from '@/composables/useStreamReducer'
import {
  startChat as rpcStartChat,
  cancelChat as rpcCancelChat,
  onChatChunk,
  onChatDone,
  onChatError,
} from '@/lib/llm'
import type { ChatMessage } from '@/types/chat'

const SYSTEM_PROMPT =
  '你是 PlotCraft —— 一个帮玩家设计 RPG / VN 世界观、人物、剧情的 AI 编剧搭档。' +
  '核心原则：玩家主导，AI 辅助。AI 给建议，玩家挑+改，AI 永远不自动覆盖玩家内容。' +
  '共创模式：每步给 3-5 个备选让玩家挑。' +
  '保持项目文件夹结构：world/ characters/ plot/ art/ sessions/。' +
  '输出 markdown 格式，每个文件带 frontmatter 元信息。'

export const useChatStore = defineStore('chat', () => {
  const { state, reduce, reset } = createStreamReducer()
  const unlistenFns = ref<UnlistenFn[]>([])
  let initialized = false

  async function init() {
    if (initialized) return
    initialized = true

    unlistenFns.value.push(
      await onChatChunk((payload) => {
        reduce({ type: 'appendChunk', runId: payload.run_id, text: payload.text })
      }),
    )
    unlistenFns.value.push(
      await onChatDone((payload) => {
        reduce({ type: 'complete', runId: payload.run_id, usage: payload.usage })
      }),
    )
    unlistenFns.value.push(
      await onChatError((payload) => {
        reduce({ type: 'fail', runId: payload.run_id, error: payload.error })
      }),
    )
  }

  function teardown() {
    unlistenFns.value.forEach((fn) => fn())
    unlistenFns.value = []
    initialized = false
  }

  async function sendMessage(content: string) {
    const text = content.trim()
    if (!text) return

    // 1. user message 入 messages
    const userMsg: ChatMessage = { role: 'user', content: text }
    reduce({ type: 'addUserMessage', message: userMsg })

    // 2. 调 start_chat 拿 run_id
    const sessionId = state.value.sessionId ?? 'default'
    const runId = await rpcStartChat([
      { role: 'system', content: SYSTEM_PROMPT },
      ...state.value.messages,
    ])

    // 3. start mutation（启动流式）
    reduce({ type: 'start', sessionId, runId })
  }

  async function stopCurrent() {
    if (state.value.currentRunId) {
      const runId = state.value.currentRunId
      try {
        await rpcCancelChat(runId)
      } catch (e) {
        // ignore — cancel 失败也强制本地 cancel
        console.error('cancel_chat failed:', e)
      }
      reduce({ type: 'cancel', runId })
    }
  }

  function clear() {
    reset()
  }

  return { state, init, teardown, sendMessage, stopCurrent, clear }
})
