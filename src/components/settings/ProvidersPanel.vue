<script setup lang="ts">
// Providers panel（v0.1 Locus-shape subset + custom providers 库）
//
// 布局：
// - Section 1: 当前激活的连接（model / baseUrl / apiKey 顶层字段）—— LLM 真用的
// - Section 2: 已保存的第三方 provider 库（customProviders[]）—— 玩家可 Add / Use / Delete
//
// 跟 Locus 差别：
// - Locus `CustomProvider` 有完整字段 `id/name/endpoint/apiFormat/apiKey/catalogId/models[]`，
//   且 apiKey 走 OS keychain
// - PlotCraft v0.1 简化：不分 apiFormat、不接 keychain、不按 provider 分 model
//   （model 走全局 BUILTIN_MODELS datalist，跨 provider 共用）
// - "Use" provider 时把它的 baseUrl + apiKey 复制到顶层 `base_url` / `apiKey` 字段

import { ref, computed } from 'vue'
import { Plus, Trash2, Check, AlertTriangle, Power, PowerOff, Pencil, X, Save } from 'lucide-vue-next'
import type { CustomProvider } from '@/lib/settings'

const props = defineProps<{
  baseUrl: string | null
  apiKey: string
  customProviders: CustomProvider[]
}>()

// === Active connection (v-model) ===
const baseUrl = defineModel<string | null>('base-url', { required: true })
const apiKey = defineModel<string>('api-key', { required: true })

// === Saved library (v-model) ===
const customProviders = defineModel<CustomProvider[]>('custom-providers', { required: true })

// === Add / Edit modal state ===
const editingId = ref<string | null>(null)        // null = add new, else edit existing id
const showForm = computed(() => editingId.value !== null || addingNew.value)
const addingNew = ref(false)

const draftId = ref('')
const draftName = ref('')
const draftBaseUrl = ref('')
const draftApiKey = ref('')
const draftEnabled = ref(true)
const formError = ref<string | null>(null)

function startAdd() {
  addingNew.value = true
  editingId.value = null
  draftId.value = ''
  draftName.value = ''
  draftBaseUrl.value = 'https://'
  draftApiKey.value = ''
  draftEnabled.value = true
  formError.value = null
}

function startEdit(p: CustomProvider) {
  addingNew.value = false
  editingId.value = p.id
  draftId.value = p.id
  draftName.value = p.name
  draftBaseUrl.value = p.baseUrl
  draftApiKey.value = p.apiKey
  draftEnabled.value = p.enabled
  formError.value = null
}

function cancelForm() {
  addingNew.value = false
  editingId.value = null
  formError.value = null
}

function saveForm() {
  // 校验
  if (!draftId.value.trim()) {
    formError.value = 'id 不能为空'
    return
  }
  if (!draftName.value.trim()) {
    formError.value = 'name 不能为空'
    return
  }
  if (!draftBaseUrl.value.trim() || !draftBaseUrl.value.startsWith('http')) {
    formError.value = 'baseUrl 必须以 http/https 开头'
    return
  }
  // id 唯一性
  if (editingId.value === null) {
    // add: id 不能跟现有重复
    if (customProviders.value.some((p) => p.id === draftId.value)) {
      formError.value = `id "${draftId.value}" 已存在`
      return
    }
  } else {
    // edit: id 改的话也不能跟其他重复
    if (
      draftId.value !== editingId.value &&
      customProviders.value.some((p) => p.id === draftId.value)
    ) {
      formError.value = `id "${draftId.value}" 已存在`
      return
    }
  }

  const newProvider: CustomProvider = {
    id: draftId.value.trim(),
    name: draftName.value.trim(),
    baseUrl: draftBaseUrl.value.trim(),
    apiKey: draftApiKey.value.trim(),
    enabled: draftEnabled.value,
  }

  if (editingId.value === null) {
    // add
    customProviders.value = [...customProviders.value, newProvider]
  } else {
    // edit
    customProviders.value = customProviders.value.map((p) =>
      p.id === editingId.value ? newProvider : p,
    )
  }

  cancelForm()
}

function removeProvider(id: string) {
  if (!window.confirm(`删除 provider "${id}"？此操作不可撤销。`)) return
  customProviders.value = customProviders.value.filter((p) => p.id !== id)
}

function useProvider(p: CustomProvider) {
  // 把这个 provider 的 baseUrl + apiKey 复制到顶层
  baseUrl.value = p.baseUrl
  apiKey.value = p.apiKey
  // model 不动（玩家自己选）
}

function toggleEnabled(p: CustomProvider) {
  customProviders.value = customProviders.value.map((x) =>
    x.id === p.id ? { ...x, enabled: !x.enabled } : x,
  )
}
</script>

<template>
  <div class="providers-panel">
    <h2>Providers</h2>
    <p class="hint">
      上面是当前激活的 LLM 连接（顶层的 <code>base_url</code> / <code>apiKey</code>），
      下面是已保存的第三方 provider 库（顶层 <code>customProviders[]</code>，跟 Locus
      <code>CustomProvider</code> schema 同构，PlotCraft 简化 apiKey 裸存 + 不分 apiFormat）。
      点 <strong>Use</strong> 把 provider 的 endpoint/key 填到当前激活字段。
    </p>

    <!-- Section 1: Active connection -->
    <section class="section">
      <div class="section-header">
        <span class="section-title">Active Connection</span>
        <span class="section-tag">config.json 顶层</span>
      </div>

      <label>
        <span class="label-text">Endpoint (base_url)</span>
        <input
          v-model="baseUrl"
          type="text"
          placeholder="https://api.openai.com/v1"
        />
        <span class="field-hint">OpenAI 兼容端点 —— 当前 LLM 调用的目标</span>
      </label>

      <label>
        <span class="label-text">API Key</span>
        <input
          v-model="apiKey"
          type="password"
          placeholder="sk-..."
          autocomplete="off"
        />
        <span class="field-hint">
          <AlertTriangle :size="12" />
          v0.1 裸存在本地 <code>config.json</code>（自用风险可接受；v0.2 升 OS keyring）
        </span>
      </label>
    </section>

    <!-- Section 2: Saved library -->
    <section class="section">
      <div class="section-header">
        <span class="section-title">Saved Providers</span>
        <span class="section-tag">{{ customProviders.length }} 个</span>
        <button
          v-if="!showForm"
          @click="startAdd"
          class="add-btn"
        >
          <Plus :size="12" />
          <span>Add provider</span>
        </button>
      </div>

      <!-- Add / Edit form (inline) -->
      <div v-if="showForm" class="form">
        <div class="form-title">
          {{ editingId === null ? 'Add new provider' : `Edit "${editingId}"` }}
        </div>
        <div class="form-grid">
          <label>
            <span class="label-text">id（唯一 key，小写英文）</span>
            <input v-model="draftId" type="text" placeholder="deepseek" />
          </label>
          <label>
            <span class="label-text">name（显示名）</span>
            <input v-model="draftName" type="text" placeholder="DeepSeek" />
          </label>
          <label class="form-grid-full">
            <span class="label-text">baseUrl（OpenAI 兼容端点）</span>
            <input
              v-model="draftBaseUrl"
              type="text"
              placeholder="https://api.deepseek.com/v1"
            />
          </label>
          <label class="form-grid-full">
            <span class="label-text">apiKey（v0.1 裸存）</span>
            <input
              v-model="draftApiKey"
              type="password"
              placeholder="sk-..."
              autocomplete="off"
            />
          </label>
          <label class="form-grid-full enabled-row">
            <input v-model="draftEnabled" type="checkbox" />
            <span>启用</span>
          </label>
        </div>
        <div v-if="formError" class="form-error">{{ formError }}</div>
        <div class="form-actions">
          <button @click="saveForm" class="primary">
            <Save :size="12" />
            <span>保存</span>
          </button>
          <button @click="cancelForm">
            <X :size="12" />
            <span>取消</span>
          </button>
        </div>
      </div>

      <!-- Provider cards -->
      <div v-if="customProviders.length === 0 && !showForm" class="empty">
        还没有保存的 provider —— 点右上角"Add provider"加一个
        （DeepSeek / Qwen / OpenRouter / Ollama 等 OpenAI 兼容端点都行）
      </div>
      <div v-else-if="customProviders.length > 0" class="provider-list">
        <div
          v-for="p in customProviders"
          :key="p.id"
          class="provider-card"
          :class="{ disabled: !p.enabled }"
        >
          <div class="card-header">
            <div class="card-title">
              <span class="provider-id">{{ p.id }}</span>
              <span class="provider-name">{{ p.name }}</span>
              <span v-if="!p.enabled" class="disabled-tag">disabled</span>
            </div>
            <div class="card-actions">
              <button @click="useProvider(p)" class="use-btn" :disabled="!p.enabled">
                <Check :size="12" />
                <span>Use</span>
              </button>
              <button @click="toggleEnabled(p)" class="icon-btn" :title="p.enabled ? '禁用' : '启用'">
                <Power v-if="p.enabled" :size="12" />
                <PowerOff v-else :size="12" />
              </button>
              <button @click="startEdit(p)" class="icon-btn" title="编辑">
                <Pencil :size="12" />
              </button>
              <button @click="removeProvider(p.id)" class="icon-btn danger" title="删除">
                <Trash2 :size="12" />
              </button>
            </div>
          </div>
          <div class="card-body">
            <div class="card-row">
              <span class="card-label">baseUrl:</span>
              <code>{{ p.baseUrl }}</code>
            </div>
            <div class="card-row">
              <span class="card-label">apiKey:</span>
              <code>{{ p.apiKey ? '••••••' + p.apiKey.slice(-4) : '(空)' }}</code>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.providers-panel {
  padding: 8px 0;
}
h2 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text);
}
.hint {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin-bottom: 16px;
}
.hint code,
.field-hint code {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 4px;
}
.section {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px 16px;
  background: var(--bg);
  margin-bottom: 12px;
}
.section:last-child {
  margin-bottom: 0;
}
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.section-title {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
}
.section-tag {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 6px;
  margin-left: 4px;
}
.add-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 4px 10px;
  background: var(--accent);
  color: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
}
.add-btn:hover {
  opacity: 0.85;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
label:last-child {
  margin-bottom: 0;
}
.label-text {
  font-size: 12px;
  color: var(--text-muted);
}
label input {
  padding: 8px 10px;
  font-size: 13px;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
}
label input:focus {
  outline: none;
  border-color: var(--accent);
}
.field-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 4px;
  line-height: 1.4;
}

/* Form (Add / Edit) */
.form {
  background: var(--bg-elev);
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.form-title {
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
  margin-bottom: 10px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.form-grid-full {
  grid-column: 1 / -1;
}
.form-grid label {
  margin-bottom: 0;
}
.form-grid .enabled-row {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}
.form-grid .enabled-row input {
  margin: 0;
}
.form-error {
  font-size: 12px;
  color: var(--error);
  margin-top: 8px;
}
.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.form-actions button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}
.form-actions button:hover {
  background: var(--hover);
  color: var(--text);
}
.form-actions button.primary {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.form-actions button.primary:hover {
  opacity: 0.85;
}

/* Provider list */
.empty {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
  padding: 16px;
  text-align: center;
  background: var(--bg-elev);
  border: 1px dashed var(--border);
  border-radius: 6px;
  margin: 0;
}
.provider-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.provider-card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
}
.provider-card.disabled {
  opacity: 0.55;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.provider-id {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
}
.provider-name {
  font-size: 12px;
  color: var(--text);
}
.disabled-tag {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 6px;
  font-style: italic;
}
.card-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}
.use-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  background: var(--accent);
  color: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
  margin-right: 4px;
}
.use-btn:hover:not(:disabled) {
  opacity: 0.85;
}
.use-btn:disabled {
  background: var(--border);
  color: var(--text-muted);
  border-color: var(--border);
  cursor: not-allowed;
}
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}
.icon-btn:hover {
  background: var(--hover);
  color: var(--text);
  border-color: var(--border);
}
.icon-btn.danger:hover {
  background: rgba(232, 90, 90, 0.12);
  color: var(--error);
  border-color: var(--error);
}
.card-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.card-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}
.card-label {
  color: var(--text-muted);
  width: 60px;
  flex-shrink: 0;
}
.card-row code {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 11px;
  word-break: break-all;
}
</style>
