<script setup lang="ts">
import { RouterView, useRoute, useRouter } from 'vue-router'
import { Globe, Users, BookOpen, Lightbulb, ImageIcon, MessageSquare, Settings as SettingsIcon } from 'lucide-vue-next'
import { computed, type Component } from 'vue'

const route = useRoute()
const router = useRouter()

interface Tab {
  name: string
  path: string
  icon: Component
}

// Tab 顺序 = 创作流水线顺序（2026-07-30 用户决策：概念是第一步，放最前）
// - 概念（宪法）→ 世界 → 人物 → 剧情 → 设定图，会话/设置殿后
// - 路由层 `path: '/'` → `redirect: '/session'` 不变：新建/打开项目在会话 tab，
//   默认落地页仍是会话（fresh app 无项目时概念 tab 只有空态）
// - 概览 tab 已摘除（2026-07-30 决策"概览最后设计"；路由 + OverviewView 保留，将来加回来）
// - 人物 / 剧情 placeholder 保留可见（v0.3+ 实装信号）
const tabs: readonly Tab[] = [
  { name: '概念', path: '/concept', icon: Lightbulb },
  { name: '世界', path: '/world', icon: Globe },
  { name: '人物', path: '/characters', icon: Users },
  { name: '剧情', path: '/plot', icon: BookOpen },
  { name: '设定图', path: '/art', icon: ImageIcon },
  { name: '会话', path: '/session', icon: MessageSquare },
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
