// useModelCatalog —— 拉 + 缓存 models.dev catalog 的 composable
//
// v0.1.4+：model catalog 从 Rust 端拉（embedded models.dev snapshot）
//  - 单进程拉一次，缓存到 module-level singleton（player 多次打开 modal 不重复 IPC）
//  - 失败 → error 状态，UI 显示 "模型库暂不可用"（不静默吞）
//  - 没 Pinia store（轻量级 one-shot 数据，store 过度设计）
//
// 数据流：
//   ModelLibraryPanel / ProviderCatalogStep / ProviderEditModal
//     → useModelCatalog().load()  (onMounted 触发)
//     → ready 后用 catalog.value

import { computed, ref } from 'vue'
import { getModelCatalog } from '@/lib/llm'
import type { ModelCatalog } from '@/types/catalog'

// === module-level singleton state ===

let cached: ModelCatalog | null = null
const loading = ref(false)
const error = ref<Error | null>(null)

/** 强制下次 load() 重新拉（v0.1 暂不暴露 —— snapshot 不会变） */
export function invalidateModelCatalog() {
  cached = null
  error.value = null
}

/** 加载 catalog（已缓存直接返回；并发起只跑一次） */
export async function loadModelCatalog(): Promise<ModelCatalog> {
  if (cached) return cached
  if (loading.value) {
    // 等已有 in-flight 完成（最多 5s）
    const start = Date.now()
    while (loading.value && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 50))
    }
    if (cached) return cached
  }
  loading.value = true
  error.value = null
  try {
    cached = await getModelCatalog()
  } catch (e) {
    error.value = e instanceof Error ? e : new Error(String(e))
  } finally {
    loading.value = false
  }
  if (!cached) throw error.value ?? new Error('model catalog load failed')
  return cached
}

/** composable：UI 用的 reactive view */
export function useModelCatalog() {
  return {
    catalog: computed<ModelCatalog | null>(() => cached),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    load: loadModelCatalog,
  }
}
