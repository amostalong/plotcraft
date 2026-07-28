<script setup lang="ts">
import { RouterView, useRoute, useRouter } from 'vue-router'
import { Home, Globe, Users, BookOpen, ImageIcon, MessageSquare, Settings as SettingsIcon } from 'lucide-vue-next'
import { computed } from 'vue'

const route = useRoute()
const router = useRouter()

interface Tab {
  name: string
  path: string
  icon: typeof Home
}

// Tab 顺序：会话置首（参考 Locus：chat 是默认落地页）
// - 路由层 `path: '/'` → `redirect: '/session'` 已经把默认页设到 chat
// - 这里把 tab bar 顺序也跟上来，开窗即见 chat
// - 5 个 placeholder 保留可见（v0.2 实装信号）
const tabs: readonly Tab[] = [
  { name: '会话', path: '/session', icon: MessageSquare },
  { name: '概览', path: '/overview', icon: Home },
  { name: '世界', path: '/world', icon: Globe },
  { name: '人物', path: '/characters', icon: Users },
  { name: '剧情', path: '/plot', icon: BookOpen },
  { name: '设定图', path: '/art', icon: ImageIcon },
  { name: '设置', path: '/settings', icon: SettingsIcon },
] as const

const activeTab = computed(() => tabs.find((t) => route.path.startsWith(t.path)))
</script>

<template>
  <div class="app">
    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.path"
        :class="['tab', { active: activeTab?.path === tab.path }]"
        @click="router.push(tab.path)"
      >
        <component :is="tab.icon" :size="16" />
        <span>{{ tab.name }}</span>
      </button>
    </nav>
    <main class="view">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
  color: var(--text);
}
.tab-bar {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
  font-family: inherit;
}
.tab:hover {
  background: var(--hover);
  color: var(--text);
}
.tab.active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent);
}
.view {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
</style>
