<script setup lang="ts">
// Providers panel（v0.1.3+ 只剩 Saved Providers 库 + 顶部 hint）
//
//  v0.1.3 历史：
//  - v0.1.0 整段 inline 列表 + Add/Edit form
//  - v0.1.1 改 Locus 同款 custom providers section + import 按钮
//  - v0.1.2 Active Connection 改 readonly display
//  - v0.1.3 整段 Active Connection 删除（active 切换完全在 chat tab model selector）
//
// 现在的布局：
// - 顶部 hint：解释 active connection 切换路径
// - Saved Providers section：每条 provider 一个 card（id / name / baseUrl / apiKey mask
//   / apiFormat / defaultModel + Use / 启用 / Edit / Delete 按钮）
// - 顶部按钮：Import from Locus + Add provider（弹 ProviderEditModal）
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

import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  Plus,
  Trash2,
  Check,
  Power,
  PowerOff,
  Pencil,
  X,
  Download,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-vue-next'
import type { CustomProvider, ApiFormat } from '@/lib/settings'
import { API_FORMAT_LABELS, DEFAULT_API_FORMAT } from '@/lib/settings'
import { importFromLocus, type LocusImportData } from '@/lib/locusImport'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'
import ProviderEditModal from '@/components/settings/ProviderEditModal.vue'

const props = defineProps<{
  baseUrl: string | null
  apiKey: string
  customProviders: CustomProvider[]
}>()

// === Active connection (v-model —— settings 顶层字段，player 改不到)
//
// v0.1.3+ 这个 panel 不再显示 active connection；
// 玩家切 active 的唯一路径：
// 1. chat tab 的 model selector → 选 builtin model 或 custom provider
// 2. 选 custom provider → SessionView `onSelectModel` 把 baseUrl/apiKey/apiFormat 写到这 3 个 v-model
// 3. settings 这里保留 v-model 是为了让 "Use" 按钮还能写
const baseUrl = defineModel<string | null>('base-url', { required: true })
const apiKey = defineModel<string>('api-key', { required: true })
const apiFormat = defineModel<ApiFormat>('api-format', { required: true })

// === Saved library (v-model) ===
const customProviders = defineModel<CustomProvider[]>('custom-providers', { required: true })

// === Toast（useProvider 成功提示用）===
interface ToastMsg {
  id: number
  text: string
  tone: 'success' | 'error'
}
const toast = ref<ToastMsg | null>(null)
let toastTimer: number | null = null
function showToast(text: string, tone: 'success' | 'error' = 'success') {
  toast.value = { id: Date.now(), text, tone }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.value = null
    toastTimer = null
  }, 3000)
}

// === Add / Edit modal (v0.1.2+ 用 ProviderEditModal 替换原 inline form) ===
const editingProvider = ref<CustomProvider | null>(null)
const isAdding = ref(false)

// === Delete confirm dialog (v0.1.3+ 替代 window.confirm —— 见 removeProvider) ===
const confirmingDeleteId = ref<string | null>(null)
const confirmingDeleteTarget = computed(() => {
  const id = confirmingDeleteId.value
  if (!id) return null
  return customProviders.value.find((p) => p.id === id) ?? null
})

const existingProviderIds = computed(() => customProviders.value.map((p) => p.id))

function startAdd() {
  isAdding.value = true
  editingProvider.value = {
    id: '',
    name: '',
    baseUrl: 'https://',
    apiKey: '',
    apiFormat: DEFAULT_API_FORMAT,
    enabled: true,
    models: [],
    defaultModel: '',
  }
}

function startEdit(p: CustomProvider) {
  isAdding.value = false
  // 浅拷贝（modal 内会修改 draft，但 props.provider 是 readonly）
  editingProvider.value = { ...p }
}

function closeModal() {
  editingProvider.value = null
  isAdding.value = false
}

function onModalSave(newProvider: CustomProvider) {
  if (isAdding.value) {
    // 新增
    customProviders.value = [...customProviders.value, newProvider]
  } else {
    // 编辑
    const oldId = editingProvider.value?.id
    customProviders.value = customProviders.value.map((p) =>
      p.id === oldId ? newProvider : p,
    )
  }
  closeModal()
}

function removeProvider(id: string) {
  // v0.1.3+ 不能用 window.confirm —— Tauri 2 + WebView2 在 Windows 上 confirm 弹窗返回值
  // 不可靠（弹窗能显示但 cancel 仍当 OK 走）。改用组件内 modal dialog（confirmingDeleteId）。
  confirmingDeleteId.value = id
}

function cancelDelete() {
  confirmingDeleteId.value = null
}

function confirmDelete() {
  const id = confirmingDeleteId.value
  if (!id) return
  customProviders.value = customProviders.value.filter((p) => p.id !== id)
  confirmingDeleteId.value = null
}

async function useProvider(p: CustomProvider) {
  // v0.1.5+ Use 按钮完整化 —— 之前只写 3 个 v-model，chat 切过去还显示
  // "未添加任何 provider"。补 3 件事：
  // 1. 写 config.model = effectiveDefaultModel（chat selector 靠这个解析 trigger）
  // 2. 同步 chat.selectedModel（让 trigger 立即变 active，不必等下次 init）
  // 3. save 持久化 + toast 反馈

  const effectiveModel = p.defaultModel?.trim() || p.models?.[0]?.id?.trim() || ''

  // 1. 写 active connection 3 字段
  baseUrl.value = p.baseUrl
  apiKey.value = p.apiKey
  apiFormat.value = p.apiFormat

  // 2. 写 config.model（chat selector 解析的 key）—— 写 settings.config
  //    ref 即可，store 的 .config 是 ref 引用，会同步触发 reactivity
  const settings = useSettingsStore()
  if (!settings.loaded) await settings.init()
  settings.config.model = effectiveModel

  // 3. 同步 chat store（玩家当前在 chat tab 切回 trigger 立即变 active）
  //    不要等 watcher 触发（init 时只 watch selectedModel/selectedEffort 改的时候）
  const chat = useChatStore()
  if (chat.selectedModel !== effectiveModel) {
    chat.selectedModel = effectiveModel
  }

  // 4. 持久化
  try {
    await settings.save()
  } catch (e) {
    console.error('[useProvider] save failed:', e)
    showToast(`保存失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    return
  }

  // 5. toast 反馈
  if (effectiveModel) {
    showToast(`已切换到 ${p.name} · ${effectiveModel}`)
  } else {
    showToast(`已切换到 ${p.name}（未设 model —— 去 chat tab 选一个）`, 'error')
  }
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
        models: p.models.map((m) => ({ id: m.id, name: m.name })), // v0.1.3+ 完整 models 列表
        defaultModel: p.defaultModel, // Locus models[0].id
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

// === Delete confirm dialog 键盘交互（Esc 取消） ===
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && confirmingDeleteId.value) {
    cancelDelete()
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="providers-panel">
    <h2>Providers</h2>
    <p class="hint">
      已保存的第三方 provider 库（顶层 <code>customProviders[]</code>，跟 Locus
      <code>CustomProvider</code> schema 同构，PlotCraft 简化 apiKey 裸存 + 不分 apiFormat）。
      点 <strong>Use</strong> 把 provider 的 endpoint / key / format / model 写到 active
      connection（settings 顶层），同步刷新 <strong>chat tab model selector</strong>，
      切到 chat tab 就能直接发消息。
      <br />
      <strong>注意</strong>：<code>models</code> 为空的 provider <strong>不会</strong>出现在
      chat selector —— chat 需要知道用哪个 model id 才能发请求。点 <strong>✎ Edit</strong>
      → "<strong>从模型库添加</strong>" 选 model，或"手动添加"填 id + name。
    </p>

    <!-- Section 1: 没了 (v0.1.2+)
         v0.1.1 之前有 Active Connection section（3 个可编辑 input + Test 按钮）——
         v0.1.2 改 readonly display，v0.1.3 整段删除。
         现在 active connection 完全在 chat tab 切（model selector → 选 provider →
         "Use" 按钮复制到 active），settings 这里只管 Saved Providers 库。
    -->

    <!-- Section 2: Saved library -->
    <section class="section">
      <div class="section-header">
        <span class="section-title">Saved Providers</span>
        <span class="section-tag">{{ customProviders.length }} 个</span>
        <button
          v-if="!editingProvider"
          @click="openImportModal"
          class="import-btn"
          title="从 Locus config 导入（跨 app 读 Locus 的 settings）"
        >
          <Download :size="12" />
          <span>Import from Locus</span>
        </button>
        <button
          v-if="!editingProvider"
          @click="startAdd"
          class="add-btn"
        >
          <Plus :size="12" />
          <span>Add provider</span>
        </button>
      </div>

      <!-- Provider cards -->
      <div v-if="customProviders.length === 0 && !editingProvider" class="empty">
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
              <button
                @click="useProvider(p)"
                class="use-btn"
                :disabled="!p.enabled"
                :title="p.models.length === 0 ? '这个 provider 还没填 model —— 点 ✎ Edit 加 model 才能在 chat 用' : '切到 chat tab 用这个 provider 发送消息'"
              >
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
            <div class="card-row">
              <span class="card-label">models:</span>
              <template v-if="p.models.length > 0">
                <code>
                  {{ p.models.length }} 个（default: {{ p.defaultModel || p.models[0]?.id || '—' }}）
                </code>
              </template>
              <template v-else>
                <!-- v0.1.5+ 显眼提示：models 空的 provider 不会出现在 chat selector
                     给个"+"按钮直接打开 edit modal 加 model，避免玩家要先去 chat
                     看 dropdown 才能发现"为什么没出现" -->
                <span class="models-empty-warning">
                  <AlertTriangle :size="12" />
                  0 个 —— chat selector 看不到
                </span>
                <button
                  type="button"
                  class="add-model-btn"
                  @click="startEdit(p)"
                  title="打开 edit modal 给这个 provider 加 model"
                >
                  <Plus :size="11" />
                  <span>加 model</span>
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Provider Edit Modal (v0.1.2+ Locus 同款) -->
    <ProviderEditModal
      :provider="editingProvider"
      :is-new="isAdding"
      :existing-ids="existingProviderIds"
      @close="closeModal"
      @save="onModalSave"
    />

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
                        <span v-if="p.defaultModel" class="modal-provider-default-model">
                          default: <code>{{ p.defaultModel }}</code>
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

    <!-- v0.1.3+ Delete confirm dialog (替代 window.confirm)
         Teleport 到 body 避免被父级 overflow:hidden 截断；点击 overlay 关闭 = 取消 -->
    <Teleport to="body">
      <div
        v-if="confirmingDeleteTarget"
        class="confirm-overlay"
        @mousedown.self="cancelDelete"
      >
        <div class="confirm-modal" role="alertdialog" aria-modal="true">
          <div class="confirm-header">
            <AlertTriangle :size="18" />
            <span class="confirm-title">删除 provider？</span>
          </div>
          <div class="confirm-body">
            <p>
              确定删除 provider
              <code class="confirm-target-id">{{ confirmingDeleteTarget.id }}</code>
              <span v-if="confirmingDeleteTarget.name" class="confirm-target-name">
                ({{ confirmingDeleteTarget.name }})
              </span>
              ？此操作不可撤销。
            </p>
            <p class="confirm-hint">
              不会影响 config.json 里其他 provider 或 chat 历史。
            </p>
          </div>
          <div class="confirm-actions">
            <button type="button" class="confirm-cancel" @click="cancelDelete">
              取消
            </button>
            <button type="button" class="confirm-delete" @click="confirmDelete" autofocus>
              删除
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- v0.1.5+ Toast (useProvider 切 active connection 反馈)
         Teleport 到 body；用 id 作 key 让连续 toast 也能重新触发动画 -->
    <Teleport to="body">
      <Transition name="toast">
        <div
          v-if="toast"
          :key="toast.id"
          class="toast"
          :class="`toast-${toast.tone}`"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 v-if="toast.tone === 'success'" :size="14" />
          <AlertTriangle v-else :size="14" />
          <span>{{ toast.text }}</span>
        </div>
      </Transition>
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
/* v0.1.5+ provider 没 model 时的显眼提示 —— error 色 + 图标，比之前灰 code 醒目 */
.models-empty-warning {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  background: rgba(232, 90, 90, 0.12);
  border: 1px solid var(--error, #e53e3e);
  color: var(--error, #e53e3e);
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
}
.models-empty-warning svg {
  flex-shrink: 0;
}
/* v0.1.5+ "加 model" 按钮 —— 直接打开该 provider 的 edit modal
   比让玩家去翻整个 modal 找位置方便 */
.add-model-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 3px;
  cursor: pointer;
  font-size: 10px;
  font-family: inherit;
  font-weight: 500;
}
.add-model-btn:hover {
  background: var(--accent);
  color: var(--bg);
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

/* === Delete confirm dialog (v0.1.3+ 替代 window.confirm) === */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000; /* 高于 ProviderEditModal (z-index 100) */
  animation: confirm-fade 0.12s ease-out;
}
.confirm-modal {
  width: min(420px, calc(100vw - 32px));
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  animation: confirm-rise 0.15s ease-out;
}
.confirm-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--error, #e53e3e);
  margin-bottom: 12px;
}
.confirm-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.confirm-body {
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--text);
  line-height: 1.5;
}
.confirm-body p {
  margin: 0 0 6px 0;
}
.confirm-target-id {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  background: var(--bg);
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
  color: var(--accent);
}
.confirm-target-name {
  color: var(--text-muted);
  font-size: 12px;
  margin-left: 2px;
}
.confirm-hint {
  color: var(--text-muted);
  font-size: 11px;
  margin-top: 4px;
}
.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.confirm-cancel,
.confirm-delete {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: opacity 0.12s ease, background 0.12s ease;
}
.confirm-cancel {
  background: var(--bg);
  color: var(--text);
}
.confirm-cancel:hover {
  background: var(--hover);
}
.confirm-delete {
  background: var(--error, #e53e3e);
  border-color: var(--error, #e53e3e);
  color: #fff;
  font-weight: 500;
}
.confirm-delete:hover {
  opacity: 0.85;
}
.confirm-delete:focus-visible,
.confirm-cancel:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

@keyframes confirm-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes confirm-rise {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* === Toast (v0.1.5+ useProvider 反馈) ===
   屏幕底部居中浮动，3s 后自动消失；用 id key + Transition 触发 enter/leave 动画
   避免被父级 overflow:hidden 截断 → Teleport 到 body */
.toast {
  position: fixed;
  left: 50%;
  bottom: 28px;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
  font-size: 13px;
  z-index: 1100; /* 高于 confirm modal (1000) */
  max-width: min(560px, calc(100vw - 32px));
  pointer-events: none;
}
.toast-success {
  border-color: var(--accent);
}
.toast-success svg {
  color: var(--accent);
  flex-shrink: 0;
}
.toast-error {
  border-color: var(--error, #e53e3e);
  color: var(--error, #e53e3e);
}
.toast-error svg {
  color: var(--error, #e53e3e);
  flex-shrink: 0;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
.toast-enter-to,
.toast-leave-from {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
</style>
