<script setup lang="ts">
// v0.4+ AI 工具设置 —— 玩家在 Settings tab 控制每个 tool 的开关 + 权限
//
// 设计：
// - **两个 sub-tab**（Locus 风格的"工具 / 工具权限"）：
//   - 工具：enabled 开关（关闭的 tool 不在 LLM request body → LLM 完全不知道存在）
//   - 工具权限：每个 tool 的 auto / ask / deny 策略（玩家主导安全机制）
// - 修改后自动落盘（settings.store v0.1.5+ 自动 save）—— 跟其他设置一致
// - 工具列表从 `BUILTIN_TOOLS` 读，自动跟 lib/ai-tools.ts 同步
//
// 跟 Locus 关键差异：
// - Locus 是 AI 主导（几十个 tool 玩家可控制）
// - PlotCraft v0.4+ 只 3 个 tool（玩家主导原则 → 工具精简）

import { computed, ref } from 'vue'
import { Lock, ShieldCheck, Sparkles } from 'lucide-vue-next'

import {
  BUILTIN_TOOLS,
  normalizeToolsConfig,
  type ToolPermission,
  type ToolsConfig,
} from '@/lib/ai-tools'
import { useSettingsStore } from '@/stores/settings'

const settings = useSettingsStore()

const activeSubTab = ref<'enable' | 'permission'>('enable')

/** 标准化过的 tool settings（缺字段补 default） */
const tools = computed<ToolsConfig>(() =>
  normalizeToolsConfig((settings.config as Record<string, unknown>).tools),
)

async function onToggleEnabled(name: keyof ToolsConfig, enabled: boolean) {
  const prev = tools.value[name]
  const newTools: ToolsConfig = { ...tools.value, [name]: { ...prev, enabled } }
  ;(settings.config as Record<string, unknown>).tools = newTools
  try {
    await settings.save()
    console.log(`[ToolsSettings] ${name} enabled=${enabled} saved`)
  } catch (e) {
    console.error('[ToolsSettings] save failed:', e)
  }
}

async function onChangePermission(name: keyof ToolsConfig, permission: ToolPermission) {
  const prev = tools.value[name]
  const newTools: ToolsConfig = { ...tools.value, [name]: { ...prev, permission } }
  ;(settings.config as Record<string, unknown>).tools = newTools
  try {
    await settings.save()
    console.log(`[ToolsSettings] ${name} permission=${permission} saved`)
  } catch (e) {
    console.error('[ToolsSettings] save failed:', e)
  }
}

const PERMISSION_OPTIONS: { value: ToolPermission; label: string; desc: string }[] = [
  {
    value: 'auto',
    label: '自动',
    desc: 'LLM 调了就直接执行（适合只读 / 只问类）',
  },
  {
    value: 'ask',
    label: '询问',
    desc: 'LLM 调了弹"AI 建议 X，确认吗" → 玩家点确认才执行（推荐写编辑器类）',
  },
  {
    value: 'deny',
    label: '禁止',
    desc: 'LLM 调了直接拒绝（schema 仍存在但运行时被拦）',
  },
]
</script>

<template>
  <div class="tools-settings">
    <header class="header">
      <Sparkles :size="16" />
      <h3>AI 工具</h3>
    </header>

    <div class="sub-tabs">
      <button
        type="button"
        class="sub-tab"
        :class="{ active: activeSubTab === 'enable' }"
        @click="activeSubTab = 'enable'"
      >
        工具
      </button>
      <button
        type="button"
        class="sub-tab"
        :class="{ active: activeSubTab === 'permission' }"
        @click="activeSubTab = 'permission'"
      >
        工具权限
      </button>
    </div>

    <!-- 工具 sub-tab：每个 tool 的 enabled 开关 -->
    <section v-if="activeSubTab === 'enable'" class="sub-section">
      <p class="hint">
        控制 AI 编剧搭档可以调用哪些工具。关闭的工具既不出现在 LLM 的 tools 字段，也不会在 system prompt 描述 —— AI 完全不知道存在。
      </p>
      <div class="tool-list">
        <div
          v-for="tool in BUILTIN_TOOLS"
          :key="tool.name"
          class="tool-item"
          :class="{ disabled: !tools[tool.name]?.enabled }"
        >
          <div class="tool-info">
            <div class="tool-header">
              <span class="tool-label">{{ tool.label }}</span>
              <span
                v-if="tool.risk === 'medium'"
                class="tool-risk"
                title="中等风险：AI 可自动写入编辑器内容"
              >
                <ShieldCheck :size="10" />
                写编辑器
              </span>
            </div>
            <div class="tool-desc">{{ tool.description }}</div>
            <div class="tool-name">{{ tool.name }}</div>
          </div>
          <label class="toggle">
            <input
              type="checkbox"
              :checked="tools[tool.name]?.enabled ?? true"
              @change="(e) => onToggleEnabled(tool.name, (e.target as HTMLInputElement).checked)"
            />
            <span class="toggle-slider" />
          </label>
        </div>
      </div>
      <div class="footer-note">
        <strong>玩家主导原则</strong>：这些工具都是 LLM 给玩家建议或问问题，AI 不会主动覆盖你写的内容。
      </div>
    </section>

    <!-- 工具权限 sub-tab：每个 tool 的 auto / ask / deny -->
    <section v-else class="sub-section">
      <p class="hint">
        控制 AI 调工具时的确认策略。<strong>自动</strong>直接执行，<strong>询问</strong>弹确认对话框，<strong>禁止</strong>运行时拒绝。
      </p>
      <div class="tool-list">
        <div
          v-for="tool in BUILTIN_TOOLS"
          :key="tool.name"
          class="tool-item permission-item"
          :class="{ disabled: !tools[tool.name]?.enabled }"
        >
          <div class="tool-info">
            <div class="tool-header">
              <span class="tool-label">{{ tool.label }}</span>
              <span
                v-if="!tools[tool.name]?.enabled"
                class="tool-badge-disabled"
                title="工具已关闭，权限策略不生效"
              >
                <Lock :size="10" />
                已关闭
              </span>
            </div>
            <div class="tool-desc">{{ tool.description }}</div>
            <div class="tool-name">{{ tool.name }}</div>
          </div>
          <div class="permission-radios">
            <label
              v-for="opt in PERMISSION_OPTIONS"
              :key="opt.value"
              class="radio"
              :class="{ active: tools[tool.name]?.permission === opt.value, disabled: !tools[tool.name]?.enabled }"
              :title="opt.desc"
            >
              <input
                type="radio"
                :name="`permission-${tool.name}`"
                :value="opt.value"
                :checked="tools[tool.name]?.permission === opt.value"
                :disabled="!tools[tool.name]?.enabled"
                @change="onChangePermission(tool.name, opt.value)"
              />
              <span>{{ opt.label }}</span>
            </label>
          </div>
        </div>
      </div>
      <div class="footer-note">
        <strong>推荐</strong>：问问题类工具（ask_choose_option / ask_user_question）→ 自动；改编辑器类（update_doc_item）→ 询问。
      </div>
    </section>
  </div>
</template>

<style scoped>
.tools-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 720px;
}
.header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
}
.header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

/* v0.4+ Locus 风格 sub-tabs */
.sub-tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.sub-tab {
  padding: 6px 14px;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  margin-bottom: -1px;
}
.sub-tab:hover {
  color: var(--text);
}
.sub-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.sub-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hint {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0;
}
.tool-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tool-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 6px;
  transition: opacity 0.12s, border-color 0.12s;
}
.tool-item.disabled {
  opacity: 0.55;
  border-style: dashed;
}
.tool-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tool-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.tool-risk {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--warning, #d9822b) 18%, transparent);
  color: var(--warning, #d9822b);
  border: 1px solid color-mix(in srgb, var(--warning, #d9822b) 40%, transparent);
}
.tool-badge-disabled {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-muted) 18%, transparent);
  color: var(--text-muted);
  border: 1px solid color-mix(in srgb, var(--text-muted) 40%, transparent);
}
.tool-desc {
  font-size: 12px;
  color: var(--text);
  line-height: 1.4;
}
.tool-name {
  font-size: 10px;
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

/* 权限 sub-tab radio buttons */
.permission-item {
  align-items: flex-start;
}
.permission-radios {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  align-self: center;
}
.radio {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  transition: all 0.12s;
}
.radio:hover:not(.disabled) {
  border-color: var(--accent);
  color: var(--text);
}
.radio input {
  display: none;
}
.radio.active {
  background: var(--accent-soft, color-mix(in srgb, var(--accent) 15%, transparent));
  color: var(--accent);
  border-color: var(--accent);
  font-weight: 600;
}
.radio.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* 工具 sub-tab toggle switch */
.toggle {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
  cursor: pointer;
  align-self: center;
}
.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--border);
  border-radius: 10px;
  transition: background 0.15s;
}
.toggle-slider::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  transition: transform 0.15s;
}
.toggle input:checked + .toggle-slider {
  background: var(--accent);
}
.toggle input:checked + .toggle-slider::before {
  transform: translateX(16px);
}
.footer-note {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.6;
  margin-top: 4px;
  padding: 8px 12px;
  background: var(--bg-elev);
  border-left: 3px solid var(--accent);
  border-radius: 4px;
}
</style>
