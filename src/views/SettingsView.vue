<script setup lang="ts">
// PlotCraft v0.1 Settings —— Locus-shape layout
//
// 布局参考 Locus `SettingsView.vue`：左侧分组导航 + 右侧内容切换
// - 跟 Locus 的差异：v0.1 只 3 个分组（LLM / General / 控制台）
//
// v0.1.5+：所有 settings 改动自动落盘（v0.1.4 之前是"编辑-保存"模型，
// 玩家要点底部"保存"按钮才写 config.json；现在 modal / theme / provider toggle
// / 删除 / import 等都直接 settings.save()）。底部"保存"按钮已删，
// 只剩"重置"按钮（显式操作）。

import { onMounted, ref } from 'vue'
import { AlertCircle, RotateCcw, Plug, SlidersHorizontal, Terminal } from 'lucide-vue-next'

import { useSettingsStore } from '@/stores/settings'
import ProvidersPanel from '@/components/settings/ProvidersPanel.vue'
import GeneralSettingsPanel from '@/components/settings/GeneralSettings.vue'
import ConsoleSettings from '@/components/settings/ConsoleSettings.vue'

const settings = useSettingsStore()

onMounted(async () => {
  await settings.init()
})

// activeCategory: 'api' | 'general' | 'console' —— v0.1.5+ 加 'console'
// （active model 切换完全在 chat tab model selector，settings 只管 provider 库）
const activeCategory = ref<'api' | 'general' | 'console'>('api')

async function onReset() {
  if (window.confirm('确定要重置为默认配置吗？这不会清空项目列表。')) {
    settings.reset()
    // v0.1.5+ 重置立即落盘（Settings 底部"保存"按钮已删）
    try {
      await settings.save()
      console.log('[SettingsView] config reset to default')
    } catch (e) {
      console.error('[SettingsView] reset save failed:', e)
    }
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
        <button
          class="sidebar-item"
          :class="{ active: activeCategory === 'console' }"
          @click="activeCategory = 'console'"
        >
          <Terminal :size="14" />
          <span>控制台</span>
        </button>
      </div>
    </aside>

    <!-- Content: 切换 panel -->
    <main class="settings-content">
      <Transition name="fade" mode="out-in">
        <ProvidersPanel
          v-if="activeCategory === 'api'"
          key="api"
          v-model:custom-providers="settings.config.customProviders"
        />
        <GeneralSettingsPanel
          v-else-if="activeCategory === 'general'"
          key="general"
          :ui="settings.config.ui"
          :recent-projects="settings.config.recentProjects"
        />
        <ConsoleSettings v-else-if="activeCategory === 'console'" key="console" />
      </Transition>

      <!-- 底部 action bar（v0.1.5+ 只剩 重置 + 错误状态，"保存"按钮已删） -->
      <div class="actions">
        <button @click="onReset">
          <RotateCcw :size="16" />
          <span>重置</span>
        </button>
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
