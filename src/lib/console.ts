// PlotCraft v0.1 debug console 前端 wrapper
//
// 跟 Locus `debugConsole` service 思路一致，但实现从零（AGENTS.md 硬规则 #1）。
// PlotCraft v0.1 简化：
// - 不上 tracing-subscriber / 全局 hook（v0.1 不上 eprintln 自动收）
// - 关键错误点由 Rust 端手动调 `console_log()` 推 frontend
// - 前端 console.log/warn/error 主动 hook（覆盖玩家最常看到的 log）
// - 不上 column resize / message preview limit / export log file（v0.1 简化）
//
// 数据流：
// 1. Rust 端 console_log() → 写 in-memory Vec + emit `console:entry` 事件
// 2. 前端 listen `console:entry` → pushLocal 到本地 reactive ref
// 3. 前端 init() 时 invoke `get_console_entries` 拉历史 snapshot（合并去重）
// 4. UI 读 reactive ref，filter / search / clear

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { ref } from 'vue'

/** console 日志级别（v0.1 简化 3 种） */
export type ConsoleLevel = 'info' | 'warn' | 'error'

/** console 来源（v0.1 简化 2 种） */
export type ConsoleSource = 'backend' | 'frontend'

/** 单条 console entry —— 镜像 Rust 端 ConsoleEntry
 *
 *  v0.1.5+ fix: Rust serde 默认 snake_case，emit payload 里字段是 `timestamp_ms`，
 *  不是 `timestampMs`。前端之前用 camelCase → Rust 推的 entry 的 timestamp 拿到
 *  undefined → NaN:NaN:NaN（控制台 time 列坏）。改成 snake_case 跟 Rust 对齐
 *  （AGENTS.md 硬规则 #8：跨 Tauri boundary 走 snake_case）。
 *
 *  前端 pushLocal 时也用 `timestamp_ms` 写，确保 key 一致。
 */
export interface ConsoleEntry {
  id: string
  level: ConsoleLevel
  source: ConsoleSource
  module: string
  message: string
  /** 毫秒时间戳（snake_case 跟 Rust 端对齐） */
  timestamp_ms: number
}

const MAX_ENTRIES = 1000

// === Module-level singleton state ===
//
// 不用 pinia —— console 是单流的，所有 view 共享一份数据。
// vue ref 让 UI 自动 reactive。
const entries = ref<ConsoleEntry[]>([])
let initialSnapshotLoaded = false
let unsubscribeEvent: UnlistenFn | null = null
let consoleHookInstalled = false

function pushLocal(entry: ConsoleEntry) {
  // 已有同 id 的就不重复加（防 listen snapshot 重复）
  if (entries.value.some((e) => e.id === entry.id)) return
  entries.value = [entry, ...entries.value]
  if (entries.value.length > MAX_ENTRIES) {
    entries.value = entries.value.slice(0, MAX_ENTRIES)
  }
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return a.stack || a.message
      try {
        return JSON.stringify(a, null, 2)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

/** 推一条 frontend entry（v0.1 hook 模式直接调，不通过 Rust） */
function pushFrontend(level: ConsoleLevel, args: unknown[]): void {
  pushLocal({
    id: `fe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    level,
    source: 'frontend',
    module: 'app',
    message: formatArgs(args),
    timestamp_ms: Date.now(),
  })
}

/** 拉 Rust 端 snapshot 合并到本地（去重 by id） */
async function loadInitialSnapshot(): Promise<void> {
  if (initialSnapshotLoaded) return
  try {
    const fromBackend = await invoke<ConsoleEntry[]>('get_console_entries')
    for (const e of fromBackend) pushLocal(e)
    initialSnapshotLoaded = true
  } catch (e) {
    // 静默 —— init 失败不影响 UI
    console.error('[console] failed to load initial snapshot:', e)
  }
}

/** 订阅 Rust `console:entry` 事件 */
async function subscribeBackendEvents(): Promise<void> {
  if (unsubscribeEvent) return
  unsubscribeEvent = await listen<ConsoleEntry>('console:entry', (e) => {
    pushLocal(e.payload)
  })
}

/** v0.1+ hook 前端 console.log/warn/error → 推到 console state
 *  玩家在 chat 看到的 console.log 调用都被收集
 *  装一次就行（main.ts 启动时调） */
export function installConsoleHook(): void {
  if (consoleHookInstalled) return
  consoleHookInstalled = true

  const origLog = console.log.bind(console)
  const origWarn = console.warn.bind(console)
  const origError = console.error.bind(console)

  console.log = (...args: unknown[]) => {
    origLog(...args)
    pushFrontend('info', args)
  }
  console.warn = (...args: unknown[]) => {
    origWarn(...args)
    pushFrontend('warn', args)
  }
  console.error = (...args: unknown[]) => {
    origError(...args)
    pushFrontend('error', args)
  }
}

/** 初始化：拉 snapshot + 订阅 backend 事件（hook 由 main.ts 单独调） */
export async function initConsole(): Promise<void> {
  await Promise.all([loadInitialSnapshot(), subscribeBackendEvents()])
}

/** 清空全部 console entries（前端 + 后端） */
export async function clearConsole(): Promise<void> {
  entries.value = []
  try {
    await invoke('clear_console')
  } catch (e) {
    console.error('[console] clear_console command failed:', e)
  }
}

/** 拿 reactive entries ref（UI 用） */
export function useConsoleEntries() {
  return entries
}

/** 显式 reload snapshot（UI "Refresh" 按钮用） */
export async function refreshConsole(): Promise<void> {
  initialSnapshotLoaded = false
  await loadInitialSnapshot()
}

/** Test: dev 用，给 console state 推一条假 entry（不调 Rust） */
export function _pushTestEntry(entry: Partial<ConsoleEntry>): void {
  pushLocal({
    id: entry.id ?? `fe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    level: entry.level ?? 'info',
    source: entry.source ?? 'frontend',
    module: entry.module ?? 'app',
    message: entry.message ?? '',
    timestamp_ms: entry.timestamp_ms ?? Date.now(),
  })
}
