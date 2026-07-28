<script setup lang="ts">
// API Providers panel（v0.1 Locus-shape subset）
//
// Locus 那边 `<ApiProviders>` 是个 700+ 行的庞然大物：管所有 provider 列表 + OAuth +
// Codex + model catalog 拉取。PlotCraft v0.1 只 hardcoded `openai` 一个 provider，
// 暂不做 OAuth / 模型目录 / 自定义 provider —— schema 留位，UI 简化。
//
// 跟 Locus 的差别：
// - 玩家编辑不直接落盘，要点 SettingsView 顶部的"保存"才一次性写 config.json
// - v0.1 只显示 openai，v0.2+ 加 provider 时这个 component 改 v-for 即可

import { computed } from 'vue'
import { Power, PowerOff, AlertTriangle } from 'lucide-vue-next'
import type { ProviderConfig } from '@/lib/settings'

const props = defineProps<{
  providers: Record<string, ProviderConfig>
}>()

// v0.1 固定只显示 openai（hardcoded）
// v0.2+ 改成 v-for 渲染 props.providers
const openaiProvider = computed<ProviderConfig | null>(() => {
  return props.providers['openai'] ?? null
})
</script>

<template>
  <div class="api-providers">
    <h2>API Providers</h2>
    <p class="hint">
      v0.1 仅实装 <code>openai</code> 一个 provider（OpenAI 兼容接口）。
      v0.2+ 加 Claude / Gemini 等 —— schema 已留位（<code>providers</code> dict），
      这个 panel 改成 <code>v-for</code> 即可。
    </p>

    <div v-if="openaiProvider" class="provider">
      <div class="provider-header">
        <span class="provider-name">openai</span>
        <label class="enabled-toggle">
          <input v-model="openaiProvider.enabled" type="checkbox" />
          <Power v-if="openaiProvider.enabled" :size="14" />
          <PowerOff v-else :size="14" />
          <span>{{ openaiProvider.enabled ? '已启用' : '已禁用' }}</span>
        </label>
      </div>

      <label>
        <span class="label-text">Endpoint</span>
        <input
          v-model="openaiProvider.endpoint"
          type="text"
          placeholder="https://api.openai.com/v1"
        />
      </label>

      <label>
        <span class="label-text">API Key</span>
        <input
          v-model="openaiProvider.apiKey"
          type="password"
          placeholder="sk-..."
          autocomplete="off"
        />
        <span class="field-hint">
          <AlertTriangle :size="12" />
          v0.1 裸存在本地 config.json（自用风险可接受；v0.2 升 keyring）
        </span>
      </label>
    </div>

    <p v-else class="empty">
      openai provider 未配置 —— 试试点 Settings 顶部的"重置"。
    </p>
  </div>
</template>

<style scoped>
.api-providers {
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
.provider {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px 16px;
  background: var(--bg);
}
.provider-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.provider-name {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
}
.enabled-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  flex-direction: row;
  margin-bottom: 0;
}
.enabled-toggle input {
  margin: 0;
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
.field-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}
.empty {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
  padding: 16px;
  text-align: center;
  background: var(--bg);
  border: 1px dashed var(--border);
  border-radius: 6px;
  margin: 0;
}
</style>
