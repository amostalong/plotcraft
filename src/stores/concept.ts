// concept pinia store —— 概念设计漏斗（6 步）+ LLM 辅助
//
// 照搬 stores/art.ts 形状：
// - steps 用 shallowRef 包（反卡顿惯例：大列表不深 reactive）
// - load() 依赖 useProjectStore().current：无项目 → 清空不报错
// - 不做文件监听：玩家手改 concept/ 后点"刷新"重扫（对齐 art）
//
// step chat（v0.3+ 重构：per-item Map 化 + 备选内联化 + 自动落盘）
// - 复用流式 start_chat，store 级 listener 按 runId 过滤（init 幂等）
// - 状态从 per-item Map<stepId, ...> 派生，currentStepId 切步自动切派生
// - 切步保留历史（v0.3+ 内存 per-item）；切项目 flush 老项目 + 清内存 + load 新项目
// - 备选走流式 chat + JSON parse（done 后判定卡片 vs 气泡），删 v0.2 的 generateAlternatives
// - **自动落盘**（v0.3+ 玩家反馈"想保留"）：watch chatHistories → debounce 1s → saveChat
//   位置 <项目>/.chats/concept/<stepId>.json（详见 [docs/AI_PANEL_DESIGN.md]）
//
// 详细设计见 [docs/AI_PANEL_DESIGN.md]

import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef, triggerRef, watch, type Ref } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'

import { resolveEnabledTools } from '@/lib/ai-tools'
import { deleteChat, deleteAllChats, loadChats, makeItemKey, saveChat, type ChatFile } from '@/lib/chats'
import { listConceptSteps, saveConceptStep } from '@/lib/concept'
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
import type { ConceptStep, ConceptStepId } from '@/types/concept'
import { useProjectStore } from './project'
import { useSettingsStore } from './settings'

// === 6 步静态定义（hint = 写作引导语，编辑区显示 + 拼 LLM prompt 的说明部分） ===

export const STEP_HINTS: Record<ConceptStepId, string> = {
  seed: '一个画面、一种情绪、一个「如果……会怎样」—— 模糊没关系，先写下来',
  'core-fantasy': '玩家是谁、在什么处境、做什么 —— 一句话说清核心体验',
  pillars: '3-5 条设计支柱 —— 每条都要有否决权，「丰富剧情」这种废话不算',
  'world-rules': '每条写清「是什么 + 造成什么冲突」—— 写不出冲突的规则是可疑的',
  'character-functions': '每个角色想要什么、为什么得不到 —— 功能是制造冲突',
  'three-act': '冲突加压序列 —— 一幕比一幕紧，写 3-5 个关键转折点',
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
  '基于当前步骤最新内容回答。'

/** 反思/追问类 preset 通用尾巴（v0.4+ 走 ask_free_text tool，prompt 兜底走 markdown）
 *  - 玩家主导：只给追问，玩家自己答，绝不替玩家做决定 */
const REFLECT_TAIL =
  '玩家主导：你只给备选/追问，玩家挑+改，绝不替玩家做决定。' +
  '基于当前步骤最新内容回答。'

/** 润色 / 扩展 类 preset 通用指令（v0.3+ 改成"出 3-5 个不同方向的备选"）
 *  - v0.3 早期是"输出完整润色/扩展后的版本" (一个 bubble), 玩家只能采用或放弃
 *  - v0.3 后改成跟 generate 一样: LLM 一次给 3-5 个不同方向, 玩家挑一个
 *  - v0.4+ 改走 tool calling：LLM 优先调 `ask_user_question` tool 返备选，
 *    玩家挑一个后再 LLM round 2 调 `update_doc_item` tool 写入
 *  - 这俩 instruction 拼好后, store sendStepChat 会再 append 当前 step.content
 *    (不依赖 system 注入, 确保 LLM 拿到完整原文做改造) */
const POLISH_INSTRUCTION =
  '把这步的内容润色 3-5 个不同方向。每个备选都要：\n' +
  '- 保持原意，不改方向\n' +
  '- 改进表达：更精炼 / 更有画面感 / 节奏更紧凑\n' +
  '- 删废话，保留关键信息\n' +
  '- 是完整润色后的版本（不是修改说明）\n' +
  '- 长度跟原文相当（不要扩长，那是另一个 chip 的事）'

const EXPAND_INSTRUCTION =
  '把这步的内容扩展 3-5 个不同方向。每个备选都要：\n' +
  '- 保持原意，不改方向\n' +
  '- 加细节 / 加例子 / 加场景 / 加张力\n' +
  '- 让内容更具体、更可玩、更有画面\n' +
  '- 是完整扩展后的版本（不是扩展说明）\n' +
  '- 长度比原文明显更长（至少 1.5 倍，扩写就是要更厚）'

// === 6 步 × 4 presets 静态配置（chip + 完整 prompt）===

export const STEP_PRESETS: Record<ConceptStepId, PresetAction[]> = {
  seed: [
    {
      label: '💡 给 3-5 个一句话种子',
      prompt:
        '根据玩家给的素材，给出 3-5 个不同方向的一句话种子版本（画面感 / 情绪 / "如果..." 各试）。' +
        JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 反问我 3 个尖锐问题',
      prompt: '玩家想法模糊时，先反问 3 个尖锐问题逼玩家想清楚（不要急着给答案）。' + REFLECT_TAIL,
      action: 'reflect',
    },
    {
      label: '✨ 润色我的种子',
      prompt: POLISH_INSTRUCTION + JSON_TAIL,
      action: 'polish',
    },
    {
      label: '🌱 扩展我的种子',
      prompt: EXPAND_INSTRUCTION + JSON_TAIL,
      action: 'expand',
    },
  ],
  'core-fantasy': [
    {
      label: '💡 给 3-5 个改写',
      prompt:
        '「玩家是___，在___处境，做___」格式。给出 3-5 个改写，每个都要具体到能想象出实际游玩的一分钟。' +
        JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检验这句有没有钩子',
      prompt: '帮玩家检验他写的核心体验有没有钩子（让玩家想玩下去的张力）。' + REFLECT_TAIL,
      action: 'reflect',
    },
    {
      label: '✨ 润色核心体验',
      prompt: POLISH_INSTRUCTION + JSON_TAIL,
      action: 'polish',
    },
    {
      label: '🌱 扩展核心体验',
      prompt: EXPAND_INSTRUCTION + JSON_TAIL,
      action: 'expand',
    },
  ],
  pillars: [
    {
      label: '💡 从核心体验拆支柱',
      prompt: '从核心体验拆 3-5 条设计支柱，每条必须有否决权 —— 能用来否决具体方案。' + JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 打回我的废话支柱',
      prompt:
        '「丰富剧情」「画面精美」这种无法否决任何方案的废话支柱要打回，明确指出并给出可否决的写法。' +
        REFLECT_TAIL,
      action: 'reflect',
    },
    {
      label: '✨ 润色支柱',
      prompt: POLISH_INSTRUCTION + JSON_TAIL,
      action: 'polish',
    },
    {
      label: '🌱 扩展支柱',
      prompt: EXPAND_INSTRUCTION + JSON_TAIL,
      action: 'expand',
    },
  ],
  'world-rules': [
    {
      label: '💡 从核心体验推规则',
      prompt: '从核心体验推 3-5 条世界规则，每条 = 是什么 + 造成什么冲突。' + JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检查规则有没有冲突',
      prompt: '检查玩家写的世界规则有没有规则间冲突 / 压死玩法的情况。' + REFLECT_TAIL,
      action: 'reflect',
    },
    {
      label: '✨ 润色世界规则',
      prompt: POLISH_INSTRUCTION + JSON_TAIL,
      action: 'polish',
    },
    {
      label: '🌱 扩展世界规则',
      prompt: EXPAND_INSTRUCTION + JSON_TAIL,
      action: 'expand',
    },
  ],
  'character-functions': [
    {
      label: '💡 按模式生成人物候选',
      prompt:
        '按模式生成人物候选：对手 = 支柱的反面人格化；镜子 = 主角的另一种可能；推手 = 推进情节。' +
        '每个角色写清「想要什么 + 为什么得不到」。' +
        JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检查人物是不是纸片人',
      prompt: '检查玩家写的人物是不是纸片人（缺「想要什么」或「为什么得不到」的打回）。' + REFLECT_TAIL,
      action: 'reflect',
    },
    {
      label: '✨ 润色人物功能',
      prompt: POLISH_INSTRUCTION + JSON_TAIL,
      action: 'polish',
    },
    {
      label: '🌱 扩展人物功能',
      prompt: EXPAND_INSTRUCTION + JSON_TAIL,
      action: 'expand',
    },
  ],
  'three-act': [
    {
      label: '💡 给 3-5 种加压走法',
      prompt: '给出 3-5 种冲突加压序列的走法，每种写清三幕各自的加压点（一幕比一幕紧）。' + JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检验压力有没有递增',
      prompt: '帮玩家检验三幕骨架的压力有没有递增（第二幕比第一幕紧、第三幕不能塌）。' + REFLECT_TAIL,
      action: 'reflect',
    },
    {
      label: '✨ 润色三幕骨架',
      prompt: POLISH_INSTRUCTION + JSON_TAIL,
      action: 'polish',
    },
    {
      label: '🌱 扩展三幕骨架',
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
function stepChatSystemPrompt(step: ConceptStep): string {
  return (
    `你是 PlotCraft 的 AI 编剧搭档，正在帮玩家做「${step.title}」这一步。\n` +
    `这一步要写什么：${STEP_HINTS[step.id as ConceptStepId] ?? ''}\n` +
    `玩家主导原则：你只给备选/追问/建议，玩家挑+改，绝不替玩家做决定。\n` +
    `**严格遵循用户消息中指定的输出格式**：\n` +
    `- 如果用户要求 JSON 数组 → 第一个字符必须是 \`[\`，**不要**任何额外文字/preamble/思考/解释\n` +
    `- 如果用户没指定 → 输出 markdown，保持简洁`
  )
}

/** 拼 context：前面步骤的 confirmed 内容（按 STEP_IDS 顺序取当前步之前的） */
function buildContext(steps: ConceptStep[], currentId: string): string {
  const idx = steps.findIndex((s) => s.id === currentId)
  const prior = steps.slice(0, idx === -1 ? 0 : idx).filter((s) => s.status === 'confirmed')
  if (prior.length === 0) return ''
  return (
    '已确认的前置步骤（生成内容必须与之保持一致）：\n' +
    prior.map((s) => `## ${s.title}\n${s.content.trim()}`).join('\n\n')
  )
}

export const useConceptStore = defineStore('concept', () => {
  const steps = shallowRef<ConceptStep[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const currentStepId = ref<string>('seed')

  // === load / save（照搬 art store 形状） ===

  /** 扫描当前项目 concept/ —— 无项目 → 清空（不报错）
   *  v0.3+ 同时加载 .chats/concept/*.json 到 chatHistories（chat 落盘）*/
  async function load(): Promise<void> {
    const project = useProjectStore()
    if (!project.current) {
      steps.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      steps.value = await listConceptSteps(project.current.folder)
      // 加载 chat 历史（v0.3+ 落盘）
      const chats = await loadChats(project.current.folder)
      const next = new Map<string, ChatMessage[]>()
      for (const [itemKey, file] of Object.entries(chats)) {
        // 后端返回的 itemKey 是 "concept:seed" 格式 → store 内部 key 也是 "concept:seed"（落盘 key 与 in-memory 一致）
        next.set(itemKey, file.messages)
      }
      chatHistories.value = next
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      console.error('[concept.load] failed:', e)
    } finally {
      loading.value = false
    }
  }

  /** 保存一步（v0.3+ 永远 markConfirmed=true：玩家操作 = 自动 confirmed，不再有"标记为已确认"按钮）
   *  成功用后端返回的 step 替换本地项（shallowRef → 整个数组换新引用）；
   *  失败抛错让 UI 提示 */
  async function save(stepId: string, content: string, markConfirmed: boolean): Promise<void> {
    const project = useProjectStore()
    if (!project.current) throw new Error('没有打开的项目')
    const updated = await saveConceptStep(project.current.folder, stepId, content, markConfirmed)
    steps.value = steps.value.map((s) => (s.id === stepId ? updated : s))
  }

  // === step chat v0.3+ per-item Map 化 + 自动落盘 ===
  //
  // 5 个 Map<stepId, ...> + 1 个 Map<stepId, runId>，shallowRef 包；
  // shallowRef(new Map) 的 set/get 不自动追踪响应性 → 用 triggerRef 显式触发
  // 设计：见 [docs/AI_PANEL_DESIGN.md §3.3 + §4.3]
  //
  // **v0.3+ 落盘**：store 内部 key = "concept:<stepId>"（与后端 item_key 格式一致），
  // 派生 computed `messages` 等按 `concept:${currentStepId}` 取值。
  // chatHistories 整体变化 → debounce 1s → flushChatsToDisk 写盘
  // reset / clearAll 立即 delete（不等 debounce）

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

  /** 按 runId 找 itemId（chunk/done/error listener 用）*/
  function findItemByRunId(runId: string): string | null {
    for (const [id, rid] of chatRunIds.value) {
      if (rid === runId) return id
    }
    return null
  }

  /** 当前 step 在 store 内部的 chat map key（"concept:<stepId>"）*/
  function currentItemKey(): string {
    return makeItemKey('concept', currentStepId.value)
  }

  // 派生 computed —— 组件拿到的是 currentStepId 对应的那一份
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

  /** v0.4+ tool call 累积状态（per-item Map<index, ToolCallInfo>）
   *  - 流式累积：start 时 id+name 已知, arguments 后续累积
   *  - done 时（arguments 合法 JSON 或 done event 触发）→ 转成 ToolCallInfo 存到 chatHistories
   *  - 跟 chatTexts 一样是 per-item Map，shallowRef + triggerRef
   *  - 切步 / 切项目 / reset 时清 */
  const chatToolCalls = shallowRef(new Map<string, Map<number, ToolCallInfo>>())

  function mapGetToolCalls(itemId: string): Map<number, ToolCallInfo> {
    return chatToolCalls.value.get(itemId) ?? new Map()
  }

  function mapSetToolCalls(itemId: string, tc: Map<number, ToolCallInfo>) {
    chatToolCalls.value.set(itemId, tc)
    triggerRef(chatToolCalls)
  }

  /** 流式累积一个 tool call partial 到对应 item 的 tool call 状态 */
  function accumulateToolCallPartial(itemId: string, partial: ToolCallPartial) {
    const tc = new Map(mapGetToolCalls(itemId))
    const existing = tc.get(partial.index)
    if (partial.id || partial.name) {
      // start chunk：建/覆盖 entry
      tc.set(partial.index, {
        id: partial.id ?? existing?.id ?? '',
        name: partial.name ?? existing?.name ?? '',
        arguments: (existing?.arguments ?? '') + partial.arguments_delta,
      })
    } else {
      // delta chunk：arguments 累积
      if (existing) {
        tc.set(partial.index, {
          id: existing.id,
          name: existing.name,
          arguments: existing.arguments + partial.arguments_delta,
        })
      } else {
        // 没 start 直接 delta（异常）：建临时 entry
        tc.set(partial.index, {
          id: '',
          name: '',
          arguments: partial.arguments_delta,
        })
      }
    }
    mapSetToolCalls(itemId, tc)
  }

  /** done 时把所有累积的 tool calls 写到 chatHistories 最后一条 assistant message 的 tool_calls 字段 */
  function flushToolCallsToHistory(itemId: string) {
    const tcs = mapGetToolCalls(itemId)
    if (tcs.size === 0) return
    const tcsArray: ToolCallInfo[] = Array.from(tcs.values())
    const cur = mapGet(chatHistories, itemId, [])
    if (cur.length === 0) return
    // 最后一条 assistant message 加 tool_calls
    const last = cur[cur.length - 1]
    if (last.role === 'assistant') {
      const updated = [...cur.slice(0, -1), { ...last, tool_calls: tcsArray }]
      mapSet(chatHistories, itemId, updated)
    }
    // 清累积状态
    mapSetToolCalls(itemId, new Map())
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
    // v0.4+ tool call 流式事件订阅 —— 按 runId 过滤后累积到 chatToolCalls
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
        // v0.4+ tool call 模式：没 text content（LLM 纯 tool call, 没自然语言）
        // → 写空 content 但带 tool_calls 的 assistant message
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
            `[concept.onChatDone] ${id} run=${payload.run_id} OK: contentLen=${accumulated.length}, action=${lastUser?.action ?? 'none'}, toolCalls=${toolCalls?.length ?? 0}`,
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
            `[concept.onChatDone] ${id} run=${payload.run_id} OK: pure tool_call, toolCalls=${toolCalls.length}, names=${toolCalls.map((t) => t.name).join(',')}`,
          )
        } else {
          console.warn(`[concept.onChatDone] ${id} run=${payload.run_id} empty content (LLM returned 0 chars?)`)
        }
        mapSet(chatTexts, id, '')
        mapSet(chatRunIds, id, null)
        mapSet(chatStreamings, id, false)
        // 清 tool call 累积状态
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
          `[concept.onChatError] ${id} run=${payload.run_id} kind=${payload.kind} err="${payload.error}" partialLen=${accumulated.length} partialToolCalls=${tcs.size}`,
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

  /** 发一条 step chat 消息
   *  - preset 存在 → user 气泡用 preset.label；LLM 收到 preset.prompt（不是 text）
   *  - preset 不存在 → 自由输入，user 气泡 = text，LLM 收到 text
   *  - **polish / expand**：prompt 末尾显式追加当前 step.content（不依赖 system 注入的截断版）
   *  - 历史：发后端前 strip preset + action field（后端 ChatMessage 没这俩字段，详见 types/chat.ts 注释）
   *  - 失败抛错让 UI 提示 */
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
      console.log(`[concept.sendStepChat] ${id} ignored: already streaming`)
      return
    }
    const step = steps.value.find((s) => s.id === currentStepId.value)
    if (!step) throw new Error('未知步骤')
    await init()

    // 玩家手动 / 自动重试 的诊断
    console.log(
      `[concept.sendStepChat] ${id} starting: preset=${preset?.label ?? '(free text)'}, action=${preset?.action ?? 'none'}, isRetry=${isRetry}, stepContentLen=${step.content.length}`,
    )

    // polish / expand 必须显式附当前 step.content（确保 LLM 拿到完整原文做改造）
    if (preset && (preset.action === 'polish' || preset.action === 'expand')) {
      prompt = `${prompt}\n\n当前「${step.title}」内容：\n${step.content.trim()}`
    }

    // v0.3+ 自动重试: 标记 retry=true (前端 only, 发后端前 strip)
    const userMsg: ChatMessage = preset
      ? { role: 'user', content: prompt, preset: preset.label, action: preset.action, retry: isRetry || undefined }
      : { role: 'user', content: trimmedText, retry: isRetry || undefined }
    const cur = mapGet(chatHistories, id, [])
    mapSet(chatHistories, id, [...cur, userMsg])
    mapSet(chatErrorKinds, id, null)
    mapSet(chatErrorRaws, id, null)

    const contextParts: string[] = []
    const ctx = buildContext(steps.value, currentStepId.value)
    if (ctx) contextParts.push(ctx)
    if (step.content.trim()) {
      contextParts.push(`当前「${step.title}」已有的内容：\n${step.content.trim()}`)
    }

    try {
      mapSet(chatStreamings, id, true)
      // model 显式传解析结果：start_chat 的 model: null 走 config.json 兜底，
      // 那里可能是没同步过的失效值（400 invalid model 踩过）——resolveLlmConnection 才跟会话 tab 同源
      const conn = await resolveLlmConnection()
      // v0.4+ 走 tool calling：runChatRound 内部自动 resolveEnabledTools 注入 tools 字段，
      // LLM 收到 schema 强制调 ask_user_question / update_doc_item 返结构化数据
      await runChatRound({ id, conn })
    } catch (e) {
      mapSet(chatStreamings, id, false)
      console.error('[concept.sendStepChat] startChat FAILED:', e)
      throw e
    }
  }

  /** v0.4+ tool result 喂回 LLM（多轮 tool calling 核心）
   *  - 玩家点 AltCard / 确认 update_doc_item 后调这个
   *  - 加 `role: 'tool'` 消息到 chatHistories，关联到对应 tool_call 的 id
   *  - 调 LLM 第二轮（带 tool_calls / tool_call_id 完整 messages）
   *  - LLM 第二轮可能：
   *    - 调 update_doc_item tool → 走 assistant-tool-update 渲染分支（玩家点"确认写入"再调一次）
   *    - 直接出 text → 走整体采用条 append
   *    - 调 ask_user_question tool → 又一个 AltCard 循环
   *  - 失败抛错让 UI 提示 */
  async function sendToolResult(toolCallId: string, content: string): Promise<void> {
    const id = currentItemKey()
    if (mapGet(chatStreamings, id, false)) {
      console.log(`[concept.sendToolResult] ${id} ignored: already streaming`)
      return
    }
    if (!steps.value.find((s) => s.id === currentStepId.value)) {
      throw new Error('未知步骤')
    }
    await init()

    console.log(
      `[concept.sendToolResult] ${id} starting: tool_call_id=${toolCallId}, contentLen=${content.length}`,
    )

    // 加 tool result 消息（关联到对应 tool_call）
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
      console.error('[concept.sendToolResult] startChat FAILED:', e)
      throw e
    }
  }

  /** 内部：发一轮 LLM（user 消息流 / tool result 流 共用）
   *  - 拼 system + 完整 messages（透传 tool_calls / tool_call_id）
   *  - 注入 enabled tools（resolveEnabledTools 过滤关闭的）
   *  - 失败抛错（外层 catch 负责 streaming=false） */
  async function runChatRound(opts: {
    id: string
    conn: Awaited<ReturnType<typeof resolveLlmConnection>>
  }): Promise<void> {
    const { id, conn } = opts
    const settings = useSettingsStore()
    if (!settings.loaded) await settings.init()
    const tools = resolveEnabledTools(settings.config)
    // 找当前 step 拼 system context
    const step = steps.value.find((s) => s.id === currentStepId.value)
    if (!step) throw new Error('未知步骤')
    const ctx = buildContext(steps.value, currentStepId.value)
    const systemContent =
      stepChatSystemPrompt(step) +
      (ctx ? '\n\n' + ctx : '') +
      (step.content.trim() ? `\n\n当前「${step.title}」已有的内容：\n${step.content.trim()}` : '')
    const runId = await rpcStartChat(
      [
        { role: 'system', content: systemContent },
        // 过滤 system（第一轮 system 已含 context）+ strip preset field（后端 ChatMessage 不带）
        // v0.4+ tool_calls / tool_call_id 必须透传给后端（跨 request 回放需要）
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

  /** 清当前 step 的 chat 状态（UI「清空对话」按钮调）
   *  - 流式中的 run 不取消 —— runId 清掉后 listener 自动过滤掉后续 chunk
   *  - **v0.3+ 立即删文件**（不等 debounce），同时取消 pending save timer */
  function resetStepChat(): void {
    const id = currentItemKey()
    cancelPendingSave()
    mapSet(chatHistories, id, [])
    mapSet(chatTexts, id, '')
    mapSet(chatStreamings, id, false)
    mapSet(chatRunIds, id, null)
    mapSet(chatErrorKinds, id, null)
    mapSet(chatErrorRaws, id, null)
    // 立即删 .chats/concept/<stepId>.json
    const project = useProjectStore()
    if (project.current) {
      void deleteChat(project.current.folder, id).catch((e) =>
        console.error('[concept.resetStepChat] delete chat failed:', e),
      )
    }
  }

  /** 清所有 step 的 chat 状态（切项目调；不同项目 step 内容同 id 语义不同，叠加会乱）
   *  - **v0.3+ 立即 deleteAll 全部 .chats/concept/*.json**（取消 pending save） */
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
        console.error('[concept.clearAllStepChats] delete all chats failed:', e),
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

  /** 触发 debounce 落盘（chatHistories 每次变化都 schedule） */
  function scheduleChatSave() {
    cancelPendingSave()
    saveTimer = setTimeout(() => void flushChatsToCurrent(), SAVE_DEBOUNCE_MS)
  }

  /** 立即 flush chat 落盘到**当前**项目（不传 projectRoot；典型用途：切项目前先落盘老项目时传老 folder） */
  async function flushChatsToCurrent(): Promise<void> {
    cancelPendingSave()
    const project = useProjectStore()
    if (!project.current) return
    await flushChatsTo(project.current.folder)
  }

  /** 显式 flush chat 落盘到指定项目（view 切项目时调：先把内存里的旧项目 chats 写到旧 folder） */
  async function flushChatsTo(projectRoot: string): Promise<void> {
    cancelPendingSave()
    const snapshot = new Map(chatHistories.value)
    for (const [itemKey, messages] of snapshot) {
      if (messages.length === 0) continue // 空 messages → 不写盘（reset/clearAll 已 delete 文件）
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
        console.error('[concept.flushChatsTo] save chat failed:', itemKey, e)
      }
    }
  }

  // chatHistories 变化 → debounce 落盘
  watch(chatHistories, () => {
    scheduleChatSave()
  })

  /** 通用 AiChatPanel 用的 step chat 状态包（types/ai.ts StepChatState）
   *  markRaw 必须：store 实例是 reactive 代理，普通对象会被深度 reactive 化、
   *  嵌套的 ref/computed 被自动解包（组件期望 Ref/ComputedRef 却拿到裸值 → .value 崩）*/
  const stepChat: StepChatState = markRaw({
    messages,
    text,
    streaming,
    errorKind,
    errorRaw,
    send: sendStepChat,
    /** v0.4+ tool result 喂回 LLM（玩家点 AltCard / 确认 update_doc_item 后调） */
    sendToolResult,
    reset: resetStepChat,
  })

  return {
    steps,
    loading,
    error,
    currentStepId,
    load,
    save,
    init,
    stepChat,
    resetStepChat,
    clearAllStepChats,
    flushChatsTo, // 暴露给 view：切项目前调，把内存 chats 写到指定 folder
  }
})
