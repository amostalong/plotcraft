<script setup lang="ts">
// SessionView —— chat tab 主 UI
//
// v0.1+ model + effort 选择器改用 Locus 同款 `ModelEffortSelector` 组件
// v0.1.3+ chat selector 只显示玩家在 Settings → Providers 库加的 custom provider
// v0.2+ 产品级 chat error feedback：
//   - composer 顶部错误条：title + description + hint + retry + 详情链接 + X
//   - transcript 区错误条：同上
//   - partial response 末尾 "(回复中断)" marker（LLM 流到一半挂的情况保留 currentText）
//   - 快捷键 Ctrl/Cmd+Shift+R 一键 retry
//   - "查看详情" 跳 Settings → Console tab，filter by run_id（App.vue / router 配合）

import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronUp,
  FolderOpen,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Square,
  Terminal,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-vue-next'

import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useProjectStore } from '@/stores/project'
import { renderMarkdown } from '@/lib/markdown'
import { getErrorMessage, type PlayerErrorMessage } from '@/lib/error-messages'
import type { ProjectMeta } from '@/lib/project'
import type { EffortLevel } from '@/lib/settings'
import ModelEffortSelector from '@/components/chat/ModelEffortSelector.vue'
import NewProjectModal from '@/components/project/NewProjectModal.vue'
import OpenProjectModal from '@/components/project/OpenProjectModal.vue'
import type { SessionMeta } from '@/lib/llm'

const chat = useChatStore()
const settings = useSettingsStore()
const project = useProjectStore()
const router = useRouter()
const route = useRoute()

const input = ref('')
const transcriptEl = ref<HTMLElement | null>(null)

const messages = computed(() => chat.state.messages)
const currentText = computed(() => chat.state.currentText)
const status = computed(() => chat.state.status)
const errorRaw = computed(() => chat.state.error)
const errorKind = computed(() => chat.state.errorKind)
const isStreaming = computed(() => status.value === 'streaming')

// === v0.2+ chat error feedback：玩家文案 ===
// - 默认隐藏技术细节（TLS handshake / OpenSSL / reqwest error 字符串）
// - 点 "查看详情" 才展开 raw error
const errorMessage = computed<PlayerErrorMessage | null>(() => {
  if (!errorRaw.value) return null
  return getErrorMessage(errorKind.value, errorRaw.value)
})
const errorDetailsExpanded = ref(false)

function toggleErrorDetails() {
  errorDetailsExpanded.value = !errorDetailsExpanded.value
}

/** v0.2+ retry 上次发送的 user message —— 用 chat store 暴露的 retryLast */
async function onRetry() {
  if (!errorMessage.value?.canRetry) return
  errorDetailsExpanded.value = false
  input.value = '' // retry 不沿用当前 input 草稿（避免混合）
  try {
    await chat.retryLast()
  } catch (e) {
    // retry 自身失败（比如 API key 空）→ 显示在 composerError
    // 走 send() 一样的路径（因为 retryLast 内部也是 addUserMessage + start）
    console.error('[onRetry] failed:', e)
  }
}

function onDismissError() {
  errorDetailsExpanded.value = false
  chat.dismissError()
}

/** v0.2+ "查看详情" 跳 Settings → Console tab，filter by run_id
 *  - App.vue 的 router 接收 query params
 *  - SettingsView 读到 runId 后传给 ConsoleSettings，filter messages */
function onShowConsoleDetails() {
  const runId = chat.state.lastFailedRunId
  if (!runId) {
    // 没 runId（极少见，比如 retry 失败时）→ 直接跳 Settings
    router.push({ path: '/settings', query: { tab: 'console' } })
    return
  }
  router.push({ path: '/settings', query: { tab: 'console', runId } })
}

/** v0.2+ 快捷键 Ctrl/Cmd+Shift+R → retry
 *  - 跟 Locus "retry last" 同款
 *  - 只在 chat 视图有焦点时生效（不跟 system hotkey 冲突） */
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
    if (errorMessage.value?.canRetry) {
      e.preventDefault()
      onRetry()
    }
  }
}

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
  const cp = settings.config.customProviders.find((p) => {
    if (!p.enabled) return false
    const effective = p.defaultModel?.trim() || p.models?.[0]?.id?.trim() || ''
    return effective === id
  })
  if (cp) {
    settings.config.base_url = cp.baseUrl
    settings.config.apiKey = cp.apiKey
    settings.config.apiFormat = cp.apiFormat
    settings.save().catch((e) => console.error('[onSelectModel] save failed:', e))
  }

  chat.selectedModel = id
}

function onSelectEffort(level: EffortLevel) {
  chat.selectedEffort = level
}

function renderMd(md: string): string {
  return renderMarkdown(md)
}

onMounted(async () => {
  await chat.init()
  if (!settings.loaded) await settings.init()
  // v0.2+ 注册全局快捷键
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  // v0.2+ chat.teardown() 改 no-op（listener 跟 view 生命周期解耦，避免切 tab 丢 stream）
  // 这里不再调 teardown；快捷键 listener 仍要清
  window.removeEventListener('keydown', onKeydown)
})

async function send() {
  const text = input.value.trim()
  if (!text || isStreaming.value) return
  if (!chat.selectedModel.trim()) {
    // v0.1.5+ 之前 send 静默 return（user 困惑"为什么没响应"）。现在 inline 提示
    composerError.value = '⚠ 没选 model —— 点左下 model selector 选一个（先在 Settings → Providers 库加 model）'
    return
  }
  composerError.value = null
  input.value = ''
  try {
    await chat.sendMessage(text)
  } catch (e) {
    // v0.1.5+ 之前 send 失败只 console.error，user 看不到。现在 inline 显示
    composerError.value = e instanceof Error ? e.message : String(e)
  }
}

async function stop() {
  await chat.stopCurrent()
}

// === v0.1.5+ Project flow：pickFolder → modal → confirm ===
const newProjectParent = ref<string | null>(null)
const openProjectScan = ref<{ parentDir: string; entries: ProjectMeta[] } | null>(null)
const creating = ref(false)
const createError = ref<string | null>(null)

// v0.2+ composer 错误条 —— 同步状态用（start_chat 同步抛错的 case，
// 比如 API key 空 / model 空）。stream 异步错误走 errorMessage computed。
const composerError = ref<string | null>(null)

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
    newProjectParent.value = null
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

// === v0.2+ session list UI ===
const renamingId = ref<string | null>(null)
const renameDraft = ref('')
const confirmingDeleteId = ref<string | null>(null)

async function onNewSession() {
  try {
    await chat.createNewSession('New Chat')
  } catch (e) {
    composerError.value = e instanceof Error ? e.message : String(e)
  }
}

function onSelectSession(s: SessionMeta) {
  if (s.id === chat.currentSessionId) return
  // 切 session 不清 composer 草稿（玩家可能切回去对照）
  chat.switchSession(s.id).catch((e) => {
    composerError.value = e instanceof Error ? e.message : String(e)
  })
}

function startRename(s: SessionMeta) {
  renamingId.value = s.id
  renameDraft.value = s.title
}
function commitRename() {
  const id = renamingId.value
  if (!id) return
  const newTitle = renameDraft.value.trim()
  renamingId.value = null
  if (!newTitle) return
  chat.renameSessionById(id, newTitle).catch((e) => {
    composerError.value = e instanceof Error ? e.message : String(e)
  })
}
function cancelRename() {
  renamingId.value = null
  renameDraft.value = ''
}
function startConfirmDelete(s: SessionMeta) {
  confirmingDeleteId.value = s.id
}
function cancelDelete() {
  confirmingDeleteId.value = null
}
function commitDelete(s: SessionMeta) {
  confirmingDeleteId.value = null
  // v0.2+：删任意 session 都允许，store.deleteSessionById() 兜底
  // —— 删完没剩余会自动 createNewSession('New Chat')，不会出现"零 session"空状态
  chat.deleteSessionById(s.id).catch((e) => {
    composerError.value = e instanceof Error ? e.message : String(e)
  })
}

/** 把 ISO 8601 截短成 "HH:MM" 或 "MM-DD"（v0.2 简版，v0.3+ 国际化用 date-fns） */
function shortTime(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    if (sameDay) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch {
    return ''
  }
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
  <div class="session-layout">
    <!-- v0.2+ 左侧 session list（跟 Locus ChatSessionList 同位） -->
    <aside class="session-list">
      <button class="session-list-new" @click="onNewSession" title="新建 session">
        <Plus :size="14" />
        <span>新建会话</span>
      </button>
      <div v-if="chat.sessionsLoading" class="session-list-empty">加载中…</div>
      <div v-else-if="chat.sessions.length === 0" class="session-list-empty">还没有 session</div>
      <div
        v-for="s in chat.sessions"
        :key="s.id"
        :class="['session-item', { active: s.id === chat.currentSessionId }]"
        @click="onSelectSession(s)"
      >
        <MessageSquare :size="13" class="session-item-icon" />
        <div v-if="renamingId === s.id" class="session-item-rename" @click.stop>
          <input
            v-model="renameDraft"
            @keydown.enter="commitRename"
            @keydown.escape="cancelRename"
            @blur="commitRename"
            class="rename-input"
            autofocus
          />
        </div>
        <div v-else class="session-item-body">
          <div class="session-item-title">{{ s.title }}</div>
          <div class="session-item-meta">
            <span>{{ s.message_count }} 条</span>
            <span class="dot">·</span>
            <span>{{ shortTime(s.updated_at) }}</span>
          </div>
        </div>
        <div v-if="renamingId !== s.id" class="session-item-actions" @click.stop>
          <button
            v-if="confirmingDeleteId === s.id"
            type="button"
            class="session-item-action confirm-delete"
            @click="commitDelete(s)"
            title="确认删除"
          >
            <Trash2 :size="11" />
          </button>
          <button
            v-else
            type="button"
            class="session-item-action"
            @click="startConfirmDelete(s)"
            title="删除"
          >
            <Trash2 :size="11" />
          </button>
          <button
            type="button"
            class="session-item-action"
            @click="startRename(s)"
            title="改名"
          >
            <Pencil :size="11" />
          </button>
        </div>
      </div>
    </aside>

    <!-- 右侧 chat main（v0.1 之前的内容） -->
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
      <div v-if="messages.length === 0 && !currentText && !errorMessage" class="empty">
        <Bot :size="48" :stroke-width="1.5" />
        <h2>开始新对话</h2>
        <p>跟 AI 聊你的 RPG / VN 设定 —— 我会给 3-5 个备选让你挑 + 改</p>
        <p v-if="!project.current" class="hint">建议先点顶部"新建项目"或"打开项目"</p>
      </div>

      <div
        v-for="(msg, i) in messages"
        :key="i"
        :class="['message', msg.role, msg.partial ? 'partial' : '']"
      >
        <UserIcon v-if="msg.role === 'user'" :size="16" />
        <Bot v-else :size="16" />
        <div v-if="msg.role === 'user'" class="content">{{ msg.content }}</div>
        <div
          v-else
          class="content markdown"
        >
          <div v-html="renderMd(msg.content)" />
          <!-- v0.2+ partial marker —— LLM 流到一半挂时显示 "(回复中断)" -->
          <div v-if="msg.partial" class="partial-marker">
            <span class="partial-marker-text">…回复中断</span>
          </div>
        </div>
      </div>

      <div v-if="currentText" class="message assistant streaming">
        <Bot :size="16" />
        <div class="content markdown streaming" v-html="renderMd(currentText) + '<span class=\'cursor\'>▍</span>'" />
      </div>

      <!-- v0.2+ transcript error block（产品级） -->
      <div v-if="errorMessage" class="error-block">
        <div class="error-block-header">
          <AlertCircle :size="16" />
          <div class="error-block-text">
            <div class="error-block-title">{{ errorMessage.title }}</div>
            <div class="error-block-description">{{ errorMessage.description }}</div>
            <div class="error-block-hint">
              <span class="hint-label">建议：</span>{{ errorMessage.hint }}
            </div>
          </div>
        </div>
        <div class="error-block-actions">
          <button
            v-if="errorMessage.canRetry && chat.state.lastUserMessage"
            type="button"
            class="error-btn retry"
            @click="onRetry"
            title="重发上一条 (Ctrl/Cmd+Shift+R)"
          >
            <RefreshCw :size="12" />
            <span>重试</span>
          </button>
          <button
            type="button"
            class="error-btn details"
            @click="onShowConsoleDetails"
            title="查看 Console 日志详情"
          >
            <Terminal :size="12" />
            <span>查看详情</span>
          </button>
          <button
            type="button"
            class="error-btn expand"
            @click="toggleErrorDetails"
            :title="errorDetailsExpanded ? '收起技术细节' : '展开技术细节'"
          >
            <component :is="errorDetailsExpanded ? ChevronUp : ChevronDown" :size="12" />
          </button>
          <button
            type="button"
            class="error-btn dismiss"
            @click="onDismissError"
            title="关闭错误提示"
          >
            <X :size="12" />
          </button>
        </div>
        <!-- v0.2+ 技术细节折叠区（默认折叠） -->
        <pre v-if="errorDetailsExpanded" class="error-block-raw">{{ errorMessage.technicalDetails }}</pre>
      </div>

      <div v-if="status === 'cancelled'" class="cancelled">已停止</div>
    </div>

    <form class="composer" @submit.prevent="send">
      <!-- v0.2+ composer 顶部 inline 错误（v0.1.5 兼容保留：send 同步抛错的 case） -->
      <div v-if="composerError" class="composer-error">
        <AlertCircle :size="12" />
        <span>{{ composerError }}</span>
        <button type="button" class="dismiss-btn" @click="composerError = null" title="关闭">
          <X :size="11" />
        </button>
      </div>

      <textarea
        v-model="input"
        class="composer-input"
        :placeholder="chat.selectedModel.trim() ? '输入消息... (Enter 发送, Shift+Enter 换行)' : '⚠ 选个 model 才能发消息（点左下 model selector）'"
        :class="{ 'no-model': !chat.selectedModel.trim() }"
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

    <Teleport to="body">
      <div v-if="createError" class="project-error-toast" role="alert">
        <AlertCircle :size="14" />
        <span>{{ createError }}</span>
        <button @click="createError = null" class="dismiss-btn" title="关闭">
          <X :size="12" />
        </button>
      </div>
    </Teleport>
    </div><!-- /session-main -->
  </div><!-- /session-layout -->
</template>

<style scoped>
/* === v0.2+ session layout: 左侧 list + 右侧 chat === */
.session-layout {
  display: flex;
  height: 100%;
  background: var(--bg);
}
.session-list {
  width: 240px;
  flex-shrink: 0;
  background: var(--bg-elev);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 4px;
  overflow-y: auto;
}
.session-list-new {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  background: transparent;
  color: var(--accent);
  border: 1px dashed var(--accent);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  font-weight: 500;
  transition: all 0.12s;
  flex-shrink: 0;
}
.session-list-new:hover {
  background: var(--accent-soft);
}
.session-list-empty {
  padding: 16px 8px;
  color: var(--text-muted);
  font-size: 11px;
  text-align: center;
  font-style: italic;
}
.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-muted);
  transition: background 0.1s;
  position: relative;
}
.session-item:hover {
  background: var(--hover);
  color: var(--text);
}
.session-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.session-item-icon {
  flex-shrink: 0;
  opacity: 0.7;
}
.session-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.session-item-title {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.session-item-meta {
  font-size: 10px;
  opacity: 0.7;
  display: flex;
  gap: 4px;
}
.session-item-meta .dot {
  opacity: 0.5;
}
.session-item-actions {
  display: none;
  gap: 2px;
  flex-shrink: 0;
}
.session-item:hover .session-item-actions,
.session-item.active .session-item-actions {
  display: flex;
}
.session-item-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  background: transparent;
  color: inherit;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  opacity: 0.6;
}
.session-item-action:hover {
  background: var(--bg);
  opacity: 1;
}
.session-item-action.confirm-delete {
  color: var(--error, #e53e3e);
  opacity: 1;
  animation: confirm-pulse 1s ease infinite;
}
@keyframes confirm-pulse {
  50% { transform: scale(1.1); }
}
.session-item-rename {
  flex: 1;
  min-width: 0;
}
.rename-input {
  width: 100%;
  padding: 2px 4px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--accent);
  border-radius: 3px;
  outline: none;
  font-size: 12px;
  font-family: inherit;
}

/* === 右侧 chat main（v0.1 既有 .session 样式，v0.2 wrapper 加了所以改名） === */
.session {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  flex: 1;
  min-width: 0;
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
/* v0.2+ partial assistant message —— LLM 流到一半挂时给视觉提示 */
.message.assistant.partial {
  border-style: dashed;
  opacity: 0.85;
}
.message .content {
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  flex: 1;
  min-width: 0;
}
.message .content.markdown {
  white-space: normal;
}
.partial-marker {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
  text-align: right;
}
.partial-marker-text {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
  letter-spacing: 0.3px;
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

/* === v0.2+ 产品级 chat error block（替换 v0.1 的 .error 简单红条）=== */
.error-block {
  max-width: 800px;
  padding: 12px 14px;
  background: rgba(232, 90, 90, 0.08);
  border: 1px solid var(--error, #e53e3e);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.error-block-header {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  color: var(--error, #e53e3e);
}
.error-block-header svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.error-block-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.error-block-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.error-block-description {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}
.error-block-hint {
  font-size: 12px;
  color: var(--accent);
  line-height: 1.5;
}
.hint-label {
  font-weight: 600;
  margin-right: 2px;
}
.error-block-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.error-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
  transition: all 0.12s ease;
}
.error-btn:hover {
  background: var(--hover);
  color: var(--text);
  border-color: var(--text-muted);
}
.error-btn.retry {
  color: var(--accent);
  border-color: var(--accent);
}
.error-btn.retry:hover {
  background: var(--accent);
  color: var(--bg);
}
.error-btn.expand,
.error-btn.dismiss {
  padding: 4px 6px;
}
.error-block-raw {
  margin: 0;
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow-y: auto;
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
/* === Composer === */
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
.composer-input.no-model {
  border-color: var(--error, #e53e3e);
  border-style: dashed;
}
.composer-input.no-model::placeholder {
  color: var(--text-muted);
  font-style: italic;
  opacity: 0.7;
}

/* composer 顶部 inline 错误条（v0.1.5+ 保留：send 同步抛错的 case）*/
.composer-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: rgba(232, 90, 90, 0.12);
  border: 1px solid var(--error, #e53e3e);
  color: var(--error, #e53e3e);
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.4;
}
.composer-error svg {
  flex-shrink: 0;
}
.composer-error span {
  flex: 1;
  min-width: 0;
}
.composer-error .dismiss-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  background: transparent;
  color: inherit;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  opacity: 0.7;
  flex-shrink: 0;
}
.composer-error .dismiss-btn:hover {
  opacity: 1;
  background: rgba(232, 90, 90, 0.15);
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

/* === v0.1.5+ Project flow error toast === */
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
  z-index: 1100;
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
