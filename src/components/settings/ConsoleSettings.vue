<script setup lang="ts">
// PlotCraft v0.1 控制台 UI —— 仿 Locus `ConsoleSettings.vue` 简化版
//
// 跟 Locus 差别（AGENTS.md 硬规则 #1：结构对齐，代码自写）：
// - Locus 上：column resize / message preview limit + expand / export log file /
//   reveal log file / 6 种 level (trace/debug/info/warn/error) / 3 种 source
// - PlotCraft v0.1 简化：
//   - 不上 column resize（固定列宽）
//   - 不上 message preview / expand（v0.1 不优化长 log）
//   - 不上 export log file（v0.1 玩家看就够了）
//   - 不上 reveal log file（Rust 端不写盘 log）
//   - level 3 种（info / warn / error），source 2 种（backend / frontend）
//   - entry 单击复制整行
//
// 数据流：
// - useConsoleEntries() 拿 reactive entries
// - 过滤：level + source + search
// - 操作：refresh（重新拉 snapshot） / clear（清空）
// - 单击 entry → 复制整行到剪贴板（v0.1 不上 multi-select copy）

import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RefreshCw, Trash2, Copy, Search } from 'lucide-vue-next'

import {
  useConsoleEntries,
  refreshConsole,
  clearConsole,
  initConsole,
  type ConsoleEntry,
  type ConsoleLevel,
  type ConsoleSource,
} from '@/lib/console'

/** v0.2+ 可选 prop —— chat 错误"查看详情"跳转时传入，filter 到该 run_id 相关 entries
 *  - null/undefined → 不过滤
 *  - watch 变化时自动设 searchQuery（玩家可手动改覆盖）
 *  - 跟 module / message 字段做 substring 匹配
 */
const props = defineProps<{
  runIdFilter?: string | null
}>()

const entries = useConsoleEntries()

// === Filters ===
const levelFilter = ref<'all' | ConsoleLevel>('all')
const sourceFilter = ref<'all' | ConsoleSource>('all')
const searchQuery = ref('')
const autoScroll = ref(true)

// v0.2+ runIdFilter → 自动设 searchQuery（玩家可手动改）
watch(
  () => props.runIdFilter,
  (v) => {
    if (v) {
      searchQuery.value = v
    }
  },
)

const listEl = ref<HTMLElement | null>(null)
const copiedId = ref<string | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const filtered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return entries.value.filter((e) => {
    if (levelFilter.value !== 'all' && e.level !== levelFilter.value) return false
    if (sourceFilter.value !== 'all' && e.source !== sourceFilter.value) return false
    if (q) {
      const hay = `${e.module} ${e.message} ${e.level} ${e.source}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
})

const countLabel = computed(() => `${filtered.value.length} 条`)

function formatTime(ts: number): string {
  const d = new Date(ts)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}`
}

function sourceLabel(s: ConsoleSource): string {
  return s === 'backend' ? 'backend' : 'frontend'
}

async function onRefresh() {
  await refreshConsole()
}

async function onClear() {
  await clearConsole()
}

async function copyEntry(entry: ConsoleEntry) {
  const text = `[${formatTime(entry.timestamp_ms)}] [${sourceLabel(entry.source)}] [${entry.module}] [${entry.level.toUpperCase()}] ${entry.message}`
  try {
    await navigator.clipboard.writeText(text)
    copiedId.value = entry.id
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copiedId.value = null
      copiedTimer = null
    }, 1200)
  } catch (e) {
    console.error('[console] clipboard write failed:', e)
  }
}

// Auto-scroll: 新 entry 进来时滚到顶（最新在 [0]）
watch(
  () => [filtered.value[0]?.id ?? '', filtered.value.length] as const,
  async () => {
    if (!autoScroll.value) return
    await nextTick()
    if (listEl.value) {
      listEl.value.scrollTop = 0
    }
  },
)

onMounted(async () => {
  // 防止 user 直接进 console tab 时 main.ts init 还没完成
  await initConsole()
})

onUnmounted(() => {
  if (copiedTimer) {
    clearTimeout(copiedTimer)
    copiedTimer = null
  }
})
</script>

<template>
  <div class="console-panel">
    <div class="section-label">控制台</div>
    <p class="section-desc">
      app 运行时日志（info / warn / error + backend / frontend）。Rust 端关键错误 +
      前端 <code>console.log</code> 自动收录，最多 1000 条，重启清空。
    </p>

    <!-- Toolbar -->
    <div class="console-toolbar">
      <div class="filter-group" role="tablist" aria-label="level filter">
        <button
          v-for="lv in (['all', 'info', 'warn', 'error'] as const)"
          :key="lv"
          type="button"
          class="filter-chip"
          :class="{ active: levelFilter === lv }"
          @click="levelFilter = lv"
        >
          {{ lv }}
        </button>
      </div>

      <div class="filter-group" role="tablist" aria-label="source filter">
        <button
          v-for="src in (['all', 'backend', 'frontend'] as const)"
          :key="src"
          type="button"
          class="filter-chip"
          :class="{ active: sourceFilter === src }"
          @click="sourceFilter = src"
        >
          {{ src }}
        </button>
      </div>

      <label class="autoscroll-toggle">
        <input v-model="autoScroll" type="checkbox" />
        <span>auto-scroll</span>
      </label>

      <div class="search-wrap">
        <Search :size="12" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索 module / message…"
          class="search-input"
        />
      </div>

      <button type="button" class="action-btn" @click="onRefresh" title="重新拉 snapshot">
        <RefreshCw :size="12" />
        <span>Refresh</span>
      </button>
      <button
        type="button"
        class="action-btn"
        :disabled="entries.length === 0"
        @click="onClear"
        title="清空所有 entries"
      >
        <Trash2 :size="12" />
        <span>Clear</span>
      </button>
    </div>

    <!-- Meta line -->
    <div class="console-meta">
      <span>{{ countLabel }}</span>
      <span class="hint">点 entry 复制整行到剪贴板</span>
    </div>

    <!-- Entry list -->
    <div ref="listEl" class="console-list">
      <div v-if="filtered.length === 0" class="console-empty">
        <template v-if="entries.length === 0">
          还没有 log —— Rust 端关键错误会推过来，前端 console.log 也自动入
        </template>
        <template v-else>当前 filter 下没匹配的 entry</template>
      </div>
      <button
        v-for="entry in filtered"
        :key="entry.id"
        type="button"
        class="console-row"
        :class="[`level-${entry.level}`, `source-${entry.source}`, { copied: copiedId === entry.id }]"
        @click="copyEntry(entry)"
        :title="`点击复制整行`"
      >
        <span class="console-time">{{ formatTime(entry.timestamp_ms) }}</span>
        <span class="console-source">{{ sourceLabel(entry.source) }}</span>
        <span class="console-module">{{ entry.module }}</span>
        <span class="console-level">{{ entry.level.toUpperCase() }}</span>
        <span class="console-message">{{ entry.message }}</span>
        <span v-if="copiedId === entry.id" class="console-copied">
          <Copy :size="11" />
          <span>copied</span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.console-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}

.section-label {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}

.section-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0 0 8px 0;
}
.section-desc code {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 11px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
}

/* Toolbar */
.console-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 10px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.filter-group {
  display: inline-flex;
  align-items: center;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 1px;
  gap: 1px;
}

.filter-chip {
  padding: 3px 9px;
  font-size: 11px;
  font-family: inherit;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  text-transform: lowercase;
  transition: background 0.1s ease, color 0.1s ease;
}
.filter-chip:hover {
  color: var(--text);
  background: var(--hover);
}
.filter-chip.active {
  background: var(--accent);
  color: var(--bg);
  font-weight: 500;
}

.autoscroll-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}
.autoscroll-toggle input {
  margin: 0;
  cursor: pointer;
}

.search-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  flex: 1 1 200px;
  min-width: 160px;
  color: var(--text-muted);
}
.search-wrap:focus-within {
  border-color: var(--accent);
}
.search-input {
  flex: 1;
  background: transparent;
  color: var(--text);
  border: none;
  outline: none;
  font-size: 12px;
  font-family: inherit;
  min-width: 0;
}
.search-input::placeholder {
  color: var(--text-muted);
  opacity: 0.7;
}

.action-btn {
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
}
.action-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
  border-color: var(--accent);
}
.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Meta line */
.console-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
  padding: 0 2px;
}
.console-meta .hint {
  opacity: 0.7;
}

/* List */
.console-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
}

.console-empty {
  padding: 32px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
  opacity: 0.7;
}

.console-row {
  display: grid;
  grid-template-columns: 64px 70px 110px 50px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--text);
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 11px;
  text-align: left;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.08s ease;
  min-width: 0;
}
.console-row:hover {
  background: var(--hover);
}
.console-row.copied {
  background: var(--accent-soft);
}

.console-time {
  color: var(--text-muted);
  opacity: 0.85;
  font-variant-numeric: tabular-nums;
}
.console-source {
  color: var(--text-muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.console-module {
  color: var(--text-muted);
  font-size: 10px;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.console-level {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.3px;
  text-align: center;
  padding: 1px 0;
  border-radius: 2px;
}
.console-message {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
  word-break: break-all;
  font-size: 11px;
}
.console-copied {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--accent);
  font-size: 10px;
  font-weight: 600;
}

/* level 颜色（仿 Locus 风格） */
.console-row.level-info .console-level {
  color: var(--text-muted);
  background: var(--bg-elev);
}
.console-row.level-warn .console-level {
  color: #d69e2e;
  background: rgba(214, 158, 46, 0.12);
}
.console-row.level-warn {
  border-left: 2px solid #d69e2e;
}
.console-row.level-error .console-level {
  color: var(--error, #e53e3e);
  background: rgba(232, 90, 90, 0.12);
}
.console-row.level-error {
  border-left: 2px solid var(--error, #e53e3e);
}

/* source 颜色微调（让 backend/frontend 视觉可分） */
.console-row.source-frontend .console-source {
  color: var(--accent);
  opacity: 0.85;
}
</style>
