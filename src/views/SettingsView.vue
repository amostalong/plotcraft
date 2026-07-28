<script setup lang="ts">
import { Settings as SettingsIcon } from 'lucide-vue-next'
</script>

<template>
  <div class="placeholder">
    <SettingsIcon :size="48" :stroke-width="1.5" />
    <h2>设置</h2>
    <p>API key / endpoint / model / 主题 / 最近项目</p>
    <p class="version">commit 6 实装</p>
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
