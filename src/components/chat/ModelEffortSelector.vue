<script setup lang="ts">
// ModelEffortSelector —— chat composer 左下角的 model + effort 选择器
//
// 视觉 + 交互镜像 Locus `ModelEffortSelector.vue`（AGENTS.md 硬规则 #1：结构对齐，代码自写）：
// - 单 trigger button：model 名 + effort 标签（带颜色）+ chevron ▾
// - 点开 → 双 panel 下拉：
//   - 左 panel：models 按 provider 分组（OpenAI / Anthropic 段头）
//   - 右 panel：effort 列表（None / Low / Med / High / XHigh / Max）
// - 位置：trigger 上方弹出（bottom: calc(100% + 6px)）
// - 交互：click outside 关闭 + transition（opacity + translateY）
// - 颜色：effort 等级映射到 Locus 同款（low=绿 / med=黄 / high/xhigh/max=橙）
//
// v0.1+ 行为：
// - 没 model 时 trigger 显示 "Model" placeholder
// - streaming 时 disabled（避免 race）
// - 不在 builtin 列表的 model（玩家手填）也允许 —— 显示原 id 作 trigger label
// - fast mode 跳过（PlotCraft v0.1 不接 codex / subagent）

import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  groupModelsForSelector,
  findModel,
  getSupportedEfforts,
  type BuiltinModel,
} from '@/lib/modelCatalog'
import { EFFORT_LABELS, type EffortLevel } from '@/lib/settings'

const props = defineProps<{
  /** builtin models（按 apiFormat 过滤后的子集） */
  models: BuiltinModel[]
  /** 当前选中的 model id（可能不在 models 列表里） */
  selectedId: string
  /** 当前 effort */
  effort: EffortLevel
  /** 强制提供的 effort 列表（覆盖 model.supportedEfforts） */
  efforts?: EffortLevel[]
  /** 当前 model 是否支持 effort（false → 右 panel 隐藏） */
  effortSupported?: boolean
  /** 弹层对齐：start=左对齐, end=右对齐（默认） */
  align?: 'start' | 'end'
  disabled?: boolean
}>()

const emit = defineEmits<{
  selectModel: [id: string]
  selectEffort: [level: EffortLevel]
}>()

const open = ref(false)
const selectorRef = ref<HTMLElement | null>(null)

// === Locs of selected state ===
const selectedModel = computed<BuiltinModel | null>(
  () => findModel(props.selectedId) ?? null,
)

/** trigger 按钮显示名（找不到 builtin → 简化原 id）
 *
 *  v0.1 处理逻辑（跟 Locus `optionDisplayName` 一致）：
 *  1. builtin 找到 → 用 `model.name`（例 "GPT-4o mini"）
 *  2. builtin 找不到但 id 含 `/`（OpenRouter / proxy 风格 `provider/model`）→ 取最后一段
 *     例 "openrouter/claude-sonnet-4.6" → "claude-sonnet-4.6"
 *  3. 完全自定义 → 原 id，超过 24 字符截断 + …（避免撑爆 trigger）
 *  4. 多个 builtin model 同名（不同 provider）→ 加 provider prefix
 */
const TRIGGER_MAX_LEN = 24
const selectedDisplayName = computed(() => {
  const m = selectedModel.value
  if (m) {
    // builtin 找到 + 无重名 → 用 friendly name
    const duplicated = props.models.some(
      (other) => other.id !== m.id && other.name === m.name,
    )
    if (!duplicated) return m.name
    return `${providerLabel(m.provider)} / ${m.name}`
  }
  // builtin 找不到 → 处理原 id
  const raw = props.selectedId
  if (!raw) return 'Model'
  // OpenRouter 风格 "provider/model" → 取 model 部分
  const slashIdx = raw.lastIndexOf('/')
  const cleaned = slashIdx >= 0 ? raw.slice(slashIdx + 1) : raw
  if (cleaned.length <= TRIGGER_MAX_LEN) return cleaned
  return cleaned.slice(0, TRIGGER_MAX_LEN - 1) + '…'
})

/** 当前 model 支持的 effort 列表（按 EFFORT_ORDER 排序） */
const levels = computed<EffortLevel[]>(() => {
  if (props.efforts && props.efforts.length > 0) {
    return props.efforts
  }
  return getSupportedEfforts(selectedModel.value ?? undefined)
})

/** 当前选中的 effort 在 trigger 里的显示 label（CamelCase 跟 Locus 同款）
 *
 *  effort = 'none' → 不显示（避免 trigger 太乱；玩家想关 effort 就当不显示）
 *  其他 → 显示 EFFORT_LABELS[effort]（如 "XHigh" / "Max" / "Med"）
 */
const currentLevelLabel = computed<string | null>(() => {
  if (!props.effortSupported) return null
  if (props.effort === 'none') return null
  return EFFORT_LABELS[props.effort]
})

/** grouped models（左 panel） */
const groupedModels = computed(() => groupModelsForSelector(props.models))

/** trigger 整 title（hover tooltip） */
const triggerTitle = computed(() => {
  const modelTitle = selectedDisplayName.value
  if (!props.effortSupported) return modelTitle
  return `${modelTitle} · ${EFFORT_LABELS[props.effort]}`
})

function providerLabel(provider: BuiltinModel['provider']): string {
  switch (provider) {
    case 'openai':
      return 'OpenAI'
    case 'anthropic':
      return 'Anthropic'
    case 'google':
      return 'Google'
    case 'custom':
      return 'Custom'
  }
}

/** effort 颜色（跟 Locus `levelColor` 一致） */
function levelColor(level: EffortLevel): string {
  switch (level) {
    case 'low':
      return 'var(--thinking-low, #38a169)'
    case 'medium':
      return 'var(--thinking-medium, #d69e2e)'
    case 'high':
      return 'var(--thinking-high, #dd6b20)'
    case 'xhigh':
      return 'var(--thinking-xhigh, #c05621)'
    case 'max':
      return 'var(--thinking-xhigh, #c05621)'
    default:
      return 'var(--text-muted)'
  }
}

function toggle() {
  if (props.disabled) return
  open.value = !open.value
}

function selectModel(id: string) {
  emit('selectModel', id)
  // 选 model 后不下拉关闭（跟 Locus 一致，关闭只在选 effort 或外部点击）
}

function selectEffort(level: EffortLevel) {
  emit('selectEffort', level)
  open.value = false
}

function onClickOutside(e: MouseEvent) {
  if (!open.value) return
  if (selectorRef.value && !selectorRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside))
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside))
</script>

<template>
  <div class="model-effort-selector" :class="{ open, 'align-end': align !== 'start' }" ref="selectorRef">
    <button
      class="model-effort-trigger"
      :class="{ open, disabled }"
      type="button"
      :title="triggerTitle"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="model-effort-model">{{ selectedDisplayName }}</span>
      <span
        v-if="currentLevelLabel"
        class="model-effort-level"
        :style="{ color: levelColor(props.effort) }"
      >
        {{ currentLevelLabel }}
      </span>
      <span class="model-effort-chevron">▾</span>
    </button>

    <Transition name="dropdown">
      <div
        v-if="open"
        class="model-effort-dropdown"
        :class="{
          'has-effort': props.effortSupported !== false,
          'align-end': align !== 'start',
        }"
      >
        <div class="model-effort-model-panel">
          <template v-if="groupedModels.length === 0">
            <div class="model-effort-empty">没有可用的 model —— 先在 Settings 填 API key + 选 provider</div>
          </template>
          <template
            v-for="(group, gi) in groupedModels"
            :key="group.key"
          >
            <div v-if="gi > 0" class="model-effort-divider"></div>
            <div class="model-effort-section-label">{{ group.label }}</div>
            <button
              v-for="model in group.models"
              :key="model.id"
              type="button"
              class="model-effort-option"
              :class="{ active: model.id === selectedId }"
              @click="selectModel(model.id)"
            >
              <span class="model-effort-option-name">{{ model.name }}</span>
              <span
                v-if="model.id === selectedId && currentLevelLabel"
                class="model-effort-option-tag"
                :style="{ color: levelColor(props.effort) }"
              >
                {{ currentLevelLabel }}
              </span>
            </button>
          </template>
        </div>

        <div
          v-if="props.effortSupported !== false"
          class="model-effort-effort-panel"
        >
          <div class="model-effort-section-label">Effort</div>
          <button
            v-for="level in levels"
            :key="level"
            type="button"
            class="model-effort-option"
            :class="{ active: level === props.effort }"
            @click="selectEffort(level)"
          >
            <span
              class="model-effort-option-name"
              :style="level === props.effort ? { color: levelColor(level), fontWeight: 600 } : {}"
            >
              {{ EFFORT_LABELS[level] }}
            </span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* === 镜像 Locus ModelEffortSelector 样式（结构对齐，代码自写） === */
.model-effort-selector {
  position: relative;
  display: inline-flex;
  flex-shrink: 1;
  min-width: 0;
  margin-right: 4px;
}
.model-effort-selector.open {
  z-index: 50; /* 高于 composer / transcript */
}

.model-effort-trigger {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  min-height: 28px;
  max-width: min(280px, 100%);
  padding: 4px 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
  white-space: nowrap;
}
.model-effort-trigger:hover:not(.disabled) {
  color: var(--text);
  background: var(--hover);
}
.model-effort-trigger.open {
  color: var(--text);
  background: var(--hover);
}
.model-effort-trigger.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.model-effort-model {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.model-effort-level {
  flex-shrink: 0;
  font-weight: 600; /* 比 trigger 其他文字粗，让 effort 标签更显眼 */
  letter-spacing: 0.2px;
  /* 不强制 text-transform：EFFORT_LABELS 已经是 CamelCase（"XHigh" / "Max"） */
}
.model-effort-chevron {
  flex-shrink: 0;
  font-size: 10px;
  transition: transform 0.15s ease;
}
.model-effort-trigger.open .model-effort-chevron {
  transform: rotate(180deg);
}

/* === Dropdown === */
.model-effort-dropdown {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  right: auto;
  min-width: 220px;
  max-width: min(420px, calc(100vw - 24px));
  max-height: min(420px, calc(100vh - 160px));
  overflow: hidden;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 50;
  transform-origin: bottom left;
}
.model-effort-dropdown.align-end {
  left: auto;
  right: 0;
  transform-origin: bottom right;
}
.model-effort-dropdown.has-effort {
  width: min(420px, calc(100vw - 24px));
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px;
}

.model-effort-model-panel,
.model-effort-effort-panel {
  min-width: 0;
  max-height: min(404px, calc(100vh - 176px));
  overflow-y: auto;
}
.model-effort-effort-panel {
  border-left: 1px solid var(--border);
  padding-left: 4px;
}

.model-effort-section-label {
  padding: 4px 12px 2px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  opacity: 0.7;
}
.model-effort-divider {
  height: 1px;
  margin: 4px 8px;
  background: var(--border);
}
.model-effort-empty {
  padding: 12px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}

.model-effort-option {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}
.model-effort-option:hover {
  background: var(--hover);
}
.model-effort-option.active {
  background: var(--accent-soft);
}
.model-effort-option-name {
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-effort-option-tag {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  /* 不强制 text-transform：EFFORT_LABELS 已经是 CamelCase */
}

/* === Dropdown transition === */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
