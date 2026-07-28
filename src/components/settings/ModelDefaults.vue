<script setup lang="ts">
// Model Defaults panel（v0.1 Locus-shape subset）
//
// 字段位置：Locus `AppConfig.model` 顶层 string —— PlotCraft 这边绑 `model` prop
// （Locus 那边的 `ModelDefaults` 包含 mainModel / planModel / subagentModels，
// PlotCraft v0.1 只用 mainModel = `AppConfig.model`）
//
// 交互：
// - input + datalist：打字有自动补全建议，鼠标选也行
// - 下方显示当前 model 的 context window + note（找不到 = "custom"）
// - "重置为默认" 按钮：model 设回 BUILTIN_MODELS 里 isDefault 那个（gpt-4o-mini）

import { computed } from 'vue'
import { Cpu, RotateCcw, AlertCircle } from 'lucide-vue-next'
import { BUILTIN_MODELS, DEFAULT_MAIN_MODEL, findModel, formatContextWindow } from '@/lib/modelCatalog'

// v-model:model 双向绑定（Vue 3.4+ defineModel）
const model = defineModel<string>('model', { required: true })

const DATALIST_ID = 'plotcraft-builtin-models'

const currentModel = computed(() => findModel(model.value))
const isCustom = computed(() => !currentModel.value && model.value.length > 0)

function onResetToDefault() {
  model.value = DEFAULT_MAIN_MODEL
}
</script>

<template>
  <div class="model-defaults">
    <h2>Model Defaults</h2>
    <p class="hint">
      PlotCraft <code>config.json</code> 顶层 <code>model</code> 字段（跟 Locus
      <code>AppConfig.model</code> 同位）。v0.1 走玩家自填 / 内置 catalog 二选一。
      v0.2+ 加 Locus-style 远端 catalog + subagent / plan model 再说。
    </p>

    <div class="section">
      <div class="section-header">
        <Cpu :size="14" />
        <span class="section-title">mainModel</span>
      </div>
      <p class="section-desc">
        主模型 —— Chat tab 默认调用的模型。修改后下次发消息生效。
      </p>

      <label>
        <span class="label-text">Model ID（选 / 打字都行）</span>
        <input
          v-model="model"
          type="text"
          :list="DATALIST_ID"
          placeholder="gpt-4o-mini"
        />
        <datalist :id="DATALIST_ID">
          <option v-for="m in BUILTIN_MODELS" :key="m.id" :value="m.id">
            {{ m.name }} — {{ formatContextWindow(m.contextWindow) }}{{ m.isDefault ? ' (默认)' : '' }}
          </option>
        </datalist>
      </label>

      <div v-if="currentModel" class="model-info">
        <span class="model-name">{{ currentModel.name }}</span>
        <span class="model-ctx">context: {{ formatContextWindow(currentModel.contextWindow) }}</span>
        <span v-if="currentModel.note" class="model-note">{{ currentModel.note }}</span>
      </div>
      <div v-else-if="isCustom" class="model-info custom">
        <AlertCircle :size="12" />
        <span class="model-name">自定义 model</span>
        <span class="model-note">不在内置列表 —— 走玩家自建 endpoint 时正常</span>
      </div>
      <div v-else class="model-info">
        <span class="model-note">未填写 —— 发消息前需要填一个 model</span>
      </div>

      <div class="actions">
        <button
          @click="onResetToDefault"
          class="reset"
          :disabled="model === DEFAULT_MAIN_MODEL"
        >
          <RotateCcw :size="12" />
          <span>重置为默认（{{ DEFAULT_MAIN_MODEL }}）</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.model-defaults {
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
.hint code {
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
}
.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.section-title {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
}
.section-desc {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 12px;
  line-height: 1.4;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
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
.model-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 10px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  margin-bottom: 10px;
}
.model-info.custom {
  background: rgba(232, 90, 90, 0.08);
  border-color: var(--error);
  color: var(--text-muted);
}
.model-name {
  font-weight: 500;
  color: var(--accent);
}
.model-ctx {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  color: var(--text-muted);
  padding: 1px 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 11px;
}
.model-note {
  color: var(--text-muted);
  font-size: 11px;
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.reset {
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
.reset:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.reset:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
