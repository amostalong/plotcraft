// useMarkdown —— Vue composable 包装 renderMarkdown
//
// v0.1 简单版：直接 computed 同步渲染
// v0.2+ 可加 LRU cache 防重复解析（key = msg.content hash）

import { computed, type ComputedRef, type Ref } from 'vue'
import { renderMarkdown } from '@/lib/markdown'

export function useMarkdown(source: Ref<string>): ComputedRef<string> {
  return computed(() => renderMarkdown(source.value))
}
