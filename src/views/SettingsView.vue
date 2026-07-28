<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { CheckCircle2, AlertCircle, Save, RotateCcw, Power, PowerOff } from 'lucide-vue-next'

import { useSettingsStore } from '@/stores/settings'
import type { ProviderConfig } from '@/lib/settings'

const settings = useSettingsStore()

const justSaved = ref(false)

onMounted(async () => {
  await settings.init()
})

const dirty = computed(() => settings.config !== null)

// v0.1 固定只显示 `openai` provider（hardcoded）—— v0.2+ 多 provider 改成 v-for
// 用 computed 拿 openai 引用（settings.config.providers.openai 可能 undefined，如果用户手改了 config.json）
const openaiProvider = computed<ProviderConfig | null>(() => {
  return settings.config?.providers?.openai ?? null
})

async function onSave() {
  try {
    await settings.save()
    justSaved.value = true
    setTimeout(() => (justSaved.value = false), 2000)
  } catch {
    // error 已经在 store 里
  }
}

function onReset() {
  if (window.confirm('确定要重置为默认配置吗？这不会清空项目列表。')) {
    settings.reset()
  }
}
</script>

<template>
  <div class="settings">
    <h2>设置</h2>

    <!-- Providers: 跟 Locus 同构（多 provider dict，v0.1 hardcoded openai） -->
    <section class="block">
      <h3>LLM Providers</h3>
      <p class="hint">
        API key 存在本地 config.json（v0.1 裸存，自用风险可接受；v0.2 升 keyring）。
        v0.1 仅实装 <code>openai</code> 一个 provider —— 跟 Locus 一样走多 provider 结构，
        v0.2+ 加 Claude / Gemini 时直接加 key，不用动 schema。
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
        </label>
      </div>

      <p v-else class="empty">
        openai provider 未配置 —— 试试"重置"按钮恢复默认。
      </p>
    </section>

    <!-- Model Defaults: 跟 Locus `ModelDefaults` 对齐（v0.1 只 mainModel） -->
    <section class="block">
      <h3>Model Defaults</h3>
      <p class="hint">
        v0.1 只用 <code>mainModel</code>。v0.2+ 加 <code>planModel</code> / <code>subagentModels</code>。
      </p>

      <label>
        <span class="label-text">mainModel</span>
        <input
          v-if="settings.config"
          v-model="settings.config.modelDefaults.mainModel"
          type="text"
          placeholder="gpt-4o-mini"
        />
      </label>
    </section>

    <!-- UI: 主题（v0.1 只 dark） -->
    <section class="block">
      <h3>UI</h3>
      <label>
        <span class="label-text">主题</span>
        <select v-if="settings.config" v-model="settings.config.ui.theme">
          <option value="dark">深色 (dark)</option>
          <option value="light" disabled>浅色 (v0.2 实装)</option>
        </select>
      </label>
    </section>

    <section v-if="settings.config && settings.config.recentProjects.length > 0" class="block">
      <h3>最近项目 ({{ settings.config.recentProjects.length }})</h3>
      <ul class="recent">
        <li v-for="(p, i) in settings.config.recentProjects" :key="i">
          <code>{{ p }}</code>
        </li>
      </ul>
    </section>

    <div class="actions">
      <button @click="onSave" :disabled="settings.saving" class="primary">
        <Save :size="16" />
        <span>{{ settings.saving ? '保存中...' : '保存' }}</span>
      </button>
      <button @click="onReset">
        <RotateCcw :size="16" />
        <span>重置</span>
      </button>
      <div v-if="justSaved" class="success">
        <CheckCircle2 :size="16" />
        <span>已保存</span>
      </div>
      <div v-if="settings.error" class="error">
        <AlertCircle :size="16" />
        <span>{{ settings.error }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px;
  color: var(--text);
}
.settings h2 {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 24px;
}
.block {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 16px;
}
.block h3 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--accent);
}
.hint {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 12px;
  line-height: 1.5;
}
.hint code {
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
  padding: 12px 14px;
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
.empty {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
  margin: 0;
  padding: 8px 0;
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
label input,
label select {
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
}
label input:focus,
label select:focus {
  outline: none;
  border-color: var(--accent);
}
.recent {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.recent li code {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 12px;
  color: var(--text-muted);
  background: var(--bg);
  padding: 4px 8px;
  border-radius: 3px;
  border: 1px solid var(--border);
  display: block;
  word-break: break-all;
}
.actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.actions button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
}
.actions button:hover {
  background: var(--hover);
  color: var(--text);
}
.actions button.primary {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.actions button.primary:hover {
  opacity: 0.85;
}
.actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.success {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--success);
}
.error {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--error);
}
</style>
