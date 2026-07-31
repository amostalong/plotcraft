// chat pinia store —— 包装 useStreamReducer + LLM client + Tauri event 订阅
//
// v0.1+ 跟 Locus 对齐：session-level model + effort 选择
// v0.1.5+：chat session messages 持久化
// v0.2+：chat error feedback 产品级（1-5 全做）
// v0.2+：多 session —— 左侧 session list + 切换 / 创建 / 删除 / 改名
//   - 后端存 sessions/_index.json + sessions/<id>.json
//   - 第一次启动时 v0.1 legacy default.json 自动迁移成 id="default" 的 session
//   - 启动时拉 session 列表 + 玩家上次 active 的 session（localStorage 记）
//   - 切 session 时 loadSession(id) + replace state.messages + lastUserMessage
//   - save 时 debounce 1s 写到 active session
// v0.2+：init / teardown 跟 view 生命周期解耦
//   - 之前 listener 绑在 SessionView.onMounted/onUnmounted 上，切 tab → teardown 解绑
//     → 切走期间 stream chunks 全丢 → 切回时 init 又 loadSession 把 currentText 清空
//   - 修法：teardown() 改 no-op，listener 永久在 store 上；init() 真幂等
//     （teardown 不再清 initialized），切走期间 stream 继续跑、chunks 继续累积
//   - 唯一成本：用户切到别的 view 时，chat 仍在累积 currentText，UI 看不到（但 state 是对的）
// v0.3+：宪法注入 —— sendMessage/retryLast 拼 messages 前现读当前项目 concept/ 摘要，
//   非空则 append 到 SYSTEM_PROMPT（buildSystemPrompt）；读取失败不阻塞发消息
// v0.5+：方法论索引注入 —— METHODS_HINT 始终 append 到 SYSTEM_PROMPT 末尾，
//   让 LLM 在玩家卡住时自动引用对应方法论（McKee/Fullerton/Playcentric 等）。
//   玩家主导，非强规则；LLM 不主动推销，只在玩家明显卡住时引用

import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'

import { createStreamReducer } from '@/composables/useStreamReducer'
import {
  startChat as rpcStartChat,
  cancelChat as rpcCancelChat,
  onChatChunk,
  onChatDone,
  onChatError,
  listSessions as rpcListSessions,
  createSession as rpcCreateSession,
  deleteSession as rpcDeleteSession,
  renameSession as rpcRenameSession,
  loadSession,
  saveSession,
  type SessionMeta,
  type SessionFileV2,
} from '@/lib/llm'
import { DEFAULT_EFFORT, type EffortLevel } from '@/lib/settings'
import { getConceptSummary } from '@/lib/concept'
import type { ChatMessage } from '@/types/chat'
import { useProjectStore } from './project'
import { useSettingsStore } from './settings'

const SYSTEM_PROMPT =
  '你是 PlotCraft —— 一个帮玩家设计 RPG / VN 世界观、人物、剧情的 AI 编剧搭档。' +
  '核心原则：玩家主导，AI 辅助。AI 给建议，玩家挑+改，AI 永远不自动覆盖玩家内容。' +
  '共创模式：每步给 3-5 个备选让玩家挑。' +
  '保持项目文件夹结构：world/ characters/ plot/ art/ sessions/。' +
  '**严格遵循用户消息中指定的输出格式**：\n' +
  '- 如果用户要求 JSON 数组 → 第一个字符必须是 `[`，**不要**任何额外文字/preamble/思考/解释\n' +
  '- 如果用户没指定 → 输出 markdown 格式，每个文件带 frontmatter 元信息。'

/** v0.5+ 方法论索引：让 LLM 在玩家卡住时自动引用对应方法论。
 *  始终注入（不只在概念设计 chat），对人物/剧情/设定图等场景同样适用。
 *  ~200 中文字符 ≈ 150-200 tokens / 每次 chat 调用的固定开销。
 *  完整设计见 `docs/CONCEPT_REDESIGN_PLAN.md §13`。 */
const METHODS_HINT =
  '[可选方法论索引 — 玩家主导，非强规则]\n' +
  '- 立意卡住 → McKee controlling idea（1 句价值走向，如"正义必胜"或"纯真会失去"）\n' +
  '- 设计卡住 → Fullerton Iterative（概念→原型→测试→修订，先粗糙再迭代）\n' +
  '- 不知道缺什么 → Fullerton 戏剧元素清单（玩家/目标/冲突/输入/边界/反馈/输出/控制）\n' +
  '- 不知道故事类型 → McKee 故事三角（经典/最小主义/反结构，对应不同美学）\n' +
  '- 玩家要 AI 替写完整内容 → 违反 Playcentric，必须指出"我不替玩家写完整版"\n' +
  '- 玩家做沙盒/涌现式游戏 → 跳过 L6 三幕；只设计 L1-L5 物理规则\n' +
  '这些是参考方法，玩家可弃用。你（AI）不主动推销方法论，' +
  '只在玩家明显卡住 / 表达困惑时引用对应方法。'

/** v0.3+ 宪法注入：当前项目有概念内容（concept/ 目录 status != empty 的步骤）→
 *  append 到 SYSTEM_PROMPT，让 chat 生成内容跟概念保持一致。
 *  每次 send 现读（6 个小文件，亚毫秒级），不做缓存 —— 玩家刚改完概念立即生效。
 *  读取失败只 console.error，不阻塞发消息。 */
async function buildSystemPrompt(): Promise<string> {
  const project = useProjectStore()
  let base = SYSTEM_PROMPT
  if (project.current) {
    try {
      const summary = await getConceptSummary(project.current.folder)
      if (summary.trim()) {
        base = base + '\n\n## 当前项目概念（宪法，生成内容必须与之保持一致）\n' + summary
      }
    } catch (e) {
      console.error('[chat.buildSystemPrompt] getConceptSummary failed:', e)
    }
  }
  // v0.5+ 方法论索引：始终拼接，让 LLM 在玩家卡住时自动引用对应方法论
  return base + '\n\n' + METHODS_HINT
}

/** v0.2+ 玩家上次 active session id —— 用 localStorage 持久化（重启 app 保留） */
const ACTIVE_SESSION_KEY = 'plotcraft.chat.activeSessionId'

export const useChatStore = defineStore('chat', () => {
  const { state, reduce, reset } = createStreamReducer()
  const unlistenFns = ref<UnlistenFn[]>([])
  let initialized = false

  // === v0.1+ session-level model + effort (跟 Locus `selectedModel` / `thinkingLevel` 同位) ===
  const selectedModel = ref<string>('')
  const selectedEffort = ref<EffortLevel>(DEFAULT_EFFORT)

  // === v0.2+ 多 session ===
  /** 全部 session metadata 列表（按 updated_at 倒序） */
  const sessions = ref<SessionMeta[]>([])
  /** 当前 active session id —— chat 状态关联的 session */
  const currentSessionId = ref<string | null>(null)
  /** session 列表加载状态（首次 init 还没拉完时为 true） */
  const sessionsLoading = ref(false)

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

        const customProviders = settings.config.customProviders ?? []
        const persisted = settings.config.model?.trim() || ''

        let resolved = ''
        if (persisted) {
          const match = customProviders.find((p) => {
            if (!p.enabled) return false
            const def = p.defaultModel?.trim() || p.models?.[0]?.id?.trim() || ''
            return def === persisted
          })
          if (match) resolved = persisted
        }

        if (!resolved) {
          const fallback = customProviders.find((p) => {
            if (!p.enabled) return false
            return (p.defaultModel?.trim() || p.models?.[0]?.id?.trim() || '') !== ''
          })
          if (fallback) {
            resolved = fallback.defaultModel?.trim() || fallback.models![0].id.trim()
          }
        }

        selectedModel.value = resolved

        selectedEffort.value = settings.config.effort ?? DEFAULT_EFFORT
      } catch (e) {
        console.error('[chat.init] failed to load default model from settings:', e)
      }
    }

    // v0.2+ 多 session 初始化：拉 session 列表 + 选/建 active session
    sessionsLoading.value = true
    try {
      sessions.value = await rpcListSessions()
      console.log(`[chat.init] loaded ${sessions.value.length} sessions`)
    } catch (e) {
      console.error('[chat.init] failed to list sessions:', e)
    } finally {
      sessionsLoading.value = false
    }

    // 选 active session：优先 localStorage 记忆，否则取 sessions[0]（最新），否则建新
    const persistedActive = localStorage.getItem(ACTIVE_SESSION_KEY)
    let activeId: string | null = null
    if (persistedActive && sessions.value.some((s) => s.id === persistedActive)) {
      activeId = persistedActive
    } else if (sessions.value.length > 0) {
      activeId = sessions.value[0].id
    } else {
      // 没有任何 session → 建一个 "New Chat"
      try {
        const newSession = await rpcCreateSession('New Chat')
        sessions.value = [newSession]
        activeId = newSession.id
        console.log(`[chat.init] created default session: ${newSession.id}`)
      } catch (e) {
        console.error('[chat.init] failed to create default session:', e)
      }
    }
    if (activeId) {
      await switchSession(activeId)
      // 持久化 active session id
      try {
        localStorage.setItem(ACTIVE_SESSION_KEY, activeId)
      } catch (e) {
        console.error('[chat.init] failed to persist activeSessionId:', e)
      }
    }

    watch(
      [selectedModel, selectedEffort],
      ([m, e]) => {
        if (!m) return
        persistToSettings(m, e)
      },
      { flush: 'post' },
    )

    // v0.1.5+ 监听 messages 变化 → debounce 1s 写盘
    // v0.2+ 升级：saveSession 接 id 参数，写到 currentSessionId 对应文件
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    watch(
      [() => state.value.messages, () => state.value.lastUserMessage, currentSessionId],
      ([msgs, lastUserMsg, sid]) => {
        if (!sid) return // 没 active session 不写
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
          const payload: SessionFileV2 = {
            version: 2,
            updated_at: new Date().toISOString(),
            messages: msgs,
            last_user_message: lastUserMsg,
          }
          saveSession(sid, payload).catch((e) => {
            console.error('[chat] saveSession failed:', e)
          })
        }, 1000)
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
        reduce({
          type: 'fail',
          runId: payload.run_id,
          error: payload.error,
          kind: payload.kind,
        })
      }),
    )
  }

  function teardown() {
    // v0.2+：no-op。listener 跟 view 生命周期解绑，永久留在 store 上。
    // 切走 SessionView 时不解绑 → 切走期间 stream 继续 emit → 切回时看到完整 currentText
    // 保留函数签名给 v0.3+ app-level teardown 留口（关 app 时再真清理 unlisten + saveTimer）
  }

  // === v0.2+ session 切换/创建/删除/改名 ===

  /** 切到指定 session —— 加载 messages + 更新 activeSessionId + 持久化 */
  async function switchSession(id: string) {
    console.log('[chat.switchSession] id:', id)
    try {
      const file = await loadSession(id)
      reduce({
        type: 'loadSession',
        sessionId: id,
        messages: file.messages,
        lastUserMessage: file.last_user_message,
      })
      currentSessionId.value = id
      try {
        localStorage.setItem(ACTIVE_SESSION_KEY, id)
      } catch (e) {
        console.error('[chat.switchSession] failed to persist:', e)
      }
    } catch (e) {
      console.error('[chat.switchSession] failed:', e)
      throw e
    }
  }

  /** 创建新 session —— 后端写空 session + 切换过去 */
  async function createNewSession(title: string = 'New Chat'): Promise<SessionMeta> {
    console.log('[chat.createNewSession] title:', title)
    const newSession = await rpcCreateSession(title)
    sessions.value = [newSession, ...sessions.value]
    await switchSession(newSession.id)
    return newSession
  }

  /** 删除 session —— 后端删文件 + 从 sessions 列表移除 + 切到第一个剩余 session */
  async function deleteSessionById(id: string) {
    console.log('[chat.deleteSessionById] id:', id)
    await rpcDeleteSession(id)
    sessions.value = sessions.value.filter((s) => s.id !== id)
    if (currentSessionId.value === id) {
      // 切到列表第一个；如果没剩余，建新 session
      if (sessions.value.length > 0) {
        await switchSession(sessions.value[0].id)
      } else {
        await createNewSession('New Chat')
      }
    }
  }

  /** 改名 —— 后端改 _index.json + 更新 sessions 列表 */
  async function renameSessionById(id: string, newTitle: string) {
    console.log('[chat.renameSessionById] id:', id, 'newTitle:', newTitle)
    const updated = await rpcRenameSession(id, newTitle)
    sessions.value = sessions.value.map((s) => (s.id === id ? updated : s))
  }

  // === sendMessage / retryLast / stopCurrent / dismissError（v0.2+）===

  async function sendMessage(content: string) {
    const text = content.trim()
    if (!text) return
    console.log('[chat.sendMessage] starting, text length:', text.length)

    const userMsg: ChatMessage = { role: 'user', content: text }
    reduce({ type: 'addUserMessage', message: userMsg })
    console.log('[chat.sendMessage] addUserMessage done, messages count:', state.value.messages.length)

    const sessionId = state.value.sessionId ?? 'default'
    // v0.3+ 宪法注入：拼 messages 前现读 concept 摘要（失败不阻塞）
    const systemPrompt = await buildSystemPrompt()
    let runId: string
    try {
      console.log('[chat.sendMessage] calling rpcStartChat, model:', selectedModel.value, 'effort:', selectedEffort.value)
      runId = await rpcStartChat(
        [
          { role: 'system', content: systemPrompt },
          ...state.value.messages,
        ],
        {
          model: selectedModel.value || null,
          effort: selectedEffort.value,
        },
      )
      console.log('[chat.sendMessage] rpcStartChat returned run_id:', runId)
    } catch (e) {
      console.error('[chat.sendMessage] rpcStartChat FAILED:', e)
      throw e
    }

    reduce({ type: 'start', sessionId, runId })
    console.log('[chat.sendMessage] start mutation done, status:', state.value.status, 'currentRunId:', state.value.currentRunId)
  }

  async function retryLast() {
    const last = state.value.lastUserMessage
    if (!last) {
      console.warn('[chat.retryLast] no lastUserMessage to retry')
      return
    }
    console.log('[chat.retryLast] retrying, content length:', last.content.length)
    reduce({ type: 'retry', message: last })
    const sessionId = state.value.sessionId ?? 'default'
    // v0.3+ 宪法注入：retry 跟 sendMessage 走同一份 system prompt
    const systemPrompt = await buildSystemPrompt()
    try {
      const runId = await rpcStartChat(
        [
          { role: 'system', content: systemPrompt },
          ...state.value.messages,
        ],
        {
          model: selectedModel.value || null,
          effort: selectedEffort.value,
        },
      )
      console.log('[chat.retryLast] rpcStartChat returned run_id:', runId)
      reduce({ type: 'start', sessionId, runId })
    } catch (e) {
      console.error('[chat.retryLast] rpcStartChat FAILED:', e)
      throw e
    }
  }

  function dismissError() {
    reduce({ type: 'dismissError' })
  }

  async function stopCurrent() {
    if (state.value.currentRunId) {
      const runId = state.value.currentRunId
      try {
        await rpcCancelChat(runId)
      } catch (e) {
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
    sessions,
    currentSessionId,
    sessionsLoading,
    init,
    teardown,
    sendMessage,
    retryLast,
    dismissError,
    stopCurrent,
    clear,
    switchSession,
    createNewSession,
    deleteSessionById,
    renameSessionById,
  }
})
