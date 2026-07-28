<script setup lang="ts">
// Model Defaults panel（v0.1 Locus-shape subset + built-in catalog）
//
// 跟 Locus 差别：
// - Locus `ModelDefaults` 拉远端 catalog + 处理 subagent / plan model / workspace override
// - PlotCraft v0.1 用本地静态 `BUILTIN_MODELS`（OpenAI 兼容子集），HTML <datalist> 给
//   玩家自动补全 —— 选/手填都行。v0.2+ 走远端 fetch + snapshot 缓存时改 `modelCatalog` 字段
//
// 交互：
// - input + datalist：打字有下拉建议，鼠标选也行；输入框可写任何 model id
// - 下方显示当前 model 的 context window + note（lookup from catalog，找不到显示 "custom"）
// - "重置为默认" 按钮：把 mainModel 设回 BUILTIN_MODELS 里 isDefault 那个

import { computed, ref, watch } from 'vue'
import { Cpu, RotateCcw, AlertCircle } from 'lucide-vue-next'
import type { ModelDefaults } from '@/lib/settings'
import { BUILTIN_MODELS, DEFAULT_MAIN_MODEL, findModel, formatContextWindow } from '@/lib/modelCatalog'

const props = defineProps<{
  modelDefaults: ModelDefaults
}>()

const DATALIST_ID = 'plotcraft-builtin-models'

// 当前 mainModel 在 catalog 里吗？找不到 → 显示 "custom" 提示
const currentModel = computed(() => findModel(props.modelDefaults.mainModel))
const isCustom = computed(() => !currentModel.value && props.modelDefaults.mainModel.length > 0)

function onResetToDefault() {
  props.modelDefaults.mainModel = DEFAULT_MAIN_MODEL
}
</script>

<template>
  <div class="model-defaults">
    <h2>Model Defaults</h2>
    <p class="hint">
      玩家可选内置 model 或手填任意 model id（v0.1 用 HTML <code>&lt;datalist&gt;</code> 自动补全）。
      v0.2+ 改走远端 fetch + snapshot 缓存 —— schema 留了 <code>modelCatalog</code> 字段。
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
          v-model="modelDefaults.mainModel"
          type="text"
          :list="DATALIST_ID"
          placeholder="gpt-4o-mini"
        />
        <datalist :id="DATALIST_ID">
          <option
            v-for="m in BUILTIN_MODELS"
            :key="m.id"
            :value="m.id"
          >
            {{ m.name }} — {{ formatContextWindow(m.contextWindow) }}{{ m.isDefault ? ' (默认)' : '' }}
          </option>
        </datalist>
      </label>

      <!-- 当前 model 信息：context window + note（找不到 = custom） -->
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
        <button @click="onResetToDefault" class="reset" :disabled="modelDefaults.mainModel === DEFAULT_MAIN_MODEL">
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
