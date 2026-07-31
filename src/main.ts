// PlotCraft v0.1 启动分阶段
// - phase 1 (< 500ms): 同步 mount UI + 装 console hook
// - phase 2 (异步): load config + pre-warm markdown + console init，不阻塞首屏
//
// 设计见 [docs/CHECKLIST.md §6 启动分阶段] / [docs/CHAT_LLM_DESIGN.md §4 性能验收 P5-P8]

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useSettingsStore } from '@/stores/settings'
import { useProjectStore } from '@/stores/project'
import { renderMarkdown } from '@/lib/markdown'
import { initConsole, installConsoleHook } from '@/lib/console'
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

// phase 1 末尾：装 console hook（之后所有 console.log/warn/error 自动入控制台）
// 不能在 module 顶层装——会捕获 module init 时的 log 但那时 console hook 还没就绪
installConsoleHook()

// phase 2: 窗口已显示，异步 init（**不**阻塞 UI）
// - settings.init() → loadConfig() 走 Tauri IPC（~1 roundtrip）
// - project.init() → 恢复 last project（settings.recentProjects[0] + 后端 open_project 验证）
//   单独 await 保顺序（依赖 settings.loaded 才能读 recentProjects）
// - renderMarkdown('# warmup') → 触发 marked + DOMPurify JIT 编译
// - initConsole() → 拉 console snapshot + 订阅 backend 事件
// - 任一失败都 fallback 到 default，**不**抛到 UI（用户首次打开也不会因为 config 缺失崩）
void (async () => {
  const t2 = performance.now()
  // settings 先 init（project.init 内部依赖 settings.recentProjects）
  const settingsResult = await Promise.allSettled([useSettingsStore().init()])
  // 剩下的并行
  const othersResults = await Promise.allSettled([
    Promise.resolve().then(() => renderMarkdown('# warmup')),
    initConsole(),
    useProjectStore().init(),
  ])
  const allResults = [...settingsResult, ...othersResults]
  const labels = ['settings', 'markdown', 'console', 'project']
  for (const [i, r] of allResults.entries()) {
    if (r.status === 'rejected') {
      console.error(`[phase2] ${labels[i]} failed (using fallback):`, r.reason)
    } else {
      console.log(`[phase2] ${labels[i]} ok`)
    }
  }
  const t3 = performance.now()
  console.log(`[phase2] init total: ${(t3 - t2).toFixed(2)}ms`)
})()
