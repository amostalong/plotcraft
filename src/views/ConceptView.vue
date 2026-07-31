<script setup lang="ts">
// ConceptView —— 概念 tab（概念设计漏斗：6 步 stepper + 编辑区 + AI 面板）
//
// - 左栏 stepper：6 步 + 状态点（empty 灰 / draft 橙 / confirmed 绿），点击切步
// - 中栏编辑区：标题 + hint + textarea（800ms debounce 自动落盘，对齐 ConceptArtView 惯例）
//   + 「标记为已确认」切换 + save 状态提示
// - 右栏 AI 面板：单个 AiChatPanel（替代 v0.2 的 AlternativesPicker + StepChatPanel 两件套）
//   - presets：每步 2 个 chip（生成备选 / 反思追问），store export STEP_PRESETS
//   - step chat 历史内存 per-item，切步保留；切项目全清
// - 无项目 → 空态（对齐 ConceptArtView）
// - 玩家手改 concept/ 文件后点「刷新」重扫（不做文件监听，对齐 art）

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Check, FolderOpen, Lightbulb, RefreshCw } from 'lucide-vue-next'

import AiChatPanel from '@/components/ai/AiChatPanel.vue'
import { STEP_HINTS, STEP_PRESETS, useConceptStore } from '@/stores/concept'
import { useProjectStore } from '@/stores/project'
import { useResizableWidth } from '@/composables/useResizableWidth'
import type { ConceptStepId, ConceptStepStatus } from '@/types/concept'
import type { AdoptPayload } from '@/types/ai'

const concept = useConceptStore()
const project = useProjectStore()

// === v0.3+ AI 面板宽度可调 (默认 480px = 1.5x 原 320px) ===
const {
  width: aiPanelWidth,
  resizing: aiPanelResizing,
  onResizeStart: onAiPanelResizeStart,
  resetWidth: resetAiPanelWidth,
} = useResizableWidth({
  storageKey: 'plotcraft.aiPanelWidth',
  defaultWidth: 480,
  min: 320,
  max: 800,
  edge: 'left',
})

const STATUS_LABELS: Record<ConceptStepStatus, string> = {
  empty: '未开始',
  confirmed: '已确认',
}

const currentStep = computed(
  () => concept.steps.find((s) => s.id === concept.currentStepId) ?? null,
)
const hint = computed(() => STEP_HINTS[concept.currentStepId as ConceptStepId] ?? '')
/** 当前 step 的 presets（静态配置，响应式跟随 currentStepId 切换） */
const presets = computed(() => STEP_PRESETS[concept.currentStepId as ConceptStepId] ?? [])

/** header 字数（按字符数；中文英文都 1 字符，不分词） */
const headerWordCount = computed(() => currentStep.value?.content.length ?? 0)

// === 编辑区（debounce 自动落盘 + flush on 切步/卸载，对齐 ConceptArtView） ===
const draft = ref('')
const original = ref('')
const saving = ref(false)
const savedAt = ref<string | null>(null)
const saveError = ref<string | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** steps 变化（load / save 返回）→ 同步编辑器内容 */
watch(
  currentStep,
  (step) => {
    draft.value = step?.content ?? ''
    original.value = draft.value
    savedAt.value = step?.updated ? shortTime(step.updated) : null
    saveError.value = null
  },
  { immediate: true },
)

watch(draft, (v) => {
  if (!currentStep.value || v === original.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void doSave(), 800)
})

/** 保存当前步（v0.3+ 永远 markConfirmed=true：玩家操作 = 自动 confirmed，不再有"标记为已确认"按钮） */
async function doSave() {
  const step = currentStep.value
  if (!step) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  // 无变化且状态不变 → 跳过（采用备选的重复触发防护）
  if (draft.value === original.value) return
  saving.value = true
  saveError.value = null
  try {
    await concept.save(step.id, draft.value, true) // 永远 markConfirmed = true
    original.value = draft.value
    savedAt.value = new Date().toTimeString().slice(0, 5)
  } catch (e) {
    console.error('[concept save] failed:', e)
    saveError.value = '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

/** 切步 / 刷新 / 卸载前把 pending 的 debounce save 冲掉（fire-and-forget） */
function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const step = currentStep.value
  if (step && draft.value !== original.value) {
    void concept.save(step.id, draft.value, true).catch((e) => console.error('[concept flushSave] failed:', e))
  }
}

function onSelectStep(id: string) {
  if (id === concept.currentStepId) return
  flushSave()
  // v0.3+ 不再 resetStepChat：切步保留 chat 历史（AiChatPanel 派生自动切）
  concept.currentStepId = id
}

async function onRefresh() {
  flushSave()
  await concept.load()
}

// === AI 面板 adopt 回调（v0.3+ 单事件 + mode 派生） ===

/** AiChatPanel emit({ text, mode })：mode='replace' 替换；mode='append' 追加 */
function onAdopt(payload: AdoptPayload) {
  if (!currentStep.value) return
  if (payload.mode === 'replace') {
    // 备选卡片「采用」→ 替换编辑器
    draft.value = payload.text
    void doSave()
  } else {
    // 气泡「写入编辑器」→ 追加到末尾
    const step = currentStep.value
    const base = draft.value.trim()
    draft.value = base ? base + '\n\n' + payload.text.trim() : payload.text.trim()
    void doSave()
  }
}

/** ISO → "HH:MM"（跟 SessionView shortTime 同款简版） */
function shortTime(iso: string): string {
  try {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

onMounted(() => {
  void concept.init() // 绑 step chat 的 chat:* listener（幂等）
  void concept.load()
})
onUnmounted(() => {
  flushSave()
})

/** v0.4+ 兜底：load 完 steps 时，如果 currentStepId 不在数组里 → 自动跳到第一个 step
 *  - 之前 v-if="currentStep" 在 steps 数组里没匹配 id 时整个 AI 面板不显示
 *  - 现在 load 完保证 currentStep 永远非 null（只要 steps 非空）
 *  - steps 为空（项目没 concept/ 目录）仍走 v-else 占位（"加载中..."） */
watch(
  () => concept.steps,
  (steps) => {
    if (steps.length === 0) return
    if (!steps.find((s) => s.id === concept.currentStepId)) {
      concept.currentStepId = steps[0].id
    }
  },
)

// 切项目 → 1. flush 老项目 chats（落盘内存里的旧项目 chat） 2. 清内存 + 删新项目 .chats/  3. load 新项目
// 注意：这里不 flushSave —— project.current 已变，flush 会把旧项目的草稿写进新项目；
// 未落盘的 debounce 草稿直接丢弃（最多 800ms 窗口，对齐 art 的"切项目关 modal"取舍）
watch(
  () => project.current?.folder,
  async (_newFolder, oldFolder) => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (oldFolder) {
      // 先落盘老项目 chats（store 内存里仍是老项目的 chat map；flushChatsTo 显式传 oldFolder）
      await concept.flushChatsTo(oldFolder)
    }
    concept.clearAllStepChats() // 清内存 + 删新项目的 .chats/（玩家新项目不应该有 chat 残留）
    void concept.load()
  },
)
</script>

<template>
  <div class="concept-view">
    <!-- 无项目 empty state（对齐 ConceptArtView） -->
    <div v-if="!project.current" class="empty">
      <Lightbulb :size="48" :stroke-width="1.5" />
      <h2>概念</h2>
      <p>先在会话 tab 打开一个项目 —— 概念设计存在项目的 <code>concept/</code> 文件夹里</p>
    </div>

    <template v-else>
      <div class="toolbar">
        <FolderOpen :size="14" />
        <span class="project-name">{{ project.current.name }}</span>
        <span class="toolbar-spacer" />
        <button @click="onRefresh" :disabled="concept.loading" title="重扫 concept/ 文件夹">
          <RefreshCw :size="12" :class="{ spinning: concept.loading }" />
          <span>刷新</span>
        </button>
      </div>

      <div class="columns">
        <!-- 左栏 stepper -->
        <nav class="stepper">
          <button
            v-for="(step, i) in concept.steps"
            :key="step.id"
            type="button"
            class="step"
            :class="{ active: step.id === concept.currentStepId }"
            @click="onSelectStep(step.id)"
          >
            <span class="step-index">{{ i + 1 }}</span>
            <span class="step-title">{{ step.title }}</span>
            <span class="dot" :class="step.status" :title="STATUS_LABELS[step.status]" />
          </button>
          <div v-if="concept.error" class="stepper-error">
            加载失败：{{ concept.error }}
            <button type="button" @click="onRefresh">重试</button>
          </div>
          <div v-else-if="concept.steps.length === 0 && !concept.loading" class="stepper-empty">
            加载中…
          </div>
        </nav>

        <!-- 中栏编辑区 -->
        <section v-if="currentStep" class="editor">
          <div class="editor-header">
            <h3>{{ currentStep.title }}</h3>
            <code class="filename">concept/{{ currentStep.filename }}</code>
            <span class="toolbar-spacer" />
          </div>
          <p class="hint">{{ hint }}</p>
          <textarea v-model="draft" class="editor-input" :placeholder="hint" />
          <div class="save-status">
            <span v-if="saving" class="saving">保存中…</span>
            <span v-else-if="saveError" class="save-error">{{ saveError }}</span>
            <span v-else-if="savedAt" class="saved">已保存 {{ savedAt }}</span>
          </div>
        </section>

        <!-- 右栏 AI 面板（v0.3+ 统一：单 AiChatPanel，4 chip/step + 自由对话 + 写/替换编辑器）
             v0.4+ 放宽：v-if 改成「项目打开 + 步骤加载完成」，不再 strict 依赖 currentStep
             - 老 v-if="currentStep" 在 steps 空 / 加载失败时整个 AI 面板消失，玩家看不到
             - 新条件：项目打开 + steps 数组 load 完（含空数组也算 load 完），AI 面板始终显示
             - currentStep 为 null 时 title fallback 到 "概念"，onAdopt 内部再 guard -->
        <aside v-if="project.current && !concept.loading" class="ai-panel" :style="{ width: aiPanelWidth + 'px' }">
          <AiChatPanel
            :item-id="concept.currentStepId"
            :title="currentStep?.title ?? '概念'"
            :chat="concept.stepChat"
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
.concept-view {
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

/* === 左栏 stepper === */
.stepper {
  width: 180px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}
.step {
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
.step:hover {
  background: var(--hover);
  color: var(--text);
}
.step.active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent);
}
.step-index {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 50%;
  font-size: 10px;
}
.step.active .step-index {
  border-color: var(--accent);
}
.step-title {
  flex: 1;
}
.dot {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
}
.dot.empty {
  background: var(--text-muted);
  opacity: 0.4;
}
.dot.draft {
  background: var(--warning, #d9822b);
}
.dot.confirmed {
  background: var(--success, #3fb950);
}
.stepper-empty {
  padding: 12px 10px;
  color: var(--text-muted);
  font-size: 12px;
}
.stepper-error {
  padding: 12px 10px;
  color: var(--error, #e53e3e);
  font-size: 12px;
  line-height: 1.6;
  word-break: break-all;
}
.stepper-error button {
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
.stepper-error button:hover {
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
.confirm-btn {
  display: flex;
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
}
.confirm-btn:hover {
  background: var(--hover);
  color: var(--text);
}
.confirm-btn.confirmed {
  color: var(--success, #3fb950);
  border-color: var(--success, #3fb950);
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
