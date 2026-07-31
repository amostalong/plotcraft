<script setup lang="ts">
// AltCard —— AI 备选卡片（独立 .vue 版，从 v0.2 AlternativesPicker 抽出）
//
// - props.text = 单条备选文本（markdown 渲染，emit 'adopt' 传回去）
// - **v0.4+** props.title / props.description：v0.4+ ask_user_question tool 给的 label + description
//   - title 显示在 header（10 字内短标题）
//   - description 显示在 title 下的小字（hover tooltip 也有）
//   - 老路径（v0.3+ JSON 解析）不传 title/description，header 不显示
// - emit('adopt', text) → view 层写入编辑器（替换模式）
// - 自带样式（不再依赖父组件 :deep），AiChatPanel 直接 <AltCard ... />
// - useMarkdown 在 setup 调一次，v0.1 markdown 渲染主线程同步（< 1ms）

import { toRef } from 'vue'

import { useMarkdown } from '@/composables/useMarkdown'

const props = defineProps<{
  text: string
  /** v0.4+ ask_user_question option.label —— 显示在 header */
  title?: string
  /** v0.4+ ask_user_question option.description —— 显示在 title 下 + hover tooltip */
  description?: string
}>()
const emit = defineEmits<{ adopt: [text: string] }>()

const html = useMarkdown(toRef(props, 'text'))

function onAdopt() {
  emit('adopt', props.text)
}
</script>

<template>
  <div class="alt-card">
    <div v-if="title || description" class="alt-header">
      <div v-if="title" class="alt-title">{{ title }}</div>
      <div v-if="description" class="alt-description" :title="description">{{ description }}</div>
    </div>
    <div class="alt-body markdown" v-html="html" />
    <button class="adopt-btn" type="button" @click="onAdopt">采用</button>
  </div>
</template>

<style scoped>
.alt-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.alt-card:hover {
  border-color: var(--accent);
}
.alt-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.alt-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
}
.alt-description {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.alt-body {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text);
  word-break: break-word;
}
.alt-body :deep(p) {
  margin: 0 0 6px;
}
.alt-body :deep(p:last-child) {
  margin-bottom: 0;
}
.alt-body :deep(ul),
.alt-body :deep(ol) {
  margin: 0 0 6px;
  padding-left: 18px;
}
.adopt-btn {
  align-self: flex-end;
  padding: 3px 10px;
  background: transparent;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
}
.adopt-btn:hover {
  background: var(--accent-soft);
}
</style>
