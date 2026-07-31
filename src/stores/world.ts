// world pinia store —— 世界设定（5 个固定分节）+ LLM 辅助
//
// 照搬 concept store 形状（对齐 AGENTS.md 惯例）：
// - docs 用 shallowRef 包（反卡顿惯例：大列表不深 reactive）
// - load() 依赖 useProjectStore().current：无项目 → 清空不报错
// - 无 status 状态机（那是概念漏斗的语义），左栏状态点只看 exists
// - 不做文件监听：玩家手改 world/ 后点"刷新"重扫
//
// step chat（v0.3+ 重构：per-item Map 化 + 备选内联化 + 自动落盘，对称 concept store）
// - 复用流式 start_chat，store 级 listener 按 runId 过滤（init 幂等）
// - 状态从 per-item Map<docId, ...> 派生，currentDocId 切节自动切派生
// - 切节保留历史（v0.3+ 内存 per-item）；切项目 flush 老项目 + 清内存 + load 新项目
// - 备选走流式 chat + JSON parse，删 v0.2 的 generateAlternatives
// - **自动落盘**（v0.3+ 玩家反馈"想保留"）：watch chatHistories → debounce 1s → saveChat
//   位置 <项目>/.chats/world/<docId>.json（详见 [docs/AI_PANEL_DESIGN.md]）
//
// 详细设计见 [docs/AI_PANEL_DESIGN.md]

import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef, triggerRef, watch, type Ref } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'

import { resolveEnabledTools } from '@/lib/ai-tools'
import { deleteChat, deleteAllChats, loadChats, makeItemKey, saveChat, type ChatFile } from '@/lib/chats'
import { getConceptSummary } from '@/lib/concept'
import { getDocsSummary, listDocs, saveDoc } from '@/lib/docs'
import { resolveLlmConnection } from '@/lib/llm-connection'
import {
  onChatChunk,
  onChatDone,
  onChatError,
  onChatToolCall,
  startChat as rpcStartChat,
} from '@/lib/llm'
import type { PresetAction, StepChatState } from '@/types/ai'
import type { ChatErrorKind, ChatMessage, ToolCallInfo, ToolCallPartial } from '@/types/chat'
import { WORLD_COLLECTION, type DocEntry } from '@/types/world'
import { useProjectStore } from './project'
import { useSettingsStore } from './settings'

// === 5 节静态定义（hint = 写作引导语，编辑区显示 + 拼 LLM prompt 的说明部分） ===

export const SECTION_HINTS: Record<string, string> = {
  overview: '一段话讲完这个世界 —— 玩家会感受到什么，不是百科条目',
  geography: '写对故事有用的地点 —— 每个地点带它提供的舞台 / 冲突',
  history: '只写对现在还有影响的历史 —— 每条带它造成了今天的什么',
  'magic-system': '规则必须有代价 / 限制 —— 写不出代价的能力是可疑的',
  factions: '每个阵营想要什么、跟谁的什么冲突 —— 阵营是冲突的发动机',
}

// === Preset 共享片段 ===

/** v0.3+ preset 都拼这段尾巴 —— v0.4+ 改走 tool calling 后的兜底
 *  - v0.4+ 主路径：LLM 收到 tools schema（`ask_user_question` / `update_doc_item`）→
 *    schema 强制 LLM 调 tool 返结构化数据（AltCard / 确认按钮）
 *  - 本段 prompt 是**兜底**：万一 LLM 不调 tool，prompt 仍约束 content 字段返
 *    "JSON 数组"形态（前端 v0.3+ parseAlternatives 已删，v0.4+ 直接当 markdown bubble
 *    显示，但 LLM 至少返稳定形态而非自由发挥）
 *  - v0.3+ 强化: **第一个字符必须是 `[`, 最后一个必须是 `]`** —— 之前 LLM 会加
 *    "让我分析一下" / 思考过程 / 多版本混排 等, 前端 fallback 按 \n\n 切段造假 cards
 *  - v0.3+ 防御：流式开始那一刻 system prompt 固定，过程中玩家改编辑器 chat 不会重发，
 *    显式告诉 LLM "以最新内容为准"（虽然 system 已注入"当前「X」已有内容"，这是双保险） */
const JSON_TAIL =
  '**优先用 ask_user_question tool 提问**：每项 option 是 1 个备选，label 10 字内，preview 是完整内容。\n' +
  '**如果 LLM 不调 tool，content 字段严格 JSON 数组**（第一个 `[`、最后一个 `]`，3-5 项）。\n' +
  '**禁止**输出任何额外文字、preamble、思考过程、解释、markdown 代码围栏。\n' +
  '**禁止**说"好的"、"让我分析一下"、"以下是"、"方案 1"等任何人类语言前缀。\n' +
  '基于当前节最新内容回答。'

/** 反思/追问类 preset 通用尾巴（v0.4+ 走 ask_free_text tool，prompt 兜底走 markdown）
 *  - 玩家主导：只给追问，玩家自己答，绝不替玩家做决定 */
const REFLECT_TAIL =
  '玩家主导：你只给备选/追问，玩家挑+改，绝不替玩家做决定。' +
  '基于当前节最新内容回答。'

/** 润色 / 扩展 类 preset 通用指令（v0.3+ 改成"出 3-5 个不同方向的备选"）
 *  - v0.3 早期是"输出完整润色/扩展后的版本" (一个 bubble), 玩家只能采用或放弃
 *  - v0.3 后改成跟 generate 一样: LLM 一次给 3-5 个不同方向, 玩家挑一个
 *  - v0.4+ 改走 tool calling：LLM 优先调 `ask_user_question` tool 返备选，
 *    玩家挑一个后再 LLM round 2 调 `update_doc_item` tool 写入
 *  - 这俩 instruction 拼好后, store sendStepChat 会再 append 当前 doc.content
 *    (不依赖 system 注入, 确保 LLM 拿到完整原文做改造) */
const POLISH_INSTRUCTION =
  '把这节的内容润色 3-5 个不同方向。每个备选都要：\n' +
  '- 保持原意，不改方向\n' +
  '- 改进表达：更精炼 / 更有画面感 / 节奏更紧凑\n' +
  '- 删废话，保留关键信息\n' +
  '- 是完整润色后的版本（不是修改说明）\n' +
  '- 长度跟原文相当（不要扩长，那是另一个 chip 的事）'

const EXPAND_INSTRUCTION =
  '把这节的内容扩展 3-5 个不同方向。每个备选都要：\n' +
  '- 保持原意，不改方向\n' +
  '- 加细节 / 加例子 / 加场景 / 加张力\n' +
  '- 让内容更具体、可玩、有画面\n' +
  '- 是完整扩展后的版本（不是扩展说明）\n' +
  '- 长度比原文明显更长（至少 1.5 倍，扩写就是要更厚）'

// === 5 节 × 4 presets 静态配置（chip + 完整 prompt）===

export const SECTION_PRESETS: Record<string, PresetAction[]> = {
  overview: [
    {
      label: '💡 给 3-5 个不同基调的版本',
      prompt:
        '200 字以内讲完这个世界。给 3-5 个不同基调的版本（写实冷感 / 史诗浪漫 / 怪奇童话 / 江湖市井 / 后工业废土 之类挑 3-5），每个必须体现概念宪法里的核心体验 —— 玩家会感受到什么，不是百科条目。' +
        JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检查有没有体现核心体验',
      prompt:
        '帮玩家检查他写的世界观速览有没有体现概念宪法里的核心体验 —— 玩家看这段能感受到核心体验吗？' +
        REFLECT_TAIL,
      action: 'reflect',
    },
    {
      label: '✨ 润色世界观速览',
      prompt: POLISH_INSTRUCTION + JSON_TAIL,
      action: 'polish',
    },
    {
      label: '🌱 扩展世界观速览',
      prompt: EXPAND_INSTRUCTION + JSON_TAIL,
      action: 'expand',
    },
  ],
  geography: [
    {
      label: '💡 给 3-5 个关键地点设计',
      prompt:
        '每个地点必须带「它给故事提供什么舞台 / 冲突」—— 纯百科式的地理罗列要打回。给 3-5 个关键地点设计。' +
        JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检查是不是纯百科',
      prompt: '帮玩家检查地理分节是不是纯百科（无冲突的地点罗列要打回）。' + REFLECT_TAIL,
      action: 'reflect',
    },
    {
      label: '✨ 润色地理',
      prompt: POLISH_INSTRUCTION + JSON_TAIL,
      action: 'polish',
    },
    {
      label: '🌱 扩展地理',
      prompt: EXPAND_INSTRUCTION + JSON_TAIL,
      action: 'expand',
    },
  ],
  history: [
    {
      label: '💡 给 3-5 条关键历史',
      prompt:
        '只写「对现在还有影响」的历史，每条带「它造成了今天的什么」—— 对今天没影响的事件不要写。给 3-5 条。' +
        JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检查对现在还有没有影响',
      prompt: '帮玩家检查历史分节每条对现在还有没有影响（无影响的事件要打回）。' + REFLECT_TAIL,
      action: 'reflect',
    },
    {
      label: '✨ 润色历史',
      prompt: POLISH_INSTRUCTION + JSON_TAIL,
      action: 'polish',
    },
    {
      label: '🌱 扩展历史',
      prompt: EXPAND_INSTRUCTION + JSON_TAIL,
      action: 'expand',
    },
  ],
  'magic-system': [
    {
      label: '💡 给 3-5 套不同机制',
      prompt:
        '给 3-5 套不同机制的魔法体系（符文 / 血脉 / 信仰 / 炼金 / 契约 之类挑 3-5），每套规则必须有代价 / 限制（对齐概念设计支柱）。' +
        JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检查代价/限制够不够',
      prompt:
        '帮玩家检查魔法体系每条规则的代价/限制够不够（写不出代价的规则标记为可疑并说明）。' +
        REFLECT_TAIL,
      action: 'reflect',
    },
    {
      label: '✨ 润色魔法体系',
      prompt: POLISH_INSTRUCTION + JSON_TAIL,
      action: 'polish',
    },
    {
      label: '🌱 扩展魔法体系',
      prompt: EXPAND_INSTRUCTION + JSON_TAIL,
      action: 'expand',
    },
  ],
  factions: [
    {
      label: '💡 给 3-5 个阵营',
      prompt: '每个阵营必须带「想要什么 + 跟谁的什么冲突」。给 3-5 个阵营。' + JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检查冲突网是否闭合',
      prompt:
        '帮玩家检查阵营冲突网是否闭合（每个阵营至少跟 1 个别的阵营有冲突 —— 写不出冲突的阵营是装饰品，要打回）。' +
        REFLECT_TAIL,
      action: 'reflect',
    },
    {
      label: '✨ 润色阵营',
      prompt: POLISH_INSTRUCTION + JSON_TAIL,
      action: 'polish',
    },
    {
      label: '🌱 扩展阵营',
      prompt: EXPAND_INSTRUCTION + JSON_TAIL,
      action: 'expand',
    },
  ],
}

/** step chat 的 system prompt（对话形态：所有 preset 走 start_chat 流式 + chip prompt 是 user message）
 *  - 角色 + 约束 + 玩家主导（v0.3+ 统一骨架）
 *  - 具体的"输出 JSON 数组"约束在 preset.prompt 里（user message），但 v0.3+ system 也强调
 *    "严格遵循用户消息的格式要求"，避免 LLM 默认走 markdown 啰嗦模式
 *  - 默认 markdown 形态；用户消息若要求 JSON 则必须 JSON */
function sectionChatSystemPrompt(doc: DocEntry): string {
  return (
    `你是 PlotCraft 的 AI 编剧搭档，正在帮玩家做「${doc.title}」这一节。\n` +
    `这一节要写什么：${SECTION_HINTS[doc.id] ?? ''}\n` +
    `玩家主导原则：你只给备选/追问/建议，玩家挑+改，绝不替玩家做决定。\n` +
    `**严格遵循用户消息中指定的输出格式**：\n` +
    `- 如果用户要求 JSON 数组 → 第一个字符必须是 \`[\`，**不要**任何额外文字/preamble/思考/解释\n` +
    `- 如果用户没指定 → 输出 markdown，保持简洁`
  )
}

/** 拼 AI context：概念宪法 + 世界其他分节摘要 + 当前节已有内容（step chat 共用） */
async function buildContext(projectRoot: string, doc: DocEntry): Promise<string[]> {
  const parts: string[] = []
  // 概念宪法：生成内容必须与之保持一致（v0.3+ chat 的 buildSystemPrompt 再扩到 world）
  const constitution = await getConceptSummary(projectRoot)
  if (constitution.trim()) {
    parts.push('项目概念宪法（生成内容必须与之保持一致）：\n' + constitution.trim())
  }
  // 世界其他分节摘要（含当前节已有内容的截断版，当前节完整内容单独再加）
  const docsSummary = await getDocsSummary(projectRoot, WORLD_COLLECTION)
  if (docsSummary.trim()) {
    parts.push('世界设定已有的内容：\n' + docsSummary.trim())
  }
  if (doc.content.trim()) {
    parts.push(`当前「${doc.title}」已有的内容：\n${doc.content.trim()}`)
  } else {
    parts.push(`当前「${doc.title}」还是空白，请从零给备选。`)
  }
  return parts
}

export const useWorldStore = defineStore('world', () => {
  const docs = shallowRef<DocEntry[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const currentDocId = ref<string>('overview')

  // === load / save（照搬 concept store 形状） ===

  /** 扫描当前项目 world/ —— 无项目 → 清空（不报错）
   *  v0.3+ 同时加载 .chats/world/*.json 到 chatHistories（chat 落盘）*/
  async function load(): Promise<void> {
    const project = useProjectStore()
    if (!project.current) {
      docs.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      docs.value = await listDocs(project.current.folder, WORLD_COLLECTION)
      // 加载 chat 历史（v0.3+ 落盘）
      const chats = await loadChats(project.current.folder)
      const next = new Map<string, ChatMessage[]>()
      for (const [itemKey, file] of Object.entries(chats)) {
        // 后端返回的 itemKey 是 "world:overview" 格式 → store 内部 key 一致
        // 但 world store 只能管自己的 key（"world:" 前缀），过滤掉 concept 的（不会发生但保险）
        if (itemKey.startsWith('world:')) {
          next.set(itemKey, file.messages)
        }
      }
      chatHistories.value = next
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      console.error('[world.load] failed:', e)
    } finally {
      loading.value = false
    }
  }

  /** 保存一节（view 层 debounce / flush 调这个）
   *  成功用后端返回的 doc 替换本地项（shallowRef → 整个数组换新引用）；
   *  失败抛错让 UI 提示 */
  async function save(docId: string, content: string): Promise<void> {
    const project = useProjectStore()
    if (!project.current) throw new Error('没有打开的项目')
    const updated = await saveDoc(project.current.folder, WORLD_COLLECTION, docId, content)
    docs.value = docs.value.map((d) => (d.id === docId ? updated : d))
  }

  // === step chat v0.3+ per-item Map 化 + 自动落盘（对称 concept store） ===

  const chatHistories = shallowRef(new Map<string, ChatMessage[]>())
  const chatTexts = shallowRef(new Map<string, string>())
  const chatStreamings = shallowRef(new Map<string, boolean>())
  const chatErrorKinds = shallowRef(new Map<string, ChatErrorKind | null>())
  const chatErrorRaws = shallowRef(new Map<string, string | null>())
  const chatRunIds = shallowRef(new Map<string, string | null>())

  function mapGet<T>(ref: Ref<Map<string, T>>, key: string, fallback: T): T {
    return ref.value.get(key) ?? fallback
  }
  function mapSet<T>(ref: Ref<Map<string, T>>, key: string, value: T): void {
    ref.value.set(key, value)
    triggerRef(ref)
  }

  function findItemByRunId(runId: string): string | null {
    for (const [id, rid] of chatRunIds.value) {
      if (rid === runId) return id
    }
    return null
  }

  function currentItemKey(): string {
    return makeItemKey('world', currentDocId.value)
  }

  // 派生 computed —— 组件拿到的是 currentDocId 对应的那一份
  const messages = computed<ChatMessage[]>(() => mapGet(chatHistories, currentItemKey(), []))
  const text = computed<string>(() => mapGet(chatTexts, currentItemKey(), ''))
  const streaming = computed<boolean>(() => mapGet(chatStreamings, currentItemKey(), false))
  const errorKind = computed<ChatErrorKind | null>(() =>
    mapGet(chatErrorKinds, currentItemKey(), null),
  )
  const errorRaw = computed<string | null>(() => mapGet(chatErrorRaws, currentItemKey(), null))

  // === step chat listener 初始化（幂等） ===

  let listenerInit = false
  const unlistenFns: UnlistenFn[] = []

  // v0.4+ tool call 流式累积（per-item Map<index, ToolCallInfo>），对齐 concept store 形状
  const chatToolCalls = shallowRef(new Map<string, Map<number, ToolCallInfo>>())

  function mapGetToolCalls(itemId: string): Map<number, ToolCallInfo> {
    return chatToolCalls.value.get(itemId) ?? new Map()
  }
  function mapSetToolCalls(itemId: string, tc: Map<number, ToolCallInfo>) {
    chatToolCalls.value.set(itemId, tc)
    triggerRef(chatToolCalls)
  }

  function accumulateToolCallPartial(itemId: string, partial: ToolCallPartial) {
    const tc = new Map(mapGetToolCalls(itemId))
    const existing = tc.get(partial.index)
    if (partial.id || partial.name) {
      tc.set(partial.index, {
        id: partial.id ?? existing?.id ?? '',
        name: partial.name ?? existing?.name ?? '',
        arguments: (existing?.arguments ?? '') + partial.arguments_delta,
      })
    } else if (existing) {
      tc.set(partial.index, {
        id: existing.id,
        name: existing.name,
        arguments: existing.arguments + partial.arguments_delta,
      })
    } else {
      tc.set(partial.index, {
        id: '',
        name: '',
        arguments: partial.arguments_delta,
      })
    }
    mapSetToolCalls(itemId, tc)
  }

  async function init(): Promise<void> {
    if (listenerInit) return
    listenerInit = true
    unlistenFns.push(
      await onChatChunk((payload) => {
        const id = findItemByRunId(payload.run_id)
        if (!id) return
        mapSet(chatTexts, id, mapGet(chatTexts, id, '') + payload.text)
      }),
    )
    // v0.4+ tool call 流式事件订阅 —— 对称 concept store
    unlistenFns.push(
      await onChatToolCall((payload) => {
        const id = findItemByRunId(payload.run_id)
        if (!id) return
        for (const partial of payload.calls) {
          accumulateToolCallPartial(id, partial)
        }
      }),
    )
    unlistenFns.push(
      await onChatDone((payload) => {
        const id = findItemByRunId(payload.run_id)
        if (!id) return
        const accumulated = mapGet(chatTexts, id, '')
        const tcs = mapGetToolCalls(id)
        if (accumulated) {
          const cur = mapGet(chatHistories, id, [])
          // 拷触发这条回复的 user message 的 action（决定渲染分支：cards / polish-bubble / expand-bubble / reflect-bubble）
          const lastUser = [...cur].reverse().find((m) => m.role === 'user')
          const toolCalls = tcs.size > 0 ? Array.from(tcs.values()) : undefined
          mapSet(chatHistories, id, [
            ...cur,
            {
              role: 'assistant',
              content: accumulated,
              action: lastUser?.action,
              tool_calls: toolCalls,
            },
          ])
          console.log(
            `[world.onChatDone] ${id} run=${payload.run_id} OK: contentLen=${accumulated.length}, action=${lastUser?.action ?? 'none'}, toolCalls=${toolCalls?.length ?? 0}`,
          )
        } else if (tcs.size > 0) {
          // v0.4+ 纯 tool call reply（无 text content）
          const cur = mapGet(chatHistories, id, [])
          const lastUser = [...cur].reverse().find((m) => m.role === 'user')
          const toolCalls = Array.from(tcs.values())
          mapSet(chatHistories, id, [
            ...cur,
            {
              role: 'assistant',
              content: '',
              action: lastUser?.action,
              tool_calls: toolCalls,
            },
          ])
          console.log(
            `[world.onChatDone] ${id} run=${payload.run_id} OK: pure tool_call, toolCalls=${toolCalls.length}, names=${toolCalls.map((t) => t.name).join(',')}`,
          )
        } else {
          console.warn(`[world.onChatDone] ${id} run=${payload.run_id} empty content (LLM returned 0 chars?)`)
        }
        mapSet(chatTexts, id, '')
        mapSet(chatRunIds, id, null)
        mapSet(chatStreamings, id, false)
        mapSetToolCalls(id, new Map())
      }),
    )
    unlistenFns.push(
      await onChatError((payload) => {
        const id = findItemByRunId(payload.run_id)
        if (!id) return
        const accumulated = mapGet(chatTexts, id, '')
        const tcs = mapGetToolCalls(id)
        console.error(
          `[world.onChatError] ${id} run=${payload.run_id} kind=${payload.kind} err="${payload.error}" partialLen=${accumulated.length} partialToolCalls=${tcs.size}`,
        )
        if (accumulated || tcs.size > 0) {
          // 流到一半挂 → 保留 partial（对齐 chat reducer v0.2+ 行为）；同 done，拷 user action
          const cur = mapGet(chatHistories, id, [])
          const lastUser = [...cur].reverse().find((m) => m.role === 'user')
          const toolCalls = tcs.size > 0 ? Array.from(tcs.values()) : undefined
          mapSet(chatHistories, id, [
            ...cur,
            {
              role: 'assistant',
              content: accumulated,
              partial: true,
              action: lastUser?.action,
              tool_calls: toolCalls,
            },
          ])
        }
        mapSet(chatTexts, id, '')
        mapSet(chatRunIds, id, null)
        mapSet(chatStreamings, id, false)
        mapSet(chatErrorKinds, id, payload.kind)
        mapSet(chatErrorRaws, id, payload.error)
        mapSetToolCalls(id, new Map())
      }),
    )
  }

  // === send / reset ===

  async function sendStepChat(
    text: string,
    preset?: PresetAction,
    isRetry: boolean = false,
  ): Promise<void> {
    const trimmedText = text.trim()
    let prompt = preset?.prompt ?? trimmedText
    if (!prompt) return
    const id = currentItemKey()
    if (mapGet(chatStreamings, id, false)) {
      console.log(`[world.sendStepChat] ${id} ignored: already streaming`)
      return
    }
    const project = useProjectStore()
    if (!project.current) throw new Error('没有打开的项目')
    const doc = docs.value.find((d) => d.id === currentDocId.value)
    if (!doc) throw new Error('未知分节')
    await init()

    // 玩家手动 / 自动重试 的诊断
    console.log(
      `[world.sendStepChat] ${id} starting: preset=${preset?.label ?? '(free text)'}, action=${preset?.action ?? 'none'}, isRetry=${isRetry}, docContentLen=${doc.content.length}`,
    )

    // polish / expand 必须显式附当前 doc.content（确保 LLM 拿到完整原文做改造）
    if (preset && (preset.action === 'polish' || preset.action === 'expand')) {
      prompt = `${prompt}\n\n当前「${doc.title}」内容：\n${doc.content.trim()}`
    }

    // v0.3+ 自动重试: 标记 retry=true (前端 only, 发后端前 strip)
    const userMsg: ChatMessage = preset
      ? { role: 'user', content: prompt, preset: preset.label, action: preset.action, retry: isRetry || undefined }
      : { role: 'user', content: trimmedText, retry: isRetry || undefined }
    const cur = mapGet(chatHistories, id, [])
    mapSet(chatHistories, id, [...cur, userMsg])
    mapSet(chatErrorKinds, id, null)
    mapSet(chatErrorRaws, id, null)

    const parts = await buildContext(project.current.folder, doc)

    try {
      mapSet(chatStreamings, id, true)
      const conn = await resolveLlmConnection()
      // v0.4+ 走 tool calling：runChatRound 内部自动 resolveEnabledTools 注入 tools 字段，
      // LLM 收到 schema 强制调 ask_user_question / update_doc_item 返结构化数据
      await runChatRound({ id, conn })
    } catch (e) {
      mapSet(chatStreamings, id, false)
      console.error('[world.sendStepChat] startChat FAILED:', e)
      throw e
    }
  }

  /** v0.4+ tool result 喂回 LLM（多轮 tool calling 核心）—— 对称 concept store */
  async function sendToolResult(toolCallId: string, content: string): Promise<void> {
    const id = currentItemKey()
    if (mapGet(chatStreamings, id, false)) {
      console.log(`[world.sendToolResult] ${id} ignored: already streaming`)
      return
    }
    if (!docs.value.find((d) => d.id === currentDocId.value)) {
      throw new Error('未知分节')
    }
    await init()

    console.log(
      `[world.sendToolResult] ${id} starting: tool_call_id=${toolCallId}, contentLen=${content.length}`,
    )

    const toolMsg: ChatMessage = {
      role: 'tool',
      content,
      tool_call_id: toolCallId,
    }
    const cur = mapGet(chatHistories, id, [])
    mapSet(chatHistories, id, [...cur, toolMsg])
    mapSet(chatErrorKinds, id, null)
    mapSet(chatErrorRaws, id, null)

    try {
      mapSet(chatStreamings, id, true)
      const conn = await resolveLlmConnection()
      // v0.4+ tool result 二轮：直接走 tool calling 路径，LLM 自己判断下一步要不要 tool call
      await runChatRound({ id, conn })
    } catch (e) {
      mapSet(chatStreamings, id, false)
      console.error('[world.sendToolResult] startChat FAILED:', e)
      throw e
    }
  }

  /** 内部：发一轮 LLM（user 消息流 / tool result 流 共用）—— 对称 concept store */
  async function runChatRound(opts: {
    id: string
    conn: Awaited<ReturnType<typeof resolveLlmConnection>>
  }): Promise<void> {
    const { id, conn } = opts
    const settings = useSettingsStore()
    if (!settings.loaded) await settings.init()
    const tools = resolveEnabledTools(settings.config)
    const doc = docs.value.find((d) => d.id === currentDocId.value)
    if (!doc) throw new Error('未知分节')
    const systemContent =
      sectionChatSystemPrompt(doc) +
      (doc.content.trim() ? `\n\n当前「${doc.title}」已有的内容：\n${doc.content.trim()}` : '')
    const runId = await rpcStartChat(
      [
        { role: 'system', content: systemContent },
        ...mapGet(chatHistories, id, [])
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role,
            content: m.content,
            partial: m.partial,
            tool_calls: m.tool_calls,
            tool_call_id: m.tool_call_id,
          })),
      ],
      { model: conn.model, effort: null, tools },
    )
    mapSet(chatRunIds, id, runId)
  }

  function resetStepChat(): void {
    const id = currentItemKey()
    cancelPendingSave()
    mapSet(chatHistories, id, [])
    mapSet(chatTexts, id, '')
    mapSet(chatStreamings, id, false)
    mapSet(chatRunIds, id, null)
    mapSet(chatErrorKinds, id, null)
    mapSet(chatErrorRaws, id, null)
    const project = useProjectStore()
    if (project.current) {
      void deleteChat(project.current.folder, id).catch((e) =>
        console.error('[world.resetStepChat] delete chat failed:', e),
      )
    }
  }

  function clearAllStepChats(): void {
    cancelPendingSave()
    chatHistories.value = new Map()
    chatTexts.value = new Map()
    chatStreamings.value = new Map()
    chatRunIds.value = new Map()
    chatErrorKinds.value = new Map()
    chatErrorRaws.value = new Map()
    const project = useProjectStore()
    if (project.current) {
      void deleteAllChats(project.current.folder).catch((e) =>
        console.error('[world.clearAllStepChats] delete all chats failed:', e),
      )
    }
  }

  // === v0.3+ chat 落盘（debounce 1s + 显式 flushChats） ===

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const SAVE_DEBOUNCE_MS = 1000

  function cancelPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  function scheduleChatSave() {
    cancelPendingSave()
    saveTimer = setTimeout(() => void flushChatsToCurrent(), SAVE_DEBOUNCE_MS)
  }

  async function flushChatsToCurrent(): Promise<void> {
    cancelPendingSave()
    const project = useProjectStore()
    if (!project.current) return
    await flushChatsTo(project.current.folder)
  }

  async function flushChatsTo(projectRoot: string): Promise<void> {
    cancelPendingSave()
    const snapshot = new Map(chatHistories.value)
    for (const [itemKey, messages] of snapshot) {
      if (messages.length === 0) continue
      const lastUser = [...messages].reverse().find((m) => m.role === 'user') ?? null
      const payload: ChatFile = {
        version: 1,
        messages,
        last_user_message: lastUser,
        updated_at: new Date().toISOString(),
      }
      try {
        await saveChat(projectRoot, itemKey, payload)
      } catch (e) {
        console.error('[world.flushChatsTo] save chat failed:', itemKey, e)
      }
    }
  }

  watch(chatHistories, () => {
    scheduleChatSave()
  })

  const stepChat: StepChatState = markRaw({
    messages,
    text,
    streaming,
    errorKind,
    errorRaw,
    send: sendStepChat,
    /** v0.4+ tool result 喂回 LLM（多轮 tool calling） */
    sendToolResult,
    reset: resetStepChat,
  })

  return {
    docs,
    loading,
    error,
    currentDocId,
    load,
    save,
    init,
    stepChat,
    resetStepChat,
    clearAllStepChats,
    flushChatsTo, // 暴露给 view：切项目前调，把内存 chats 写到指定 folder
  }
})
