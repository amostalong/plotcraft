<script setup lang="ts">
// General Settings panel
//
// v0.1 实装：UI 主题 / 最近项目展示
// v0.2+ 加：DisplaySettings（字体 / 字号）/ NotificationsSettings / 等
// （参考 Locus 但只取 PlotCraft 实际需要的）

import { SlidersHorizontal, Clock } from 'lucide-vue-next'
import type { UiConfig } from '@/lib/settings'

defineProps<{
  ui: UiConfig
  recentProjects: string[]
}>()
</script>

<template>
  <div class="general-settings">
    <h2>General</h2>
    <p class="hint">
      PlotCraft 通用设置。v0.2+ 在这加 Display / Notifications / Shortcuts 等 section。
    </p>

    <!-- UI section -->
    <div class="section">
      <div class="section-header">
        <SlidersHorizontal :size="14" />
        <span class="section-title">UI</span>
      </div>
      <label>
        <span class="label-text">主题</span>
        <select v-model="ui.theme">
          <option value="dark">深色 (dark)</option>
          <option value="light" disabled>浅色 (v0.2 实装)</option>
        </select>
      </label>
    </div>

    <!-- Recent Projects section -->
    <div v-if="recentProjects.length > 0" class="section">
      <div class="section-header">
        <Clock :size="14" />
        <span class="section-title">最近项目 ({{ recentProjects.length }})</span>
      </div>
      <p class="section-desc">
        v0.1 自动记录的最近打开项目路径（v0.2 加一键恢复 / 移除单条 / 排序）。
      </p>
      <ul class="recent">
        <li v-for="(p, i) in recentProjects" :key="i">
          <code>{{ p }}</code>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.general-settings {
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
.section {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px 16px;
  background: var(--bg);
  margin-bottom: 12px;
}
.section:last-child {
  margin-bottom: 0;
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
  margin-bottom: 10px;
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
label select {
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
}
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
  background: var(--bg-elev);
  padding: 4px 8px;
  border-radius: 3px;
  border: 1px solid var(--border);
  display: block;
  word-break: break-all;
}
</style>
