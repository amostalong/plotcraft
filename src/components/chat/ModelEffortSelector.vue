<script setup lang="ts">
// ModelEffortSelector —— chat composer 左下角的 model + effort 选择器
//
// 视觉 + 交互镜像 Locus `ModelEffortSelector.vue`（AGENTS.md 硬规则 #1：结构对齐，代码自写）：
// - 单 trigger button：model 名 + effort 标签（带颜色）+ chevron ▾
// - 点开 → 双 panel 下拉：
//   - 左 panel：models 按 custom provider 分段（每个 provider 一个段头，Locus DEEPSEEK / WINKY-XXX 风格）
//   - 右 panel：effort 列表（None / Low / Med / High / XHigh / Max）
// - 位置：trigger 上方弹出（bottom: calc(100% + 6px)）
// - 交互：click outside 关闭 + transition（opacity + translateY）
// - 颜色：effort 等级映射到 Locus 同款（low=绿 / med=黄 / high/xhigh/max=橙）
//
// v0.1+ 行为（不再自动展示 BUILTIN_MODELS）：
// - 数据源：customProviderShortcuts（玩家在 Settings 主动 add 的 provider）
// - 0 个 provider → trigger "Select model" placeholder + dropdown 显示空状态提示
// - streaming 时 disabled（避免 race）
// - 玩家手填 / stale model id 仍允许：cleanupModelId 当 trigger label
// - fast mode 跳过（PlotCraft v0.1 不接 codex / subagent）

import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  groupCustomProviderShortcuts,
  type ModelSelectorGroup,
} from '@/lib/modelCatalog'
import { EFFORT_LABELS, type EffortLevel } from '@/lib/settings'

const props = defineProps<{
  /** 当前选中的 model id（可能不在任何 custom provider 的 defaultModel 里） */
  selectedId: string
  /** 当前 effort */
  effort: EffortLevel
  /** 当前 model 是否支持 effort（false → 右 panel 隐藏）
   *  v0.1+ 玩家加的 custom model 不知道具体支持哪些 effort，best-effort 一律 true */
  effortSupported?: boolean
  /** 弹层对齐：start=左对齐, end=右对齐（默认） */
  align?: 'start' | 'end'
  /** v0.4.1+ 弹层位置：top=trigger 上方（默认，composer 在底部时用），
   *  bottom=trigger 下方（header 在 panel 顶部时用，避免撞 stepper / editor） */
  placement?: 'top' | 'bottom'
  disabled?: boolean
  /** v0.1+ 玩家保存的 custom providers（仅 enabled 且有 defaultModel 的会显示）
   *  TS 端只给名字 + id + defaultModel（不传 apiKey / baseUrl，避免泄露） */
  customProviderShortcuts?: { id: string; name: string; defaultModel: string }[]
  /** v0.1.5+ 没填 model 的 enabled provider 数 —— empty state 文案分流
   *  > 0 → 提示"有 N 个 provider 但没填 model"，玩家去 Settings 加 model
   *  = 0 → 真正"0 个 provider"，提示去 add provider */
  unconfiguredProviderCount?: number
}>()

const emit = defineEmits<{
  selectModel: [id: string]
  selectEffort: [level: EffortLevel]
}>()

const open = ref(false)
const selectorRef = ref<HTMLElement | null>(null)

/** 当前选中的 custom provider shortcut（selectedId 匹配某个 custom provider 的 defaultModel） */
const selectedCustomShortcut = computed(() => {
  if (!props.selectedId) return null
  if (!props.customProviderShortcuts) return null
  return (
    props.customProviderShortcuts.find(
      (cp) => cp.defaultModel === props.selectedId,
    ) ?? null
  )
})

/** trigger 按钮显示名（custom provider → "provider / model"，stale id → 简化 + 截断） */
const TRIGGER_MAX_LEN = 24
const selectedDisplayName = computed(() => {
  // 1. 匹配 custom provider 的 defaultModel → "<provider.name> / <cleaned id>"
  //    例 "winky-claude / claude-sonnet-5-20250929"
  if (selectedCustomShortcut.value) {
    const cp = selectedCustomShortcut.value
    return `${cp.name} / ${cleanupModelId(cp.defaultModel)}`
  }
  // 2. 完全自定义 / stale id（旧的 builtin gpt-4o-mini 等）→ 简化 + 截断
  const raw = props.selectedId
  if (!raw) return 'Select model'
  return cleanupModelId(raw)
})

/** 处理长 model id（OpenRouter 风格 + 截断） */
function cleanupModelId(id: string): string {
  const slashIdx = id.lastIndexOf('/')
  const cleaned = slashIdx >= 0 ? id.slice(slashIdx + 1) : id
  if (cleaned.length <= TRIGGER_MAX_LEN) return cleaned
  return cleaned.slice(0, TRIGGER_MAX_LEN - 1) + '…'
}

/** 当前 model 支持的 effort 列表 —— v0.1+ 全部 6 个都展示（best-effort：后端对不支持的 model 静默 no-op） */
const levels = computed<EffortLevel[]>(() => [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

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

/** grouped models（左 panel）—— 每个 custom provider 各自一个段头 */
const groupedModels = computed<ModelSelectorGroup[]>(() =>
  groupCustomProviderShortcuts(props.customProviderShortcuts ?? []),
)

/** trigger 整 title（hover tooltip） */
const triggerTitle = computed(() => {
  const modelTitle = selectedDisplayName.value
  if (!props.effortSupported) return modelTitle
  return `${modelTitle} · ${EFFORT_LABELS[props.effort]}`
})

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
  <div class="model-effort-selector" :class="{ open, 'align-end': align !== 'start', 'placement-bottom': placement === 'bottom' }" ref="selectorRef">
    <button
      class="model-effort-trigger"
      :class="{ open, disabled, empty: !selectedId }"
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
          'placement-bottom': placement === 'bottom',
        }"
      >
        <div class="model-effort-model-panel">
          <template v-if="groupedModels.length === 0">
            <div class="model-effort-empty">
              <template v-if="(props.unconfiguredProviderCount ?? 0) > 0">
                <!-- v0.1.5+ 分流：库里有 provider 但都没填 model -->
                <p>有 {{ unconfiguredProviderCount }} 个 provider，但都没填 model</p>
                <p class="model-effort-empty-hint">Settings → Providers 库点 ✎ Edit → 加 model</p>
              </template>
              <template v-else>
                <!-- 真正 0 provider：玩家还没 add 任何东西 -->
                <p>未添加任何 provider</p>
                <p class="model-effort-empty-hint">Settings → Providers 加一个</p>
              </template>
            </div>
          </template>
          <template
            v-else
            v-for="(group, gi) in groupedModels"
            :key="group.key"
          >
            <div v-if="gi > 0" class="model-effort-divider"></div>
            <div
              class="model-effort-section-label"
              :class="{ uppercase: group.uppercaseLabel }"
            >
              {{ group.label }}
            </div>

            <!-- custom provider 段头：单 model option（用 provider.defaultModel 当 id） -->
            <button
              v-if="group.customProvider"
              type="button"
              class="model-effort-option"
              :class="{ active: group.customProvider.defaultModel === selectedId }"
              @click="selectModel(group.customProvider.defaultModel)"
            >
              <span class="model-effort-option-name">
                {{ cleanupModelId(group.customProvider.defaultModel) }}
              </span>
              <span
                v-if="group.customProvider.defaultModel === selectedId && currentLevelLabel"
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
/* v0.1+ 没选 provider 时 trigger 文字明显灰一点（鼓励用户去加 provider） */
.model-effort-trigger.empty .model-effort-model {
  color: var(--text-muted);
  font-style: italic;
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
/* v0.4.1+ placement=bottom: trigger 在 panel 顶部时（AiChatPanel header）用，
   popover 弹在 trigger 下方，避免撞 stepper / editor */
.model-effort-dropdown.placement-bottom {
  bottom: auto;
  top: calc(100% + 6px);
  transform-origin: top left;
}
.model-effort-dropdown.align-end {
  left: auto;
  right: 0;
  transform-origin: bottom right;
}
.model-effort-dropdown.placement-bottom.align-end {
  transform-origin: top right;
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
  padding: 6px 12px 4px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.2px;
  color: var(--text-muted);
  /* builtin 段头不强制 uppercase（"OpenAI" / "Anthropic" 正常 case） */
}
.model-effort-section-label.uppercase {
  /* v0.1.2+ Locus 同款：custom provider 段头大写（"DEEPSEEK" / "WINKY-CLAUDE-SONNET-5"） */
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text);
  font-weight: 600;
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
.model-effort-empty p {
  margin: 0;
}
.model-effort-empty-hint {
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.8;
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
