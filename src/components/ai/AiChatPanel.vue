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
import { Eraser, Loader2, Send, Sparkles } from 'lucide-vue-next'

import { getErrorMessage } from '@/lib/error-messages'
import type { AdoptPayload, PresetAction, StepChatState } from '@/types/ai'
import type { ChatMessage, ToolCallInfo } from '@/types/chat'

import AltCard from './AltCard.vue'
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
const { messages, streaming, errorKind, errorRaw, send, sendToolResult, reset } = props.chat

const input = ref('')
const listEl = ref<HTMLElement | null>(null)
/** startChat invoke 本身失败（不是流式 error event）的本地错误 */
const localError = ref<string | null>(null)

const streamError = computed(() => {
  if (!errorRaw.value) return null
  return getErrorMessage(errorKind.value, errorRaw.value)
})

/** 解析 ask_user_question tool 的 arguments（JSON 字符串）→ {question, options[]}
 *  - 失败 → null（前端走"AI 在想..."占位） */
function parseAskUserQuestion(tc: ToolCallInfo): { question: string; options: { label: string; preview: string; description?: string }[] } | null {
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

function parseAskFreeText(tc: ToolCallInfo): { question: string } | null {
  try {
    const args = JSON.parse(tc.arguments)
    if (typeof args.question !== 'string') return null
    return { question: args.question }
  } catch {
    return null
  }
}

function parseUpdateDocItem(tc: ToolCallInfo): { item_id: string; content: string } | null {
  try {
    const args = JSON.parse(tc.arguments)
    if (typeof args.item_id !== 'string' || typeof args.content !== 'string') return null
    return { item_id: args.item_id, content: args.content }
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
}
const decorated = computed<Decorated[]>(() =>
  messages.value.map((msg) => {
    if (msg.role === 'user') return { kind: 'user', msg }
    // v0.4+ tool call 优先：assistant 消息带 tool_calls → 按 tool name 分发
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // 取第一个有效 tool call（v0.4+ LLM 一次只调一个 tool）
      const tc = msg.tool_calls[0]
      if (tc.name === 'ask_user_question') {
        const parsed = parseAskUserQuestion(tc)
        if (parsed) {
          return {
            kind: 'assistant-tool-question',
            msg,
            question: parsed.question,
            options: parsed.options,
            toolCall: tc,
          }
        }
      } else if (tc.name === 'ask_free_text') {
        const parsed = parseAskFreeText(tc)
        if (parsed) {
          return {
            kind: 'assistant-tool-freetext',
            msg,
            question: parsed.question,
            toolCall: tc,
          }
        }
      } else if (tc.name === 'update_doc_item') {
        const parsed = parseUpdateDocItem(tc)
        if (parsed) {
          return {
            kind: 'assistant-tool-update',
            msg,
            toolCall: tc,
          }
        }
      }
      // 未知 tool name / 解析失败 → 走老 bubble 路径
    }
    // 老路径：action 决定 polish/expand/reflect
    if (msg.action === 'polish') return { kind: 'assistant-polish', msg }
    if (msg.action === 'expand') return { kind: 'assistant-expand', msg }
    return { kind: 'assistant-bubble', msg }
  }),
)

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
  const t = input.value.trim()
  if (!t || streaming.value) return
  input.value = ''
  localError.value = null
  try {
    await send(t)
  } catch (e) {
    // start_chat invoke 失败（比如没配 provider）—— 玩家文案跟流式错误同套路
    console.error('[AiChatPanel] send failed:', e)
    localError.value = getErrorMessage('unknown', String(e)).title
  }
}

async function onSendPreset(preset: PresetAction) {
  if (streaming.value) return
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

/** v0.4+ update_doc_item "确认写入" 按钮
 *  - 把 tool result 喂回 LLM（"OK 玩家确认了"）
 *  - emit('adopt', replace) 让 ConceptView 写编辑器
 *  - 这俩并行发：写入不依赖 LLM 响应（LLM 可能想再加一句总结） */
async function onConfirmUpdate(toolCall: ToolCallInfo | undefined) {
  if (!toolCall) return
  // 1. 写编辑器：emit adopt，ConceptView 处理
  const args = parseUpdateDocItem(toolCall)
  if (!args) return
  emit('adopt', { text: args.content, mode: 'replace' })
  // 2. 喂回 LLM：让 ta 知道玩家确认了（如果没 sendToolResult 也不阻塞，编辑已写）
  if (sendToolResult) {
    try {
      await sendToolResult(toolCall.id, '玩家已确认写入。')
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

  // 排除规则:
  // - assistant-tool-question / assistant-tool-update 走单选, 不走整体采用 (LLM 调 tool 是显式问玩家)
  // - partial 还在流式, 等
  // - **polish/expand 一律排除**: 玩家点润色/扩展 chip 是想要"挑一个方向", 整体采用条不能"一键采用"
  //   LLM preamble (还没出 tool call 时说的"让我分析一下..."那种) 是 polish/expand action 但 kind=assistant-bubble
  //   —— 同样排除, 玩家应该等 tool call 出来用 AltCard 挑
  const block = afterUser.filter((d) => {
    if (d.kind === 'assistant-tool-question') return false
    if (d.kind === 'assistant-tool-update') return false
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
        <!-- v0.4+ ask_user_question tool → AltCard 卡片组（替代 v0.3+ JSON 解析） -->
        <div v-else-if="d.kind === 'assistant-tool-question'" class="tool-question">
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
        </div>
        <!-- v0.4+ ask_free_text tool → 气泡 + "我去答" 按钮 -->
        <div v-else-if="d.kind === 'assistant-tool-freetext'" class="tool-freetext">
          <MessageBubble :msg="d.msg" />
          <div class="tool-freetext-prompt">💭 {{ d.question }}</div>
          <div class="tool-freetext-hint">在下方输入框写你的想法，发送后会作为回答继续对话</div>
        </div>
        <!-- v0.4+ update_doc_item tool → "AI 建议写入 X" + 确认按钮 -->
        <div v-else-if="d.kind === 'assistant-tool-update'" class="tool-update">
          <div class="tool-update-title">✨ AI 建议写入</div>
          <div class="tool-update-content">{{ d.toolCall?.arguments }}</div>
          <button
            type="button"
            class="tool-update-btn"
            :disabled="streaming"
            @click="onConfirmUpdate(d.toolCall)"
          >
            <span class="tool-update-icon">✨</span>
            <span>确认写入编辑器</span>
          </button>
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
      {{ streamError.title }} —— {{ streamError.hint }}
    </div>
    <div v-if="localError" class="chat-error">{{ localError }}</div>

    <div v-if="presets.length > 0" class="chips">
      <button
        v-for="p in presets"
        :key="p.label"
        type="button"
        class="chip"
        :title="p.prompt"
        :disabled="streaming"
        @click="onSendPreset(p)"
      >
        {{ p.label }}
      </button>
    </div>

    <div class="composer">
      <textarea
        v-model="input"
        rows="2"
        placeholder="聊这一步的想法、疑问……（Enter 发送）"
        @keydown.enter.exact.prevent="onEnter"
      />
      <button
        class="send-btn"
        type="button"
        :disabled="!input.trim() || streaming"
        title="发送"
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
