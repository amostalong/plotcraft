<script setup lang="ts">
// OpenProjectModal —— PlotCraft 风格 custom modal（v0.1.5+）
//
// 替代 v0.1.4 之前 openExisting 用的 `window.prompt`（OS system dialog）。
// - 列 rootDir 下所有子文件夹（不 filter —— v0.1.5+ 取消 README.md 判定）
// - PlotCraft 项目（含 world/）标 "PlotCraft 项目" 标签 + 排前面
// - 单选 + 底部 "打开" 按钮
// - Esc / 取消 关闭
// - 空状态："该目录没有子文件夹"

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Folder, FolderOpen, X, Search } from 'lucide-vue-next'

import type { ProjectMeta } from '@/lib/project'

const props = defineProps<{
  /** 选中的根目录（player 在 OS dialog 选的） */
  rootDir: string
  /** 子文件夹列表（list_projects 返回，已排好序：PlotCraft 排前） */
  entries: ProjectMeta[]
}>()

const emit = defineEmits<{
  close: []
  /** 玩家选了一个 project */
  pick: [project: ProjectMeta]
}>()

const selectedIndex = ref<number>(-1)
const searchQuery = ref('')
const listEl = ref<HTMLElement | null>(null)

const filtered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return props.entries
  return props.entries.filter((p) => p.name.toLowerCase().includes(q))
})

const canOpen = computed(() => selectedIndex.value >= 0 && filtered.value[selectedIndex.value] != null)

watch(
  () => props.entries,
  () => {
    // 新 entries → 重置选择
    selectedIndex.value = -1
    searchQuery.value = ''
  },
)

function pick(index: number) {
  selectedIndex.value = index
}

function onOpen() {
  if (!canOpen.value) return
  const picked = filtered.value[selectedIndex.value]
  emit('pick', picked)
}

function onClose() {
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    onClose()
  } else if (e.key === 'Enter' && canOpen.value) {
    e.preventDefault()
    onOpen()
  } else if (e.key === 'ArrowDown' && filtered.value.length > 0) {
    e.preventDefault()
    selectedIndex.value = Math.min(filtered.value.length - 1, selectedIndex.value + 1)
  } else if (e.key === 'ArrowUp' && filtered.value.length > 0) {
    e.preventDefault()
    selectedIndex.value = Math.max(0, selectedIndex.value - 1)
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @mousedown.self="onClose">
      <div class="modal" role="dialog" aria-modal="true" aria-label="打开项目">
        <div class="modal-header">
          <FolderOpen :size="16" />
          <h3>打开项目</h3>
          <button @click="onClose" class="modal-close" title="关闭 (Esc)">
            <X :size="16" />
          </button>
        </div>

        <div class="modal-body">
          <p class="modal-hint">
            扫描 <code class="path">{{ rootDir }}</code> 的子文件夹。带
            <span class="plotcraft-tag-inline">PlotCraft 项目</span>
            标签的是含 <code>world/</code> 子目录的（v0.1.5+ 起的判定），其他是普通文件夹。
          </p>

          <!-- Search -->
          <div v-if="entries.length > 0" class="search-wrap">
            <Search :size="12" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索名字…"
              class="search-input"
            />
          </div>

          <!-- Empty state -->
          <div v-if="entries.length === 0" class="empty">
            <p>该目录没有子文件夹</p>
            <p class="empty-hint">换个目录？或者关掉 modal 去新建一个</p>
          </div>

          <!-- No match for search -->
          <div v-else-if="filtered.length === 0" class="empty">
            <p>没匹配 "{{ searchQuery }}" 的子文件夹</p>
          </div>

          <!-- List -->
          <div v-else ref="listEl" class="list">
            <button
              v-for="(p, i) in filtered"
              :key="p.folder"
              type="button"
              class="item"
              :class="{ selected: i === selectedIndex, 'is-plotcraft': p.is_plotcraft_project }"
              @click="pick(i)"
            >
              <span class="item-icon">
                <Folder v-if="!p.is_plotcraft_project" :size="14" />
                <FolderOpen v-else :size="14" />
              </span>
              <span class="item-info">
                <span class="item-name">
                  {{ p.name }}
                  <span v-if="p.is_plotcraft_project" class="plotcraft-tag">PlotCraft 项目</span>
                </span>
                <code class="item-path">{{ p.folder }}</code>
              </span>
            </button>
          </div>
        </div>

        <div class="modal-actions">
          <button @click="onClose" type="button">取消</button>
          <button
            @click="onOpen"
            type="button"
            class="primary"
            :disabled="!canOpen"
          >
            <span>打开</span>
            <span v-if="canOpen" class="selected-name">{{ filtered[selectedIndex]?.name }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fade 0.12s ease-out;
}
.modal {
  width: min(640px, calc(100vw - 32px));
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  animation: rise 0.15s ease-out;
  overflow: hidden;
}
.modal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  color: var(--accent);
}
.modal-header h3 {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}
.modal-close:hover {
  background: var(--hover);
  color: var(--text);
}
.modal-body {
  flex: 1;
  min-height: 0;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}
.modal-hint {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}
.modal-hint code.path,
.modal-hint code {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
  color: var(--text);
}
.plotcraft-tag-inline {
  display: inline-block;
  font-size: 10px;
  color: var(--bg);
  background: var(--accent);
  border-radius: 3px;
  padding: 1px 5px;
  font-weight: 500;
  letter-spacing: 0.3px;
  vertical-align: middle;
}

.search-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 5px;
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
  padding: 4px 0;
  min-width: 0;
}
.search-input::placeholder {
  color: var(--text-muted);
  opacity: 0.7;
}

.empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}
.empty p {
  margin: 0;
}
.empty-hint {
  margin-top: 6px !important;
  font-size: 11px;
  opacity: 0.7;
}

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: transparent;
  color: inherit;
  border: 1px solid transparent;
  border-radius: 4px;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.08s ease;
  min-width: 0;
}
.item:hover {
  background: var(--hover);
}
.item.selected {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.item.is-plotcraft .item-icon {
  color: var(--accent);
}
.item-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}
.item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.item-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.plotcraft-tag {
  display: inline-block;
  font-size: 9px;
  color: var(--bg);
  background: var(--accent);
  border-radius: 3px;
  padding: 1px 5px;
  font-weight: 500;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}
.item-path {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 10px;
  color: var(--text-muted);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
  word-break: break-all;
  width: fit-content;
  max-width: 100%;
}

.modal-actions {
  display: flex;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  justify-content: flex-end;
  align-items: center;
}
.modal-actions button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}
.modal-actions button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.modal-actions button.primary {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.modal-actions button.primary:hover:not(:disabled) {
  opacity: 0.85;
}
.modal-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.modal-actions .selected-name {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 11px;
  opacity: 0.85;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes rise {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
