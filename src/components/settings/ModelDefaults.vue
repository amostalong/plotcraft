<script setup lang="ts">
// Model Defaults panel（v0.1 Locus-shape subset）
//
// Locus `ModelDefaults` 是个复杂组件：主模型 / 计划模型 / subagent 模型 / 工作区覆盖
// + workspace override + agent / subagent 选择。PlotCraft v0.1 只用 mainModel，
// 玩家手填模型名（不拉 model catalog）。
//
// v0.2+ 加 planModel / subagentModels 时这个 component 加对应 section 即可。

import { Cpu } from 'lucide-vue-next'
import type { ModelDefaults } from '@/lib/settings'

defineProps<{
  modelDefaults: ModelDefaults
}>()
</script>

<template>
  <div class="model-defaults">
    <h2>Model Defaults</h2>
    <p class="hint">
      玩家手填模型名（v0.1 暂不拉 model catalog，schema 留位）。
      v0.2+ 加 <code>planModel</code> / <code>subagentModels</code> 时这里加对应 section。
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
        <span class="label-text">Model ID</span>
        <input
          v-model="modelDefaults.mainModel"
          type="text"
          placeholder="gpt-4o-mini"
        />
      </label>
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
}
.label-text {
  font-size: 12px;
  color: var(--text-muted);
}
label input {
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
}
label input:focus {
  outline: none;
  border-color: var(--accent);
}
</style>
