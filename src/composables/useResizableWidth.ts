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
// 实现注意:
// - 用 document.addEventListener 绑 mousemove/mouseup (用户拖出元素也跟手)
// - 锁 body cursor + userSelect + overflow 防 iOS 滚动
// - 锁 body 移动端 passive: false 才能 preventDefault
import { onMounted, ref, watch } from 'vue'

export type ResizeEdge = 'right' | 'left'

export interface UseResizableWidthOptions {
  /** localStorage key */
  storageKey: string
  /** 默认宽度 (px) */
  defaultWidth: number
  /** 最小宽度 */
  min: number
  /** 最大宽度 */
  max: number
  /** 拖哪条边变宽:
   *  - 'right': 拖右边缘向右 (主聊天 transcript 在中间, 右边留白) —— 拖右 = 变宽
   *  - 'left' : 拖左边缘向左 (右栏 AI panel) —— 拖左 = 变宽 */
  edge: ResizeEdge
}

export function useResizableWidth(opts: UseResizableWidthOptions) {
  const width = ref(opts.defaultWidth)
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
    width.value = opts.defaultWidth
  }

  return { width, resizing, onResizeStart, resetWidth }
}
