<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { CheckCircle2, AlertCircle, Save, RotateCcw } from 'lucide-vue-next'

import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()

const justSaved = ref(false)

onMounted(async () => {
  await settings.init()
})

const dirty = computed(() => settings.config !== null)

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

    <section class="block">
      <h3>LLM</h3>
      <p class="hint">API key 存在本地 config.json（v0.1 裸存，自用风险可接受；v0.2 升 keyring）</p>

      <label>
        <span class="label-text">Endpoint</span>
        <input
          v-model="settings.config.llm.endpoint"
          type="text"
          placeholder="https://api.openai.com/v1"
        />
      </label>

      <label>
        <span class="label-text">API Key</span>
        <input
          v-model="settings.config.llm.api_key"
          type="password"
          placeholder="sk-..."
          autocomplete="off"
        />
      </label>

      <label>
        <span class="label-text">Model</span>
        <input
          v-model="settings.config.llm.model"
          type="text"
          placeholder="gpt-4o-mini"
        />
      </label>
    </section>

    <section class="block">
      <h3>UI</h3>
      <label>
        <span class="label-text">主题</span>
        <select v-model="settings.config.ui.theme">
          <option value="dark">深色 (dark)</option>
          <option value="light" disabled>浅色 (v0.2 实装)</option>
        </select>
      </label>
    </section>

    <section v-if="settings.config.recent_projects.length > 0" class="block">
      <h3>最近项目 ({{ settings.config.recent_projects.length }})</h3>
      <ul class="recent">
        <li v-for="(p, i) in settings.config.recent_projects" :key="i">
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
  max-width: 640px;
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
