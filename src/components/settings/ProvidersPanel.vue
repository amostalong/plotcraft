<script setup lang="ts">
// Providers panel（v0.1 Locus-shape subset + custom providers 库）
//
// 布局：
// - Section 1: 当前激活的连接（model / baseUrl / apiKey / apiFormat 顶层字段）
// - Section 2: 已保存的第三方 provider 库（customProviders[]）
//
// 跟 Locus 差别：
// - Locus `CustomProvider` 有完整字段 `id/name/endpoint/apiFormat/apiKey/catalogId/models[]`，
//   且 apiKey 走 OS keychain
// - PlotCraft v0.1 简化：不分 catalogId / models，apiKey 裸存
// - "Use" provider 时把 baseUrl + apiKey + apiFormat 复制到顶层
//
// 支持的 API 协议（参考 Locus `ApiFormat`）：
// - `openai_chat`（OpenAI Chat Completions + SSE）—— v0.1 已实装
// - `openai_responses`（OpenAI Responses API）—— v0.1 已实装
// - `anthropic_messages`（Anthropic Messages + SSE）—— v0.1 已实装
//
// v0.1+ "Import from Locus"：跨 app 读 Locus config.json + custom_providers.json，
// 玩家挑要导入哪些 provider（API key 不带 —— Locus 存 keychain）。

import { ref, computed } from 'vue'
import { Plus, Trash2, Check, AlertTriangle, Power, PowerOff, Pencil, X, Save, Download } from 'lucide-vue-next'
import type { CustomProvider, ApiFormat } from '@/lib/settings'
import { API_FORMAT_LABELS, DEFAULT_API_FORMAT } from '@/lib/settings'
import { importFromLocus, type LocusImportData } from '@/lib/locusImport'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{
  baseUrl: string | null
  apiKey: string
  customProviders: CustomProvider[]
}>()

// === Active connection (v-model) ===
const baseUrl = defineModel<string | null>('base-url', { required: true })
const apiKey = defineModel<string>('api-key', { required: true })
const apiFormat = defineModel<ApiFormat>('api-format', { required: true })

// === Saved library (v-model) ===
const customProviders = defineModel<CustomProvider[]>('custom-providers', { required: true })

// === Add / Edit form state ===
const editingId = ref<string | null>(null)
const showForm = computed(() => editingId.value !== null || addingNew.value)
const addingNew = ref(false)

const draftId = ref('')
const draftName = ref('')
const draftBaseUrl = ref('')
const draftApiKey = ref('')
const draftApiFormat = ref<ApiFormat>(DEFAULT_API_FORMAT)
const draftEnabled = ref(true)
const formError = ref<string | null>(null)

function startAdd() {
  addingNew.value = true
  editingId.value = null
  draftId.value = ''
  draftName.value = ''
  draftBaseUrl.value = 'https://'
  draftApiKey.value = ''
  draftApiFormat.value = DEFAULT_API_FORMAT
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
  draftApiFormat.value = p.apiFormat
  draftEnabled.value = p.enabled
  formError.value = null
}

function cancelForm() {
  addingNew.value = false
  editingId.value = null
  formError.value = null
}

function saveForm() {
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
  if (editingId.value === null) {
    if (customProviders.value.some((p) => p.id === draftId.value)) {
      formError.value = `id "${draftId.value}" 已存在`
      return
    }
  } else {
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
    apiFormat: draftApiFormat.value,
    enabled: draftEnabled.value,
  }

  if (editingId.value === null) {
    customProviders.value = [...customProviders.value, newProvider]
  } else {
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
  baseUrl.value = p.baseUrl
  apiKey.value = p.apiKey
  apiFormat.value = p.apiFormat
}

function toggleEnabled(p: CustomProvider) {
  customProviders.value = customProviders.value.map((x) =>
    x.id === p.id ? { ...x, enabled: !x.enabled } : x,
  )
}

function formatLabel(fmt: ApiFormat): string {
  return API_FORMAT_LABELS[fmt]
}

// === Import from Locus ===
const showImportModal = ref(false)
const locusData = ref<LocusImportData | null>(null)
const locusLoading = ref(false)
const locusError = ref<string | null>(null)
// 玩家挑要导入的 provider id
const importSelectedIds = ref<Set<string>>(new Set())
// 玩家是否要覆盖 active connection
const importApplyActive = ref(false)

async function openImportModal() {
  showImportModal.value = true
  locusLoading.value = true
  locusError.value = null
  locusData.value = null
  importSelectedIds.value = new Set()
  importApplyActive.value = false
  try {
    const data = await importFromLocus()
    locusData.value = data
    // 默认勾选所有 provider
    importSelectedIds.value = new Set(data.providers.map((p) => p.id))
    // 默认勾选 active connection（如果有 model 或 baseUrl）
    importApplyActive.value = data.model != null || data.baseUrl != null
  } catch (e) {
    locusError.value = String(e)
  } finally {
    locusLoading.value = false
  }
}

function closeImportModal() {
  showImportModal.value = false
}

function applyImport() {
  if (!locusData.value) return

  // 1. 合并 providers
  if (locusData.value.providers.length > 0) {
    const toImport = locusData.value.providers
      .filter((p) => importSelectedIds.value.has(p.id))
      .map<CustomProvider>((p) => ({
        id: p.id,
        name: p.name,
        baseUrl: p.endpoint,
        apiKey: '', // Locus 把 key 存 keychain，PlotCraft 玩家手动填
        apiFormat: p.apiFormat,
        enabled: p.enabled,
      }))
    // 跳过已存在 id（提示玩家手动处理）
    const existing = new Set(customProviders.value.map((p) => p.id))
    const newOnes = toImport.filter((p) => !existing.has(p.id))
    const skipped = toImport.length - newOnes.length
    customProviders.value = [...customProviders.value, ...newOnes]
    if (skipped > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[Locus import] 跳过 ${skipped} 个已存在 id 的 provider`)
    }
  }

  // 2. 覆盖 active connection（玩家勾选时）
  if (importApplyActive.value) {
    // model 字段在 settings.config.model，ProvidersPanel 没绑 v-model
    // （ModelDefaultsPanel 管它）—— 直接通过 store 改
    if (locusData.value.model) {
      const settings = useSettingsStore()
      settings.config.model = locusData.value.model
    }
    if (locusData.value.baseUrl) {
      baseUrl.value = locusData.value.baseUrl
    }
    if (locusData.value.inferredApiFormat) {
      apiFormat.value = locusData.value.inferredApiFormat
    }
  }

  closeImportModal()
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
        <span class="label-text">API Format</span>
        <select v-model="apiFormat">
          <option
            v-for="(label, fmt) in API_FORMAT_LABELS"
            :key="fmt"
            :value="fmt"
          >
            {{ label }}
          </option>
        </select>
        <span class="field-hint">
          当前 LLM 调用的协议 —— 切换后下次发消息生效
        </span>
      </label>

      <label>
        <span class="label-text">Endpoint (base_url)</span>
        <input
          v-model="baseUrl"
          type="text"
          placeholder="https://api.openai.com/v1"
        />
        <span class="field-hint">
          OpenAI / Anthropic 端点 —— 切换 API format 时记得改这里
        </span>
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
          @click="openImportModal"
          class="import-btn"
          title="从 Locus config 导入（跨 app 读 Locus 的 settings）"
        >
          <Download :size="12" />
          <span>Import from Locus</span>
        </button>
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
          <label class="form-grid-full">
            <span class="label-text">apiFormat（API 协议）</span>
            <select v-model="draftApiFormat">
              <option
                v-for="(label, fmt) in API_FORMAT_LABELS"
                :key="fmt"
                :value="fmt"
              >
                {{ label }}
              </option>
            </select>
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
            <div class="card-row">
              <span class="card-label">apiFormat:</span>
              <code>{{ formatLabel(p.apiFormat) }}</code>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Import from Locus modal -->
    <Teleport to="body">
      <div v-if="showImportModal" class="modal-backdrop" @click.self="closeImportModal">
        <div class="modal">
          <div class="modal-header">
            <Download :size="16" />
            <h3>Import from Locus</h3>
            <button @click="closeImportModal" class="modal-close">
              <X :size="16" />
            </button>
          </div>

          <div class="modal-body">
            <div v-if="locusLoading" class="modal-status">读取 Locus config 中...</div>
            <div v-else-if="locusError" class="modal-status error">
              读取失败：{{ locusError }}
            </div>
            <div v-else-if="locusData && !locusData.found" class="modal-status">
              没找到 Locus config（<code>%APPDATA%/Locus/config.json</code>）
              —— 确认装过 Locus 吗？
            </div>
            <template v-else-if="locusData">
              <p class="modal-hint">
                从 Locus config 读到的内容 —— 玩家挑要导入哪些。
                <strong>API key 不会带过来</strong>（Locus 存 OS keychain，跨 app 读不到），
                导入后玩家手动填。
              </p>

              <!-- Active connection section -->
              <div v-if="locusData.model || locusData.baseUrl" class="modal-section">
                <label class="modal-section-title">
                  <input v-model="importApplyActive" type="checkbox" />
                  覆盖 Active Connection
                </label>
                <div class="modal-field-grid">
                  <div v-if="locusData.model" class="modal-field">
                    <span class="modal-field-label">model</span>
                    <code>{{ locusData.model }}</code>
                    <span class="modal-field-hint">（由 ModelDefaults panel 设置，不在这里）</span>
                  </div>
                  <div v-if="locusData.baseUrl" class="modal-field">
                    <span class="modal-field-label">baseUrl</span>
                    <code>{{ locusData.baseUrl }}</code>
                  </div>
                  <div v-if="locusData.inferredApiFormat" class="modal-field">
                    <span class="modal-field-label">apiFormat (推断)</span>
                    <code>{{ formatLabel(locusData.inferredApiFormat) }}</code>
                  </div>
                </div>
              </div>

              <!-- Custom providers section -->
              <div v-if="locusData.providers.length > 0" class="modal-section">
                <div class="modal-section-title">
                  Custom Providers（{{ locusData.providers.length }} 个） —— 勾选要导入的
                </div>
                <div class="modal-providers">
                  <label
                    v-for="p in locusData.providers"
                    :key="p.id"
                    class="modal-provider"
                  >
                    <input
                      type="checkbox"
                      :checked="importSelectedIds.has(p.id)"
                      @change="(e) => {
                        if ((e.target as HTMLInputElement).checked) {
                          importSelectedIds.add(p.id)
                        } else {
                          importSelectedIds.delete(p.id)
                        }
                        // trigger reactivity
                        importSelectedIds = new Set(importSelectedIds)
                      }"
                    />
                    <div class="modal-provider-info">
                      <div class="modal-provider-name">
                        <span class="modal-provider-id">{{ p.id }}</span>
                        <span class="modal-provider-display">{{ p.name }}</span>
                      </div>
                      <div class="modal-provider-meta">
                        <code>{{ p.endpoint }}</code>
                        <span class="modal-provider-format">{{ formatLabel(p.apiFormat) }}</span>
                        <span v-if="p.modelCount > 0" class="modal-provider-models">
                          {{ p.modelCount }} 个 model
                        </span>
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              <p class="modal-hint-bottom">
                路径：
                <code class="path">{{ locusData.configPath }}</code>
                <code class="path">{{ locusData.customProvidersPath }}</code>
              </p>
            </template>
          </div>

          <div class="modal-actions" v-if="locusData && locusData.found">
            <button @click="applyImport" class="primary" :disabled="locusLoading">
              <Download :size="14" />
              <span>
                Import
                <span v-if="locusData && locusData.providers.length > 0 && importSelectedIds.size > 0">
                  ({{ importSelectedIds.size }} provider{{ importSelectedIds.size === 1 ? '' : 's' }})
                </span>
              </span>
            </button>
            <button @click="closeImportModal">取消</button>
          </div>
          <div class="modal-actions" v-else>
            <button @click="closeImportModal">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>
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

/* === Import from Locus button === */
.import-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 4px 10px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
  margin-right: 6px;
}
.import-btn:hover {
  background: var(--hover);
  color: var(--text);
  border-color: var(--accent);
}
.add-btn {
  margin-left: 0;
}

/* === Import from Locus modal === */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.modal {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  max-width: 640px;
  width: 90%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
.modal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}
.modal-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  flex: 1;
}
.modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.modal-close:hover {
  background: var(--hover);
  color: var(--text);
}
.modal-body {
  padding: 14px 18px;
  overflow-y: auto;
  flex: 1;
  font-size: 12px;
  line-height: 1.5;
}
.modal-status {
  padding: 20px;
  text-align: center;
  color: var(--text-muted);
}
.modal-status.error {
  color: var(--error);
}
.modal-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0 0 14px;
  line-height: 1.5;
}
.modal-hint code {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 11px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 4px;
}
.modal-hint-bottom {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.modal-section {
  margin-bottom: 14px;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.modal-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
  margin-bottom: 8px;
  flex-direction: row;
}
.modal-section-title input[type="checkbox"] {
  margin: 0;
}
.modal-field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}
.modal-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.modal-field-label {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.modal-field code {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 11px;
  color: var(--text);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 2px 6px;
  word-break: break-all;
}
.modal-field-hint {
  font-size: 10px;
  color: var(--text-muted);
  font-style: italic;
}
.modal-providers {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.modal-provider {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  flex-direction: row;
  margin: 0;
}
.modal-provider:hover {
  border-color: var(--accent);
}
.modal-provider input[type="checkbox"] {
  margin: 2px 0 0 0;
  flex-shrink: 0;
}
.modal-provider-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.modal-provider-name {
  display: flex;
  align-items: center;
  gap: 6px;
}
.modal-provider-id {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
}
.modal-provider-display {
  font-size: 12px;
  color: var(--text);
}
.modal-provider-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--text-muted);
}
.modal-provider-meta code {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  background: transparent;
  border: none;
  padding: 0;
  color: var(--text-muted);
  word-break: break-all;
}
.modal-provider-format {
  padding: 1px 5px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 10px;
}
.modal-provider-models {
  font-size: 10px;
  color: var(--text-muted);
}
.path {
  display: inline-block;
  font-size: 10px;
  word-break: break-all;
  margin-right: 6px;
  margin-top: 2px;
  background: var(--bg-elev) !important;
  padding: 2px 6px !important;
  border: 1px solid var(--border) !important;
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
  gap: 4px;
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
</style>
