// PlotCraft v0.1 启动分阶段
// - phase 1 (< 500ms): 同步 mount UI
// - phase 2 (异步): load config + pre-warm markdown，不阻塞首屏
//
// 设计见 [docs/CHECKLIST.md §6 启动分阶段] / [docs/CHAT_LLM_DESIGN.md §4 性能验收 P5-P8]

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useSettingsStore } from '@/stores/settings'
import { renderMarkdown } from '@/lib/markdown'
import './style.css'

// phase 1: 同步 mount UI（窗口已显示 + 首屏可交互）
const t0 = performance.now()

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.mount('#app')

const t1 = performance.now()
console.log(`[phase1] mount: ${(t1 - t0).toFixed(2)}ms`)

// phase 2: 窗口已显示，异步 init（**不**阻塞 UI）
// - settings.init() → loadConfig() 走 Tauri IPC（~1 roundtrip）
// - renderMarkdown('# warmup') → 触发 marked + DOMPurify JIT 编译
// - 任一失败都 fallback 到 default，**不**抛到 UI（用户首次打开也不会因为 config 缺失崩）
void (async () => {
  const t2 = performance.now()
  const results = await Promise.allSettled([
    useSettingsStore().init(),
    Promise.resolve().then(() => renderMarkdown('# warmup')),
  ])
  for (const [i, r] of results.entries()) {
    const label = i === 0 ? 'settings' : 'markdown'
    if (r.status === 'rejected') {
      console.error(`[phase2] ${label} failed (using fallback):`, r.reason)
    } else {
      console.log(`[phase2] ${label} ok`)
    }
  }
  const t3 = performance.now()
  console.log(`[phase2] init total: ${(t3 - t2).toFixed(2)}ms`)
})()
