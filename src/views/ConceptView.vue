<script setup lang="ts">
// ConceptView —— 概念 tab（7 层严格派生模型 + 设计循环 + 编辑区 + AI 面板）
//
// v0.5+：6 步漏斗 → 7 层派生模型（seed / pillars / world-rules / locations / character-functions / three-act / core-fantasy）
//   - L1 立意 / L2 抽象规则 / L3 世界 / L4 地点（可选） / L5 人物 / L6 故事 / L7 核心体验
//   - 旧项目兼容：旧 core-fantasy 自动归 L7
//   - maturity（L2 pillars 专用）：empty / draft / evolving / finalized 4 态
//
// v0.5+ 设计循环：改任何 step → markStale 上下游 → 黄点 ? 提示
//   - 改 L1 → L2-L7 全标 stale（最重）
//   - 改 L2-L6 → 自己 + 上游 + L7 stale
//   - 改 L7 → L1-L6 全标 stale（5min cooldown 避免 toast 刷屏）
//   - 点黄点 → 切到该步 + 跑校准 chip
//
// - 左栏 stepper：7 步 + 状态点（empty 灰 / confirmed 绿 / stale 黄 + ? 角标）
//   - 步序号 = [L1] / [L2] / ...（派生链位置）
//   - L4 标"（可选）"—— 玩家知道不写也 OK
// - 中栏编辑区：标题 + L2 maturity 选择器 + hint + textarea
//   （800ms debounce 自动落盘，对齐 ConceptArtView 惯例）
// - 右栏 AI 面板：单个 AiChatPanel（每步 5 chip：4 基础 + 1 校准）
//   - 校准 chip：L1 立意校准 / L2 反向检验 / L3-L6 上游校准 / L7 全链路整合
// - 无项目 → 空态（对齐 ConceptArtView）
// - 玩家手改 concept/ 文件后点「刷新」重扫（不做文件监听，对齐 art）

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { FolderOpen, Lightbulb, RefreshCw, X } from 'lucide-vue-next'

import AiChatPanel from '@/components/ai/AiChatPanel.vue'
import { STEP_HINTS, STEP_PRESETS, useConceptStore } from '@/stores/concept'
import { useProjectStore } from '@/stores/project'
import { useResizableWidth } from '@/composables/useResizableWidth'
import type { ConceptStepId, ConceptStepStatus, StepMaturity } from '@/types/concept'
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

// === v0.5+ 设计循环：stale 黄点 + 校准 chip ===

/** 某 step 是否 stale（需要重看） */
function isStale(stepId: string): boolean {
  return concept.staleFlags?.get(stepId as ConceptStepId) ?? false
}

/** 点黄点 → 切到该步 + 跑该步的校准 chip（最后 1 个 action: 'calibrate'） */
function onStaleClick(stepId: string) {
  if (stepId !== concept.currentStepId) {
    flushSave()
    concept.currentStepId = stepId
  }
  // 找该 step 的校准 chip
  const ps = STEP_PRESETS[stepId as ConceptStepId] ?? []
  const cal = ps.find((p) => p.action === 'calibrate')
  if (cal) {
    // 用校准 chip 作为 user message 触发 LLM 校准
    void concept.stepChat.send(cal.prompt, cal)
    // 校准跑起来后清黄点（玩家主动触发了校准）
    concept.clearStale(stepId as ConceptStepId)
  }
}

/** 手动 X 关闭黄点（不跑校准） */
function onStaleDismiss(stepId: string) {
  concept.clearStale(stepId as ConceptStepId)
}

/** L2 pillars maturity 切换（v0.5+ 4 态） */
const MATURITY_LABELS: Record<StepMaturity, string> = {
  empty: '空',
  draft: '草稿 v1',
  evolving: '演进 v2+',
  finalized: '定型',
}
const MATURITIES: StepMaturity[] = ['empty', 'draft', 'evolving', 'finalized']

async function onMaturityChange(m: StepMaturity) {
  const step = currentStep.value
  if (!step || step.id !== 'pillars') return
  // 立即更新本地 + 落盘（maturity 是 frontmatter 字段，独立于 content）
  try {
    await concept.save(step.id, step.content, true, m)
  } catch (e) {
    console.error('[concept.maturity] save failed:', e)
  }
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
        <!-- 左栏 stepper（v0.5+ 7 层 + 状态点 + 黄点） -->
        <nav class="stepper">
          <button
            v-for="step in concept.steps"
            :key="step.id"
            type="button"
            class="step"
            :class="{ active: step.id === concept.currentStepId, stale: isStale(step.id) }"
            @click="onSelectStep(step.id)"
          >
            <span class="step-level">[L{{ step.level }}]</span>
            <span class="step-title">
              {{ step.title }}
              <span v-if="step.optional" class="optional-tag">（可选）</span>
            </span>
            <span class="dot" :class="step.status" :title="STATUS_LABELS[step.status]" />
            <!-- v0.5+ 设计循环：黄点 ? 角标 + X 关闭按钮 -->
            <span
              v-if="isStale(step.id)"
              class="stale-badge"
              :title="step.id === concept.currentStepId ? '本步需要重看（点 X 忽略）' : '点 ? 切到此步并跑校准 / 点 X 忽略'"
              @click.stop="onStaleClick(step.id)"
            >
              <span class="stale-q">?</span>
            </span>
            <button
              v-if="isStale(step.id)"
              type="button"
              class="stale-dismiss"
              title="忽略本黄点（mtime 记录保留，下次再有改动会再出现）"
              @click.stop="onStaleDismiss(step.id)"
            >
              <X :size="10" />
            </button>
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
            <h3>[L{{ currentStep.level }}] {{ currentStep.title }}</h3>
            <code class="filename">concept/{{ currentStep.filename }}</code>
            <span class="toolbar-spacer" />
            <!-- v0.5+ L2 pillars maturity 选择器（仅 pillars 步骤显示） -->
            <div v-if="currentStep.id === 'pillars'" class="maturity-selector">
              <span class="maturity-label">成熟度：</span>
              <button
                v-for="m in MATURITIES"
                :key="m"
                type="button"
                class="maturity-chip"
                :class="{ active: (currentStep.maturity || 'empty') === m }"
                :title="`切换到 ${MATURITY_LABELS[m]}`"
                @click="onMaturityChange(m)"
              >
                {{ MATURITY_LABELS[m] }}
              </button>
            </div>
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
            :chat="(concept.stepChat as any)"
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
/* v0.5+ stale step 边框变黄 + 微弱背景（不抢主色） */
.step.stale {
  border-color: var(--warning, #d9822b);
  background: rgba(217, 130, 43, 0.06);
}
.step.stale.active {
  /* active + stale 共存时：active 仍主色，stale 边框保留 */
  border-color: var(--warning, #d9822b);
}
.step-level {
  font-size: 10px;
  color: var(--text-muted);
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  flex-shrink: 0;
  min-width: 32px;
}
.step.active .step-level {
  color: var(--accent);
}
.optional-tag {
  font-size: 10px;
  color: var(--text-muted);
  margin-left: 2px;
}
/* v0.5+ 黄点 ? 角标 */
.stale-badge {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--warning, #d9822b);
  color: #fff;
  border-radius: 50%;
  font-size: 10px;
  font-weight: bold;
  cursor: pointer;
  user-select: none;
}
.stale-badge:hover {
  background: #b56a1a;
}
.stale-q {
  line-height: 1;
}
.stale-dismiss {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 50%;
  cursor: pointer;
  padding: 0;
}
.stale-dismiss:hover {
  color: var(--text);
  border-color: var(--text-muted);
  background: var(--hover);
}
/* v0.5+ L2 pillars maturity 选择器 */
.maturity-selector {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}
.maturity-label {
  color: var(--text-muted);
}
.maturity-chip {
  padding: 2px 8px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 4px;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
}
.maturity-chip:hover {
  border-color: var(--text-muted);
  color: var(--text);
}
.maturity-chip.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
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
