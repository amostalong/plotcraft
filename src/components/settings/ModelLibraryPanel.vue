<script setup lang="ts">
// ModelLibraryPanel —— ProviderEditModal 内嵌的"模型库"面板（仿 Locus 同款）
//
// 视觉 + 交互镜像 Locus `ProviderModelsEditor` 的 model library section：
// - 标题 + 展开/收起 toggle + 总数提示
// - 搜索框（按 provider 名 / endpoint / model id / model name 过滤）
// - provider 分组列表：每个 provider 显示名字 + endpoint，下面列出 model
// - 每个 model：name + 上下文徽标（K/M）+ reasoning 徽标（R）+ vision 徽标（V）
// - 点 model → emit('addModel', { model, provider }) → ProviderEditModal 加到 draftModels
//
// v0.1.4+ 数据源从硬编码 BUILTIN_MODELS 改成 Tauri models.dev catalog
// （~167 providers，listable 后剩 ~30+ providers / ~1000 models，src-tauri/src/model_catalog.rs）
// 已加进 draftModels 的 model id 自动从列表隐藏。

import { computed, onMounted, ref } from 'vue'
import { ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-vue-next'
import { useModelCatalog } from '@/composables/useModelCatalog'
import type { CatalogModel, CatalogProvider } from '@/types/catalog'

const props = defineProps<{
  /** 已经加进 draft 的 model id 列表 —— 这些从库列表里隐藏 */
  existingModelIds: string[]
  /** v-model expanded：受控展开状态（外部 header 按钮 / panel 自己的 toggle 都改这个） */
  expanded: boolean
  /** 整个 panel disable（保存中） */
  disabled?: boolean
}>()

const emit = defineEmits<{
  /** 点 model → 加到 draft（带 provider 信息让 ProviderEditModal 知道 apiFormat 兜底） */
  addModel: [payload: { model: CatalogModel; provider: CatalogProvider }]
  /** v-model 双向：外部 / panel 内部 toggle 时 emit */
  'update:expanded': [value: boolean]
}>()

const { catalog, loading, refreshing, error, load, refresh } = useModelCatalog()

// 第一次显示 panel 时 lazy 加载（onMounted 时机太早，performance 影响小）
onMounted(() => {
  if (!catalog.value && !loading.value) {
    load().catch(() => {
      /* 错误已经在 composable 里存了，UI 显示即可 */
    })
  }
})

function setExpanded(v: boolean) {
  if (props.disabled) return
  emit('update:expanded', v)
}

const query = ref('')

/** 搜索关键词 normalize：小写 + 去空白 */
const search = computed(() => query.value.toLowerCase().replace(/\s+/g, '').trim())

/** 按 existingModelIds 过滤后剩下的 provider（空 model 数组过滤掉） */
const filteredProviders = computed<CatalogProvider[]>(() => {
  const cat = catalog.value
  if (!cat) return []
  const existing = new Set(props.existingModelIds)
  const q = search.value
  return cat.providers
    .map((p) => {
      if (!q) return p
      const hitProvider =
        p.name.toLowerCase().includes(q) || p.endpoint.toLowerCase().includes(q)
      const models = p.models.filter(
        (m) =>
          hitProvider ||
          m.id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q),
      )
      return { ...p, models }
    })
    .filter((p) => p.models.some((m) => !existing.has(m.id)))
    // 重写 models：去掉已加进 draft 的
    .map((p) => ({
      ...p,
      models: p.models.filter((m) => !existing.has(m.id)),
    }))
})

/** 总数提示（"X / Y 个 model" / "Y 个 model"）*/
const totalCount = computed(() => {
  if (!catalog.value) return '0 个 model'
  const total = catalog.value.providers.reduce((sum, p) => sum + p.models.length, 0)
  const shown = filteredProviders.value.reduce((sum, p) => sum + p.models.length, 0)
  if (search.value) return `${shown} / ${total} 个 model`
  return `${total} 个 model`
})

/** 上下文窗口格式化 "200000" → "200K" */
function formatCtx(tokens: number): string {
  if (!tokens) return ''
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

function onPick(model: CatalogModel, provider: CatalogProvider) {
  if (props.disabled) return
  emit('addModel', { model, provider })
}

// 错误时给一个明确 hint（玩家就知道是 catalog 拉取失败，不是 catalog 是空的）
const errorMessage = computed(() => error.value?.message ?? '')
</script>

<template>
  <div class="model-library" :class="{ collapsed: !expanded, loading: loading }">
    <!-- 标题行：库名 + 展开/收起 toggle + 总数 -->
    <div class="library-header">
      <button
        type="button"
        class="library-toggle"
        :disabled="disabled"
        @click="setExpanded(!expanded)"
      >
        <component :is="expanded ? ChevronDown : ChevronRight" :size="12" />
        <span class="library-toggle-text">
          {{ expanded ? '收起模型库' : '展开模型库' }}
        </span>
        <span class="library-count">{{ totalCount }}</span>
      </button>
    </div>

    <!-- 展开内容：搜索 + 列表 -->
    <div v-if="expanded" class="library-content">
      <div class="library-search-row">
        <div class="library-search">
          <Search :size="11" class="library-search-icon" />
          <input
            v-model="query"
            type="text"
            class="library-search-input"
            :disabled="disabled"
            placeholder="搜索供应商或模型（如 anthropic、claude、deepseek）"
            spellcheck="false"
          />
        </div>
        <button
          type="button"
          class="library-refresh"
          :disabled="disabled || refreshing"
          title="从 models.dev 拉新 catalog"
          @click="refresh"
        >
          <RefreshCw :size="11" :class="{ spinning: refreshing }" />
        </button>
      </div>

      <p v-if="!search && !error" class="library-hint">
        v0.1 内置 models.dev snapshot — 全部 {{ catalog?.providers.length ?? 0 }} 个
        listable provider 可加。
      </p>
      <p v-else-if="search" class="library-hint">搜索 "{{ query }}" 的结果</p>
      <p v-else-if="errorMessage" class="library-hint library-error">
        ⚠ catalog 拉取失败：{{ errorMessage }}
      </p>

      <div v-if="loading && !catalog" class="library-status">
        加载 catalog…
      </div>
      <div v-else-if="filteredProviders.length === 0" class="library-status">
        {{ search ? '没有匹配的 model' : '模型库里没有可加的 model（都已加）' }}
      </div>

      <div v-else class="library-list">
        <div
          v-for="provider in filteredProviders"
          :key="provider.id"
          class="library-provider"
        >
          <div class="library-provider-header">
            <span class="library-provider-name">{{ provider.name }}</span>
            <code class="library-provider-endpoint">{{ provider.endpoint }}</code>
          </div>
          <button
            v-for="m in provider.models"
            :key="m.id"
            type="button"
            class="library-model"
            :disabled="disabled"
            @click="onPick(m, provider)"
          >
            <span class="library-model-name">{{ m.name }}</span>
            <span class="library-model-badges">
              <span v-if="m.context_window" class="badge badge-ctx">
                {{ formatCtx(m.context_window) }}
              </span>
              <span v-if="m.reasoning" class="badge badge-r" title="支持 reasoning effort">
                R
              </span>
              <span v-if="m.vision" class="badge badge-v" title="支持 vision / image input">
                V
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* === 镜像 Locus `ProviderModelsEditor` 的 model library 样式（结构对齐，代码自写） === */
.model-library {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  overflow: hidden;
}
.model-library.collapsed {
  background: transparent;
}

/* === Header === */
.library-header {
  display: flex;
  align-items: center;
  padding: 6px 4px 6px 8px;
  background: transparent;
}
.library-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 5px;
  flex: 1;
  justify-content: flex-start;
  transition: background 0.12s ease;
}
.library-toggle:hover:not(:disabled) {
  background: var(--hover);
}
.library-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.library-toggle-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
}
.library-count {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--text-muted);
  padding: 1px 7px;
  background: var(--hover);
  border-radius: 10px;
  font-weight: 500;
}

/* === Content === */
.library-content {
  padding: 0 8px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* === Search === */
.library-search-row {
  display: flex;
  gap: 4px;
  align-items: center;
}
.library-search {
  position: relative;
  flex: 1;
  min-width: 0;
}
.library-search-icon {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}
.library-search-input {
  width: 100%;
  padding: 5px 8px 5px 24px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg);
  color: var(--text);
  font-size: 11.5px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.library-search-input:focus {
  border-color: var(--accent);
  background: var(--bg-elev);
}
.library-search-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.library-refresh {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, color 0.12s;
  padding: 0;
}
.library-refresh:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.library-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spinning {
  animation: library-spin 0.9s linear infinite;
}
@keyframes library-spin {
  to { transform: rotate(360deg); }
}

.library-hint {
  margin: 0;
  padding: 0 2px;
  font-size: 10.5px;
  color: var(--text-muted);
  line-height: 1.4;
}
.library-error {
  color: var(--error, #e53e3e);
}

/* === List === */
.library-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
  background: var(--bg-elev);
}
.library-provider {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.library-provider-header {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 6px 2px;
}
.library-provider-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text);
}
.library-provider-endpoint {
  font-size: 10px;
  color: var(--text-muted);
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.library-model {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s ease;
  min-width: 0;
}
.library-model:hover:not(:disabled) {
  background: var(--hover);
}
.library-model:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.library-model-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
}
.library-model-badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* === Badges === */
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9.5px;
  font-weight: 600;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 3px;
  letter-spacing: 0.2px;
}
.badge-ctx {
  background: var(--hover);
  color: var(--text-muted);
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
}
.badge-r {
  background: rgba(221, 107, 32, 0.12);
  color: var(--thinking-high, #dd6b20);
  border: 1px solid rgba(221, 107, 32, 0.3);
}
.badge-v {
  background: rgba(56, 161, 105, 0.12);
  color: var(--thinking-low, #38a169);
  border: 1px solid rgba(56, 161, 105, 0.3);
}

.library-status {
  padding: 12px 8px;
  font-size: 11.5px;
  color: var(--text-muted);
  text-align: center;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 6px;
}
</style>
