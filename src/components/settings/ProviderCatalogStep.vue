<script setup lang="ts">
// ProviderCatalogStep —— "从模型库添加" 的 Locus 同款 pick stage
//
// 视觉 + 交互镜像 Locus `ProviderCatalogStep.vue`（AGENTS.md 硬规则 #1：结构对齐，代码自写）：
// - 顶部：搜索框（按 provider 名 / endpoint 过滤，30+ providers 必备）
// - 手动添加卡（dashed border + + icon + 名字 + 描述 + chevron）
// - 分割线 + "或从模型库选" 段头
// - catalog provider 列表：每个 row 显示名字 / endpoint / model count / chevron
//
// v0.1.4+ 数据源从硬编码 BUILTIN_MODELS 改成 Tauri models.dev catalog
//  - 30+ listable providers（~167 raw，filter 完剩 ~30+ 真正能用的）
//  - 每行对应一个 CatalogProvider；点 → prefill draft + 切到 config
//  - v0.1 暂不接远端 refresh（snapshot 嵌在 Rust binary 里，rebuild 才会换）

import { computed, onMounted, ref } from 'vue'
import { BookOpen, Plus, ChevronRight, Search, RefreshCw } from 'lucide-vue-next'
import { useModelCatalog } from '@/composables/useModelCatalog'
import type { CatalogModel, CatalogProvider } from '@/types/catalog'

const props = defineProps<{
  /** disabled 状态（save 进行中） */
  disabled?: boolean
}>()

const emit = defineEmits<{
  /** 玩家选了 catalog 里的一条 provider → prefill draft 切到 config
   *  v0.1 用 provider 第一条 model 作 starter；config 阶段还能用 library 补 model */
  pickCatalog: [payload: { provider: CatalogProvider; firstModel: CatalogModel }]
  /** 玩家点 "手动添加" → 切到 config，draft 留空 */
  pickManual: []
}>()

const { catalog, loading, refreshing, error, load, refresh } = useModelCatalog()

onMounted(() => {
  if (!catalog.value && !loading.value) {
    load().catch(() => {
      /* 错误已经存在 composable 里 */
    })
  }
})

const query = ref('')
const search = computed(() => query.value.toLowerCase().replace(/\s+/g, '').trim())

/** 搜索过滤后的 provider 列表（空数组过滤掉） */
const filteredProviders = computed<CatalogProvider[]>(() => {
  const cat = catalog.value
  if (!cat) return []
  const q = search.value
  if (!q) return cat.providers
  return cat.providers.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.endpoint.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q),
  )
})

/** 总数提示 */
const totalInfo = computed(() => {
  const cat = catalog.value
  if (!cat) return '0 provider'
  const total = cat.providers.length
  const shown = filteredProviders.value.length
  if (search.value) return `${shown} / ${total} provider`
  return `${total} provider`
})

function onPickCatalog(provider: CatalogProvider, firstModel: CatalogModel) {
  if (props.disabled) return
  emit('pickCatalog', { provider, firstModel })
}

function onPickManual() {
  if (props.disabled) return
  emit('pickManual')
}
</script>

<template>
  <div class="catalog-pick-step">
    <!-- 搜索框（v0.1 启用 — 30+ providers 必备） -->
    <div class="pick-toolbar">
      <div class="pick-search-wrap">
        <Search :size="12" class="pick-search-icon" />
        <input
          v-model="query"
          class="pick-search"
          type="text"
          :disabled="disabled"
          placeholder="搜索 provider / model（如 anthropic、deepseek）"
          spellcheck="false"
        />
        <button
          type="button"
          class="pick-refresh"
          :disabled="disabled || refreshing"
          title="从 models.dev 拉新 catalog"
          @click="refresh"
        >
          <RefreshCw :size="11" :class="{ spinning: refreshing }" />
        </button>
      </div>
    </div>

    <!-- 手动添加卡（dashed border，模仿 Locus manual-card） -->
    <button
      class="manual-card"
      type="button"
      :disabled="disabled"
      @click="onPickManual"
    >
      <span class="manual-card-icon">
        <Plus :size="14" />
      </span>
      <span class="manual-card-copy">
        <span class="manual-card-name">手动添加</span>
        <span class="manual-card-desc">自己填 endpoint / API key / model id</span>
      </span>
      <ChevronRight :size="14" class="pick-chevron" />
    </button>

    <!-- 分割线 + 段头 -->
    <div class="pick-section-divider">
      <span class="pick-section-label">或从模型库选</span>
    </div>

    <!-- Catalog provider 列表 -->
    <div class="pick-list">
      <button
        v-for="provider in filteredProviders"
        :key="provider.id"
        type="button"
        class="pick-row"
        :disabled="disabled"
        @click="provider.models[0] && onPickCatalog(provider, provider.models[0])"
      >
        <span class="pick-row-main">
          <span class="pick-row-name">{{ provider.name }}</span>
          <span class="pick-row-endpoint">
            {{ provider.endpoint }}
          </span>
        </span>
        <span class="pick-row-side">
          <span class="pick-badge">
            {{ provider.models.length }} model{{ provider.models.length === 1 ? '' : 's' }}
          </span>
          <ChevronRight :size="12" class="pick-chevron" />
        </span>
      </button>
      <div v-if="error" class="pick-status pick-status-error">
        ⚠ catalog 拉取失败：{{ error.message }}
      </div>
      <div v-else-if="loading && filteredProviders.length === 0" class="pick-status">
        加载 catalog…
      </div>
      <div v-else-if="filteredProviders.length === 0" class="pick-status">
        {{ search ? '没有匹配的 provider' : '暂无 catalog entry' }}
      </div>
    </div>

    <!-- 底部 hint -->
    <p class="pick-hint">
      v0.1 内置 models.dev snapshot · {{ totalInfo }}
    </p>
  </div>
</template>

<style scoped>
/* === 镜像 Locus ProviderCatalogStep 样式（结构对齐，代码自写） === */
.catalog-pick-step {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0;
  padding: 4px;
}

/* === Toolbar / search === */
.pick-toolbar {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}
.pick-search-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 4px;
  align-items: center;
}
.pick-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
}
.pick-search {
  flex: 1;
  min-width: 0;
  padding: 7px 10px 7px 28px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.pick-search:focus:not(:disabled) {
  border-color: var(--accent);
}
.pick-search:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.pick-refresh {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, color 0.12s;
  padding: 0;
}
.pick-refresh:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.pick-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.spinning {
  animation: pick-spin 0.9s linear infinite;
}
@keyframes pick-spin {
  to { transform: rotate(360deg); }
}

/* === 手动添加卡 === */
.manual-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font: inherit;
  flex-shrink: 0;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.manual-card:hover:not(:disabled) {
  background: var(--hover);
  border-color: var(--accent);
}
.manual-card:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.manual-card-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--hover);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.manual-card-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}
.manual-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.manual-card-desc {
  font-size: 11px;
  color: var(--text-muted);
}
.pick-chevron {
  color: var(--text-muted);
  opacity: 0.6;
  flex-shrink: 0;
}

/* === Section divider === */
.pick-section-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.pick-section-divider::before,
.pick-section-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}
.pick-section-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
}

/* === Pick list === */
.pick-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px;
  background: var(--bg);
}
.pick-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font: inherit;
  min-width: 0;
  flex-shrink: 0;
  transition: background 0.12s ease;
}
.pick-row:hover:not(:disabled) {
  background: var(--hover);
}
.pick-row:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.pick-row-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.pick-row-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}
.pick-row-endpoint {
  font-size: 10.5px;
  color: var(--text-muted);
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pick-row-side {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.pick-badge {
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 4px;
  background: var(--hover);
  color: var(--text-muted);
  white-space: nowrap;
}
.pick-status {
  padding: 12px 4px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}
.pick-status-error {
  color: var(--error, #e53e3e);
}

/* === Hint === */
.pick-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin: 0;
  padding: 0 4px;
  flex-shrink: 0;
}
</style>
