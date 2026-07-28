<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { AlertCircle, Bot, Send, Square, User as UserIcon } from 'lucide-vue-next'

import { useChatStore } from '@/stores/chat'

const chat = useChatStore()

const input = ref('')
const transcriptEl = ref<HTMLElement | null>(null)

const messages = computed(() => chat.state.messages)
const currentText = computed(() => chat.state.currentText)
const status = computed(() => chat.state.status)
const error = computed(() => chat.state.error)
const isStreaming = computed(() => status.value === 'streaming')

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
        <div class="content">{{ msg.content }}</div>
      </div>

      <div v-if="currentText" class="message assistant streaming">
        <Bot :size="16" />
        <div class="content">
          {{ currentText }}<span class="cursor">▍</span>
        </div>
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
