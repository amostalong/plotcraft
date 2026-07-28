<script setup lang="ts">
// PlotCraft v0.1 Settings —— Locus-shape layout
//
// 布局参考 Locus `SettingsView.vue`：左侧分组导航 + 右侧内容切换
// - 跟 Locus 的差异：v0.1 只 2 个分组（LLM / General），内容面板也只 3 个
// - 改 settings 不直接落盘，要点底部"保存"才一次性写 config.json
//   （Locus 那边每改一字段就 emit 自己存；PlotCraft v0.1 简化成"编辑-保存"模型）

import { onMounted, ref, computed } from 'vue'
import { CheckCircle2, AlertCircle, Save, RotateCcw, Plug, Cpu, SlidersHorizontal } from 'lucide-vue-next'

import { useSettingsStore } from '@/stores/settings'
import ProvidersPanel from '@/components/settings/ProvidersPanel.vue'
import ModelDefaultsPanel from '@/components/settings/ModelDefaults.vue'
import GeneralSettingsPanel from '@/components/settings/GeneralSettings.vue'

const settings = useSettingsStore()
const justSaved = ref(false)

onMounted(async () => {
  await settings.init()
})

// activeCategory: 'api' | 'models' | 'general' —— 跟 Locus 同名风格
const activeCategory = ref<'api' | 'models' | 'general'>('api')

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
  <div class="settings-panel" v-if="settings.config">
    <!-- Sidebar: 分组导航（参考 Locus） -->
    <aside class="settings-sidebar">
      <div class="sidebar-nav">
        <!-- LLM group -->
        <div class="sidebar-group-label">LLM</div>
        <button
          class="sidebar-item"
          :class="{ active: activeCategory === 'api' }"
          @click="activeCategory = 'api'"
        >
          <Plug :size="14" />
          <span>Providers</span>
        </button>
        <button
          class="sidebar-item"
          :class="{ active: activeCategory === 'models' }"
          @click="activeCategory = 'models'"
        >
          <Cpu :size="14" />
          <span>Model Defaults</span>
        </button>

        <!-- General group -->
        <div class="sidebar-group-label">General</div>
        <button
          class="sidebar-item"
          :class="{ active: activeCategory === 'general' }"
          @click="activeCategory = 'general'"
        >
          <SlidersHorizontal :size="14" />
          <span>UI / Projects</span>
        </button>
      </div>
    </aside>

    <!-- Content: 切换 panel -->
    <main class="settings-content">
      <Transition name="fade" mode="out-in">
        <ProvidersPanel
          v-if="activeCategory === 'api'"
          key="api"
          v-model:base-url="settings.config.base_url"
          v-model:api-key="settings.config.apiKey"
          v-model:api-format="settings.config.apiFormat"
          v-model:custom-providers="settings.config.customProviders"
        />
        <ModelDefaultsPanel
          v-else-if="activeCategory === 'models'"
          key="models"
          v-model:model="settings.config.model"
        />
        <GeneralSettingsPanel
          v-else
          key="general"
          :ui="settings.config.ui"
          :recent-projects="settings.config.recentProjects"
        />
      </Transition>

      <!-- 底部 action bar（保存 / 重置 / 状态） -->
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
    </main>
  </div>
</template>

<style scoped>
.settings-panel {
  display: flex;
  height: 100%;
  background: var(--bg);
  color: var(--text);
}

/* --- Sidebar (Locus 风格) --- */
.settings-sidebar {
  width: 220px;
  flex-shrink: 0;
  background: var(--bg-elev);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 16px 0;
}
.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.sidebar-group-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  padding: 12px 16px 6px;
  opacity: 0.7;
}
.sidebar-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-left: 2px solid transparent;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  text-align: left;
  transition: all 0.12s;
}
.sidebar-item:hover {
  background: var(--hover);
  color: var(--text);
}
.sidebar-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  border-left-color: var(--accent);
  font-weight: 500;
}

/* --- Content --- */
.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
  min-width: 0;
}
.actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
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

/* --- Panel transition (Locus 风格 fade) --- */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.12s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
