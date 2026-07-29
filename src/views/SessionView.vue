<script setup lang="ts">
// SessionView —— chat tab 主 UI
//
// v0.1+ model + effort 选择器改用 Locus 同款 `ModelEffortSelector` 组件
// （嵌在 chat composer 左下，trigger 按钮 + 双 panel 下拉）
// - 位置：composer footer-start（跟 Locus ChatComposer 同位）
// - 切走再切回 chat session 保留 selectedModel / selectedEffort（不重置）
//   跟 Locus 行为对齐 —— 切 session tab 不丢玩家当前对话上下文
//
// v0.1.3+：chat selector 不再自动展示 BUILTIN_MODELS —— 只显示玩家在
// Settings → Providers 主动 add 的 custom provider 及其 defaultModel。
// 0 个 provider → trigger "Select model" placeholder + send disabled。

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
import type { ProjectMeta } from '@/lib/project'
import type { EffortLevel } from '@/lib/settings'
import ModelEffortSelector from '@/components/chat/ModelEffortSelector.vue'
import NewProjectModal from '@/components/project/NewProjectModal.vue'
import OpenProjectModal from '@/components/project/OpenProjectModal.vue'

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

/** v0.1.3+ chat selector 唯一数据源：玩家 enabled 的 custom provider
 *  effective default：defaultModel || models[0].id
 *  0 个 provider → 数组为空 → selector 显示空状态
 */
const customProviderShortcuts = computed(() =>
  settings.config.customProviders
    .filter((p) => p.enabled)
    .map((p) => {
      const effective = p.defaultModel?.trim() || p.models?.[0]?.id?.trim() || ''
      return { id: p.id, name: p.name, defaultModel: effective }
    })
    .filter((p) => p.defaultModel.length > 0),
)

/** v0.1.5+ 没填 model 的 enabled provider 数 —— 给 chat selector empty state 用
 *  让玩家能区分"完全没 add provider"和"add 了但没 model"两种情况 */
const unconfiguredProviderCount = computed(
  () =>
    settings.config.customProviders.filter((p) => {
      if (!p.enabled) return false
      const effective = p.defaultModel?.trim() || p.models?.[0]?.id?.trim() || ''
      return effective === ''
    }).length,
)

/** v0.1.3+：玩家加的 custom model 不知道具体支持哪些 effort —— 一律 best-effort 显示右 panel。
 *  后端对不支持的 model 静默 no-op（不报错）。
 *  0 model → 隐藏右 panel（避免空 effort 列表）
 */
const effortSupported = computed(() => chat.selectedModel.trim().length > 0)

function onSelectModel(id: string) {
  // v0.1.3+ 检查是否选的是某个 custom provider 的 defaultModel
  //   → 切 active connection 到该 provider（跟 ProvidersPanel "Use" 按钮行为一致）
  //   effective default：defaultModel || models[0].id
  const cp = settings.config.customProviders.find((p) => {
    if (!p.enabled) return false
    const effective = p.defaultModel?.trim() || p.models?.[0]?.id?.trim() || ''
    return effective === id
  })
  if (cp) {
    settings.config.base_url = cp.baseUrl
    settings.config.apiKey = cp.apiKey
    settings.config.apiFormat = cp.apiFormat
    // 玩家改了 settings —— 立即存盘（让其他 tab / 下次启动看到新 connection）
    settings.save().catch((e) => console.error('[onSelectModel] save failed:', e))
  }

  chat.selectedModel = id
  // v0.1.3+ 不再重置 effort：custom model 不知道 default effort，保留玩家上次选的值
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

// === v0.1.5+ Project flow：pickFolder → modal → confirm ===
const newProjectParent = ref<string | null>(null)
const openProjectScan = ref<{ parentDir: string; entries: ProjectMeta[] } | null>(null)
const creating = ref(false)
const createError = ref<string | null>(null)

async function onCreate() {
  createError.value = null
  const dir = await project.pickParentDir('选择项目根目录（你的游戏文件夹会放在这里）')
  if (!dir) return
  newProjectParent.value = dir
}
function onNewModalClose() {
  newProjectParent.value = null
  createError.value = null
}
async function onNewModalCreate(name: string) {
  if (!newProjectParent.value) return
  creating.value = true
  createError.value = null
  try {
    await project.confirmCreateNew(newProjectParent.value, name)
    newProjectParent.value = null // 成功后关 modal
  } catch (e) {
    createError.value = e instanceof Error ? e.message : String(e)
  } finally {
    creating.value = false
  }
}

async function onOpen() {
  createError.value = null
  try {
    const result = await project.scanForProjects()
    if (!result) return
    openProjectScan.value = result
  } catch (e) {
    createError.value = e instanceof Error ? e.message : String(e)
  }
}
function onOpenModalClose() {
  openProjectScan.value = null
  createError.value = null
}
function onOpenModalPick(p: ProjectMeta) {
  project.confirmOpenProject(p)
  openProjectScan.value = null
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
          :custom-provider-shortcuts="customProviderShortcuts"
          :unconfigured-provider-count="unconfiguredProviderCount"
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

    <!-- v0.1.5+ Project modals (custom PlotCraft 风格，替代 OS system dialog) -->
    <NewProjectModal
      v-if="newProjectParent"
      :parent-dir="newProjectParent"
      :creating="creating"
      @close="onNewModalClose"
      @create="onNewModalCreate"
    />
    <OpenProjectModal
      v-if="openProjectScan"
      :root-dir="openProjectScan.parentDir"
      :entries="openProjectScan.entries"
      @close="onOpenModalClose"
      @pick="onOpenModalPick"
    />

    <!-- v0.1.5+ Project flow error toast (e.g. 创建失败 / list 失败) -->
    <Teleport to="body">
      <div v-if="createError" class="project-error-toast" role="alert">
        <AlertCircle :size="14" />
        <span>{{ createError }}</span>
        <button @click="createError = null" class="dismiss-btn" title="关闭">
          <X :size="12" />
        </button>
      </div>
    </Teleport>
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

/* === v0.1.5+ Project flow error toast (e.g. 创建失败 / list 失败) === */
.project-error-toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  background: var(--bg-elev);
  color: var(--error, #e53e3e);
  border: 1px solid var(--error, #e53e3e);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
  font-size: 13px;
  z-index: 1100; /* 高于 OpenProjectModal (1000) */
  max-width: min(560px, calc(100vw - 32px));
}
.project-error-toast .dismiss-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  background: transparent;
  color: var(--error, #e53e3e);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  opacity: 0.7;
  flex-shrink: 0;
}
.project-error-toast .dismiss-btn:hover {
  opacity: 1;
  background: rgba(232, 90, 90, 0.15);
}
</style>
