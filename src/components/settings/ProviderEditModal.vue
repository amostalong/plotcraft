<script setup lang="ts">
// ProviderEditModal —— 玩家添加 / 编辑 custom provider 的弹窗
//
// 视觉 + 交互镜像 Locus `CustomProviderModal.vue`（AGENTS.md 硬规则 #1：结构对齐，代码自写）：
// - 1080×720 modal 居中浮层
// - 2 阶段流程（v0.1.4+ 仿 Locus pick → config）：
//   - stage='pick'：PlayerCatalogStep（搜索框 + 手动添加卡 + catalog 列表）
//   - stage='config'：左 320px connection 字段，右 flex model 列表
// - 中间状态条：local error + test result（连接成功 / 失败 + 错误码 + 模型返回片段）
// - Footer：保存 / 测试 / 取消
// - 顶 ← 返回按钮（仅 isNew=true + stage=config 时显示，仿 Locus）
//
// v0.1 简化（vs Locus）：
// - 内置 catalog 只 1 条（claude-sonnet-4-5），远程 fetch / 刷新等 v0.2+ 再说
// - ID 编辑模式不允许改（Locus 允许但我们 v0.1 直接锁）
// - 字段 label hardcode 英文（v0.1 不上 vue-i18n）

import { computed, ref, watch } from 'vue'
import {
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Plus,
  Save,
  Star,
  Trash2,
  X,
  XCircle,
  Zap,
} from 'lucide-vue-next'

import type { CustomProvider, ApiFormat, ProviderModel } from '@/lib/settings'
import { API_FORMAT_LABELS, DEFAULT_API_FORMAT, DEFAULT_ENDPOINTS } from '@/lib/settings'
import { findModel, getDefaultEffort, type BuiltinModel } from '@/lib/modelCatalog'
import { testProvider, type TestProviderResult } from '@/lib/llm'
import ProviderCatalogStep from './ProviderCatalogStep.vue'
import ModelLibraryPanel from './ModelLibraryPanel.vue'

const props = defineProps<{
  /** 当前编辑的 provider（null = 关闭）*/
  provider: CustomProvider | null
  /** true = 新建模式（要校验 id 唯一 + 显示 ID 字段可编辑）；false = 编辑模式（ID 锁）*/
  isNew: boolean
  /** 已有 provider id 集合（用于新模式下的唯一性校验）*/
  existingIds: string[]
}>()

const emit = defineEmits<{
  close: []
  save: [provider: CustomProvider]
}>()

// === 表单 draft（modal 期间独立，Save 才写回 props.provider）===
const draftId = ref('')
const draftName = ref('')
const draftEndpoint = ref('')
const draftApiKey = ref('')
const draftApiFormat = ref<ApiFormat>(DEFAULT_API_FORMAT)
const draftEnabled = ref(true)
const draftModels = ref<ProviderModel[]>([])
const draftDefaultModel = ref('')

// 「手动添加 model」inline form state（config stage 内部，给 catalog 选完后再加 model 用）
const showManualForm = ref(false)
const manualId = ref('')
const manualName = ref('')
const manualError = ref<string | null>(null)

// === 2 阶段流程（v0.1.4+ 仿 Locus pick → config） ===
//
//  v0.1.4+：isNew=true 打开 modal → stage='pick'（ProviderCatalogStep）
//  玩家选 catalog / 手动 → onPickCatalog / onPickManual → 切到 stage='config'，draft 填好
//  isNew=false（编辑）→ 直接 stage='config'
//  玩家在 config 阶段点 ← → 回到 stage='pick'，draft 保留（跟 Locus 一致）
const stage = ref<'pick' | 'config'>('config')

// === UI state ===
const localError = ref<string | null>(null)
const testRunning = ref(false)
const testResult = ref<TestProviderResult | null>(null)
const saving = ref(false)

/** draft 全部清空到 empty defaults（isNew 初始 / pick stage 手动按钮共用） */
function resetDraftsToEmpty() {
  draftId.value = ''
  draftName.value = ''
  draftEndpoint.value = ''
  draftApiKey.value = ''
  draftApiFormat.value = DEFAULT_API_FORMAT
  draftEnabled.value = true
  draftModels.value = []
  draftDefaultModel.value = ''
}

/** 把 props.provider 的字段塞到 draft（编辑模式用） */
function populateDraftsFromProvider(p: CustomProvider) {
  draftId.value = p.id
  draftName.value = p.name
  draftEndpoint.value = p.baseUrl
  draftApiKey.value = p.apiKey
  draftApiFormat.value = p.apiFormat
  draftEnabled.value = p.enabled
  draftModels.value = p.models ? p.models.map((m) => ({ ...m })) : []
  draftDefaultModel.value = p.defaultModel
}

/** 清 UI state（localError / test result / saving） */
function resetUiState() {
  localError.value = null
  testResult.value = null
  testRunning.value = false
  saving.value = false
  showManualForm.value = false
  manualId.value = ''
  manualName.value = ''
  manualError.value = null
}

/** v0.1.4+ 初始化：modal 每次 mount（provider prop 从 null 变 object）时跑一次
 *
 *  - isNew=true → stage='pick' + resetDraftsToEmpty
 *  - isNew=false → stage='config' + populateDraftsFromProvider
 *
 *  modal 用 v-if 控制（ProvidersPanel `editingProvider` null 时销毁），
 *  所以"打开"= "remount"，watch immediate 每次都跑。
 *  stage 切换（pick ↔ config）不触发 watch（provider prop 不变）。
 */
watch(
  () => props.provider,
  (p) => {
    if (!p) return
    resetUiState()
    if (props.isNew) {
      stage.value = 'pick'
      resetDraftsToEmpty()
    } else {
      stage.value = 'config'
      populateDraftsFromProvider(p)
    }
  },
  { immediate: true },
)

const dialogTitle = computed(() => {
  if (props.isNew && stage.value === 'pick') return '添加供应商'
  if (props.isNew) return '添加供应商 · 配置'
  return `编辑 "${props.provider?.name ?? ''}"`
})

/** v0.1.4+ pick stage 交互 */
function onPickCatalog(model: BuiltinModel) {
  const apiFormat: ApiFormat =
    model.provider === 'anthropic' ? 'anthropic_messages' : 'openai_chat'
  const providerLabel =
    model.provider === 'anthropic'
      ? 'Anthropic'
      : model.provider === 'openai'
        ? 'OpenAI'
        : model.provider === 'google'
          ? 'Google'
          : 'Custom'
  // draftId 用 provider + model id 拼（小写 + dash），保证唯一
  draftId.value = `${model.provider}-${model.id}`.replace(/[^a-z0-9-]/g, '-')
  draftName.value = `${providerLabel} / ${model.name}`
  draftEndpoint.value = DEFAULT_ENDPOINTS[apiFormat]
  draftApiKey.value = ''
  draftApiFormat.value = apiFormat
  draftEnabled.value = true
  draftModels.value = [{ id: model.id, name: model.name }]
  draftDefaultModel.value = model.id
  stage.value = 'config'
}

function onPickManual() {
  resetDraftsToEmpty()
  stage.value = 'config'
}

function onBackToPick() {
  if (!props.isNew) return // 编辑模式没 pick stage
  stage.value = 'pick'
  // 不 reset drafts —— Locus 同款，切回去不丢玩家已填的
}

/** Endpoint 用 auto-growing textarea（strip 空白 — URL 不该有 whitespace）*/
function updateEndpoint(e: Event) {
  const el = e.target as HTMLTextAreaElement
  const cleaned = el.value.replace(/\s+/g, '')
  if (cleaned !== el.value) el.value = cleaned
  draftEndpoint.value = cleaned
}

function validate(): boolean {
  if (!draftName.value.trim()) {
    localError.value = 'Display name 不能为空'
    return false
  }
  if (!draftEndpoint.value.trim() || !draftEndpoint.value.startsWith('http')) {
    localError.value = 'Endpoint 必须以 http/https 开头'
    return false
  }
  if (props.isNew) {
    if (!draftId.value.trim()) {
      localError.value = 'ID 不能为空'
      return false
    }
    if (props.existingIds.includes(draftId.value.trim())) {
      localError.value = `ID "${draftId.value}" 已存在`
      return false
    }
  }
  // v0.1.3+ models 列表可以为空（玩家还没加 model 时也能保存，
  // 但该 provider 不会出现在 chat selector）
  // 不强 warning，简化 UX
  if (draftModels.value.length === 0) {
    // 不报错，只是不显示该 provider 在 chat selector
  }
  // 校验 defaultModel 必须是 models 列表里的 id
  if (draftDefaultModel.value.trim()) {
    const exists = draftModels.value.some(
      (m) => m.id === draftDefaultModel.value.trim(),
    )
    if (!exists) {
      localError.value = `Default Model "${draftDefaultModel.value}" 不在 models 列表里`
      return false
    }
  }
  localError.value = null
  return true
}

function onSave() {
  if (!validate()) return
  saving.value = true
  const newProvider: CustomProvider = {
    id: draftId.value.trim(),
    name: draftName.value.trim(),
    baseUrl: draftEndpoint.value.trim(),
    apiKey: draftApiKey.value.trim(),
    apiFormat: draftApiFormat.value,
    enabled: draftEnabled.value,
    models: draftModels.value.map((m) => ({ id: m.id.trim(), name: m.name.trim() || m.id.trim() })),
    defaultModel: draftDefaultModel.value.trim(),
  }
  emit('save', newProvider)
  saving.value = false
}

// === v0.1.3+ models 列表增删 ===

// v0.1.4+ 「从模型库添加」整体搬到 pick stage（ProviderCatalogStep） + 内嵌的
// ModelLibraryPanel —— 这里只留「手动添加 model」inline form

/** 「手动添加 model」open/close（config stage 内部，给已 catalog 选完的 provider 再加 model） */
function openManualForm() {
  showManualForm.value = true
  manualError.value = null
  manualId.value = ''
  manualName.value = ''
}
function closeManualForm() {
  showManualForm.value = false
  manualId.value = ''
  manualName.value = ''
  manualError.value = null
}

/** v0.1.4+ 从 ModelLibraryPanel 选一个 model 加进 draft
 *  - 避免重复（id 已存在直接 no-op）
 *  - 第一个 model 自动设成 default
 */
function addFromLibrary(m: { id: string; name: string }) {
  if (draftModels.value.some((x) => x.id === m.id)) return
  draftModels.value = [...draftModels.value, { id: m.id, name: m.name || m.id }]
  if (!draftDefaultModel.value.trim()) {
    draftDefaultModel.value = m.id
  }
}

/** ModelLibraryPanel 用的 existing model ids（要过滤已加的） */
const existingModelIds = computed(() => draftModels.value.map((m) => m.id))

function submitManualAdd() {
  const id = manualId.value.trim()
  const name = manualName.value.trim() || id
  if (!id) {
    manualError.value = 'Model id 不能为空'
    return
  }
  if (draftModels.value.some((m) => m.id === id)) {
    manualError.value = `Model id "${id}" 已存在`
    return
  }
  draftModels.value = [...draftModels.value, { id, name }]
  if (!draftDefaultModel.value.trim()) {
    draftDefaultModel.value = id
  }
  closeManualForm()
}

function removeModel(id: string) {
  draftModels.value = draftModels.value.filter((m) => m.id !== id)
  // 如果删的是 defaultModel → fallback 到 models[0]
  if (draftDefaultModel.value === id) {
    draftDefaultModel.value = draftModels.value[0]?.id ?? ''
  }
}

function setAsDefault(id: string) {
  draftDefaultModel.value = id
}

/** model card 上下文：查 builtin 拿 context window 显示 */
function lookupBuiltinContext(id: string): string | null {
  const m = findModel(id)
  if (!m) return null
  if (m.contextWindow >= 1_000_000) return `${(m.contextWindow / 1_000_000).toFixed(1)}M ctx`
  if (m.contextWindow >= 1_000) return `${Math.round(m.contextWindow / 1_000)}K ctx`
  return `${m.contextWindow} ctx`
}

function lookupBuiltinEffort(id: string): string | null {
  const m = findModel(id)
  if (!m) return null
  return getDefaultEffort(m) || null
}

async function onTest() {
  // v0.1.3+ 用 effective default model（defaultModel || models[0].id）
  const testModel =
    draftDefaultModel.value.trim() || draftModels.value[0]?.id?.trim() || ''
  if (!draftEndpoint.value.trim() || !draftApiFormat.value || !testModel) {
    testResult.value = {
      ok: false,
      error: 'Endpoint + API Format + 至少 1 个 model 三个都得填',
      endpoint: draftEndpoint.value,
      model: testModel,
      apiFormat: draftApiFormat.value,
    }
    return
  }
  testRunning.value = true
  testResult.value = null
  try {
    testResult.value = await testProvider({
      endpoint: draftEndpoint.value,
      apiKey: draftApiKey.value,
      apiFormat: draftApiFormat.value,
      model: testModel,
    })
  } catch (e) {
    testResult.value = {
      ok: false,
      error: String(e),
      endpoint: draftEndpoint.value,
      model: testModel,
      apiFormat: draftApiFormat.value,
    }
  } finally {
    testRunning.value = false
  }
}

function onClose() {
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !saving.value) onClose()
}
</script>

<template>
  <Transition name="modal">
    <div
      v-if="provider"
      class="provider-modal-overlay"
      @mousedown.self="onClose"
      @keydown="onKeydown"
      tabindex="-1"
    >
      <div class="custom-provider-dialog" role="dialog" aria-modal="true">
        <!-- Header -->
        <div class="provider-modal-header">
          <div class="provider-modal-header-lead">
            <button
              v-if="isNew && stage === 'config'"
              class="back-btn"
              type="button"
              :disabled="saving"
              title="返回 catalog 选"
              @click="onBackToPick"
            >
              <ChevronLeft :size="14" />
            </button>
            <span class="provider-modal-title">{{ dialogTitle }}</span>
          </div>
          <button class="close-btn" type="button" :disabled="saving" @click="onClose">
            <X :size="14" />
          </button>
        </div>

        <!-- v0.1.4+ Pick stage (仿 Locus) —— isNew + stage='pick' 时显示 -->
        <ProviderCatalogStep
          v-if="isNew && stage === 'pick'"
          :disabled="saving"
          @pick-catalog="onPickCatalog"
          @pick-manual="onPickManual"
        />

        <!-- Body: 2 栏（左 connection，右 model）—— stage='config' 时显示 -->
        <div v-else-if="stage === 'config'" class="config-body">
          <!-- Left: connection fields -->
          <aside class="config-side">
            <div class="config-field">
              <label class="config-label">API Key</label>
              <input
                v-model="draftApiKey"
                class="config-input mono-input"
                type="password"
                :disabled="saving"
                placeholder="sk-..."
                autocomplete="off"
              />
            </div>

            <div class="config-field">
              <label class="config-label">ID（唯一 key，小写英文）</label>
              <input
                v-model="draftId"
                class="config-input"
                :class="{ invalid: localError && localError.includes('ID ') }"
                type="text"
                :disabled="saving || !isNew"
                placeholder="deepseek"
                spellcheck="false"
              />
              <span v-if="!isNew" class="field-hint">编辑模式不能改 ID</span>
            </div>

            <div class="config-field">
              <label class="config-label">Display Name（显示名）</label>
              <input
                v-model="draftName"
                class="config-input"
                :class="{ invalid: localError && localError.includes('Display name') }"
                type="text"
                :disabled="saving"
                placeholder="DeepSeek"
              />
            </div>

            <div class="config-field">
              <label class="config-label">Endpoint（请求端点）</label>
              <textarea
                :value="draftEndpoint"
                class="config-input mono-input endpoint-input"
                :class="{ invalid: localError && localError.includes('Endpoint') }"
                rows="1"
                spellcheck="false"
                :disabled="saving"
                placeholder="https://api.deepseek.com/v1"
                @input="updateEndpoint"
                @keydown.enter.prevent
              ></textarea>
            </div>

            <div class="config-field">
              <label class="config-label">API Format（API 协议）</label>
              <select v-model="draftApiFormat" class="config-input" :disabled="saving">
                <option
                  v-for="(label, fmt) in API_FORMAT_LABELS"
                  :key="fmt"
                  :value="fmt"
                >
                  {{ label }}
                </option>
              </select>
            </div>

            <div v-if="!isNew" class="config-field enabled-row">
              <input
                v-model="draftEnabled"
                type="checkbox"
                id="provider-edit-enabled"
                :disabled="saving"
              />
              <label for="provider-edit-enabled">启用</label>
            </div>
          </aside>

          <!-- Right: model list (v0.1.3+ 跟 Locus 同款多 model) -->
          <section class="config-main">
            <div class="models-header">
              <span class="models-title">Model</span>
              <span v-if="draftModels.length > 0" class="models-count">
                已添加 {{ draftModels.length }} 个
              </span>
              <span v-else class="models-count empty">未添加</span>
              <div class="models-actions">
                <!-- v0.1.4+ 「从模型库添加」整体搬到 pick stage —— 这里只剩
                     「手动添加 model」（catalog 选完后再补 model 用） -->
                <button
                  class="add-model-btn"
                  type="button"
                  :disabled="saving"
                  @click="openManualForm"
                >
                  <Plus :size="11" />
                  <span>手动添加 model</span>
                </button>
              </div>
            </div>

            <!-- 手动添加 model inline form (config stage 内部) -->
            <div v-if="showManualForm" class="manual-form">
              <div class="manual-form-grid">
                <input
                  v-model="manualId"
                  class="config-input"
                  type="text"
                  placeholder="model id（如 deepseek-coder）"
                  spellcheck="false"
                />
                <input
                  v-model="manualName"
                  class="config-input"
                  type="text"
                  placeholder="display name（可选）"
                  spellcheck="false"
                />
              </div>
              <div v-if="manualError" class="manual-form-error">{{ manualError }}</div>
              <div class="manual-form-actions">
                <button class="btn primary" type="button" @click="submitManualAdd">
                  添加
                </button>
                <button class="btn" type="button" @click="closeManualForm">
                  取消
                </button>
              </div>
            </div>

            <!-- Model list -->
            <div v-if="draftModels.length > 0" class="models-list">
              <div
                v-for="m in draftModels"
                :key="m.id"
                class="model-card"
                :class="{ 'is-default': m.id === draftDefaultModel }"
              >
                <div class="model-info">
                  <div class="model-name-row">
                    <span class="model-name">{{ m.name || m.id }}</span>
                    <code v-if="lookupBuiltinContext(m.id)" class="model-meta">
                      {{ lookupBuiltinContext(m.id) }}
                    </code>
                    <code v-else class="model-meta">custom</code>
                    <span v-if="m.id === draftDefaultModel" class="default-tag">
                      default
                    </span>
                  </div>
                  <div class="model-actions">
                    <button
                      v-if="m.id !== draftDefaultModel"
                      class="icon-btn"
                      type="button"
                      title="设为 default"
                      :disabled="saving"
                      @click="setAsDefault(m.id)"
                    >
                      <Star :size="12" />
                    </button>
                    <button
                      class="icon-btn danger"
                      type="button"
                      title="删除 model"
                      :disabled="saving"
                      @click="removeModel(m.id)"
                    >
                      <Trash2 :size="12" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div v-else-if="!showManualForm" class="models-empty">
              <p>还没有 model —— 右上点 "手动添加 model"</p>
              <p class="hint">
                PlotCraft v0.1 简化：每个 model 只需 id + display name（context window 自动从 BUILTIN_MODELS lookup）
              </p>
            </div>

            <!-- Default Model 选择（在 models 列表下方） -->
            <div v-if="draftModels.length > 0" class="default-model-picker">
              <label class="config-label">Default Model（chat 选该 provider 时用）</label>
              <select v-model="draftDefaultModel" class="config-input" :disabled="saving">
                <option value="">— 未设置（fallback 到 models[0]）—</option>
                <option v-for="m in draftModels" :key="m.id" :value="m.id">
                  {{ m.name || m.id }} ({{ m.id }})
                </option>
              </select>
            </div>

            <!-- v0.1.4+ 模型库面板（仿 Locus 同款 —— 可折叠 + 搜索 + provider 分组） -->
            <ModelLibraryPanel
              :existing-model-ids="existingModelIds"
              :disabled="saving"
              @add-model="addFromLibrary"
            />
          </section>
        </div>

        <!-- Status bar: local error + test result (config stage only) -->
        <div
          v-if="stage === 'config' && (localError || testResult || testRunning)"
          class="provider-modal-status"
        >
          <div v-if="localError" class="local-error">{{ localError }}</div>
          <div
            v-else-if="testResult || testRunning"
            class="endpoint-test-result"
            :class="{ ok: testResult?.ok, fail: testResult && !testResult.ok, testing: testRunning }"
          >
            <Loader2 v-if="testRunning" :size="14" class="spin" />
            <CheckCircle2 v-else-if="testResult?.ok" :size="14" />
            <XCircle v-else-if="testResult" :size="14" />
            <span v-if="testRunning">Testing...</span>
            <span v-else-if="testResult?.ok">
              连接成功<span v-if="testResult.status">（HTTP {{ testResult.status }}）</span>
            </span>
            <span v-else-if="testResult">
              连接失败<span v-if="testResult.status">（HTTP {{ testResult.status }}）</span>
            </span>
            <code v-if="testResult?.response" class="test-response">
              {{ testResult.response }}
            </code>
            <code v-if="testResult?.error" class="test-error">
              {{ testResult.error }}
            </code>
          </div>
        </div>

        <!-- Footer: Save / Test / Cancel (config stage only) -->
        <div v-if="stage === 'config'" class="provider-modal-footer">
          <button class="btn primary" type="button" :disabled="saving" @click="onSave">
            <Save :size="14" />
            <span>{{ saving ? '保存中...' : '保存' }}</span>
          </button>
          <button
            class="btn"
            type="button"
            :disabled="saving || testRunning"
            @click="onTest"
          >
            <Loader2 v-if="testRunning" :size="14" class="spin" />
            <Zap v-else :size="14" />
            <span>{{ testRunning ? 'Testing...' : '测试' }}</span>
          </button>
          <button class="btn" type="button" :disabled="saving" @click="onClose">
            取消
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* === Overlay === */
.provider-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8, 10, 14, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

/* === Dialog === */
.custom-provider-dialog {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  width: 1080px;
  max-width: calc(100% - 48px);
  height: min(720px, 92vh);
  display: flex;
  flex-direction: column;
  box-shadow: 0 18px 40px rgba(15, 17, 21, 0.16);
  overflow: hidden;
}

/* === Header === */
.provider-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.provider-modal-header-lead {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.provider-modal-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  color: var(--text);
}
.close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.close-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.close-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
/* v0.1.4+ ← 返回 pick stage 按钮（仿 Locus 顶←） */
.back-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}
.back-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.back-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* === Body 2 栏 === */
.config-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  overflow: hidden;
}
.config-side {
  width: 320px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 16px 16px 18px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.config-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 16px 18px 8px;
  overflow-y: auto;
}

/* === Field === */
.config-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.config-field.enabled-row {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.config-field.enabled-row label {
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}
.config-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.35;
}
.config-input {
  width: 100%;
  min-width: 0;
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s, background 0.15s;
}
.mono-input {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
}
.config-input:focus {
  border-color: var(--accent);
}
.config-input.invalid {
  border-color: var(--error);
  background: rgba(232, 90, 90, 0.06);
}
.config-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.field-hint {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}
.endpoint-input {
  field-sizing: content;
  resize: none;
  overflow: hidden;
  word-break: break-all;
  line-height: 1.5;
  font-size: 12px;
}

/* === Models section (right) === */
.models-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.models-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.add-model-btn {
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
  transition: all 0.12s;
}
.add-model-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.add-model-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.catalog-picker {
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 10px;
}
.catalog-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  font-weight: 600;
}
.catalog-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}
.catalog-empty {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
  padding: 4px 0;
}
.catalog-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  background: transparent;
  color: var(--text);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  font-size: 12px;
}
.catalog-option:hover {
  background: var(--hover);
}
.catalog-option-name {
  flex: 1;
  font-weight: 500;
}
.catalog-option-id {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 11px;
  color: var(--text-muted);
}
.manual-form {
  background: var(--bg);
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 10px;
}
.manual-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-bottom: 6px;
}
.manual-form-error {
  font-size: 11px;
  color: var(--error);
  margin-bottom: 6px;
}
.manual-form-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}
.manual-form-actions .btn {
  padding: 4px 12px;
  font-size: 11px;
}
.models-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.default-model-picker {
  border-top: 1px solid var(--border);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.models-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.models-count {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--hover);
  border-radius: 10px;
  padding: 2px 8px;
}
.models-count.empty {
  background: rgba(232, 90, 90, 0.10);
  color: var(--error);
}
.model-card {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
.model-card.is-default {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.default-tag {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 1px 5px;
  border: 1px solid var(--accent);
  border-radius: 3px;
}
.icon-btn.danger {
  color: var(--text-muted);
}
.icon-btn.danger:hover:not(:disabled) {
  background: rgba(232, 90, 90, 0.10);
  color: var(--error);
}
.model-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.model-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.model-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.model-meta {
  font-size: 10px;
  color: var(--text-muted);
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
}
.model-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.icon-btn {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
}
.icon-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.models-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: 8px;
}
.models-empty p {
  font-size: 13px;
  margin: 0 0 6px;
}
.models-empty .hint {
  font-size: 11px;
  opacity: 0.8;
  margin: 0;
}

/* === Status bar === */
.provider-modal-status {
  flex-shrink: 0;
  padding: 8px 20px 0;
}
.local-error {
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--error);
  background: rgba(232, 90, 90, 0.10);
  color: var(--error);
  font-size: 12px;
  line-height: 1.5;
}
.endpoint-test-result {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
}
.endpoint-test-result.testing {
  background: var(--hover);
  color: var(--text-muted);
}
.endpoint-test-result.ok {
  background: rgba(80, 200, 120, 0.10);
  border: 1px solid var(--success);
  color: var(--success);
}
.endpoint-test-result.fail {
  background: rgba(232, 90, 90, 0.10);
  border: 1px solid var(--error);
  color: var(--error);
}
.test-response,
.test-error {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 6px;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 11px;
  word-break: break-all;
  flex: 1 1 100%;
  color: var(--text);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* === Footer === */
.provider-modal-footer {
  display: flex;
  gap: 8px;
  padding: 12px 20px 14px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  transition: all 0.12s;
}
.btn:hover:not(:disabled) {
  background: var(--hover);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn.primary {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.btn.primary:hover:not(:disabled) {
  opacity: 0.88;
}

/* === Modal transition === */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.15s ease;
}
.modal-enter-active .custom-provider-dialog,
.modal-leave-active .custom-provider-dialog {
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .custom-provider-dialog,
.modal-leave-to .custom-provider-dialog {
  transform: translateY(8px) scale(0.98);
  opacity: 0;
}
</style>
