// useResizableWidth —— 可拖拽调整宽度的 composable (v0.3+)
//
// 用于:
// - SessionView 主聊天 transcript 右侧手柄 (edge: 'right', 拖右 = 变宽)
// - ConceptView / WorldView AI 面板左侧手柄 (edge: 'left', 拖左 = 变宽)
//
// 提供:
// - width: 当前宽度 (响应式)
// - resizing: 是否在拖拽中
// - onResizeStart: 给 mousedown 触发的 handler
// - resetWidth: 双击手柄重置回 defaultWidth
//
// 持久化: localStorage[storageKey] 存当前宽度, 组件挂载时读回
// 范围: [min, max] clamp 防越界
//
// v0.4.1+ resetOnWindowResize: 窗口 resize（最大化 / 还原 / 拖边缘）时自动 reset
// - 用函数式 defaultWidth 才有意义（固定 defaultWidth 的话 reset 也没变化）
// - debounce 250ms 避免 resize 持续触发
//
// 实现注意:
// - 用 document.addEventListener 绑 mousemove/mouseup (用户拖出元素也跟手)
// - 锁 body cursor + userSelect + overflow 防 iOS 滚动
// - 锁 body 移动端 passive: false 才能 preventDefault
import { onMounted, onUnmounted, ref, watch } from 'vue'

export type ResizeEdge = 'right' | 'left'

export interface UseResizableWidthOptions {
  /** localStorage key */
  storageKey: string
  /** 默认宽度 (px)，或懒计算函数（在 mount 时 / resetWidth 时调）
   *  - 传数字：固定默认（SessionView 用 1200）
   *  - 传函数：每次需要默认时调（Concept/WorldView 用 `() => window.innerWidth / 4` 跟随窗口）
   *  - 函数返回值会被 clamp 到 [min, max] */
  defaultWidth: number | (() => number)
  /** 最小宽度 */
  min: number
  /** 最大宽度 */
  max: number
  /** 拖哪条边变宽:
   *  - 'right': 拖右边缘向右 (主聊天 transcript 在中间, 右边留白) —— 拖右 = 变宽
   *  - 'left' : 拖左边缘向左 (右栏 AI panel) —— 拖左 = 变宽 */
  edge: ResizeEdge
  /** v0.4.1+ 窗口尺寸变化时自动 reset 到 defaultWidth
   *  - 适用场景：AI 面板跟着窗口走（最大化 / 还原 / 拖窗口边缘时按比例 reset）
   *  - 必须配合**函数式** defaultWidth 才有意义（`() => window.innerWidth / 4`）
   *  - 固定 defaultWidth 时设了也没用（reset 不会变） */
  resetOnWindowResize?: boolean
}

/** 求默认宽度（数字直返 / 函数调一下）并 clamp 到 [min, max] */
function resolveDefaultWidth(opts: UseResizableWidthOptions): number {
  const raw = typeof opts.defaultWidth === 'function' ? opts.defaultWidth() : opts.defaultWidth
  return Math.max(opts.min, Math.min(opts.max, Math.round(raw)))
}

export function useResizableWidth(opts: UseResizableWidthOptions) {
  const width = ref(resolveDefaultWidth(opts))
  const resizing = ref(false)
  let dragStartX = 0
  let dragStartWidth = 0

  function getPointerX(e: MouseEvent | TouchEvent): number {
    if ('touches' in e) {
      const t = e.touches[0] ?? (e as TouchEvent).changedTouches[0]
      return t?.clientX ?? 0
    }
    return (e as MouseEvent).clientX
  }

  onMounted(() => {
    try {
      const saved = localStorage.getItem(opts.storageKey)
      if (saved) {
        const n = parseInt(saved, 10)
        if (!isNaN(n) && n >= opts.min && n <= opts.max) {
          width.value = n
        }
      }
    } catch {
      // localStorage 不可用 (隐私模式) 静默失败
    }
  })

  watch(width, (v) => {
    try {
      localStorage.setItem(opts.storageKey, String(v))
    } catch {
      // ignore
    }
  })

  function onResizeStart(e: MouseEvent) {
    e.preventDefault()
    resizing.value = true
    dragStartX = getPointerX(e)
    dragStartWidth = width.value
    document.addEventListener('mousemove', onResizeMove)
    document.addEventListener('mouseup', onResizeEnd)
    document.addEventListener('touchmove', onResizeMove, { passive: false })
    document.addEventListener('touchend', onResizeEnd)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    document.body.style.overflow = 'hidden'
  }

  function onResizeMove(e: MouseEvent | TouchEvent) {
    if ('touches' in e) e.preventDefault()
    const dx = getPointerX(e) - dragStartX
    // edge 决定方向:
    // - 'right' 拖右边缘向右 (dx > 0) = 变宽 → +dx
    // - 'left'  拖左边缘向左  (dx < 0) = 变宽 → -dx
    const delta = opts.edge === 'right' ? dx : -dx
    const newWidth = dragStartWidth + delta
    width.value = Math.max(opts.min, Math.min(opts.max, Math.round(newWidth)))
  }

  function onResizeEnd() {
    resizing.value = false
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
    document.removeEventListener('touchmove', onResizeMove)
    document.removeEventListener('touchend', onResizeEnd)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    document.body.style.overflow = ''
  }

  function resetWidth() {
    // 函数式 defaultWidth 时每次重算（玩家 resize 窗口后 reset 也跟当前窗口走）
    width.value = resolveDefaultWidth(opts)
  }

  // === v0.4.1+ 窗口尺寸变化时自动 reset ===
  // - Tauri 2 把窗口 resize 事件转发成 webview 的 `resize` DOM 事件
  // - 最大化 / 还原 / 拖窗口边缘都会触发
  // - debounce 250ms（玩家连续拖边缘时最后稳定后调一次 reset）
  if (opts.resetOnWindowResize) {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    function onWindowResize() {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        resetWidth()
      }, 250)
    }
    onMounted(() => {
      window.addEventListener('resize', onWindowResize)
    })
    onUnmounted(() => {
      window.removeEventListener('resize', onWindowResize)
      if (debounceTimer) clearTimeout(debounceTimer)
    })
  }

  return { width, resizing, onResizeStart, resetWidth }
}
