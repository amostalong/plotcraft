<script setup lang="ts">
// WorldView —— 世界 tab（5 个固定分节 + 编辑区 + AI 面板）
//
// - 左栏 sections：5 节 + 状态点（exists 橙 / 无 灰），点击切节
// - 中栏编辑区：标题 + hint + textarea（800ms debounce 自动落盘，对齐 ConceptView 惯例）
//   + save 状态提示（无 confirmed 按钮 —— 状态机是概念漏斗的语义）
// - 右栏 AI 面板：单个 AiChatPanel（v0.3+ 重构，备选 + 反思 chip + 自由对话 + 写编辑器）
//   - presets：每节 2 个 chip（生成备选 / 反思追问），store export SECTION_PRESETS
//   - step chat 历史内存 per-item，切节保留；切项目全清
// - 无项目 → 空态（对齐 ConceptView）；加载失败 → 左栏错误 + 重试
// - 玩家手改 world/ 文件后点「刷新」重扫（不做文件监听）

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { FolderOpen, Globe, RefreshCw } from 'lucide-vue-next'

import AiChatPanel from '@/components/ai/AiChatPanel.vue'
import { useProjectStore } from '@/stores/project'
import { SECTION_HINTS, SECTION_PRESETS, useWorldStore } from '@/stores/world'
import { useResizableWidth } from '@/composables/useResizableWidth'
import type { AdoptPayload } from '@/types/ai'

const world = useWorldStore()
const project = useProjectStore()

// === v0.3+ AI 面板宽度可调 ===
// v0.5.1 改默认 = 整体窗口的 1/4（函数式 defaultWidth：mount / resetWidth 调一次
// 取当前窗口尺寸，clamp 到 [320, 800]）。localStorage 已有玩家设的宽度优先 → 不动玩家手设值
// v0.4.1+ resetOnWindowResize: 窗口尺寸变化（最大化 / 还原 / 拖边缘）自动按比例 reset
const {
  width: aiPanelWidth,
  resizing: aiPanelResizing,
  onResizeStart: onAiPanelResizeStart,
  resetWidth: resetAiPanelWidth,
} = useResizableWidth({
  storageKey: 'plotcraft.aiPanelWidth',
  defaultWidth: () => Math.floor(window.innerWidth / 4),
  min: 320,
  max: 800,
  edge: 'left',
  resetOnWindowResize: true,
})

const currentDoc = computed(() => world.docs.find((d) => d.id === world.currentDocId) ?? null)
const hint = computed(() => SECTION_HINTS[world.currentDocId] ?? '')
/** 当前节的 presets（静态配置，响应式跟随 currentDocId 切换） */
const presets = computed(() => SECTION_PRESETS[world.currentDocId] ?? [])

/** header 字数（按字符数；中文英文都 1 字符，不分词） */
const headerWordCount = computed(() => currentDoc.value?.content.length ?? 0)

// === 编辑区（debounce 自动落盘 + flush on 切节/卸载，照搬 ConceptView） ===
const draft = ref('')
const original = ref('')
const saving = ref(false)
const savedAt = ref<string | null>(null)
const saveError = ref<string | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** docs 变化（load / save 返回）→ 同步编辑器内容 */
watch(
  currentDoc,
  (doc) => {
    draft.value = doc?.content ?? ''
    original.value = draft.value
    savedAt.value = doc?.updated ? shortTime(doc.updated) : null
    saveError.value = null
  },
  { immediate: true },
)

watch(draft, (v) => {
  if (!currentDoc.value || v === original.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void doSave(), 800)
})

/** 保存当前节（采用备选 / debounce 的重复触发防护：无变化跳过） */
async function doSave() {
  const doc = currentDoc.value
  if (!doc) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (draft.value === original.value) return
  saving.value = true
  saveError.value = null
  try {
    await world.save(doc.id, draft.value)
    original.value = draft.value
    savedAt.value = new Date().toTimeString().slice(0, 5)
  } catch (e) {
    console.error('[world save] failed:', e)
    saveError.value = '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

/** 切节 / 刷新 / 卸载前把 pending 的 debounce save 冲掉（fire-and-forget） */
function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const doc = currentDoc.value
  if (doc && draft.value !== original.value) {
    void world.save(doc.id, draft.value).catch((e) => console.error('[world flushSave] failed:', e))
  }
}

function onSelectDoc(id: string) {
  if (id === world.currentDocId) return
  flushSave()
  // v0.3+ 不再 resetStepChat：切节保留 chat 历史（AiChatPanel 派生自动切）
  world.currentDocId = id
}

async function onRefresh() {
  flushSave()
  await world.load()
}

// === AI 面板 adopt 回调（v0.3+ 单事件 + mode 派生） ===

/** AiChatPanel emit({ text, mode })：mode='replace' 替换；mode='append' 追加 */
function onAdopt(payload: AdoptPayload) {
  if (!currentDoc.value) return
  if (payload.mode === 'replace') {
    // 备选卡片「采用」→ 替换编辑器
    draft.value = payload.text
    void doSave()
  } else {
    // 气泡「写入编辑器」→ 追加到末尾
    const base = draft.value.trim()
    draft.value = base ? base + '\n\n' + payload.text.trim() : payload.text.trim()
    void doSave()
  }
}

/** ISO → "HH:MM"（跟 ConceptView shortTime 同款简版）
 *  老项目的 overview.md updated 可能是 "TODO" 占位 → Invalid Date 返回空串（不显示保存时间） */
function shortTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

onMounted(() => {
  void world.init() // 绑 step chat 的 chat:* listener（幂等）
  void world.load()
})
onUnmounted(() => {
  flushSave()
})

// 切项目 → 1. flush 老项目 chats  2. 清内存 + 删新项目 .chats/  3. load 新项目
// 注意：这里不 flushSave —— project.current 已变，flush 会把旧项目的草稿写进新项目；
// 未落盘的 debounce 草稿直接丢弃（最多 800ms 窗口，对齐 ConceptView 取舍）
watch(
  () => project.current?.folder,
  async (_newFolder, oldFolder) => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (oldFolder) {
      // 先落盘老项目 chats（store 内存里仍是老项目的 chat map；flushChatsTo 显式传 oldFolder）
      await world.flushChatsTo(oldFolder)
    }
    world.clearAllStepChats() // 清内存 + 删新项目的 .chats/（玩家新项目不应该有 chat 残留）
    void world.load()
  },
)
</script>

<template>
  <div class="world-view">
    <!-- 无项目 empty state（对齐 ConceptView） -->
    <div v-if="!project.current" class="empty">
      <Globe :size="48" :stroke-width="1.5" />
      <h2>世界</h2>
      <p>先在会话 tab 打开一个项目 —— 世界设定存在项目的 <code>world/</code> 文件夹里</p>
    </div>

    <template v-else>
      <div class="toolbar">
        <FolderOpen :size="14" />
        <span class="project-name">{{ project.current.name }}</span>
        <span class="toolbar-spacer" />
        <button @click="onRefresh" :disabled="world.loading" title="重扫 world/ 文件夹">
          <RefreshCw :size="12" :class="{ spinning: world.loading }" />
          <span>刷新</span>
        </button>
      </div>

      <div class="columns">
        <!-- 左栏 sections -->
        <nav class="sections">
          <button
            v-for="doc in world.docs"
            :key="doc.id"
            type="button"
            class="section"
            :class="{ active: doc.id === world.currentDocId }"
            @click="onSelectDoc(doc.id)"
          >
            <span class="section-title">{{ doc.title }}</span>
            <span
              class="dot"
              :class="doc.exists ? 'exists' : 'missing'"
              :title="doc.exists ? '已有内容' : '还没写'"
            />
          </button>
          <div v-if="world.error" class="sections-error">
            加载失败：{{ world.error }}
            <button type="button" @click="onRefresh">重试</button>
          </div>
          <div v-else-if="world.docs.length === 0 && !world.loading" class="sections-empty">
            加载中…
          </div>
        </nav>

        <!-- 中栏编辑区 -->
        <section v-if="currentDoc" class="editor">
          <div class="editor-header">
            <h3>{{ currentDoc.title }}</h3>
            <code class="filename">world/{{ currentDoc.filename }}</code>
          </div>
          <p class="hint">{{ hint }}</p>
          <textarea v-model="draft" class="editor-input" :placeholder="hint" />
          <div class="save-status">
            <span v-if="saving" class="saving">保存中…</span>
            <span v-else-if="saveError" class="save-error">{{ saveError }}</span>
            <span v-else-if="savedAt" class="saved">已保存 {{ savedAt }}</span>
          </div>
        </section>

        <!-- 右栏 AI 面板（v0.3+ 统一：单 AiChatPanel，4 chip/section + 自由对话 + 写/替换编辑器）
             v-if 跟中栏编辑器对齐：docs 没 load 完 / 空时不显示（currentDoc.title 会被读） -->
        <aside v-if="currentDoc" class="ai-panel" :style="{ width: aiPanelWidth + 'px' }">
          <AiChatPanel
            :item-id="world.currentDocId"
            :title="currentDoc.title"
            :chat="(world.stepChat as any)"
            :presets="presets"
            :word-count="headerWordCount"
            @adopt="onAdopt"
          />
          <div
            class="ai-panel-resize-handle"
            :class="{ active: aiPanelResizing }"
            @mousedown="onAiPanelResizeStart"
            @dblclick="resetAiPanelWidth"
            title="拖动调整 AI 面板宽度 · 双击重置为 480px"
          >
            <div v-if="aiPanelResizing" class="ai-panel-resize-tooltip">{{ aiPanelWidth }}px</div>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.world-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: var(--text-muted);
}
.empty h2 {
  font-size: 18px;
  font-weight: 500;
  color: var(--text);
  margin-top: 8px;
}
.empty p {
  font-size: 13px;
}
.empty code,
.filename {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 0.9em;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
  color: var(--text);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  flex-shrink: 0;
}
.project-name {
  color: var(--accent);
  font-weight: 500;
  font-size: 12px;
}
.toolbar-spacer {
  flex: 1;
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
.toolbar button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.toolbar button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.columns {
  flex: 1;
  min-height: 0;
  display: flex;
}

/* === 左栏 sections === */
.sections {
  width: 180px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.section {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  text-align: left;
}
.section:hover {
  background: var(--hover);
  color: var(--text);
}
.section.active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent);
}
.section-title {
  flex: 1;
}
.dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
}
.dot.missing {
  background: var(--text-muted);
  opacity: 0.4;
}
.dot.exists {
  background: var(--warning, #d9822b);
}
.sections-empty {
  padding: 12px 10px;
  color: var(--text-muted);
  font-size: 12px;
}
.sections-error {
  padding: 12px 10px;
  color: var(--error, #e53e3e);
  font-size: 12px;
  line-height: 1.6;
  word-break: break-all;
}
.sections-error button {
  margin-top: 6px;
  padding: 3px 10px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}
.sections-error button:hover {
  background: var(--hover);
  color: var(--text);
}

/* === 中栏编辑区 === */
.editor {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 16px 20px;
  gap: 8px;
}
.editor-header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.editor-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}
.editor-input {
  flex: 1;
  min-height: 0;
  width: 100%;
  padding: 10px 12px;
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.7;
  resize: none;
  box-sizing: border-box;
}
.editor-input:focus {
  border-color: var(--accent);
}
.save-status {
  font-size: 11px;
  min-height: 14px;
}
.save-status .saving {
  color: var(--text-muted);
}
.save-status .saved {
  color: var(--accent);
}
.save-status .save-error {
  color: var(--error, #e53e3e);
}

/* === 右栏 AI 面板 === */
/* v0.3+ 宽度改成 inline style 控制 (composable useResizableWidth) */
.ai-panel {
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  position: relative;
}

/* v0.3+ AI 面板左侧拖拽手柄 (默认 1px 灰细线, hover/active 变 accent 粗线) */
.ai-panel-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 12px;
  cursor: ew-resize;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ai-panel-resize-handle::before {
  content: '';
  position: absolute;
  width: 1px;
  height: 32px;
  background: var(--border);
  border-radius: 1px;
  opacity: 0.3;
  transition: opacity 0.15s ease, height 0.15s ease, width 0.15s ease, background 0.15s ease;
}
.ai-panel-resize-handle:hover::before,
.ai-panel-resize-handle.active::before {
  opacity: 1;
  background: var(--accent);
  width: 2px;
  height: 48px;
}
.ai-panel-resize-tooltip {
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--accent);
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  user-select: none;
}
</style>
