import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import './style.css'

// phase 1: 同步 mount UI（< 500ms 目标）
const t0 = performance.now()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

const t1 = performance.now()
console.log(`[phase1] mount: ${(t1 - t0).toFixed(2)}ms`)

// phase 2: 异步 init（commit 7 实装：load config / init LLM client / pre-warm markdown worker）
// 这里留空 stub，v0.1 commit 7 补
void app
