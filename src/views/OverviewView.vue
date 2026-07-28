<script setup lang="ts">
import { LayoutDashboard } from 'lucide-vue-next'
</script>

<template>
  <div class="placeholder">
    <LayoutDashboard :size="48" :stroke-width="1.5" />
    <h2>概览</h2>
    <p>项目摘要 / 最近修改 / AI 操作历史</p>
    <p class="version">v0.2 实装</p>
  </div>
</template>

<style scoped>
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: var(--text-muted);
}
.placeholder h2 {
  font-size: 18px;
  font-weight: 500;
  color: var(--text);
  margin-top: 8px;
}
.placeholder p {
  font-size: 13px;
}
.placeholder .version {
  margin-top: 16px;
  font-size: 11px;
  color: var(--accent);
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
}
</style>
