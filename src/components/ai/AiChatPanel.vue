<script setup lang="ts">
// AiChatPanel —— AI 面板右栏统一组件（v0.4+ 重构）
//
// v0.3+ 走 JSON 数组解析（parseAlternatives）把备选内联进消息气泡。
// v0.4+ 替换为 tool calling：
// - LLM 用 ask_user_question tool 给 N 个备选 → AltCard 卡片组
// - LLM 用 ask_free_text tool 反问玩家 → 气泡 + "我去答" 按钮
// - LLM 用 update_doc_item tool 主动写编辑器 → "AI 建议采用 X" + "确认写入"按钮
//
// 渲染分支：assistant 消息带 tool_calls → 按 tool name 分发到 3 种 kind
// 不带 tool_calls → 老路径（polish/expand/reflect 走单气泡 / 整体采用条）
//
// v0.3+ JSON 解析路径（parseAlternatives / polishExpandFailed）已删除：
// - LLM 不会在 content 字段返 JSON 数组了（schema 强制走 tool call）
// - polishExpandFailed 兜底不再需要
//
// 详细见 [docs/AI_PANEL_DESIGN.md]
//
// 实现注意（v0.3 实施踩坑，沿用 v0.4+）：
// 单条消息气泡抽成独立 .vue（MessageBubble），不能在 script setup 内用
// `defineComponent({ setup() { return () => h(...) } })` 写法当 functional component，
// 里面 useMarkdown 创建的 computed effect 找不到 instance scope 归属，
// 触发 Vue 3.5 `locateNonHydratedAsyncRoot(null)` 崩。

import { computed, nextTick, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, ClipboardCopy, Eraser, Loader2, Send, Sparkles } from 'lucide-vue-next'

import { getErrorMessage } from '@/lib/error-messages'
import ModelEffortSelector from '@/components/chat/ModelEffortSelector.vue'
import { useSettingsStore } from '@/stores/settings'
import type { AdoptPayload, PresetAction, StepChatState } from '@/types/ai'
import type { ChatErrorDiag, ChatErrorKind, ChatMessage, ToolCallInfo } from '@/types/chat'
import type { EffortLevel } from '@/lib/settings'

import AltCard from './AltCard.vue'
// v0.4.4.1+ AskFreeTextInput 废弃（UX 整合到 composer）—— 组件文件保留作 reference，
// AiChatPanel 不再 import / render
import MessageBubble from './MessageBubble.vue'

const props = defineProps<{
  /** 当前 item id（仅 reset 反馈日志 / 跟踪用；派生都从 props.chat 拿）*/
  itemId: string
  /** 显示在 header（"AI 助手 · 种子"） */
  title: string
  /** per-item 状态（store 组合注入，markRaw 后内部 ref/computed 不被 Pinia 解包） */
  chat: StepChatState | { [K in keyof StepChatState]: StepChatState[K] }
  /** 当前 item 的预设 chip 列表（store export STEP_PRESETS[xxx]） */
  presets: PresetAction[]
  /** header 字数显示（"123 字"）；不传就不显示 */
  wordCount?: number
}>()
const emit = defineEmits<{ adopt: [payload: AdoptPayload] }>()

// ComputedRef 也是 Ref，解构不丢响应性
const {
  messages,
  streaming,
  errorKind,
  errorRaw,
  send,
  sendToolResult,
  reset,
  // v0.4.4.1+ ask_free_text 强制回复协议（UX 整合到 composer，1 round 1 ask_free_text 单问题版）
  askFreeTextPending,
  sendAllAskFreeTextAnswers,
  // v0.4.4+ 全 tool 通用 pending（ask_choose_option / ask_user_question / update_doc_item 通用）—— 锁 composer
  pendingToolCalls,
  cancelPendingToolCall,
} = props.chat

const input = ref('')
const listEl = ref<HTMLElement | null>(null)
/** startChat invoke 本身失败（不是流式 error event）的本地错误 */
const localError = ref<string | null>(null)
/** v0.4.4.1+ 防 onSend 重入：双击回车 / 双 trigger 会让 askFreeTextPending 在第一次 await
 *  时被清空，第二次 onSend 走 sendStepChat 加 user message（玩家截图 bug：同一内容
 *  出现 2 个气泡——绿色"已答"+ 灰色 user 风格）。sending 是 ref 同步设值，
 *  onSend 入口 check + 立即设 true，try-finally 释放 */
const sending = ref(false)

const streamError = computed(() => {
  if (!errorRaw.value) return null
  return getErrorMessage(errorKind.value, errorRaw.value)
})

// v0.4.1+ 错误诊断包（endpoint / model / api_format / request_body_preview）—— 4 字段 optional
const errorDiag = computed<ChatErrorDiag | null>(() => {
  // v0.4.1+ 概念 / 世界 store 暴露 errorDiag；老 store 没这字段 → undefined
  const v = (props.chat as { errorDiag?: { value: ChatErrorDiag | null } }).errorDiag
  return v?.value ?? null
})
/** v0.4.1+ 错误条诊断区展开/折叠（默认展开） */
const errorExpanded = ref(true)
/** v0.4.1+ 复制诊断信息按钮状态 */
const copyState = ref<'idle' | 'copied' | 'failed'>('idle')

// === v0.4.1+ Model 切换（header 集成 ModelEffortSelector）
// - 跟 chat tab 同款组件，placement=bottom（trigger 在 panel 顶部，popover 往下弹不撞 stepper）
// - 切 model 时同步 settings.config.base_url / apiKey / apiFormat / model（不写 chat.selectedModel，
//   概念 / 世界 store 走 resolveLlmConnection 直读 settings.config，不经 chat store）
const settings = useSettingsStore()
const aiPanelShortcuts = computed(() =>
  settings.config.customProviders
    .filter((p) => p.enabled)
    .map((p) => {
      const effective = p.defaultModel?.trim() || p.models?.[0]?.id?.trim() || ''
      return { id: p.id, name: p.name, defaultModel: effective }
    })
    .filter((p) => p.defaultModel.length > 0),
)
const aiPanelUnconfiguredCount = computed(
  () =>
    settings.config.customProviders.filter((p) => {
      if (!p.enabled) return false
      const effective = p.defaultModel?.trim() || p.models?.[0]?.id?.trim() || ''
      return effective === ''
    }).length,
)
/** 当前 panel 用的 model（settings.config.model 实时） */
const aiPanelModel = computed(() => settings.config.model?.trim() || '')
/** 当前 panel 的 effort（v0.4.1+ 复用 settings.config.effort，概念 / 世界 tab 不接 effort，先隐藏） */
const aiPanelEffort = computed(() => settings.config.effort ?? 'none')

/** v0.4.1+ 切 model —— 跟 chat tab onSelectModel 同款逻辑（同步整组 provider 配置）
 *  - 不写 chat.selectedModel（chat tab 专属字段，概念 / 世界 tab 不经 chat store）
 *  - 改完 settings.save() → 下次 resolveLlmConnection 走新 model */
function onSelectModel(id: string) {
  const cp = settings.config.customProviders.find((p) => {
    if (!p.enabled) return false
    const effective = p.defaultModel?.trim() || p.models?.[0]?.id?.trim() || ''
    return effective === id
  })
  if (cp) {
    settings.config.base_url = cp.baseUrl
    settings.config.apiKey = cp.apiKey
    settings.config.apiFormat = cp.apiFormat
    settings.save().catch((e) => console.error('[AiChatPanel.onSelectModel] save failed:', e))
  }
  settings.config.model = id
  settings.save().catch((e) => console.error('[AiChatPanel.onSelectModel] model save failed:', e))
}

/** v0.4.1+ 复制诊断信息 —— 跟 SessionView 同款 */
async function onCopyDiag() {
  const payload = {
    kind: errorKind.value ?? 'unknown',
    error: errorRaw.value ?? '',
    endpoint: errorDiag.value?.endpoint ?? '',
    model: errorDiag.value?.model ?? '',
    api_format: errorDiag.value?.api_format ?? '',
    request_body_preview: errorDiag.value?.request_body_preview ?? '',
    run_id: '',
    item_id: props.itemId,
    timestamp: new Date().toISOString(),
  }
  const text =
    `PlotCraft chat error diagnostic\n` +
    `================================\n` +
    `item_id:     ${payload.item_id}\n` +
    `kind:        ${payload.kind}\n` +
    `endpoint:    ${payload.endpoint}\n` +
    `model:       ${payload.model}\n` +
    `api_format:  ${payload.api_format}\n` +
    `timestamp:   ${payload.timestamp}\n` +
    `--------------------------------\n` +
    `raw error:\n${payload.error}\n` +
    `--------------------------------\n` +
    `request body preview (truncated to 800 chars):\n${payload.request_body_preview}\n` +
    `================================\n` +
    `\n--- JSON ---\n` +
    JSON.stringify(payload, null, 2)
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    copyState.value = 'copied'
    setTimeout(() => {
      copyState.value = 'idle'
    }, 1500)
  } catch (e) {
    console.error('[AiChatPanel.onCopyDiag] clipboard failed:', e)
    copyState.value = 'failed'
    setTimeout(() => {
      copyState.value = 'idle'
    }, 2000)
  }
}

/** 解析 ask_choose_option tool 的 arguments（JSON 字符串）→ {question, options[]}
 *  - v0.5+ 旧名 ask_user_question（这个名不准确：是"让玩家挑选项"不是"问问题"）
 *  - 失败 → null（前端走"AI 在想..."占位） */
function parseAskChooseOption(tc: ToolCallInfo): { question: string; options: { label: string; preview: string; description?: string }[] } | null {
  try {
    const args = JSON.parse(tc.arguments)
    if (typeof args.question !== 'string' || !Array.isArray(args.options)) return null
    const options = args.options
      .filter((o: unknown) => o && typeof o === 'object')
      .map((o: Record<string, unknown>) => ({
        label: typeof o.label === 'string' ? o.label : '',
        preview: typeof o.preview === 'string' ? o.preview : '',
        description: typeof o.description === 'string' ? o.description : undefined,
      }))
      .filter((o: { label: string; preview: string }) => o.label && o.preview)
    if (options.length < 2) return null
    return { question: args.question, options }
  } catch {
    return null
  }
}

/** 解析 ask_user_question tool 的 arguments（v0.5+ 旧名 ask_free_text）→ {question}
 *  - v0.5+ 旧名 ask_free_text（这个名被"问问题"语义接管了）
 *  - 失败 → null */
function parseAskUserQuestion(tc: ToolCallInfo): { question: string } | null {
  try {
    const args = JSON.parse(tc.arguments)
    if (typeof args.question !== 'string') return null
    return { question: args.question }
  } catch {
    return null
  }
}

function parseUpdateDocItem(
  tc: ToolCallInfo,
): { item_id: string; content: string; mode: 'replace' | 'append' } | null {
  try {
    const args = JSON.parse(tc.arguments)
    if (typeof args.item_id !== 'string' || typeof args.content !== 'string') return null
    // v0.4.1+ mode: 默认 'replace'（LLM 不传或传非枚举值都视为 replace）
    const mode: 'replace' | 'append' = args.mode === 'append' ? 'append' : 'replace'
    return { item_id: args.item_id, content: args.content, mode }
  } catch {
    return null
  }
}

/** 派生消息列表：把每条消息加上"渲染分支"信息
 *  - v0.4+ tool calling 优先：assistant 消息带 tool_calls → 按 tool name 分发
 *  - 不带 tool_calls → 老路径（action 决定 polish/expand/reflect 单气泡）
 *  - 普通 bubble → 整体采用条走 append (跟 v0.3+ 一致) */
type DecoratedKind =
  | 'user'
  | 'assistant-tool-question' // ask_user_question → AltCard 卡片组
  | 'assistant-tool-freetext' // ask_free_text → 气泡 + "我去答" 按钮
  | 'assistant-tool-update' // update_doc_item → "AI 建议写入 X" + 确认按钮
  | 'assistant-polish' // 老路径：润色（action=polish，无 tool call）
  | 'assistant-expand' // 老路径：扩展
  | 'assistant-bubble' // 老路径：反思/自由追问 → 单气泡
interface Decorated {
  kind: DecoratedKind
  msg: ChatMessage
  // tool call 解析结果（按 kind 选填）
  question?: string
  options?: { label: string; preview: string; description?: string }[]
  toolCall?: ToolCallInfo
  // v0.4.1+ update_doc_item 解析后内容（避免直接显示 JSON 字符串给玩家看）
  updateContent?: string
  updateMode?: 'replace' | 'append'
}
const decorated = computed<Decorated[]>(() =>
  messages.value.flatMap((msg) => {
    if (msg.role === 'user') return [{ kind: 'user' as const, msg }]
    // v0.5.1+ role: 'tool' 跳过独立渲染——tool message 只是 LLM 喂数据用（OpenAI 协议层 tool_calls + tool_result 配对），
    //   assistant-tool-question "✓ 已答" 框会从 askFreeTextAnswered 反查显示对应 tool message 内容（不重复）。
    //   - 修 onRegenerateAltCard 路径 UI 重复：玩家点"🔄 重新生成" → sendToolResult 追加 tool message
    //     + removePendingToolCall → assistant-tool-question 走 "✓ 已答" + 答案分支（显示 tool message content），
    //     但同时 tool message 走 MessageBubble fallback 独立渲染——重复显示 2 次
    //   - 同样适用于 silently 改写（虽然我 v0.5+ 已经不追加 tool message to chatHistories 避免 UI 重复，
    //     兜底这条跳过规则保证所有 tool message 都不显示独立 bubble）
    //   - 对 silently 改写后 askFreeTextAnswered 返 null 的情况：assistant-tool-question 走 v-else 分支
    //     显示 d.msg.content（"玩家放弃..." 语义），不依赖 tool message 反查——独立跳过 tool message 不影响
    if (msg.role === 'tool') return []
    // v0.4.4+ 一个 message 可能带 N 个 tool_call（LLM 一次调多个 ask_user_question / 混搭）
    // 每个 tool_call 单独生成 DecoratedItem，flatMap 自动展开
    // - 修 v0.4.3+ "只渲染 tool_calls[0]" bug：之前 N 个 tool_call 只显第 1 个，剩 N-1 默默丢
    // - 解析失败 / 未知 tool name → 跳过（不显示该 tool_call 的 bubble）
    // - **v0.5+ 工具名重命名**：
    //   - 'ask_user_question' (旧：给选项) → 'ask_choose_option'
    //   - 'ask_free_text' (旧：反问) → 'ask_user_question'
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const items: Decorated[] = []
      for (const tc of msg.tool_calls) {
        if (tc.name === 'ask_choose_option') {
          const parsed = parseAskChooseOption(tc)
          if (parsed) {
            items.push({
              kind: 'assistant-tool-question',
              msg,
              question: parsed.question,
              options: parsed.options,
              toolCall: tc,
            })
          }
        } else if (tc.name === 'ask_user_question') {
          const parsed = parseAskUserQuestion(tc)
          if (parsed) {
            items.push({
              kind: 'assistant-tool-freetext',
              msg,
              question: parsed.question,
              toolCall: tc,
            })
          }
        } else if (tc.name === 'update_doc_item') {
          const parsed = parseUpdateDocItem(tc)
          if (parsed) {
            items.push({
              kind: 'assistant-tool-update',
              msg,
              toolCall: tc,
              updateContent: parsed.content,
              updateMode: parsed.mode,
            })
          }
        }
        // 解析失败 / 未知 tool name 跳过
      }
      if (items.length > 0) return items
      // v0.5.1+ 解析全失败（LLM 调 tool 但 args 不符合 schema——比如 question 字段是 chip prompt 复述
      //   整段、options < 2）→ 跳过整条 assistant message（不显示整段 content，避免 LLM preamble
      //   复述污染 UI）。fallback 显示整段 content 是 LLM 行为异常的副作用，玩家看是噪音。
      //   - 玩家测试：deepseek-v4-flash 收到 chip "💡 从立意拆支柱" + OPTION_TAIL 后，调 ask_choose_option
      //     但 args.question = 整段 prompt 复述、options 缺/少 → parse 失败 → fallback assistant-bubble
      //     显示整段 content（"从 L1 立意拆..." 全文）——玩家截图反馈
      //   - 修复：解析全失败 + 有 tool_calls 字段 → 跳过这条 message（不显示任何内容）
      //   - 协议层：tool_call 仍存在 chatHistories，runChatRound 拼 messages 时能正常发给 LLM
      //   - 跟 v0.5+ silently 改写区分：silently 改写后 tool_calls 仍存在 + parse 成功（args 没改），
      //     走 assistant-tool-question 分支 + pendingToolCalls 已 remove + askFreeTextAnswered 返 null
      //     → v-else 显示"✓ 已答" + d.msg.content（"玩家放弃..."）——这个分支不受影响
      return []
    }
    // 没 tool_calls → 老路径：action 决定 polish/expand/reflect / 普通 text reply
    if (msg.action === 'polish') return [{ kind: 'assistant-polish' as const, msg }]
    if (msg.action === 'expand') return [{ kind: 'assistant-expand' as const, msg }]
    return [{ kind: 'assistant-bubble' as const, msg }]
  }),
)

/** v0.4.4.1+ ask_free_text 工具函数：
 *  - askFreeTextAnswered(toolCallId): 拿到玩家已提交的 answer（用于"已答"状态显示）
 *  - 都不需要 store 派生，askFreeTextPending 已经在 props.chat 暴露，answered 从 chatHistories 反查
 *  - **v0.4.4.1+ 删了 askFreeTextIsPending / askFreeTextCurrentAnswer**（v0.4.4+ 多问题版才用，
 *    用来判断"哪条 bubble 内嵌 input 已答 / 没答"——v0.4.4.1+ 整合到 composer 后不需要）
 *  - **v0.4.4.1+ 删了 getSubQuestions / getSubAnswerText / setSubAnswerText / askFreeTextAnsweredCount /
 *    onAskFreeTextSubmit / onSubmitAllAskFreeText**（都是 v0.4.4+ 多问题版逻辑：拆 N 个 input / 拼 N 个 answer /
 *    "提交所有" 按钮 —— v0.4.4.1+ 单问题版 + composer 整合后全部不需要）
 */
function askFreeTextAnswered(toolCallId: string): string | null {
  for (const m of messages.value) {
    if (m.role === 'tool' && m.tool_call_id === toolCallId) {
      return m.content
    }
  }
  return null
}

/** v0.4.4.1+ composer 是否应该被 lock
 *  - **v0.4.4.1+ ask_free_text 不再 lock composer**：UX 整合到 composer，玩家直接打字回车发作为 answer
 *  - 全 tool 通用 pending：避免玩家绕开 AltCard / 写入确认破坏协议
 *    - ask_choose_option AltCard 待选
 *    - update_doc_item 写入确认待点
 *  - **v0.4.4.1+ ask_free_text 跳过 addPendingToolCall**（onChatDone 改），所以这里不覆盖 → composer 解锁
 *  - 玩家 2026-08-02 撞 deepseek "No tool output found" 根因：ask_choose_option AltCard 待选时
 *    用 composer 发 → 协议断 → LLM 报配对错。lock 住 → 玩家必须先采用/放弃 */
const composerDisabled = computed(() => {
  // v0.4.4.1+ ask_free_text 不 lock composer（UX 整合）—— 但 ask_free_text 也在 pendingToolCalls 里
  //   （sendAllAskFreeTextAnswers 内部 add/remove），所以这里的 pendingToolCalls check 已经覆盖
  if (pendingToolCalls?.value && pendingToolCalls.value.size > 0) return true
  return false
})

/** v0.4.4.1+ chip 是否应该被 lock
 *  - **v0.4.4.1+ 跟 composer 区别**：ask_free_text pending 时 **chip lock**（避免触发新 LLM 破坏协议），
 *    但 **composer unlock**（让玩家打字回车作为 answer）
 *  - 玩家 2026-08-03 截图反馈：ask_free_text pending 时 chip 还能点不合理 —— 点 polish/expand 触发新 LLM
 *    → protocol 断（ask_free_text 没答）
 *  - chip 兜底逻辑跟 composer 同款（防 IME / 复制粘贴等绕过 UI disabled）
 */
const chipDisabled = computed(() => {
  if (pendingToolCalls?.value && pendingToolCalls.value.size > 0) return true
  // v0.4.4.1+ ask_free_text 也 lock chip（虽然不 lock composer）
  if (askFreeTextPending?.value && askFreeTextPending.value.size > 0) return true
  return false
})

/** v0.4.4.1+ composer placeholder 提示（按 pending 状态给最具体的提示）
 *  - **v0.4.4.1+ ask_free_text 改显示当前 LLM 问的问题**（不再是"请先回答上面的问题"，
 *    而是"回答「<question>」"——让玩家知道 composer 现在是 ask_free_text 模式）
 *  - ask_choose_option / update_doc_item 还是 lock
 */
const composerPlaceholder = computed(() => {
  if (pendingToolCalls?.value && pendingToolCalls.value.size > 0) {
    return '请先处理上面的备选/写入确认（或点「放弃」）'
  }
  // v0.4.4.1+ ask_free_text pending 时显示 LLM 的问题
  if (askFreeTextPending?.value && askFreeTextPending.value.size > 0) {
    // v0.4.4.1+ 修正错位：size > 1（LLM 不听话调多次）时不要只显示 firstEntry 的 question，
    // 否则 placeholder 跟 bubble 实际显示的 N 个问题不一致 —— 玩家困惑
    const size = askFreeTextPending.value.size
    if (size === 1) {
      const firstEntry = askFreeTextPending.value.values().next().value
      if (firstEntry?.question) {
        const q = firstEntry.question.replace(/\s+/g, ' ').trim()
        if (q.length <= 30) return `回答「${q}」（回车发送）`
        return `回答「${q.slice(0, 30)}…」（回车发送）`
      }
    } else {
      // size > 1：理论 REFLECT_TAIL 钉死 1 round 1 ask_free_text，size 应 = 1
      // 防御性兼容多次（LLM 不听话），统一显示通用提示
      return `回答 LLM 的 ${size} 个问题（回车发送）`
    }
  }
  return '聊这一步的想法、疑问……（Enter 发送）'
})

/** v0.4.4.1+ composer title 提示 */
const composerTitle = computed(() => {
  if (pendingToolCalls?.value && pendingToolCalls.value.size > 0) {
    return '请先处理上面的备选/写入确认'
  }
  if (askFreeTextPending?.value && askFreeTextPending.value.size > 0) {
    return '回车发送作为 ask_free_text 的回答'
  }
  return '发送'
})

/** 新消息 / 流式开始 → 滚到底 */
watch(
  [() => messages.value.length, streaming],
  () => {
    void nextTick(() => {
      if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
    })
  },
)

// === actions ===

function onEnter(e: KeyboardEvent) {
  if (e.isComposing) return // IME 组词中的 Enter 是选词，不当发送
  void onSend()
}

async function onSend() {
  // v0.4.4.1+ 防重入：双触发（同一次回车被 onEnter + send 按钮 click 都触发 / 双击回车 /
  // IME 提交残留 / 复制粘贴 click 等）会让 askFreeTextPending 在第一次 await 时被清空，
  // 第二次 onSend 看到 pending 空 → 走 sendStepChat 加 user message（玩家 2026-08-03 截图：
  // 同一内容出现 2 个气泡——绿色"已答"+ 灰色 user 风格）。sending ref 同步设值，入口 guard
  if (sending.value) {
    console.warn('[AiChatPanel.onSend] blocked: already sending (re-entry guard)')
    return
  }
  const t = input.value.trim()
  if (!t || streaming.value) return
  // v0.4.4+ 全 tool 通用 pending 兜底：composer disable 是 UI 层防御，store send 也要 guard
  // - 玩家 2026-08-02 撞 deepseek "No tool output found" 根因：ask_choose_option AltCard 待选时用 composer 发
  // - composerDisabled 已经 lock，但这里 double-check（防 IME 提交 / 复制粘贴等绕过 UI disabled 的场景）
  if (composerDisabled.value) {
    console.warn('[AiChatPanel.onSend] blocked by pendingToolCalls (composer should be disabled)')
    return
  }
  sending.value = true
  input.value = ''
  localError.value = null
  try {
    // v0.4.4.1+ ask_free_text 强制回复：ask_free_text pending 时 composer 内容作为 tool_result 喂回 LLM
    // - 协议层：ask_free_text 也在 pendingToolCalls 里（sendAllAskFreeTextAnswers 内部 add/remove），
    //   所以会被 composerDisabled 锁住（除非 sendAllAskFreeTextAnswers 提前 remove）—— 这条路径正常
    // - UX 整合：玩家在 composer 打字回车 → 走 sendAllAskFreeTextAnswers(t) → 1 条 tool message 发 LLM
    if (askFreeTextPending?.value && askFreeTextPending.value.size > 0 && sendAllAskFreeTextAnswers) {
      console.log(`[AiChatPanel.onSend] routing to sendAllAskFreeTextAnswers (ask_free_text pending)`)
      await sendAllAskFreeTextAnswers(t)
      return
    }
    await send(t)
  } catch (e) {
    // start_chat invoke 失败（比如没配 provider）—— 玩家文案跟流式错误同套路
    console.error('[AiChatPanel] send failed:', e)
    localError.value = getErrorMessage('unknown', String(e)).title
  } finally {
    sending.value = false
  }
}

async function onSendPreset(preset: PresetAction) {
  if (streaming.value) return
  // v0.4.4+ 全 tool 通用 pending 兜底：跟 composer 一样 lock
  // - 玩家 2026-08-02 撞 deepseek "No tool output found" 根因：ask_choose_option AltCard 待选时点 chip
  //   → 触发新 LLM 调用 → 协议断
  // - chip 全锁（polish/expand/calibrate 重新生成走 AltCard 旁边的"重新生成"按钮，
  //   reason 标 polish/expand/calibrate 不同方向让 LLM 自己用对应方向重新调 ask_user_question）
  // - **v0.4.4.1+ chip 也 lock ask_free_text**（chipDisabled 包含 askFreeTextPending）——
  //   composer 不 lock 但 chip lock，避免 ask_free_text 没答时点 polish/expand 触发新 LLM 断协议
  // - chip disabled 是 UI 防御，store send 也要 guard（防 IME / 复制粘贴等绕过 UI disabled 的场景）
  if (chipDisabled.value) {
    console.warn(
      `[AiChatPanel.onSendPreset] blocked by chipDisabled (chip "${preset.label}" should be disabled)`,
    )
    return
  }
  localError.value = null
  try {
    // 第二个参数 = preset；store send 内部会把 preset.label 存到 user msg.preset，
    // 用 preset.prompt 作为 LLM 输入（不是 text —— chip 点时 text 是空）
    await send('', preset)
  } catch (e) {
    console.error('[AiChatPanel] send preset failed:', e)
    localError.value = getErrorMessage('unknown', String(e)).title
  }
}

function onAdoptReplace(text: string) {
  // v0.3+ 老路径：polish/expand markdown bubble / 自由追问 → 玩家直接采用
  // （不是 v0.4+ tool call 流程 —— 那走 onAdoptAltCard / onConfirmUpdate）
  emit('adopt', { text, mode: 'replace' })
}

/** v0.4+ AltCard "采用" 按钮（ask_user_question tool 走这条）
 *  - 不直接写编辑器 —— 走多轮 tool result 喂回 LLM
 *  - LLM 第二轮可能：调 update_doc_item（玩家再点"确认写入"）/ 出 text 总结
 *  - 玩家在 chip 自由追问触发的 chip 不走 tool call → onAdoptReplace 走老路径
 *  - 失败（sendToolResult 不存在）→ 走老路径降级 */
async function onAdoptAltCard(option: { label: string; preview: string }, toolCall: ToolCallInfo | undefined) {
  if (!toolCall) {
    // 兜底：toolCall 缺失 → 走老路径直接采用
    onAdoptReplace(option.preview)
    return
  }
  if (!sendToolResult) {
    // store 没实现 sendToolResult（理论上 v0.4+ 都实现）→ 降级
    console.warn('[AiChatPanel] store.sendToolResult not implemented, falling back to direct adopt')
    onAdoptReplace(option.preview)
    return
  }
  // tool result 喂回 LLM：内容用 label 让 LLM 知道玩家选了哪张卡
  // preview 是完整备选内容 —— LLM 用这个作为 update_doc_item 的 content
  try {
    const result = `${option.label}：${option.preview}`
    await sendToolResult(toolCall.id, result)
  } catch (e) {
    console.error('[AiChatPanel] sendToolResult failed:', e)
    localError.value = getErrorMessage('unknown', String(e)).title
  }
}

/** v0.4.4+ ask_choose_option AltCard "放弃备选，自己写" 按钮
 *  - **v0.4.4+ silently 模式**：玩家点"放弃" → store 清掉对应 assistant message 的
 *    `tool_calls` 字段（LLM 看不到 tool_call，无协议要求配对），stop 在这里
 *  - composer 解锁，玩家直接打字发 → LLM 走普通 user message 流程（**不知道**有过 tool_call）
 *  - 玩家不需要想 "tool_result 该告诉 LLM 啥"——直接放弃就是直接放弃 */
async function onCancelAltCard(toolCall: ToolCallInfo | undefined): Promise<void> {
  if (!toolCall) return
  if (!cancelPendingToolCall) {
    console.error('[AiChatPanel] store 未实现 cancelPendingToolCall')
    return
  }
  try {
    // silently: true —— 不告诉 LLM，stop 在这里（玩家"放弃直接 stop"语义）
    await cancelPendingToolCall(toolCall.id, undefined, { silently: true })
  } catch (e) {
    console.error('[AiChatPanel] onCancelAltCard failed:', e)
    localError.value = getErrorMessage('unknown', String(e)).title
  }
}

/** v0.4.4+ ask_choose_option AltCard "重新生成" 按钮
 *  - 玩家不满意这些备选 → 发 1 条 tool_result（"玩家要新备选"）→ LLM 重新调 ask_choose_option 出新备选
 *  - reason 默认让 LLM 自由重新出；v0.4.4+ 不锁 chip，让 LLM 决定方向
 *  - 跟 onCancelAltCard 区别：放弃 = 不要备选要自己写；重新生成 = 不要这些，但还要 LLM 给新的
 *  - 协议：1 round 1 tool_call → 1 tool_result 配对（不破坏协议） */
async function onRegenerateAltCard(
  toolCall: ToolCallInfo | undefined,
  direction?: 'polish' | 'expand' | 'calibrate' | 'reflect',
): Promise<void> {
  if (!toolCall) return
  if (!cancelPendingToolCall) {
    console.error('[AiChatPanel] store 未实现 cancelPendingToolCall')
    return
  }
  // v0.5+ tool name 重命名：
  // - 旧 ask_user_question（给选项）→ ask_choose_option
  // - 旧 ask_free_text（反问）→ ask_user_question
  const reasonMap: Record<string, string> = {
    polish: '玩家想看润色版。请重新调 ask_choose_option 给 N 个不同表达方向的备选（不改变内容方向）',
    expand: '玩家想看更厚版。请重新调 ask_choose_option 给 N 个加细节/例子/场景的备选（不改变内容方向）',
    calibrate: '玩家点了校准。请重新调 ask_choose_option，给用 L1 立意 / L2 pillars 校准后的备选',
    reflect: '玩家想换个角度反问。请重新调 ask_choose_option tool 给 1-3 个主题层反思问题',
  }
  const reason =
    reasonMap[direction ?? ''] ?? '玩家要新备选。请重新调 ask_choose_option 给 N 个不同方向的备选'
  try {
    await cancelPendingToolCall(toolCall.id, reason)
  } catch (e) {
    console.error('[AiChatPanel] onRegenerateAltCard failed:', e)
    localError.value = getErrorMessage('unknown', String(e)).title
  }
}

/** v0.4+ update_doc_item "确认写入" 按钮
 *  - 把 tool result 喂回 LLM（"OK 玩家确认了"）
 *  - emit('adopt', replace) 让 ConceptView 写编辑器
 *  - 这俩并行发：写入不依赖 LLM 响应（LLM 可能想再加一句总结）
 *  - **v0.4.1+ mode 区分**:
 *    - mode='replace' → 「确认覆盖编辑器」（✨）
 *    - mode='append'  → 「追加到编辑器末尾」（📝） */
async function onConfirmUpdate(toolCall: ToolCallInfo | undefined, mode: 'replace' | 'append' = 'replace') {
  if (!toolCall) return
  // 1. 写编辑器：emit adopt，ConceptView 处理
  const args = parseUpdateDocItem(toolCall)
  if (!args) return
  emit('adopt', { text: args.content, mode })
  // 2. 喂回 LLM：让 ta 知道玩家确认了（如果没 sendToolResult 也不阻塞，编辑已写）
  if (sendToolResult) {
    try {
      await sendToolResult(
        toolCall.id,
        mode === 'append' ? '玩家已确认追加。' : '玩家已确认写入。',
      )
    } catch (e) {
      console.warn('[AiChatPanel] sendToolResult for confirm failed (editing already done):', e)
    }
  }
}

async function onReset() {
  // v0.3+ 不弹 confirm：玩家操作 = 自动完成（chat 落盘 = 关 app 不丢也无所谓）
  // reset 触发 store 的 resetStepChat → 同步删 .chats/ 文件（落盘做了之后）
  if (messages.value.length === 0 && !streaming.value) return
  reset()
}

// === v0.3+ 整体采用条 (替换之前的 per-message 采用按钮) ===
// - 取最后一条 user msg 之后的所有 assistant msg 组成 block
// - 还在 streaming (最新一条 partial) → 不显示, 等流完
// - block 最后一条是 polish/expand (markdown 单气泡, 老消息兼容) → 整体替换; 否则 → 整体追加
// - block 用 `\n\n` 拼接, 一并 emit 给 view
// - **跳过 assistant-cards**: v0.3+ 润色/扩展/备选都用 JSON 输出 → 走 AltCard 单选, 不走整体采用条
//   (整体采用会塞入一坨 JSON 字符串当编辑器内容, 玩家绝对不要这个)
// - **v0.4.1+ 整轮排除**: 最后一个 user 之后, 只要有任何 tool call (question/freetext/update) 触发,
//   整轮都不算可采用 block —— 那条流程是"LLM 在问 / 写", 中间夹的反思气泡不是可写编辑器的内容
//   (用户截图 bug: ask_user_question 流程中反思气泡被误判为可采用 → 底部冒"AI 回复"+"写入编辑器")
const adoptableBlock = computed(() => {
  const msgs = messages.value
  const dec = decorated.value
  if (msgs.length === 0 || dec.length === 0) return null

  // 找最后一个 user msg 索引 (用 decorated 找, kind 直接判断)
  let lastUserIdx = -1
  for (let i = dec.length - 1; i >= 0; i--) {
    if (dec[i].kind === 'user') {
      lastUserIdx = i
      break
    }
  }

  // 最后一个 user 之后的所有 assistant (用 decorated 拿 kind)
  const afterUser = dec.slice(lastUserIdx + 1).filter((d) => d.kind !== 'user')
  if (afterUser.length === 0) return null

  // 最新一条还在 streaming → 等
  if (afterUser[afterUser.length - 1].msg.partial) return null

  // v0.4.1+ 整轮排除：这一轮有任何 tool call (question / freetext / update) 触发过
  // → 整轮不算可采用 block。LLM 在问 / 在写, 中间反思气泡不是可写编辑器的内容。
  const hasToolCallInRound = afterUser.some(
    (d) =>
      d.kind === 'assistant-tool-question' ||
      d.kind === 'assistant-tool-freetext' ||
      d.kind === 'assistant-tool-update',
  )
  if (hasToolCallInRound) return null

  // 排除规则 (per-message):
  // - partial 还在流式, 等
  // - **polish/expand 一律排除**: 玩家点润色/扩展 chip 是想要"挑一个方向", 整体采用条不能"一键采用"
  //   LLM preamble (还没出 tool call 时说的"让我分析一下..."那种) 是 polish/expand action 但 kind=assistant-bubble
  //   —— 同样排除, 玩家应该等 tool call 出来用 AltCard 挑
  const block = afterUser.filter((d) => {
    if (d.msg.partial) return false
    if (d.msg.action === 'polish' || d.msg.action === 'expand') return false
    return true
  })
  if (block.length === 0) return null

  const last = block[block.length - 1].msg
  const isReplace = last.action === 'polish' || last.action === 'expand'
  const content = block.map((d) => d.msg.content).join('\n\n')

  return {
    mode: isReplace ? ('replace' as const) : ('append' as const),
    content,
    count: block.length,
  }
})

function onAdoptBlock() {
  const block = adoptableBlock.value
  if (!block) return
  emit('adopt', { text: block.content, mode: block.mode })
}

// v0.3+ auto-retry (polish/expand JSON parse 失败) 在 v0.4+ 删除：
// - LLM 不再在 content 字段返 JSON 数组（schema 强制走 tool call）
// - tool call 流式累积失败时由 store 直接走 fallback（content="" + tool_calls 完整）
// - 不需要前端 watch decorated 触发自动重试
</script>

<template>
  <section class="ai-chat">
    <header class="panel-header">
      <Sparkles :size="14" />
      <h4>AI 助手 · {{ title }}</h4>
      <span v-if="wordCount != null" class="word-count">{{ wordCount }} 字</span>
      <span class="spacer" />
      <!-- v0.4.1+ model 切换（复用 chat tab 同款 ModelEffortSelector，effort 隐藏） -->
      <ModelEffortSelector
        :custom-provider-shortcuts="aiPanelShortcuts"
        :unconfigured-provider-count="aiPanelUnconfiguredCount"
        :selected-id="aiPanelModel"
        :effort="aiPanelEffort"
        :effort-supported="false"
        placement="bottom"
        align="end"
        :disabled="streaming"
        @select-model="onSelectModel"
      />
      <button
        class="reset-btn"
        type="button"
        :disabled="messages.length === 0 && !streaming"
        title="清空这一步的对话历史"
        @click="onReset"
      >
        <Eraser :size="12" />
      </button>
    </header>

    <div ref="listEl" class="msg-list">
      <div v-if="messages.length === 0 && !streaming" class="chat-hint">
        有想法但拿不准？点上面的 chip 或直接输入 —— 备选 / 润色 / 扩展 会一次给多个方向, 点卡片「采用」选一个
      </div>
      <template v-for="(d, i) in decorated" :key="i">
        <MessageBubble v-if="d.kind === 'user'" :msg="d.msg" />
        <!-- v0.4+ ask_choose_option tool → AltCard 卡片组（替代 v0.3+ JSON 解析）
             v0.4.4+ 加 2 个按钮：玩家不挑这些备选时的两条出路
             - "重新生成"（accent 色，primary）：让 LLM 重新调 ask_choose_option 出新备选
             - "放弃备选，自己写"（muted 色，secondary）：玩家不要任何备选，自己写
             - 都走 cancelPendingToolCall 路径（同款 sendToolResult），不破坏协议
             - 锁 composer 时给玩家这两条出路（比纯 lock 友好）
             v0.4.4+ 整体 v-if 锁：pendingToolCalls 不在 → 不显示 AltCard + 显示 "✓ 已答" -->
        <div v-else-if="d.kind === 'assistant-tool-question'" class="tool-question">
          <template v-if="d.toolCall && pendingToolCalls?.has(d.toolCall.id)">
            <div v-if="d.question" class="tool-question-prompt">💬 {{ d.question }}</div>
            <div class="card-list">
              <AltCard
                v-for="(opt, ci) in d.options"
                :key="ci"
                :text="opt.preview"
                :title="opt.label"
                :description="opt.description"
                @adopt="() => onAdoptAltCard(opt, d.toolCall)"
              />
            </div>
            <div class="tool-question-actions">
              <button
                type="button"
                class="tool-regenerate-btn"
                :disabled="streaming"
                :title="'让 LLM 重新调 ask_choose_option 出新备选'"
                @click="() => onRegenerateAltCard(d.toolCall)"
              >
                🔄 重新生成
              </button>
              <button
                type="button"
                class="tool-cancel-btn"
                :disabled="streaming"
                :title="'告诉 LLM 你不要这些备选，要自己写'"
                @click="() => onCancelAltCard(d.toolCall)"
              >
                ✍️ 放弃
              </button>
            </div>
          </template>
          <template v-else-if="d.toolCall && askFreeTextAnswered(d.toolCall.id)">
            <div class="tool-question-answered">
              <div class="tool-question-answered-label">✓ 已答</div>
              <div
                v-for="(line, li) in (askFreeTextAnswered(d.toolCall.id) ?? '').split('\n').filter(Boolean)"
                :key="li"
                class="tool-question-answered-text"
              >{{ line }}</div>
            </div>
          </template>
          <template v-else>
            <div class="tool-question-answered">
              <div class="tool-question-answered-label">✓ 已答</div>
              <!-- v0.5.1+ silently 改写后：assistant content 是"玩家放弃..."语义，显示给玩家看 -->
              <div
                v-if="d.msg.content"
                class="tool-question-answered-text"
              >{{ d.msg.content }}</div>
            </div>
          </template>
        </div>
        <!-- v0.4.4.1+ ask_free_text tool → 气泡只显示 LLM 的问题（不可编辑）+ 状态指示
             强制回复 UX 整合到下方 composer（v0.4.4.1+ 之前是 bubble 内嵌 N 个 input，"上下一对输入框" 玩家
             反馈冗余 —— 现在 REFLECT_TAIL 钉死 1 个问题，composer 解锁，UX 跟普通聊天一致）
             协议要求：1 round 1 ask_free_text → 1 tool_result 配对
             三种状态：
             1. pending + 未答 → 气泡显示 LLM 的问题 + "💭 等待你的回答（下方输入框）"提示
             2. pending + 已填（玩家在 composer 打字，pending.answer 已写入）→ 气泡显示问题 + 玩家 answer
             3. 已提交（chatHistories 有 tool_result）→ 渲染 "✓ 已答" + 答案
             4. v0.5.1+ silently 改写后：显示 ✓ 已答 + d.msg.content（"玩家放弃..."）
        -->
        <div v-else-if="d.kind === 'assistant-tool-freetext'" class="tool-freetext">
          <template v-if="d.toolCall && askFreeTextPending?.has(d.toolCall.id)">
            <div class="tool-freetext-question">
              <div class="tool-freetext-question-text">{{ d.question }}</div>
              <div class="tool-freetext-pending-hint">💭 等待你的回答（下方输入框）</div>
            </div>
          </template>
          <template v-else-if="d.toolCall && askFreeTextAnswered(d.toolCall.id)">
            <div class="tool-freetext-answered">
              <div class="tool-freetext-answered-label">✓ 已答</div>
              <div
                v-for="line in (askFreeTextAnswered(d.toolCall.id) ?? '').split('\n').filter(Boolean)"
                :key="line"
                class="tool-freetext-answered-text"
              >{{ line }}</div>
            </div>
          </template>
          <template v-else>
            <!-- v0.5.1+ silently 改写后：assistant content 是"玩家放弃..."语义，显示给玩家看 -->
            <div v-if="d.msg.content" class="tool-freetext-answered">
              <div class="tool-freetext-answered-label">✓ 已答</div>
              <div
                v-for="line in d.msg.content.split('\n').filter(Boolean)"
                :key="line"
                class="tool-freetext-answered-text"
              >{{ line }}</div>
            </div>
            <div v-else class="tool-freetext-hint">在下方输入框写你的想法，发送后会作为回答继续对话</div>
          </template>
        </div>
        <!-- v0.4+ update_doc_item tool → "AI 建议写入 X" + 确认按钮
             v0.4.1+ mode 区分：replace = 覆盖（✨），append = 追加（📝）
             v0.4.4+ 加 "放弃写入" 按钮：玩家不要 LLM 的建议写入 → 发 tool_result 喂回 LLM
             显示 content 而不是原始 JSON arguments（玩家可读性） -->
        <div v-else-if="d.kind === 'assistant-tool-update'" class="tool-update">
          <div class="tool-update-title">
            {{ d.updateMode === 'append' ? '📝 AI 建议补充' : '✨ AI 建议覆盖' }}
          </div>
          <div class="tool-update-content">{{ d.updateContent }}</div>
          <!-- v0.5.1+ silently 改写后：pending 已 remove，显示"✓ 已放弃"+ assistant content（玩家放弃语义），
               不显示 ✍️ 放弃/📝 写入按钮（玩家已处理，不再二次操作） -->
          <div
            v-if="d.toolCall && pendingToolCalls?.has(d.toolCall.id)"
            class="tool-update-actions"
          >
            <button
              type="button"
              class="tool-cancel-btn"
              :disabled="streaming"
              :title="'告诉 LLM 你不要这个写入，要自己改'"
              @click="() => onCancelAltCard(d.toolCall)"
            >
              ✍️ 放弃
            </button>
            <button
              type="button"
              class="tool-update-btn"
              :disabled="streaming"
              @click="onConfirmUpdate(d.toolCall, d.updateMode ?? 'replace')"
            >
              <span class="tool-update-icon">{{ d.updateMode === 'append' ? '📝' : '✨' }}</span>
              <span>{{ d.updateMode === 'append' ? '追加到编辑器末尾' : '确认覆盖编辑器' }}</span>
            </button>
          </div>
          <div v-else class="tool-update-answered">
            <div class="tool-update-answered-label">✓ 已放弃</div>
            <div
              v-if="d.msg.content"
              class="tool-update-answered-text"
            >{{ d.msg.content }}</div>
          </div>
        </div>
        <!-- v0.3+ 老路径：polish（流中 placeholder）-->
        <div
          v-else-if="d.kind === 'assistant-polish' && d.msg.partial"
          class="bubble assistant placeholder"
        >
          <Loader2 :size="14" class="spinning" />
          <span>AI 正在润色...</span>
        </div>
        <MessageBubble v-else-if="d.kind === 'assistant-polish'" :msg="d.msg" />
        <!-- v0.3+ 老路径：expand（流中 placeholder）-->
        <div
          v-else-if="d.kind === 'assistant-expand' && d.msg.partial"
          class="bubble assistant placeholder"
        >
          <Loader2 :size="14" class="spinning" />
          <span>AI 正在扩展...</span>
        </div>
        <MessageBubble v-else-if="d.kind === 'assistant-expand'" :msg="d.msg" />
        <MessageBubble v-else :msg="d.msg" />
      </template>
      <div v-if="streaming" class="bubble assistant placeholder">
        <Loader2 :size="14" class="spinning" />
        <span>AI 在想...</span>
      </div>
    </div>

    <!-- v0.3+ 整体采用条 —— 取本轮 (最后 user msg 之后) 所有 AI 回复拼接, 一次性采用 -->
    <div v-if="adoptableBlock" class="adopt-bar">
      <span class="adopt-bar-info">
        <template v-if="adoptableBlock.count > 1">
          本轮 {{ adoptableBlock.count }} 段 AI 回复
        </template>
        <template v-else>
          AI 回复
        </template>
      </span>
      <button
        type="button"
        class="adopt-bar-btn"
        :title="adoptableBlock.mode === 'replace' ? '采用 (替换编辑器内容)' : '追加到编辑器末尾'"
        @click="onAdoptBlock"
      >
        <span class="adopt-bar-icon">{{ adoptableBlock.mode === 'replace' ? '✨' : '📝' }}</span>
        <span>{{ adoptableBlock.mode === 'replace' ? '采用' : '写入编辑器' }}</span>
      </button>
    </div>

    <div v-if="streamError" class="chat-error">
      <div class="chat-error-header">
        <span class="chat-error-msg">{{ streamError.title }} —— {{ streamError.hint }}</span>
        <div class="chat-error-actions">
          <button
            type="button"
            class="chat-error-btn"
            @click="onCopyDiag"
            :title="copyState === 'copied' ? '已复制到剪贴板' : '一键复制诊断信息给开发者'"
          >
            <ClipboardCopy :size="10" />
            <span>{{ copyState === 'copied' ? '已复制 ✓' : copyState === 'failed' ? '复制失败' : '复制诊断信息' }}</span>
          </button>
          <button
            type="button"
            class="chat-error-btn chat-error-expand"
            @click="errorExpanded = !errorExpanded"
            :title="errorExpanded ? '收起技术细节' : '展开技术细节'"
          >
            <component :is="errorExpanded ? ChevronUp : ChevronDown" :size="10" />
          </button>
        </div>
      </div>
      <!-- v0.4.1+ 诊断区（默认展开）：4 字段 + raw error 一次性显示 -->
      <div v-if="errorExpanded" class="chat-error-diag">
        <div v-if="errorDiag" class="diag-fields">
          <div v-if="errorDiag.endpoint" class="diag-row">
            <span class="diag-key">endpoint</span>
            <span class="diag-val">{{ errorDiag.endpoint }}</span>
          </div>
          <div v-if="errorDiag.model" class="diag-row">
            <span class="diag-key">model</span>
            <span class="diag-val">{{ errorDiag.model }}</span>
          </div>
          <div v-if="errorDiag.api_format" class="diag-row">
            <span class="diag-key">api_format</span>
            <span class="diag-val">{{ errorDiag.api_format }}</span>
          </div>
          <div v-if="errorDiag.request_body_preview" class="diag-row">
            <span class="diag-key">body</span>
            <pre class="diag-body">{{ errorDiag.request_body_preview }}</pre>
          </div>
        </div>
        <div v-else class="diag-empty">（老 backend 没发诊断字段）</div>
        <div class="diag-raw-section">
          <div class="diag-key">raw error</div>
          <pre class="diag-body">{{ streamError.technicalDetails }}</pre>
        </div>
      </div>
    </div>
    <div v-if="localError" class="chat-error">{{ localError }}</div>

    <div v-if="presets.length > 0" class="chips">
      <button
        v-for="p in presets"
        :key="p.label"
        type="button"
        class="chip"
        :title="chipDisabled ? (askFreeTextPending && askFreeTextPending.size > 0 ? '请先在下方输入框回答 LLM 的问题' : '请先处理上面的备选/写入确认（或点 AltCard 旁边的「重新生成」/「放弃备选」）') : p.prompt"
        :disabled="streaming || chipDisabled"
        @click="onSendPreset(p)"
      >
        {{ p.label }}
      </button>
    </div>

    <!-- v0.4.4.1+ 去掉 askFreeTextBar 进度条（UX 整合到 composer） -->

    <div class="composer">
      <textarea
        v-model="input"
        rows="4"
        :placeholder="composerPlaceholder"
        :disabled="composerDisabled"
        @keydown.enter.exact.prevent="onEnter"
      />
      <button
        class="send-btn"
        type="button"
        :disabled="!input.trim() || streaming || composerDisabled"
        :title="composerTitle"
        @click="onSend"
      >
        <Send :size="14" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.ai-chat {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
}
.panel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  flex-shrink: 0;
}
.panel-header h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 500;
  line-height: 1.4;
  flex-shrink: 0;
}
.status-badge.empty {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
}
.status-badge.draft {
  background: color-mix(in srgb, var(--warning, #d9822b) 18%, transparent);
  color: var(--warning, #d9822b);
  border: 1px solid color-mix(in srgb, var(--warning, #d9822b) 40%, transparent);
}
.status-badge.confirmed {
  background: color-mix(in srgb, var(--success, #3fb950) 18%, transparent);
  color: var(--success, #3fb950);
  border: 1px solid color-mix(in srgb, var(--success, #3fb950) 40%, transparent);
}
.word-count {
  font-size: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.spacer {
  flex: 1;
}
.reset-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
}
.reset-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.reset-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.msg-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
}
.msg-list::-webkit-scrollbar {
  width: 6px;
}
.msg-list::-webkit-scrollbar-track {
  background: transparent;
}
.msg-list::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}
.msg-list::-webkit-scrollbar-thumb:hover {
  background: var(--accent-soft);
}
.chat-hint {
  padding: 12px 10px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.6;
}
/* 消息气泡 —— 根节点带父 scope id，内部节点靠 :deep 命中 */
.ai-chat :deep(.bubble) {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
}
.ai-chat :deep(.bubble.user) {
  align-self: flex-end;
  background: var(--accent-soft);
  color: var(--text);
  max-width: 90%;
}
.ai-chat :deep(.bubble.user.preset) {
  /* preset 触发的 user 消息：浅一点 + 等宽感更强，区分"AI 自动发的" vs "玩家手输入" */
  opacity: 0.85;
  font-style: italic;
}
.ai-chat :deep(.bubble.assistant) {
  align-self: flex-start;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  max-width: 100%;
}
.ai-chat :deep(.bubble.assistant.placeholder) {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
}
.ai-chat :deep(.bubble-body p) {
  margin: 0 0 6px;
}
.ai-chat :deep(.bubble-body p:last-child) {
  margin-bottom: 0;
}
.ai-chat :deep(.bubble-body ul),
.ai-chat :deep(.bubble-body ol) {
  margin: 0 0 6px;
  padding-left: 18px;
}
.ai-chat :deep(.partial-mark) {
  color: var(--text-muted);
  font-size: 11px;
  margin-left: 6px;
}

/* v0.3+ polish/expand 未生成提示 (LLM 没按 JSON 输出) —— 不暴露 raw 文本 */
.polish-expand-failed {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--warning, #d9822b) 10%, transparent);
  border: 1px dashed color-mix(in srgb, var(--warning, #d9822b) 60%, transparent);
  border-radius: 8px;
  align-self: flex-start;
  max-width: 100%;
  color: var(--warning, #d9822b);
}
.polish-expand-failed > svg {
  flex-shrink: 0;
  margin-top: 1px;
}
.polish-expand-failed-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.polish-expand-failed-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}
.polish-expand-failed-hint {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

/* v0.4+ tool call 渲染样式 */
.tool-question {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-self: stretch;
}
.tool-question-prompt {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 2px;
  font-style: italic;
}
.tool-freetext {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-self: stretch;
}
.tool-freetext-prompt {
  padding: 8px 10px;
  background: var(--accent-soft, color-mix(in srgb, var(--accent) 12%, transparent));
  border-left: 3px solid var(--accent);
  border-radius: 4px;
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
}
.tool-freetext-hint {
  font-size: 10px;
  color: var(--text-muted);
  font-style: italic;
}
/* v0.4.4.1+ ask_free_text 气泡问题文本（v0.4.4+ 之前 AskFreeTextInput 的 placeholder 显示问题，
   整合到 composer 后 bubble 自己显示问题文本 —— 玩家必须知道 LLM 问的是啥才能答）*/
.tool-freetext-question {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--bg-soft, rgba(255, 255, 255, 0.03));
  border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
  border-radius: 6px;
}
.tool-freetext-question-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.tool-freetext-pending-hint {
  font-size: 10px;
  color: var(--text-muted);
  font-style: italic;
}
/* v0.4.4+ ask_free_text 已答状态 */
.tool-freetext-answered {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--success, #22c55e) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--success, #22c55e) 30%, transparent);
  border-radius: 6px;
}
.tool-freetext-answered-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--success, #22c55e);
}
.tool-freetext-answered-text {
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.tool-update {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 6px;
  align-self: stretch;
}
.tool-update-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
}
.tool-update-content {
  font-size: 11px;
  color: var(--text);
  max-height: 100px;
  overflow-y: auto;
  padding: 6px 8px;
  background: var(--bg-2, rgba(255, 255, 255, 0.03));
  border-radius: 3px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
.tool-update-btn {
  align-self: flex-end;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
}
.tool-update-btn:hover:not(:disabled) {
  background: var(--accent-soft, color-mix(in srgb, var(--accent) 12%, transparent));
}
.tool-update-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.tool-update-icon {
  font-size: 12px;
}

/* v0.4.4+ 工具通用 "放弃" 按钮（玩家不要 LLM 给的备选/写入，自己来）
   - 用 muted 色区别于 accent 的"确认"按钮（让玩家知道这是退路，不是主线） */
.tool-cancel-btn {
  align-self: flex-end;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border, rgba(255, 255, 255, 0.15));
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
}
.tool-cancel-btn:hover:not(:disabled) {
  background: var(--hover, rgba(255, 255, 255, 0.05));
  color: var(--text);
  border-color: var(--text-muted);
}
.tool-cancel-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* v0.4.4+ "重新生成" 按钮（玩家不挑这些备选但还要 LLM 给新的——accent 色 primary 操作）
   - 跟 tool-cancel-btn 一起放在 .tool-question-actions 行 */
.tool-regenerate-btn {
  align-self: flex-end;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
}
.tool-regenerate-btn:hover:not(:disabled) {
  background: var(--accent-soft, color-mix(in srgb, var(--accent) 12%, transparent));
}
.tool-regenerate-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* v0.4.4+ ask_user_question actions 行（重新生成 + 放弃 并列，靠右对齐） */
.tool-question-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
  margin-top: 4px;
}

/* v0.4.4+ ask_user_question 已答态（玩家已采用/放弃/重新生成后显示） */
.tool-question-answered {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  background: var(--bg-soft, rgba(255, 255, 255, 0.03));
  border: 1px solid color-mix(in srgb, var(--success, #22c55e) 30%, transparent);
  border-radius: 6px;
  align-self: stretch;
}
.tool-question-answered-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--success, #22c55e);
}
.tool-question-answered-text {
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* v0.4.4+ update 工具 actions 行（放弃 + 确认并列） */
.tool-update-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
}

.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.card-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* v0.3+ 整体采用条 (替换之前的 per-message 采用按钮) */
.adopt-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px dashed color-mix(in srgb, var(--accent) 50%, transparent);
  border-radius: 6px;
  flex-shrink: 0;
}
.adopt-bar-info {
  font-size: 11px;
  color: var(--text-muted);
  flex: 1;
  min-width: 0;
}
.adopt-bar-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  background: var(--accent);
  color: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  font-family: inherit;
  transition: opacity 0.12s ease;
  flex-shrink: 0;
}
.adopt-bar-btn:hover {
  opacity: 0.85;
}
.adopt-bar-icon {
  font-size: 12px;
  line-height: 1;
}
.chat-error {
  font-size: 11px;
  line-height: 1.5;
  color: var(--error, #e53e3e);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: rgba(232, 90, 90, 0.08);
  border: 1px solid var(--error, #e53e3e);
  border-radius: 6px;
}
.chat-error-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  justify-content: space-between;
}
.chat-error-msg {
  flex: 1;
  min-width: 0;
  color: var(--text);
  word-break: break-word;
}
.chat-error-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.chat-error-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--text-muted);
  font-size: 10px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
}
.chat-error-btn:hover {
  background: var(--hover);
  color: var(--text);
  border-color: var(--text-muted);
}
.chat-error-expand {
  padding: 2px 4px;
}
.chat-error-diag {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.diag-fields {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.diag-row {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  word-break: break-all;
}
.diag-key {
  flex-shrink: 0;
  width: 60px;
  color: var(--text-muted);
  font-weight: 500;
  font-size: 10px;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
}
.diag-val {
  color: var(--text);
  font-size: 10px;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  word-break: break-all;
}
.diag-body {
  margin: 0;
  padding: 4px 6px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 9px;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 150px;
  overflow-y: auto;
  flex: 1;
  min-width: 0;
}
.diag-empty {
  color: var(--text-muted);
  font-style: italic;
  font-size: 10px;
}
.diag-raw-section {
  margin-top: 3px;
  padding-top: 4px;
  border-top: 1px dashed var(--border);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex-shrink: 0;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}
.chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
  transition: border-color 0.15s, background 0.15s;
}
.chip:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.composer {
  display: flex;
  gap: 6px;
  align-items: flex-end;
  flex-shrink: 0;
}
.composer textarea {
  flex: 1;
  padding: 6px 8px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 5px;
  outline: none;
  font-size: 12px;
  font-family: inherit;
  line-height: 1.5;
  resize: vertical;
}
.composer textarea:focus {
  border-color: var(--accent);
}
.composer textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--bg-soft, rgba(255, 255, 255, 0.02));
}
/* v0.4.4+ ask_free_text 强制回复进度条（嵌在 composer 上方） */
.ask-freetext-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-radius: 6px;
}
.ask-freetext-bar-text {
  font-size: 11px;
  color: var(--text);
  font-weight: 500;
}
.ask-freetext-bar-btn {
  padding: 4px 12px;
  background: var(--accent, #6366f1);
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
}
.ask-freetext-bar-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}
.ask-freetext-bar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: var(--accent);
  color: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 5px;
  cursor: pointer;
  flex-shrink: 0;
}
.send-btn:hover:not(:disabled) {
  opacity: 0.85;
}
.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
