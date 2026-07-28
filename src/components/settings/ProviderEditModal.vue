<script setup lang="ts">
// ProviderEditModal —— 玩家添加 / 编辑 custom provider 的弹窗
//
// 视觉 + 交互镜像 Locus `CustomProviderModal.vue`（AGENTS.md 硬规则 #1：结构对齐，代码自写）：
// - 1080×720 modal 居中浮层
// - 左 320px：connection 字段（API Key / ID / Display Name / Endpoint / API Format / Default Model）
// - 右 flex：model 列表（v0.1 简化：单个 defaultModel card，Locus 同款但少了多 model 增删）
// - 中间状态条：local error + test result（连接成功 / 失败 + 错误码 + 模型返回片段）
// - Footer：保存 / 测试 / 取消
//
// v0.1 简化（vs Locus）：
// - 没有 catalog "从模型库添加" wizard（v0.2+ 接 models.dev snapshot 再说）
// - 没有 per-provider 多 model 增删（只有 1 个 defaultModel）
// - ID 编辑模式不允许改（Locus 允许但我们 v0.1 直接锁）
// - 字段 label hardcode 英文（v0.1 不上 vue-i18n）

import { computed, ref, watch } from 'vue'
import {
  CheckCircle2,
  Loader2,
  Save,
  Trash2,
  X,
  XCircle,
  Zap,
} from 'lucide-vue-next'

import type { CustomProvider, ApiFormat } from '@/lib/settings'
import { API_FORMAT_LABELS, DEFAULT_API_FORMAT } from '@/lib/settings'
import { testProvider, type TestProviderResult } from '@/lib/llm'

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
const draftDefaultModel = ref('')

// === UI state ===
const localError = ref<string | null>(null)
const testRunning = ref(false)
const testResult = ref<TestProviderResult | null>(null)
const saving = ref(false)

/** 初始化 draft 当 provider prop 变化 */
watch(
  () => props.provider,
  (p) => {
    if (p) {
      draftId.value = p.id
      draftName.value = p.name
      draftEndpoint.value = p.baseUrl
      draftApiKey.value = p.apiKey
      draftApiFormat.value = p.apiFormat
      draftEnabled.value = p.enabled
      draftDefaultModel.value = p.defaultModel
    }
    localError.value = null
    testResult.value = null
    testRunning.value = false
    saving.value = false
  },
  { immediate: true },
)

const dialogTitle = computed(() =>
  props.isNew ? '添加供应商' : `编辑 "${props.provider?.name ?? ''}"`,
)

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
  if (!draftDefaultModel.value.trim()) {
    // v0.1 不强 block，但 warning 一下
    localError.value = 'Default Model 留空 → 该 provider 不会出现在 chat selector（建议填一个）'
    return false
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
    defaultModel: draftDefaultModel.value.trim(),
  }
  emit('save', newProvider)
  saving.value = false
}

async function onTest() {
  if (!draftEndpoint.value.trim() || !draftApiFormat.value || !draftDefaultModel.value.trim()) {
    testResult.value = {
      ok: false,
      error: 'Endpoint + API Format + Default Model 三个都得填',
      endpoint: draftEndpoint.value,
      model: draftDefaultModel.value,
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
      model: draftDefaultModel.value,
    })
  } catch (e) {
    testResult.value = {
      ok: false,
      error: String(e),
      endpoint: draftEndpoint.value,
      model: draftDefaultModel.value,
      apiFormat: draftApiFormat.value,
    }
  } finally {
    testRunning.value = false
  }
}

function onClose() {
  emit('close')
}

function onDeleteDefaultModel() {
  draftDefaultModel.value = ''
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
            <span class="provider-modal-title">{{ dialogTitle }}</span>
          </div>
          <button class="close-btn" type="button" :disabled="saving" @click="onClose">
            <X :size="14" />
          </button>
        </div>

        <!-- Body: 2 栏（左 connection，右 model） -->
        <div class="config-body">
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

            <div class="config-field">
              <label class="config-label">Default Model（chat 默认用）</label>
              <input
                v-model="draftDefaultModel"
                class="config-input"
                :class="{ invalid: localError && localError.includes('Default Model') }"
                type="text"
                :disabled="saving"
                placeholder="claude-sonnet-4-5"
                spellcheck="false"
              />
              <span class="field-hint">留空 → 该 provider 不出现在 chat selector</span>
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

          <!-- Right: model list (v0.1 简化：单 model card) -->
          <section class="config-main">
            <div class="models-header">
              <span class="models-title">Model</span>
              <span v-if="draftDefaultModel" class="models-count">已添加 1 个</span>
              <span v-else class="models-count empty">未添加</span>
            </div>
            <div v-if="draftDefaultModel" class="model-card">
              <div class="model-info">
                <div class="model-name-row">
                  <span class="model-name">{{ draftDefaultModel }}</span>
                  <code class="model-meta">128K ctx</code>
                </div>
                <div class="model-actions">
                  <button
                    class="icon-btn"
                    type="button"
                    title="删除 default model"
                    :disabled="saving"
                    @click="onDeleteDefaultModel"
                  >
                    <Trash2 :size="12" />
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="models-empty">
              <p>还没有 default model —— 左边填一个</p>
              <p class="hint">
                PlotCraft v0.1 简化：每个 provider 1 个 default model（Locus 那个多 model 增删 v0.2+ 再加）
              </p>
            </div>
          </section>
        </div>

        <!-- Status bar: local error + test result -->
        <div v-if="localError || testResult || testRunning" class="provider-modal-status">
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

        <!-- Footer: Save / Test / Cancel -->
        <div class="provider-modal-footer">
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
