<script setup lang="ts">
// SessionView —— chat tab 主 UI
//
// v0.1+ model + effort 选择器改用 Locus 同款 `ModelEffortSelector` 组件
// （嵌在 chat composer 左下，trigger 按钮 + 双 panel 下拉）
// - 位置：composer footer-start（跟 Locus ChatComposer 同位）
// - 切 apiFormat → selector 自动重过滤建议列表
// - 切走再切回 chat session 保留 selectedModel / selectedEffort（不重置）
//   跟 Locus 行为对齐 —— 切 session tab 不丢玩家当前对话上下文

import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  AlertCircle,
  Bot,
  FolderOpen,
  Plus,
  Send,
  Square,
  User as UserIcon,
  X,
} from 'lucide-vue-next'

import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useProjectStore } from '@/stores/project'
import { renderMarkdown } from '@/lib/markdown'
import { BUILTIN_MODELS, findModel, getDefaultEffort, getSupportedEfforts } from '@/lib/modelCatalog'
import type { EffortLevel } from '@/lib/settings'
import ModelEffortSelector from '@/components/chat/ModelEffortSelector.vue'

const chat = useChatStore()
const settings = useSettingsStore()
const project = useProjectStore()

const input = ref('')
const transcriptEl = ref<HTMLElement | null>(null)

const messages = computed(() => chat.state.messages)
const currentText = computed(() => chat.state.currentText)
const status = computed(() => chat.state.status)
const error = computed(() => chat.state.error)
const isStreaming = computed(() => status.value === 'streaming')

/** 按 active apiFormat 过滤的 model 建议（ModelEffortSelector 用） */
const suggestedModels = computed(() => {
  const fmt = settings.config.apiFormat
  switch (fmt) {
    case 'anthropic_messages':
      return BUILTIN_MODELS.filter((m) => m.provider === 'anthropic')
    case 'openai_chat':
    case 'openai_responses':
    default:
      return BUILTIN_MODELS.filter((m) => m.provider === 'openai')
  }
})

/** v0.1+ 玩家 enabled 且有 defaultModel 的 custom providers（selector Custom 段头用） */
const customProviderShortcuts = computed(() =>
  settings.config.customProviders
    .filter((p) => p.enabled && p.defaultModel && p.defaultModel.trim().length > 0)
    .map((p) => ({ id: p.id, name: p.name, defaultModel: p.defaultModel })),
)

/** 当前 model 是否支持 effort（找不到 / 不支持 → false，selector 隐藏右 panel） */
const effortSupported = computed(() => {
  const m = findModel(chat.selectedModel)
  if (!m) {
    // 自定义 model → 默认显示 effort panel（best-effort）
    return true
  }
  const supported = getSupportedEfforts(m)
  return supported.length > 1 || (supported.length === 1 && supported[0] !== 'none')
})

function onSelectModel(id: string) {
  // 1. 检查是否选的是某个 custom provider 的 defaultModel
  //    → 切 active connection 到该 provider（跟 ProvidersPanel "Use" 按钮行为一致）
  const cp = settings.config.customProviders.find(
    (p) => p.defaultModel === id && p.enabled,
  )
  if (cp) {
    settings.config.base_url = cp.baseUrl
    settings.config.apiKey = cp.apiKey
    settings.config.apiFormat = cp.apiFormat
    // 玩家改了 settings —— 立即存盘（让其他 tab / 下次启动看到新 connection）
    settings.save().catch((e) => console.error('[onSelectModel] save failed:', e))
  }

  chat.selectedModel = id
  // 切换 model 时，如果当前 effort 不在新 model 的支持列表里 → 重置为该 model 的 default
  const m = findModel(id)
  const supported = getSupportedEfforts(m)
  if (!supported.includes(chat.selectedEffort)) {
    chat.selectedEffort = getDefaultEffort(m)
  }
}

function onSelectEffort(level: EffortLevel) {
  chat.selectedEffort = level
}

function renderMd(md: string): string {
  return renderMarkdown(md)
}

onMounted(async () => {
  await chat.init()
  // settings 一定要先 init（chat.init() 也会从 settings 拉默认值）
  if (!settings.loaded) await settings.init()
})
onUnmounted(() => {
  chat.teardown()
})

async function send() {
  const text = input.value.trim()
  if (!text || isStreaming.value) return
  if (!chat.selectedModel.trim()) {
    // 没 model 就不发（前端友好提示）
    return
  }
  input.value = ''
  await chat.sendMessage(text)
}

async function stop() {
  await chat.stopCurrent()
}

async function onCreate() {
  await project.createNew()
}
async function onOpen() {
  await project.openExisting()
}
function onCloseProject() {
  project.close()
}

// 自动滚到底部（streaming 时持续滚）
watch(
  [messages, currentText],
  async () => {
    await nextTick()
    if (transcriptEl.value) {
      transcriptEl.value.scrollTop = transcriptEl.value.scrollHeight
    }
  },
  { deep: true },
)
</script>

<template>
  <div class="session">
    <div class="toolbar">
      <button v-if="!project.current" @click="onCreate" class="primary">
        <Plus :size="14" />
        <span>新建项目</span>
      </button>
      <button v-if="!project.current" @click="onOpen">
        <FolderOpen :size="14" />
        <span>打开项目</span>
      </button>
      <div v-if="project.current" class="current-project">
        <FolderOpen :size="14" />
        <span class="name">{{ project.current.name }}</span>
        <span class="path">{{ project.current.folder }}</span>
        <button @click="onCloseProject" class="close" title="关闭项目">
          <X :size="14" />
        </button>
      </div>
    </div>

    <div ref="transcriptEl" class="transcript">
      <div v-if="messages.length === 0 && !currentText" class="empty">
        <Bot :size="48" :stroke-width="1.5" />
        <h2>开始新对话</h2>
        <p>跟 AI 聊你的 RPG / VN 设定 —— 我会给 3-5 个备选让你挑 + 改</p>
        <p v-if="!project.current" class="hint">建议先点顶部"新建项目"或"打开项目"</p>
      </div>

      <div
        v-for="(msg, i) in messages"
        :key="i"
        :class="['message', msg.role]"
      >
        <UserIcon v-if="msg.role === 'user'" :size="16" />
        <Bot v-else :size="16" />
        <div v-if="msg.role === 'user'" class="content">{{ msg.content }}</div>
        <div
          v-else
          class="content markdown"
          v-html="renderMd(msg.content)"
        />
      </div>

      <div v-if="currentText" class="message assistant streaming">
        <Bot :size="16" />
        <div class="content markdown streaming" v-html="renderMd(currentText) + '<span class=\'cursor\'>▍</span>'" />
      </div>

      <div v-if="status === 'error' && error" class="error">
        <AlertCircle :size="16" />
        <span>{{ error }}</span>
      </div>

      <div v-if="status === 'cancelled'" class="cancelled">已停止</div>
    </div>

    <form class="composer" @submit.prevent="send">
      <!-- v0.1+ composer 布局（跟 Locus `ChatComposer` 同位）：
           - 上：textarea（满宽）
           - 下：footer 行（ModelEffortSelector 左 + 弹性空间 + 发送按钮 右） -->
      <textarea
        v-model="input"
        class="composer-input"
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
        :disabled="isStreaming"
        @keydown.enter.exact.prevent="send"
      />
      <div class="composer-footer">
        <ModelEffortSelector
          :models="suggestedModels"
          :custom-provider-shortcuts="customProviderShortcuts"
          :selected-id="chat.selectedModel"
          :effort="chat.selectedEffort"
          :effort-supported="effortSupported"
          align="start"
          :disabled="isStreaming"
          @select-model="onSelectModel"
          @select-effort="onSelectEffort"
        />
        <div class="composer-footer-spacer" />
        <button v-if="!isStreaming" type="submit" class="composer-send" :disabled="!input.trim() || !chat.selectedModel.trim()">
          <Send :size="16" />
          <span>发送</span>
        </button>
        <button v-else type="button" class="composer-send stop" @click="stop">
          <Square :size="16" />
          <span>停止</span>
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.session {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}
.toolbar {
  display: flex;
  gap: 8px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  align-items: center;
  flex-shrink: 0;
}
.toolbar button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}
.toolbar button:hover {
  background: var(--hover);
  color: var(--text);
}
.toolbar button.primary {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.toolbar button.primary:hover {
  background: var(--accent);
  color: var(--bg);
  opacity: 0.85;
}
.current-project {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 8px;
  font-size: 12px;
  color: var(--text-muted);
}
.current-project .name {
  color: var(--accent);
  font-weight: 500;
}
.current-project .path {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.7;
}
.current-project .close {
  padding: 2px;
  border: none;
  background: transparent;
}
.transcript {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  gap: 12px;
}
.empty h2 {
  font-size: 18px;
  color: var(--text);
  font-weight: 500;
}
.empty p {
  font-size: 13px;
  max-width: 360px;
  text-align: center;
}
.empty .hint {
  margin-top: 8px;
  color: var(--accent);
  font-size: 12px;
}
.message {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  max-width: 800px;
  padding: 8px 12px;
  border-radius: 8px;
}
.message.user {
  background: var(--bg-elev);
  margin-left: auto;
  flex-direction: row-reverse;
}
.message.assistant {
  background: transparent;
  border: 1px solid var(--border);
}
.message.assistant.streaming {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.message .content {
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.message .content.markdown {
  white-space: normal;
}

.markdown :deep(p) { margin: 0 0 8px; }
.markdown :deep(p:last-child) { margin-bottom: 0; }
.markdown :deep(h1), .markdown :deep(h2), .markdown :deep(h3), .markdown :deep(h4) {
  margin: 12px 0 8px;
  font-weight: 600;
  color: var(--text);
}
.markdown :deep(h1) { font-size: 18px; }
.markdown :deep(h2) { font-size: 16px; }
.markdown :deep(h3) { font-size: 15px; }
.markdown :deep(h4) { font-size: 14px; }
.markdown :deep(ul), .markdown :deep(ol) {
  margin: 0 0 8px;
  padding-left: 20px;
}
.markdown :deep(li) { margin-bottom: 2px; }
.markdown :deep(code) {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 0.9em;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
}
.markdown :deep(pre) {
  margin: 8px 0;
  padding: 8px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow-x: auto;
}
.markdown :deep(pre code) {
  background: none;
  border: none;
  padding: 0;
}
.markdown :deep(blockquote) {
  margin: 8px 0;
  padding: 4px 12px;
  border-left: 3px solid var(--accent);
  color: var(--text-muted);
  background: var(--accent-soft);
}
.markdown :deep(a) {
  color: var(--accent);
  text-decoration: none;
}
.markdown :deep(a:hover) {
  text-decoration: underline;
}
.markdown :deep(strong) {
  font-weight: 600;
  color: var(--text);
}
.markdown :deep(em) { font-style: italic; }
.markdown :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 12px 0;
}

.cursor {
  display: inline-block;
  animation: blink 1s steps(2) infinite;
  color: var(--accent);
  margin-left: 2px;
}
@keyframes blink {
  50% { opacity: 0; }
}
.error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(232, 90, 90, 0.12);
  border: 1px solid var(--error);
  color: var(--error);
  border-radius: 6px;
  font-size: 13px;
}
.cancelled {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  color: var(--text-muted);
  font-size: 12px;
  font-style: italic;
}
/* === Composer（v0.1+ Locus 风格：textarea 上 + footer 下） === */
.composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 16px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-elev);
}
.composer-input {
  width: 100%;
  min-height: 56px;
  max-height: 200px;
  resize: none;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.5;
  padding: 8px 10px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.12s ease;
}
.composer-input:focus {
  border-color: var(--accent);
}
.composer-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.composer-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
.composer-footer-spacer {
  flex: 1 1 auto;
  min-width: 0;
}
.composer-send {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: var(--accent);
  color: var(--bg);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  font-size: 12px;
  font-family: inherit;
  flex-shrink: 0;
}
.composer-send:disabled {
  background: var(--border);
  color: var(--text-muted);
  cursor: not-allowed;
}
.composer-send.stop {
  background: var(--error);
  color: white;
}
</style>
