<script setup lang="ts">
// MessageBubble —— AI 面板单条消息气泡（user / assistant）
//
// v0.3+ 简化：去掉 per-message 的 "采用" / "写入编辑器" 按钮（统一改在 AiChatPanel
// 底部一个"整体采用"条采用本轮所有 AI 回复）。assistant message 仍按 msg.action
// 派生 header（"✨ 润色结果" / "🌱 扩展结果"），方便玩家看出这条是哪类输出。
//
// - assistant：useMarkdown 渲染 content（主线程同步 < 1ms）
// - user：preset 存在则显示 label（不渲染 markdown），否则显示 content
// - assistant.partial：末尾加「（回复中断）」marker
//
// 设计说明（v0.3 评审踩坑）：
// 不能用 `defineComponent({ setup() { return () => h(...) } })` 写法当 functional
// component，里面 useMarkdown 创建的 computed effect 找不到 instance scope 归属，
// 触发 Vue 3.5 `locateNonHydratedAsyncRoot(null)` 崩。所以走标准 .vue script setup +
// template 路线（跟 AltCard 同套路）。

import { computed } from 'vue'

import { useMarkdown } from '@/composables/useMarkdown'
import type { ChatMessage } from '@/types/chat'

const props = defineProps<{
  msg: ChatMessage
}>()

const isUser = computed(() => props.msg.role === 'user')
const isPreset = computed(() => !!props.msg.preset)
const userLabel = computed(() => props.msg.preset ?? props.msg.content)
const html = useMarkdown(computed(() => props.msg.content))

/** assistant 消息的 action header（无 action → null）*/
const actionHeader = computed(() => {
  if (isUser.value) return null
  if (props.msg.action === 'polish') return '✨ 润色结果'
  if (props.msg.action === 'expand') return '🌱 扩展结果'
  return null
})
</script>

<template>
  <div
    class="bubble"
    :class="{
      user: isUser,
      assistant: !isUser,
      preset: isPreset,
      polish: msg.action === 'polish',
      expand: msg.action === 'expand',
    }"
  >
    <div v-if="isUser" class="bubble-body">{{ userLabel }}</div>
    <template v-else>
      <div v-if="actionHeader" class="action-header">{{ actionHeader }}</div>
      <div
        class="bubble-body markdown"
        v-html="html + (msg.partial ? '<span class=\'partial-mark\'>（回复中断）</span>' : '')"
      />
    </template>
  </div>
</template>

<style scoped>
.bubble {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
}
.bubble.user {
  align-self: flex-end;
  background: var(--accent-soft);
  color: var(--text);
  max-width: 90%;
}
.bubble.user.preset {
  /* preset 触发的 user 消息：浅一点 + italic，区分"AI 自动发的" vs "玩家手输入" */
  opacity: 0.85;
  font-style: italic;
}
.bubble.assistant {
  align-self: flex-start;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  max-width: 100%;
}
/* v0.3+ 润色 / 扩展结果气泡的左边色条（区别于普通反思气泡）*/
.bubble.assistant.polish,
.bubble.assistant.expand {
  border-left: 3px solid var(--accent);
  padding-left: 8px;
}
.action-header {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 2px;
  letter-spacing: 0.3px;
}
.bubble-body {
  word-break: break-word;
}
.bubble-body :deep(p) {
  margin: 0 0 6px;
}
.bubble-body :deep(p:last-child) {
  margin-bottom: 0;
}
.bubble-body :deep(ul),
.bubble-body :deep(ol) {
  margin: 0 0 6px;
  padding-left: 18px;
}
.partial-mark {
  color: var(--text-muted);
  font-size: 11px;
  margin-left: 6px;
}
</style>
