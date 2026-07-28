<script setup lang="ts">
// API Providers / Connection panel（v0.1 Locus-shape subset）
//
// 跟 Locus 差别：
// - Locus `ApiProviders` 管多 provider 列表 + OAuth + Codex auth + keychain 索引
// - PlotCraft v0.1 是 single `baseUrl` + `apiKey`（v0.1 裸存；v0.2 升 keyring）
// - 字段位置跟 Locus `AppConfig` 顶层一致：`base_url` / `apiKey`
//   （Locus 把 apiKey 放 keychain 索引文件 `provider_key_ids.json` 里，PlotCraft 简化）

import { AlertTriangle } from 'lucide-vue-next'

// v-model:base-url + v-model:api-key 双向绑定
// 注意 prop 名是 kebab-case `base-url` / `api-key`，对应 JSON 字段 `base_url` / `apiKey`
const baseUrl = defineModel<string | null>('base-url', { required: true })
const apiKey = defineModel<string>('api-key', { required: true })
</script>

<template>
  <div class="api-providers">
    <h2>Connection</h2>
    <p class="hint">
      PlotCraft v0.1 走 OpenAI 兼容接口 —— 填 endpoint + API key 就能用。
      字段名 <code>base_url</code> / <code>apiKey</code> 跟 Locus <code>AppConfig</code> 顶层
      完全一致（<a href="https://github.com/amostalong/locus" target="_blank" rel="noopener">参考 Locus</a>）。
    </p>

    <div class="provider">
      <div class="provider-header">
        <span class="provider-name">openai-compatible</span>
        <span class="provider-tag">v0.1 唯一 provider</span>
      </div>

      <label>
        <span class="label-text">Endpoint (base_url)</span>
        <input
          v-model="baseUrl"
          type="text"
          placeholder="https://api.openai.com/v1"
        />
        <span class="field-hint">
          OpenAI 兼容 endpoint（OpenAI / DeepSeek / Qwen / Ollama / 自建 proxy 都行）
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
          v0.1 裸存在本地 <code>config.json</code> 顶层 <code>apiKey</code> 字段（自用风险可接受；
          v0.2 升 OS keyring）。Locus 走 keychain 索引（<code>provider_key_ids.json</code>），
          PlotCraft 这边简化。
        </span>
      </label>
    </div>
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
.hint a {
  color: var(--accent);
  text-decoration: none;
}
.hint a:hover {
  text-decoration: underline;
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
.provider-tag {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 6px;
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
</style>
