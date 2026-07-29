<script setup lang="ts">
// ModelLibraryPanel —— ProviderEditModal 内嵌的"模型库"面板（仿 Locus 同款）
//
// 视觉 + 交互镜像 Locus `ProviderModelsEditor` 的 model library section：
// - 标题 + 展开/收起 toggle + 总数提示
// - 搜索框（按 provider 名 / endpoint / model id / model name 过滤）
// - provider 分组列表：每个 provider 显示名字 + endpoint，下面列出 model
// - 每个 model：name + 上下文徽标 + reasoning 徽标（R）
// - 点 model → emit('addModel', m) → ProviderEditModal 加到 draftModels
//
// v0.1 简化：catalog 只 1 条 BUILTIN_MODELS（claude-sonnet-4-5 / Anthropic），
// 1 个 provider 组 + 1 个 model。结构跟 Locus 同款，未来加 catalog entry 直接扩。
// 已加进 draftModels 的 model id 自动从列表隐藏。

import { computed, ref } from 'vue'
import { ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-vue-next'
import { BUILTIN_MODELS, type BuiltinModel } from '@/lib/modelCatalog'
import { DEFAULT_ENDPOINTS, type ApiFormat } from '@/lib/settings'

const props = defineProps<{
  /** 已经加进 draft 的 model id 列表 —— 这些从库列表里隐藏 */
  existingModelIds: string[]
  /** 默认是否展开（v0.1 默认展开） */
  defaultExpanded?: boolean
  /** 整个 panel disable（保存中） */
  disabled?: boolean
}>()

const emit = defineEmits<{
  /** 点 model → 加到 draft */
  addModel: [model: BuiltinModel]
}>()

const expanded = ref(props.defaultExpanded !== false)
const query = ref('')

/** 搜索关键词 normalize：小写 + 去空白 —— 跟 Locus `normalizeModelSearch` 一致 */
const search = computed(() => query.value.toLowerCase().replace(/\s+/g, '').trim())

const PROVIDER_LABELS: Record<BuiltinModel['provider'], string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  custom: 'Custom',
}

/** 按 provider 分组 catalog（每个 provider 一组） */
interface ProviderGroup {
  provider: BuiltinModel['provider']
  label: string
  endpoint: string
  models: BuiltinModel[]
}

const providerGroups = computed<ProviderGroup[]>(() => {
  const groups = new Map<BuiltinModel['provider'], BuiltinModel[]>()
  for (const m of BUILTIN_MODELS) {
    if (!groups.has(m.provider)) groups.set(m.provider, [])
    groups.get(m.provider)!.push(m)
  }
  const existing = new Set(props.existingModelIds)
  const out: ProviderGroup[] = []
  for (const [provider, models] of groups) {
    const apiFormat: ApiFormat =
      provider === 'anthropic' ? 'anthropic_messages' : 'openai_chat'
    out.push({
      provider,
      label: PROVIDER_LABELS[provider] ?? provider,
      endpoint: DEFAULT_ENDPOINTS[apiFormat],
      models: models.filter((m) => !existing.has(m.id)),
    })
  }
  return out
})

/** 搜索过滤后剩下的 provider（空 model 数组过滤掉） */
const filteredGroups = computed<ProviderGroup[]>(() => {
  const q = search.value
  return providerGroups.value
    .map((g) => {
      if (!q) return g
      const hitProvider = g.label.toLowerCase().includes(q) || g.endpoint.toLowerCase().includes(q)
      const filteredModels = g.models.filter(
        (m) =>
          hitProvider ||
          m.id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          (m.note ?? '').toLowerCase().includes(q),
      )
      return { ...g, models: filteredModels }
    })
    .filter((g) => g.models.length > 0)
})

/** 总数提示 */
const totalCount = computed(() => {
  const shown = filteredGroups.value.reduce((sum, g) => sum + g.models.length, 0)
  const total = BUILTIN_MODELS.length
  if (search.value) return `${shown} / ${total} 个 model`
  return `${total} 个 model`
})

/** model 是否支持 reasoning（有 supportedEfforts）*/
function isReasoning(m: BuiltinModel): boolean {
  return !!m.supportedEfforts && m.supportedEfforts.length > 0
}

/** 上下文窗口格式化 "200000" → "200K" */
function formatCtx(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

function onPick(m: BuiltinModel) {
  if (props.disabled) return
  emit('addModel', m)
}
</script>

<template>
  <div class="model-library" :class="{ collapsed: !expanded }">
    <!-- 标题行：库名 + 展开/收起 toggle + 总数 -->
    <div class="library-header">
      <button
        type="button"
        class="library-toggle"
        :disabled="disabled"
        @click="expanded = !expanded"
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
            placeholder="搜索供应商或模型（如 anthropic、claude、sonnet）"
            spellcheck="false"
          />
        </div>
        <button
          type="button"
          class="library-refresh"
          :disabled="disabled"
          title="刷新 catalog（v0.1 暂未接远端）"
        >
          <RefreshCw :size="11" />
        </button>
      </div>

      <p v-if="!search" class="library-hint">
        v0.1 内置只 {{ BUILTIN_MODELS.length }} 条；想加其他 model 走 "手动添加 model"。
      </p>
      <p v-else class="library-hint">搜索 "{{ query }}" 的结果</p>

      <div v-if="filteredGroups.length === 0" class="library-empty">
        {{ search ? '没有匹配的 model' : '模型库里没有可加的 model（都已加）' }}
      </div>

      <div v-else class="library-list">
        <div
          v-for="group in filteredGroups"
          :key="group.provider"
          class="library-provider"
        >
          <div class="library-provider-header">
            <span class="library-provider-name">{{ group.label }}</span>
            <code class="library-provider-endpoint">{{ group.endpoint }}</code>
          </div>
          <button
            v-for="m in group.models"
            :key="m.id"
            type="button"
            class="library-model"
            :disabled="disabled"
            @click="onPick(m)"
          >
            <span class="library-model-name">{{ m.name }}</span>
            <span class="library-model-badges">
              <span v-if="m.contextWindow" class="badge badge-ctx">
                {{ formatCtx(m.contextWindow) }}
              </span>
              <span v-if="isReasoning(m)" class="badge badge-r" title="支持 reasoning effort">
                R
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

.library-hint {
  margin: 0;
  padding: 0 2px;
  font-size: 10.5px;
  color: var(--text-muted);
  line-height: 1.4;
}

/* === List === */
.library-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
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

.library-empty {
  padding: 12px 8px;
  font-size: 11.5px;
  color: var(--text-muted);
  text-align: center;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 6px;
}
</style>
