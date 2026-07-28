<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { AlertCircle, Bot, Send, Square, User as UserIcon } from 'lucide-vue-next'

import { useChatStore } from '@/stores/chat'
import { renderMarkdown } from '@/lib/markdown'

const chat = useChatStore()

const input = ref('')
const transcriptEl = ref<HTMLElement | null>(null)

const messages = computed(() => chat.state.messages)
const currentText = computed(() => chat.state.currentText)
const status = computed(() => chat.state.status)
const error = computed(() => chat.state.error)
const isStreaming = computed(() => status.value === 'streaming')

// markdown 渲染（assistant 消息 + streaming）
function renderMd(md: string): string {
  return renderMarkdown(md)
}

onMounted(async () => {
  await chat.init()
})
onUnmounted(() => {
  chat.teardown()
})

async function send() {
  const text = input.value.trim()
  if (!text || isStreaming.value) return
  input.value = ''
  await chat.sendMessage(text)
}

async function stop() {
  await chat.stopCurrent()
}

// 自动滚到底部（streaming 时持续滚）
watch(
  [messages, currentText],
  async () => {
    await nextTick()
    if (transcriptEl.value) {
      transcriptEl.value.scrollTop = transcriptEl.value.scrollHeight
    }
  },
  { deep: true },
)
</script>

<template>
  <div class="session">
    <div ref="transcriptEl" class="transcript">
      <div v-if="messages.length === 0 && !currentText" class="empty">
        <Bot :size="48" :stroke-width="1.5" />
        <h2>开始新对话</h2>
        <p>跟 AI 聊你的 RPG / VN 设定 —— 我会给 3-5 个备选让你挑 + 改</p>
      </div>

      <div
        v-for="(msg, i) in messages"
        :key="i"
        :class="['message', msg.role]"
      >
        <UserIcon v-if="msg.role === 'user'" :size="16" />
        <Bot v-else :size="16" />
        <div v-if="msg.role === 'user'" class="content">{{ msg.content }}</div>
        <div
          v-else
          class="content markdown"
          v-html="renderMd(msg.content)"
        />
      </div>

      <div v-if="currentText" class="message assistant streaming">
        <Bot :size="16" />
        <div class="content markdown streaming" v-html="renderMd(currentText) + '<span class=\'cursor\'>▍</span>'" />
      </div>

      <div v-if="status === 'error' && error" class="error">
        <AlertCircle :size="16" />
        <span>{{ error }}</span>
      </div>

      <div v-if="status === 'cancelled'" class="cancelled">已停止</div>
    </div>

    <form class="composer" @submit.prevent="send">
      <textarea
        v-model="input"
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
        :disabled="isStreaming"
        @keydown.enter.exact.prevent="send"
      />
      <button v-if="!isStreaming" type="submit" :disabled="!input.trim()">
        <Send :size="16" />
        <span>发送</span>
      </button>
      <button v-else type="button" class="stop" @click="stop">
        <Square :size="16" />
        <span>停止</span>
      </button>
    </form>
  </div>
</template>

<style scoped>
.session {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}
.transcript {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  gap: 12px;
}
.empty h2 {
  font-size: 18px;
  color: var(--text);
  font-weight: 500;
}
.empty p {
  font-size: 13px;
  max-width: 360px;
  text-align: center;
}
.message {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  max-width: 800px;
  padding: 8px 12px;
  border-radius: 8px;
}
.message.user {
  background: var(--bg-elev);
  margin-left: auto;
  flex-direction: row-reverse;
}
.message.assistant {
  background: transparent;
  border: 1px solid var(--border);
}
.message.assistant.streaming {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.message .content {
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.message .content.markdown {
  white-space: normal; /* markdown 自己的换行处理 */
}

/* markdown 内部样式 */
.markdown :deep(p) {
  margin: 0 0 8px;
}
.markdown :deep(p:last-child) {
  margin-bottom: 0;
}
.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3),
.markdown :deep(h4) {
  margin: 12px 0 8px;
  font-weight: 600;
  color: var(--text);
}
.markdown :deep(h1) { font-size: 18px; }
.markdown :deep(h2) { font-size: 16px; }
.markdown :deep(h3) { font-size: 15px; }
.markdown :deep(h4) { font-size: 14px; }
.markdown :deep(ul),
.markdown :deep(ol) {
  margin: 0 0 8px;
  padding-left: 20px;
}
.markdown :deep(li) {
  margin-bottom: 2px;
}
.markdown :deep(code) {
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 0.9em;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 5px;
}
.markdown :deep(pre) {
  margin: 8px 0;
  padding: 8px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow-x: auto;
}
.markdown :deep(pre code) {
  background: none;
  border: none;
  padding: 0;
}
.markdown :deep(blockquote) {
  margin: 8px 0;
  padding: 4px 12px;
  border-left: 3px solid var(--accent);
  color: var(--text-muted);
  background: var(--accent-soft);
}
.markdown :deep(a) {
  color: var(--accent);
  text-decoration: none;
}
.markdown :deep(a:hover) {
  text-decoration: underline;
}
.markdown :deep(strong) {
  font-weight: 600;
  color: var(--text);
}
.markdown :deep(em) {
  font-style: italic;
}
.markdown :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 12px 0;
}

.cursor {
  display: inline-block;
  animation: blink 1s steps(2) infinite;
  color: var(--accent);
  margin-left: 2px;
}
@keyframes blink {
  50% { opacity: 0; }
}
.error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(232, 90, 90, 0.12);
  border: 1px solid var(--error);
  color: var(--error);
  border-radius: 6px;
  font-size: 13px;
}
.cancelled {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  color: var(--text-muted);
  font-size: 12px;
  font-style: italic;
}
.composer {
  display: flex;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
  background: var(--bg-elev);
}
.composer textarea {
  flex: 1;
  min-height: 40px;
  max-height: 200px;
  resize: none;
  font-family: inherit;
  padding: 8px 12px;
}
.composer button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--accent);
  color: var(--bg);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  font-family: inherit;
}
.composer button:disabled {
  background: var(--border);
  color: var(--text-muted);
  cursor: not-allowed;
}
.composer button.stop {
  background: var(--error);
  color: white;
}
</style>
