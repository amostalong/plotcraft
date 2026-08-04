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
import type { ChatErrorDiag, ChatErrorKind, ChatMessage, ToolCallInfo, ToolCallPartial } from '@/types/chat'
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

// v0.5+ 备选类 chip 通用尾巴（强制调 ask_choose_option tool）
// - 玩家 2026-08-03 反馈：点「✨ 润色」类 chip 后 LLM 完全沉默 → fallback "(AI 无回复)"
// - 根因：旧 JSON_TAIL 写"**优先**用 ask_choose_option tool + **如果不调 tool** 就返 JSON 数组"
//   （软约束 + fallback），跟 SYSTEM_PROMPT "1 round 1 tool call" 硬规则互相打架，
//   deepseek-v4-flash 在矛盾指令下选沉默（既不调 tool 也不出 text）→ AltCard 一个不渲染
// - 修：钉死**必须**调 ask_choose_option tool，去掉 markdown / JSON 数组兜底
//   - 跟 concept store OPTION_TAIL 同款；REFLECT_TAIL（ask_user_question 强制回复）也对称
const OPTION_TAIL =
  '**必须**用 ask_choose_option tool 提问（不要返 markdown 文本 / JSON 数组）：\n' +
  '- 调 1 次 ask_choose_option tool（不要调多次）\n' +
  '- options 数组给 2-5 个互斥备选（不要重复 / 不要"其他"兜底）\n' +
  '- 每项：label（≤10 字）+ preview（完整备选内容）+ description（可选，hover tooltip）\n' +
  '- **不要**在 tool call 前后加 preamble / 客套话 / 解释 / 思考过程\n' +
  '基于当前节最新内容回答。'

/** v0.5+ 反思/追问类 preset 通用尾巴（钉死 1 个问题，对齐 concept store + tool name 重命名）
 *  - 跟 concept REFLECT_TAIL 同款：1 round 1 ask_user_question (旧名 ask_free_text) + question 字段只写 1 个问题
 *  - v0.4.4+ 之前是"兜底走 markdown"（LLM 自由调 ask_choose_option / 直接 markdown 答），
 *    UX 不一致：有时强制回复（ask_user_question），有时普通聊天（markdown）
 *  - 现在钉死走 ask_user_question 工具，UX 跟玩家在 concept REFLECT chip 一致（UX 整合到 composer）
 *  - 玩家主导：只问问题，玩家自己答，绝不替玩家做决定 */
const REFLECT_TAIL =
  '**强制走 ask_user_question tool（1 round 1 次调用，question 字段写 1 个问题）**：\n' +
  '1. **调 1 次** ask_user_question（不要调多次 / 不要调 ask_choose_option / 不要调 update_doc_item）\n' +
  '2. **question 字段**里**只写 1 个问题**（不要用 1./2./3. 编号拆多个问题）—— 玩家在下方 composer 直接打字回答，\n' +
  '   UX 跟普通聊天一致，不要让玩家在多个 input 之间跳来跳去\n' +
  '3. 玩家**回车提交**后，UI 自动把内容作为 ask_user_question 的 tool_result 喂回 LLM\n' +
  '4. **不要**给选项 / 不要替玩家做决定 / 不要说"好的""让我分析"等客套话\n' +
  '5. 基于当前分节最新内容回答。'

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
        OPTION_TAIL,
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
      prompt: POLISH_INSTRUCTION + OPTION_TAIL,
      action: 'polish',
      // v0.4.4+ 让 LLM 重新调 ask_choose_option 出新备选（玩家可换思路）；不锁 chip
      allowDuringPending: true,
    },
    {
      label: '🌱 扩展世界观速览',
      prompt: EXPAND_INSTRUCTION + OPTION_TAIL,
      action: 'expand',
      // v0.4.4+ 同上
      allowDuringPending: true,
    },
  ],
  geography: [
    {
      label: '💡 给 3-5 个关键地点设计',
      prompt:
        '每个地点必须带「它给故事提供什么舞台 / 冲突」—— 纯百科式的地理罗列要打回。给 3-5 个关键地点设计。' +
        OPTION_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检查是不是纯百科',
      prompt: '帮玩家检查地理分节是不是纯百科（无冲突的地点罗列要打回）。' + REFLECT_TAIL,
      action: 'reflect',
    },
    {
      label: '✨ 润色地理',
      prompt: POLISH_INSTRUCTION + OPTION_TAIL,
      action: 'polish',
      // v0.4.4+ 让 LLM 重新调 ask_choose_option 出新备选（玩家可换思路）；不锁 chip
      allowDuringPending: true,
    },
    {
      label: '🌱 扩展地理',
      prompt: EXPAND_INSTRUCTION + OPTION_TAIL,
      action: 'expand',
      // v0.4.4+ 同上
      allowDuringPending: true,
    },
  ],
  history: [
    {
      label: '💡 给 3-5 条关键历史',
      prompt:
        '只写「对现在还有影响」的历史，每条带「它造成了今天的什么」—— 对今天没影响的事件不要写。给 3-5 条。' +
        OPTION_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检查对现在还有没有影响',
      prompt: '帮玩家检查历史分节每条对现在还有没有影响（无影响的事件要打回）。' + REFLECT_TAIL,
      action: 'reflect',
    },
    {
      label: '✨ 润色历史',
      prompt: POLISH_INSTRUCTION + OPTION_TAIL,
      action: 'polish',
      // v0.4.4+ 让 LLM 重新调 ask_choose_option 出新备选（玩家可换思路）；不锁 chip
      allowDuringPending: true,
    },
    {
      label: '🌱 扩展历史',
      prompt: EXPAND_INSTRUCTION + OPTION_TAIL,
      action: 'expand',
      // v0.4.4+ 同上
      allowDuringPending: true,
    },
  ],
  'magic-system': [
    {
      label: '💡 给 3-5 套不同机制',
      prompt:
        '给 3-5 套不同机制的魔法体系（符文 / 血脉 / 信仰 / 炼金 / 契约 之类挑 3-5），每套规则必须有代价 / 限制（对齐概念设计支柱）。' +
        OPTION_TAIL,
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
      prompt: POLISH_INSTRUCTION + OPTION_TAIL,
      action: 'polish',
      // v0.4.4+ 让 LLM 重新调 ask_choose_option 出新备选（玩家可换思路）；不锁 chip
      allowDuringPending: true,
    },
    {
      label: '🌱 扩展魔法体系',
      prompt: EXPAND_INSTRUCTION + OPTION_TAIL,
      action: 'expand',
      // v0.4.4+ 同上
      allowDuringPending: true,
    },
  ],
  factions: [
    {
      label: '💡 给 3-5 个阵营',
      prompt: '每个阵营必须带「想要什么 + 跟谁的什么冲突」。给 3-5 个阵营。' + OPTION_TAIL,
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
      prompt: POLISH_INSTRUCTION + OPTION_TAIL,
      action: 'polish',
      // v0.4.4+ 让 LLM 重新调 ask_choose_option 出新备选（玩家可换思路）；不锁 chip
      allowDuringPending: true,
    },
    {
      label: '🌱 扩展阵营',
      prompt: EXPAND_INSTRUCTION + OPTION_TAIL,
      action: 'expand',
      // v0.4.4+ 同上
      allowDuringPending: true,
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
   *  失败抛错让 UI 提示
   *  v0.5+ sync：保存后通知概念 store 标对应 step stale（dynamic import 避免循环） */
  async function save(docId: string, content: string): Promise<void> {
    const project = useProjectStore()
    if (!project.current) throw new Error('没有打开的项目')
    const updated = await saveDoc(project.current.folder, WORLD_COLLECTION, docId, content)
    docs.value = docs.value.map((d) => (d.id === docId ? updated : d))
    // v0.5+ sync：世界 doc 保存 → 通知概念 store 标 L3/L4 stale
    // - dynamic import 避免 world ↔ concept 循环 module 依赖
    // - 失败不影响保存成功（玩家主导：sync 是软提示，不是硬约束）
    try {
      const mod = await import('./concept')
      mod.useConceptStore().markStaleFromWorld(docId)
    } catch (e) {
      console.warn('[world.save] concept sync notify failed (non-fatal):', e)
    }
  }

  // === v0.5+ sync：概念 step 改了 → 标 world 哪些 doc stale ===
  //
  // 派生关系（来自 7 层模型）：
  // - concept L3 world-rules 改 → world overview + history + magic-system + factions 都可能不一致（世界骨架变了）
  // - concept L4 locations 改  → world geography 可能不一致（地点细化变了）
  // - 其他 5 步（L1/L2/L5/L6/L7）跟 world tab 没派生关系，不动 world
  //
  // 玩家点 X 关闭黄点 → clearStaleFromConcept；不点黄点 stale flag 一直保留（下次再改同 step 仍标）
  const conceptStaleDocs = shallowRef(new Set<string>())

  /** 概念 step 改了 → 标对应 world doc stale（被 concept store 调）
   *  - world-rules → overview + history + magic-system + factions
   *  - locations → geography
   *  - 其他 stepId 忽略 */
  function markStaleFromConcept(stepId: string): void {
    let affected: string[] = []
    if (stepId === 'world-rules') {
      affected = ['overview', 'history', 'magic-system', 'factions']
    } else if (stepId === 'locations') {
      affected = ['geography']
    } else {
      return
    }
    const next = new Set(conceptStaleDocs.value)
    for (const d of affected) next.add(d)
    conceptStaleDocs.value = next
  }

  /** 玩家点 X 忽略某节 stale（view 层调） */
  function clearStaleFromConcept(docId: string): void {
    if (!conceptStaleDocs.value.has(docId)) return
    const next = new Set(conceptStaleDocs.value)
    next.delete(docId)
    conceptStaleDocs.value = next
  }

  /** 切项目时清 stale flags（不同项目 stale 状态不继承） */
  function clearAllConceptStale(): void {
    if (conceptStaleDocs.value.size === 0) return
    conceptStaleDocs.value = new Set()
  }

  // === step chat v0.3+ per-item Map 化 + 自动落盘（对称 concept store） ===

  const chatHistories = shallowRef(new Map<string, ChatMessage[]>())
  const chatTexts = shallowRef(new Map<string, string>())
  const chatStreamings = shallowRef(new Map<string, boolean>())
  const chatErrorKinds = shallowRef(new Map<string, ChatErrorKind | null>())
  const chatErrorRaws = shallowRef(new Map<string, string | null>())
  // v0.4.1+ 错误诊断包（endpoint / model / api_format / request_body_preview）——
  // 错误条 "复制诊断信息" 按钮用
  const chatErrorDiags = shallowRef(new Map<string, ChatErrorDiag | null>())
  const chatRunIds = shallowRef(new Map<string, string | null>())

  // v0.4.4+ ask_free_text tool 强制回复协议（"就地输入" 模式，对齐 concept store）
  // - Map<itemId, Map<toolCallId, { question, answer? }>>
  // - 详见 concept.ts 同款注释
  const askFreeTextPending = shallowRef(new Map<string, Map<string, { question: string; answer?: string }>>())

  // v0.4.4+ 全 tool 通用 pending（ask_choose_option / ask_user_question / update_doc_item 都在等玩家反应）
  // - 详见 concept.ts 同款注释
  const pendingToolCalls = shallowRef(new Map<string, Set<string>>())

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
  const errorDiag = computed<ChatErrorDiag | null>(() =>
    mapGet(chatErrorDiags, currentItemKey(), null),
  )

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

  // === v0.4.4+ ask_free_text pending helpers（对齐 concept store） ===
  function mapGetAskFreeText(itemId: string): Map<string, { question: string; answer?: string }> {
    return askFreeTextPending.value.get(itemId) ?? new Map()
  }
  function mapSetAskFreeText(
    itemId: string,
    pending: Map<string, { question: string; answer?: string }>,
  ): void {
    askFreeTextPending.value.set(itemId, pending)
    triggerRef(askFreeTextPending)
  }
  function clearAskFreeTextForItem(itemId: string): void {
    const next = new Map(askFreeTextPending.value)
    next.delete(itemId)
    askFreeTextPending.value = next
    triggerRef(askFreeTextPending)
  }

  // === v0.4.4+ 全 tool 通用 pending helpers（对齐 concept store）===
  function mapGetPendingToolCalls(itemId: string): Set<string> {
    return new Set(pendingToolCalls.value.get(itemId) ?? [])
  }
  function addPendingToolCall(itemId: string, toolCallId: string): void {
    const cur = pendingToolCalls.value.get(itemId)
    const next = cur ? new Set(cur) : new Set<string>()
    next.add(toolCallId)
    pendingToolCalls.value.set(itemId, next)
    triggerRef(pendingToolCalls)
  }
  function removePendingToolCall(itemId: string, toolCallId: string): void {
    const cur = pendingToolCalls.value.get(itemId)
    if (!cur || !cur.has(toolCallId)) return
    const next = new Set(cur)
    next.delete(toolCallId)
    if (next.size === 0) {
      const outer = new Map(pendingToolCalls.value)
      outer.delete(itemId)
      pendingToolCalls.value = outer
    } else {
      pendingToolCalls.value.set(itemId, next)
    }
    triggerRef(pendingToolCalls)
  }
  function clearPendingToolCallsForItem(itemId: string): void {
    const outer = new Map(pendingToolCalls.value)
    if (outer.delete(itemId)) {
      pendingToolCalls.value = outer
      triggerRef(pendingToolCalls)
    }
  }

  function parseAskFreeTextArgs(tc: ToolCallInfo): { question: string } | null {
    try {
      const args = JSON.parse(tc.arguments)
      if (typeof args.question !== 'string') return null
      return { question: args.question }
    } catch {
      return null
    }
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
          // v0.4.4.1+ 诊断：打出 LLM 实际回复的 content + tool_calls（玩家截图"AI 回复"空内容 bug 排查用）
          // - 仅 dev 模式输出（import.meta.env.DEV 是 Vite 原生 dev 标志）
          // - 生产 release 前可整体删
          if (import.meta.env.DEV) {
            console.log(
              `[world.onChatDone.DIAG] ${id} run=${payload.run_id} CONTENT: ${JSON.stringify(accumulated).slice(0, 200)}`,
            )
            if (toolCalls && toolCalls.length > 0) {
              console.log(
                `[world.onChatDone.DIAG] ${id} run=${payload.run_id} TOOL_CALLS:`,
                toolCalls.map((tc) => ({ name: tc.name, arguments: tc.arguments?.slice(0, 300) })),
              )
            }
          }
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
          // v0.4+ 真沉默（accumulated === '' && tcs.size === 0）：LLM 收到 tool_result / user message 后
          // 既不出 text 也不调 tool —— 协议层异常（对齐 concept store 修法）
          // 玩家 2026-08-03 截图：deepseek-v4-flash 收到 tool_result 后沉默
          // 修：写 fallback message 让 UI 不"卡住"
          // **v0.5+ 文案智能判断**（玩家 2026-08-03 截图反馈"AI 可以拒绝？"）：
          //   - 上一条 message 是 tool_result → LLM 刚调过 tool + 写完 → 沉默是"已交付"
          //     → fallback 显示 "✓ 已完成"
          //   - 上一条 message 是 user 打字 → LLM 主动沉默
          //     → fallback 显示 "（AI 无回复）"
          const cur = mapGet(chatHistories, id, [])
          const lastUser = [...cur].reverse().find((m) => m.role === 'user')
          const lastMsg = cur.length > 0 ? cur[cur.length - 1] : undefined
          const fallbackContent =
            lastMsg && (lastMsg.role === 'tool' || (lastMsg.role === 'user' && lastMsg.tool_call_id))
              ? '✓ 已完成'
              : '（AI 无回复）'
          mapSet(chatHistories, id, [
            ...cur,
            { role: 'assistant', content: fallbackContent, action: lastUser?.action },
          ])
          console.warn(
            `[world.onChatDone] ${id} run=${payload.run_id} empty content (LLM 沉默边界 case: 0 chars + 0 tool_call，写 fallback message "${fallbackContent}")`,
          )
        }
        // v0.4.4+ ask_free_text 强制回复：扫描本轮 tool_calls 把 ask_free_text 写入 pending map
        // （对齐 concept store 行为）
        if (tcs.size > 0) {
          const next = new Map<string, { question: string; answer?: string }>()
          for (const tc of tcs.values()) {
            // v0.5+ tool name 重命名：旧 ask_free_text → ask_user_question
            if (tc.name === 'ask_user_question') {
              const parsed = parseAskFreeTextArgs(tc)
              if (parsed && tc.id) {
                next.set(tc.id, { question: parsed.question })
              }
            }
          }
          if (next.size > 0) {
            mapSetAskFreeText(id, next)
          } else {
            clearAskFreeTextForItem(id)
          }
          // v0.4.4+ 全 tool 通用 pending：把本轮 tool_call 加到 pendingToolCalls（**v0.4.4.1+ ask_free_text 除外**）
          // - 玩家反应时 remove（sendToolResult / sendAllAskFreeTextAnswers 内部）
          // - 玩家"放弃"时 remove（cancelPendingToolCall 内部）
          // - **v0.4.4.1+ ask_free_text 跳过**（UX 整合到 composer，composer 解锁让玩家打字）
          for (const tc of tcs.values()) {
            // v0.4.4.1+ ask_user_question (旧名 ask_free_text) 跳过 pendingToolCalls（避免锁 composer）
            if (tc.id && tc.name !== 'ask_user_question') addPendingToolCall(id, tc.id)
          }
        } else {
          clearAskFreeTextForItem(id)
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
        // v0.4.1+ 错误诊断包：endpoint / model / api_format / request_body_preview
        // 4 字段都 optional（老 backend 没发就 null），复制按钮看到 null 就跳过
        if (payload.endpoint || payload.model || payload.api_format || payload.request_body_preview) {
          mapSet(chatErrorDiags, id, {
            endpoint: payload.endpoint ?? '',
            model: payload.model ?? '',
            api_format: payload.api_format ?? '',
            request_body_preview: payload.request_body_preview ?? '',
          })
        } else {
          mapSet(chatErrorDiags, id, null)
        }
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
    mapSet(chatErrorDiags, id, null)

    const parts = await buildContext(project.current.folder, doc)
    const contextStr = parts.join('\n\n')

    try {
      mapSet(chatStreamings, id, true)
      const conn = await resolveLlmConnection()
      // v0.4+ 走 tool calling：runChatRound 内部自动 resolveEnabledTools 注入 tools 字段，
      // LLM 收到 schema 强制调 ask_choose_option / update_doc_item 返结构化数据
      await runChatRound({ id, conn, contextStr })
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
    mapSet(chatErrorDiags, id, null)
    // v0.4.4+ pendingToolCalls：玩家已反应，从 pending 移除
    removePendingToolCall(id, toolCallId)

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

  // === v0.4.4.1+ ask_free_text 强制回复协议（UX 整合到 composer，单问题版，对齐 concept store） ===
  // v0.4.4+ 老的"bubble 内嵌 N 个 input"多问题版已删：setAskFreeTextAnswer / askFreeTextAllAnswered 不再需要

  const askFreeTextPendingForItem = computed(() => mapGetAskFreeText(currentItemKey()))

  /** v0.4.4.1+ playerText 必填（UX 整合到 composer，对齐 concept store）
   *  - 玩家在 composer 打的字直接作为 ask_free_text 的 answer
   *  - 1 round 1 ask_free_text → 1 tool_result 配对（协议要求）*/
  async function sendAllAskFreeTextAnswers(playerText?: string): Promise<void> {
    const id = currentItemKey()
    if (mapGet(chatStreamings, id, false)) {
      console.log(`[world.sendAllAskFreeTextAnswers] ${id} ignored: already streaming`)
      return
    }
    if (!docs.value.find((d) => d.id === currentDocId.value)) {
      throw new Error('未知分节')
    }
    const pending = askFreeTextPendingForItem.value
    if (pending.size === 0) {
      console.log(`[world.sendAllAskFreeTextAnswers] ${id} ignored: no pending ask_free_text`)
      return
    }
    // v0.4.4.1+ playerText 优先（composer 整合 UX）—— fallback 到 entry.answer 兼容旧 UI 路径
    const allAnswered: Array<{ toolCallId: string; content: string }> = []
    const trimmedText = playerText?.trim()
    for (const [toolCallId, entry] of pending) {
      const a = trimmedText || entry.answer?.trim()
      if (!a) {
        throw new Error('还有未填的 ask_free_text 答案')
      }
      allAnswered.push({ toolCallId, content: a })
    }
    // v0.4.4.1+ 玩家在 composer 打字 → 覆盖 pending.answer（保证后续 chatHistories 派生状态一致）
    if (trimmedText) {
      const next = new Map(askFreeTextPending.value)
      for (const toolCallId of pending.keys()) {
        const cur = next.get(toolCallId)
        if (cur) next.set(toolCallId, { question: cur.question, answer: trimmedText })
      }
      mapSetAskFreeText(id, next)
    }

    await init()
    console.log(
      `[world.sendAllAskFreeTextAnswers] ${id} starting: ${allAnswered.length} tool_results, contentLen=${allAnswered[0]?.content.length ?? 0}`,
    )

    let cur = mapGet(chatHistories, id, [])
    for (const { toolCallId, content } of allAnswered) {
      cur = [
        ...cur,
        { role: 'tool' as const, content, tool_call_id: toolCallId },
      ]
    }
    mapSet(chatHistories, id, cur)
    mapSet(chatErrorKinds, id, null)
    mapSet(chatErrorRaws, id, null)
    mapSet(chatErrorDiags, id, null)
    clearAskFreeTextForItem(id)
    // v0.4.4+ pendingToolCalls：玩家已提交，从 pending 移除
    for (const { toolCallId } of allAnswered) {
      removePendingToolCall(id, toolCallId)
    }

    try {
      mapSet(chatStreamings, id, true)
      const conn = await resolveLlmConnection()
      await runChatRound({ id, conn })
    } catch (e) {
      mapSet(chatStreamings, id, false)
      console.error('[world.sendAllAskFreeTextAnswers] startChat FAILED:', e)
      throw e
    }
  }

  /** v0.4.4+ 玩家点"放弃备选"按钮时调 —— 1 条 function_call_output 喂回 LLM（对齐 concept store）
   *  - 非 silently 模式：发 1 条 tool_result（"玩家放弃：<reason>"）→ LLM 知道玩家不要 → 可以出 text 引导
   *  - 协议层：1 round 1 tool_call → 1 tool_result 配对（不破坏协议）
   *  - **v0.4.4+ silently 模式**：玩家点"放弃"时**不想让 LLM 立刻再调 tool**（避免 LLM 又出一批新备选）→
   *    改 chatHistories 写「玩家放弃」语义 + **不调 LLM**。玩家解锁 composer 后自己写
   *  - **v0.5+ silently 改成主流做法**（玩家 2026-08-03 反馈）：跟 concept store 同款——
   *    改写 assistant content + **保留** tool_calls 字段（LLM 看到上下文）+ **不**追加 tool message
   *    to chatHistories（避免 UI 重复显示"✓ 已答"+ 独立 tool message bubble，截图反馈）
   *    + runChatRound 拼 messages 时**临时**为 silently 改写的 assistant message 补 1 条 tool message
   *    给 LLM（OpenAI 协议层 tool_calls + tool_result 配对）。具体见
   *    `buildMessagesWithSilentAbandonToolResult` 函数（v0.5+ 新增）
   *  - 效果：协议层 OK（LLM 看到 tool_calls + tool_result 配对，deepseek 不会报 "No tool output found"）+
   *    LLM 看到完整 tool_call 上下文 + 玩家放弃信号 → 玩家打字时 LLM 不会脑补"那你就直接写吧"
   *  - 永久性：chatHistories 存盘后 replay 仍能 detect（"玩家放弃"改写 + tool_calls 保留 2 个条件即可）*/
  async function cancelPendingToolCall(
    toolCallId: string,
    reason?: string,
    options?: { silently?: boolean },
  ): Promise<void> {
    const id = currentItemKey()
    const finalReason = reason ?? '玩家放弃这个备选'
    const silently = options?.silently ?? false
    console.log(
      `[world.cancelPendingToolCall] ${id} starting: tool_call_id=${toolCallId}, reason=${finalReason}, silently=${silently}`,
    )
    if (silently) {
      // v0.5+ 主流做法（对齐 concept store，UI 不重复版）：
      // 1) 改写 assistant content（玩家放弃语义）
      // 2) 保留 tool_calls 字段（UI 走"✓ 已答"tool-question bubble，LLM 看到 tool_call 上下文）
      // 3) 不追加 tool message to chatHistories（避免 UI 重复）
      // 4) runChatRound 拼 messages 时**临时**为这种 assistant message 补 tool_result
      //    （从 chatHistories 检测 content === SILENTLY_ABANDONED_CONTENT）
      const histories = mapGet(chatHistories, id, [])
      const idx = histories.findIndex(
        (m) => m.role === 'assistant' && m.tool_calls?.some((tc) => tc.id === toolCallId),
      )
      if (idx >= 0) {
        const next = [...histories]
        const orig = next[idx]!
        const abandonMsg = '玩家放弃这批备选，等玩家打字。'
        // 改写 content + 保留 tool_calls 字段
        next[idx] = { ...orig, content: abandonMsg }
        mapSet(chatHistories, id, next)
        console.log(
          `[world.cancelPendingToolCall] ${id} silently rewrote assistant message idx=${idx} (preserved tool_calls, content='${abandonMsg}'; tool result 临时拼给 LLM 不存)`,
        )
      } else {
        console.warn(
          `[world.cancelPendingToolCall] ${id} silently: no assistant message found with tool_call_id=${toolCallId}`,
        )
      }
      removePendingToolCall(id, toolCallId)
      return
    }
    await sendToolResult(toolCallId, finalReason)
  }

  const pendingToolCallsForItem = computed(() => mapGetPendingToolCalls(currentItemKey()))

  /** 内部：发一轮 LLM（user 消息流 / tool result 流 共用）—— 对称 concept store */
  async function runChatRound(opts: {
    id: string
    conn: Awaited<ReturnType<typeof resolveLlmConnection>>
    contextStr?: string
  }): Promise<void> {
    const { id, conn, contextStr } = opts
    const settings = useSettingsStore()
    if (!settings.loaded) await settings.init()
    const tools = resolveEnabledTools(settings.config)
    const doc = docs.value.find((d) => d.id === currentDocId.value)
    if (!doc) throw new Error('未知分节')
    const systemContent =
      sectionChatSystemPrompt(doc) +
      (contextStr ? '\n\n' + contextStr : '') +
      (doc.content.trim() ? `\n\n当前「${doc.title}」已有的内容：\n${doc.content.trim()}` : '')
    const runId = await rpcStartChat(
      [
        { role: 'system', content: systemContent },
        // **v0.5+ silently 临时补 tool message**：跟 concept store 同款——遇到 silently 改写的
        //   assistant message 临时补 tool_result 给 LLM（OpenAI 协议层配对）
        ...buildMessagesWithSilentAbandonToolResult(id),
      ],
      { model: conn.model, effort: null, tools },
    )
    mapSet(chatRunIds, id, runId)
  }

  /** v0.5+ silently 改写常量（对齐 concept store）
   *  - runChatRound 拼 messages 时扫 chatHistories，匹配这个 content 的 assistant message → 临时补 tool message
   *    给 LLM（OpenAI 协议层 tool_calls + tool_result 配对），**不**改 chatHistories
   *  - 不用维护 separate state（per item Set）——直接 string 匹配（content 固定就是这串）
   *  - 永久性：chatHistories 存盘后 replay 仍能 detect
   *  - 跟 concept store 完全一致——同一常量 */
  const SILENTLY_ABANDONED_CONTENT = '玩家放弃这批备选，等玩家打字。'

  /** v0.5+ 拼 messages 给 LLM 时，临时为 silently 放弃的 assistant message 补 tool_result
   *  - 跟 concept store 同款：见 `concept.ts:buildMessagesWithSilentAbandonToolResult` 注释
   *  - 不用维护 separate state——直接 string 匹配 */
  function buildMessagesWithSilentAbandonToolResult(itemId: string): Array<{
    role: ChatMessage['role']
    content: string
    partial?: boolean
    tool_calls?: ToolCallInfo[]
    tool_call_id?: string
  }> {
    const result: Array<{
      role: ChatMessage['role']
      content: string
      partial?: boolean
      tool_calls?: ToolCallInfo[]
      tool_call_id?: string
    }> = []
    const histories = mapGet(chatHistories, itemId, [])
    for (const m of histories) {
      if (m.role === 'system') continue
      result.push({
        role: m.role,
        content: m.content,
        partial: m.partial,
        tool_calls: m.tool_calls,
        tool_call_id: m.tool_call_id,
      })
      // silently 改写的 assistant message：临时补 tool message（不存 chatHistories）
      if (
        m.role === 'assistant' &&
        m.content === SILENTLY_ABANDONED_CONTENT &&
        m.tool_calls &&
        m.tool_calls.length > 0
      ) {
        for (const tc of m.tool_calls) {
          result.push({
            role: 'tool',
            content: SILENTLY_ABANDONED_CONTENT,
            tool_call_id: tc.id,
          })
        }
      }
    }
    return result
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
    mapSet(chatErrorDiags, id, null)
    // v0.4.4+ ask_free_text pending 也要清
    clearAskFreeTextForItem(id)
    // v0.4.4+ pendingToolCalls 也要清
    clearPendingToolCallsForItem(id)
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
    chatErrorDiags.value = new Map()
    // v0.4.4+ ask_free_text pending 也要清
    askFreeTextPending.value = new Map()
    triggerRef(askFreeTextPending)
    // v0.4.4+ pendingToolCalls 也要清
    pendingToolCalls.value = new Map()
    triggerRef(pendingToolCalls)
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
    errorDiag,
    send: sendStepChat,
    /** v0.4+ tool result 喂回 LLM（多轮 tool calling） */
    sendToolResult,
    reset: resetStepChat,
    // === v0.4.4.1+ ask_free_text 强制回复（UX 整合到 composer，1 round 1 ask_free_text 单问题版，对齐 concept store） ===
    askFreeTextPending: askFreeTextPendingForItem,
    sendAllAskFreeTextAnswers,
    // === v0.4.4+ 全 tool 通用 pending（对齐 concept store） ===
    pendingToolCalls: pendingToolCallsForItem,
    cancelPendingToolCall,
  })

  return {
    docs,
    loading,
    error,
    currentDocId,
    load,
    save,
    init,
    // markRaw 防 Pinia 深度 reactive 化 ref/computed；as unknown as StepChatState 强制 cast
    // （Pinia 类型在 build 模式严格，暴露 ref/computed 时被解包；runtime 通过 markRaw 保证不丢响应性）
    stepChat: markRaw(stepChat) as unknown as StepChatState,
    resetStepChat,
    clearAllStepChats,
    flushChatsTo, // 暴露给 view：切项目前调，把内存 chats 写到指定 folder
    // v0.5+ sync：概念 → 世界（被 concept store 调 + view 调清黄点）
    conceptStaleDocs,
    markStaleFromConcept,
    clearStaleFromConcept,
    clearAllConceptStale,
  }
})
