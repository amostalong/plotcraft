<script setup lang="ts">
// NewProjectModal —— PlotCraft 风格 custom modal（v0.1.5+）
//
// 替代 v0.1.4 之前 createNew 用的 `window.prompt`（OS system dialog）。
// - 输项目名（实时校验：空 / 含 / / \）
// - 显示父目录（不可改）
// - "Create" 按钮：校验通过才 enabled
// - Esc / 取消 关闭
// - 父组件传 name 给 create_project 后端命令

import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Plus, X, FolderOpen } from 'lucide-vue-next'

const props = defineProps<{
  /** 父目录（player 在 OS dialog 选的，不可改） */
  parentDir: string
  /** 正在创建中（按钮 disabled + spinner） */
  creating?: boolean
}>()

const emit = defineEmits<{
  close: []
  /** 玩家确认创建 */
  create: [name: string]
}>()

const name = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

const validationError = computed<string | null>(() => {
  const trimmed = name.value.trim()
  if (!trimmed) return '项目名不能为空'
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return '项目名不能包含 / 或 \\'
  }
  if (trimmed === '.' || trimmed === '..') return '项目名不能是 . 或 ..'
  return null
})

const canCreate = computed(() => !validationError.value && !props.creating)

function onCreate() {
  if (!canCreate.value) return
  emit('create', name.value.trim())
}

function onClose() {
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    onClose()
  } else if (e.key === 'Enter' && canCreate.value) {
    e.preventDefault()
    onCreate()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  // 自动 focus 输入框
  setTimeout(() => inputEl.value?.focus(), 50)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @mousedown.self="onClose">
      <div class="modal" role="dialog" aria-modal="true" aria-label="新建项目">
        <div class="modal-header">
          <Plus :size="16" />
          <h3>新建项目</h3>
          <button @click="onClose" class="modal-close" title="关闭 (Esc)">
            <X :size="16" />
          </button>
        </div>

        <div class="modal-body">
          <p class="modal-hint">
            在 <code class="path">{{ parentDir }}</code> 下新建一个项目文件夹，
            自动落 4 个 starter md（<code>README.md</code> + <code>world/</code> +
            <code>characters/</code> + <code>plot/</code>）。
          </p>

          <label class="field">
            <span class="field-label">项目名（英文 / 拼音，作为文件夹名）</span>
            <input
              ref="inputEl"
              v-model="name"
              type="text"
              class="field-input"
              :class="{ 'has-error': validationError }"
              placeholder="my-rpg-game"
              :disabled="creating"
              @keydown.enter.exact.prevent="onCreate"
            />
            <span v-if="validationError" class="field-error">{{ validationError }}</span>
            <span v-else class="field-hint">
              会在 <code>{{ parentDir }}\{{ name || '...' }}</code> 落 4 个 starter
            </span>
          </label>
        </div>

        <div class="modal-actions">
          <button @click="onClose" type="button" :disabled="creating">取消</button>
          <button
            @click="onCreate"
            type="button"
            class="primary"
            :disabled="!canCreate"
          >
            <FolderOpen v-if="!creating" :size="14" />
            <span>{{ creating ? '创建中...' : 'Create' }}</span>
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
  width: min(520px, calc(100vw - 32px));
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
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal-hint {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}
.modal-hint code {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
  color: var(--text);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field-label {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
}
.field-input {
  padding: 8px 10px;
  font-size: 13px;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  outline: none;
  transition: border-color 0.1s ease;
}
.field-input:focus {
  border-color: var(--accent);
}
.field-input.has-error {
  border-color: var(--error, #e53e3e);
}
.field-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.field-hint {
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.8;
}
.field-hint code {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 10px;
}
.field-error {
  font-size: 11px;
  color: var(--error, #e53e3e);
  font-weight: 500;
}

.modal-actions {
  display: flex;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  justify-content: flex-end;
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

@keyframes fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes rise {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
