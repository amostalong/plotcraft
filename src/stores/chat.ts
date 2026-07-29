// chat pinia store —— 包装 useStreamReducer + LLM client + Tauri event 订阅
//
// v0.1+ 跟 Locus 对齐：session-level model + effort 选择
// - 启动 init() 时从 settings.config 读 model / effort 作为默认
// - chat 期间玩家改 selectedModel / selectedEffort → 同步写 settings.config.{model,effort} + save
//   （v0.1.2 之前只在内存里存，关闭 app 丢 —— 现在持久化）
// - v0.1.2+：Locus 风格 "Use provider" 切换也走 settings.config.base_url/apiKey/apiFormat 持久化
//
// v0.1.3+：chat selector 不再自动展示 BUILTIN_MODELS —— selectedModel 必须从
// customProviders 解析。init 时的 fallback 规则：
// 1. config.model 非空 + 匹配某 custom provider 的 effective defaultModel → 用它
// 2. 否则回退到第一个 enabled + 有 effective defaultModel 的 custom provider
// 3. 否则空串（0 provider → trigger "Select model" placeholder + send disabled）

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'

import { createStreamReducer } from '@/composables/useStreamReducer'
import {
  startChat as rpcStartChat,
  cancelChat as rpcCancelChat,
  onChatChunk,
  onChatDone,
  onChatError,
} from '@/lib/llm'
import { DEFAULT_EFFORT, type EffortLevel } from '@/lib/settings'
import type { ChatMessage } from '@/types/chat'
import { useSettingsStore } from './settings'

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

  // === v0.1+ session-level model + effort (跟 Locus `selectedModel` / `thinkingLevel` 同位) ===
  // 玩家切到 SessionView 时 init() 会从 settings.config 读默认
  // 切走再切回时仍保留玩家改的值（不重置，符合 chat session 语义）
  // 改这两个值时同步写 settings.config.{model,effort} + save → 关闭 app 不丢
  const selectedModel = ref<string>('')
  const selectedEffort = ref<EffortLevel>(DEFAULT_EFFORT)

  /** v0.1+ 写 settings 辅助：失败只 console.error，不阻塞 UI */
  async function persistToSettings(model: string, effort: EffortLevel) {
    try {
      const settings = useSettingsStore()
      if (!settings.loaded) await settings.init()
      if (settings.config.model !== model) settings.config.model = model
      if (settings.config.effort !== effort) settings.config.effort = effort
      await settings.save()
    } catch (e) {
      console.error('[chat.persistToSettings] save failed:', e)
    }
  }

  async function init() {
    if (initialized) return
    initialized = true

    // 默认从 settings 拉（第一次进 chat 时）
    if (!selectedModel.value) {
      try {
        const settings = useSettingsStore()
        if (!settings.loaded) await settings.init()

        // v0.1.3+ model 解析：必须能匹配一个 custom provider 才用，否则回退
        const customProviders = settings.config.customProviders ?? []
        const persisted = settings.config.model?.trim() || ''

        // 1. config.model 匹配某 provider 的 effective defaultModel → 用它（玩家手动选过的）
        let resolved = ''
        if (persisted) {
          const match = customProviders.find((p) => {
            if (!p.enabled) return false
            const def = p.defaultModel?.trim() || p.models?.[0]?.id?.trim() || ''
            return def === persisted
          })
          if (match) resolved = persisted
        }

        // 2. 回退到第一个 enabled + 有 effective defaultModel 的 custom provider
        if (!resolved) {
          const fallback = customProviders.find((p) => {
            if (!p.enabled) return false
            return (p.defaultModel?.trim() || p.models?.[0]?.id?.trim() || '') !== ''
          })
          if (fallback) {
            resolved = fallback.defaultModel?.trim() || fallback.models![0].id.trim()
          }
        }

        // 3. 0 provider → 空串（trigger 显示 "Select model" placeholder + send disabled）
        selectedModel.value = resolved

        // v0.1.3+ effort 持久化：玩家保存的 effort 直接用，custom model 不知道 default effort，
        // 回退到 DEFAULT_EFFORT（"none"）让玩家自己选
        selectedEffort.value = settings.config.effort ?? DEFAULT_EFFORT
      } catch (e) {
        // 读不到 → 留空，让 SessionView UI 自己处理
        console.error('[chat.init] failed to load default model from settings:', e)
      }
    }

    // 监听 selectedModel / selectedEffort 变化 → 持久化到 settings.config
    // （不写回时只在内存里，关闭 app 丢 —— v0.1.2 修复）
    watch(
      [selectedModel, selectedEffort],
      ([m, e]) => {
        if (!m) return
        persistToSettings(m, e)
      },
      { flush: 'post' },
    )

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

    // 2. 调 start_chat 拿 run_id（带 model + effort 选项）
    const sessionId = state.value.sessionId ?? 'default'
    const runId = await rpcStartChat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        ...state.value.messages,
      ],
      {
        model: selectedModel.value || null,
        effort: selectedEffort.value,
      },
    )

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

  return {
    state,
    selectedModel,
    selectedEffort,
    init,
    teardown,
    sendMessage,
    stopCurrent,
    clear,
  }
})
