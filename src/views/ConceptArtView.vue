<script setup lang="ts">
import { ImageIcon } from 'lucide-vue-next'
</script>

<template>
  <div class="placeholder">
    <ImageIcon :size="48" :stroke-width="1.5" />
    <h2>设定图</h2>
    <p>占位图 + 提示词</p>
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
