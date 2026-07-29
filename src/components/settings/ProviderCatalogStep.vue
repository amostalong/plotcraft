<script setup lang="ts">
// ProviderCatalogStep —— "从模型库添加" 的 Locus 同款 pick stage
//
// 视觉 + 交互镜像 Locus `ProviderCatalogStep.vue`（AGENTS.md 硬规则 #1：结构对齐，代码自写）：
// - 顶部：搜索框（v0.1 暂时 1 个 entry 没用上，保留给 v0.2+ 多 catalog entry 时启用）
// - 手动添加卡（dashed border + + icon + 名字 + 描述 + chevron）
// - 分割线 + "或从模型库选" 段头
// - catalog provider 列表：每个 row 显示名字 / 描述 / 数量 badge / chevron
//   - v0.1 BUILTIN_MODELS 只 1 条（claude-sonnet-4-5 / Anthropic），按 provider 分组渲染
//
// v0.1 简化：1 个 builtin entry，没有 remote catalog、没有 refresh 按钮。
// v0.2+ 拿 snapshot 缓存的 catalog 时，把 search / refresh 加上。

import { computed } from 'vue'
import { BookOpen, Plus, ChevronRight, Search } from 'lucide-vue-next'
import { BUILTIN_MODELS, type BuiltinModel } from '@/lib/modelCatalog'
import type { ApiFormat } from '@/lib/settings'
import { DEFAULT_ENDPOINTS } from '@/lib/settings'

const props = defineProps<{
  /** disabled 状态（save 进行中） */
  disabled?: boolean
}>()

const emit = defineEmits<{
  /** 玩家选了 catalog 里的一条 → prefill draft 切到 config */
  pickCatalog: [model: BuiltinModel]
  /** 玩家点 "手动添加" → 切到 config，draft 留空 */
  pickManual: []
}>()

/** BuiltinModel.provider → UI label
 *  v0.1 只用 anthropic / openai 两个；custom 留给 v0.2+ */
const PROVIDER_LABELS: Record<BuiltinModel['provider'], string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  custom: 'Custom',
}

/** 按 provider 分组 catalog（每个 provider 一行，v0.1 通常只有 1 行） */
interface CatalogRow {
  provider: BuiltinModel['provider']
  providerLabel: string
  /** 选这条 row 后建议填的 endpoint（按 provider 选 DEFAULT_ENDPOINTS） */
  suggestedEndpoint: string
  /** 选这条 row 后建议填的 apiFormat（openai → openai_chat，anthropic → anthropic_messages） */
  suggestedApiFormat: ApiFormat
  /** 这一组里所有 model */
  models: BuiltinModel[]
}

const catalogRows = computed<CatalogRow[]>(() => {
  const groups = new Map<BuiltinModel['provider'], BuiltinModel[]>()
  for (const m of BUILTIN_MODELS) {
    if (!groups.has(m.provider)) groups.set(m.provider, [])
    groups.get(m.provider)!.push(m)
  }
  const rows: CatalogRow[] = []
  for (const [provider, models] of groups) {
    const apiFormat: ApiFormat =
      provider === 'anthropic' ? 'anthropic_messages' : 'openai_chat'
    rows.push({
      provider,
      providerLabel: PROVIDER_LABELS[provider] ?? provider,
      suggestedEndpoint: DEFAULT_ENDPOINTS[apiFormat],
      suggestedApiFormat: apiFormat,
      models,
    })
  }
  return rows
})

/** 整段 catalog 数量 = 所有 model 数（v0.1 始终 1） */
const totalModels = computed(() =>
  catalogRows.value.reduce((sum, r) => sum + r.models.length, 0),
)

function onPickCatalog(model: BuiltinModel) {
  if (props.disabled) return
  emit('pickCatalog', model)
}

function onPickManual() {
  if (props.disabled) return
  emit('pickManual')
}
</script>

<template>
  <div class="catalog-pick-step">
    <!-- 搜索框（v0.1 1 个 entry 不启用，保留位置 + disabled 状态） -->
    <div class="pick-toolbar">
      <div class="pick-search-wrap">
        <Search :size="12" class="pick-search-icon" />
        <input
          class="pick-search"
          type="text"
          disabled
          placeholder="搜索 provider / model（v0.2+ 启用，v0.1 暂只 1 个）"
        />
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
        v-for="row in catalogRows"
        :key="row.provider"
        type="button"
        class="pick-row"
        :disabled="disabled"
        @click="onPickCatalog(row.models[0])"
      >
        <span class="pick-row-main">
          <span class="pick-row-name">{{ row.providerLabel }}</span>
          <span class="pick-row-endpoint">
            {{ row.suggestedEndpoint }}
          </span>
        </span>
        <span class="pick-row-side">
          <span class="pick-badge">
            {{ row.models.length }} model{{ row.models.length === 1 ? '' : 's' }}
          </span>
          <ChevronRight :size="12" class="pick-chevron" />
        </span>
      </button>
      <div v-if="catalogRows.length === 0" class="pick-status">
        暂无 catalog entry
      </div>
    </div>

    <!-- 底部 hint -->
    <p class="pick-hint">
      v0.1 内置只 {{ totalModels }} 条；想加其他 model 走 "手动添加"。
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
  width: 100%;
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
.pick-search:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  font-size: 13px;
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

/* === Hint === */
.pick-hint {
  font-size: 11px;
  color: var(--text-muted);
  margin: 0;
  padding: 0 4px;
  flex-shrink: 0;
}
</style>
