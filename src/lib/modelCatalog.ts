// PlotCraft v0.1 built-in model catalog
//
// v0.1.3+ 设计：
// - BUILTIN_MODELS 不再自动展示在 chat selector —— chat selector 只显示玩家在
//   Settings → Providers 主动 add 的 custom provider 及其 defaultModel
// - BUILTIN_MODELS 暂时只留 1 条 MiniMax 官方占位（claude-sonnet-4-5）
//   只作为 ProviderEditModal "从模型库添加" dropdown 的候选源
// - 玩家要更多 model 走 "手动添加"（id + name 两个 input）或者 Locus import
// - 不 import Locus 文件（AGENTS.md 硬规则 #1）
// - v0.2+ 走远端 fetch + snapshot 缓存（schema 留口子）

import type { EffortLevel } from './settings'

export interface BuiltinModel {
  /** model id，发送给 LLM API（如 `"gpt-4o-mini"`） */
  id: string
  /** UI 显示名（如 `"GPT-4o mini"`） */
  name: string
  /** provider 分类（对应后端 `ApiFormat` 路由） */
  provider: 'openai' | 'anthropic' | 'google' | 'custom'
  /** 上下文窗口 token 数 */
  contextWindow: number
  /** 默认勾选 / 第一次启动时填进 mainModel（v0.1.3+ 不再用，留字段兼容 Locus data） */
  isDefault?: boolean
  /** 备注（给玩家看的下拉 hint） */
  note?: string
  /** 该模型支持的 reasoning effort 列表（空 = 不支持 thinking 控制）
   *  跟 Locus `ModelOption.supportedEfforts` 同位（参考 Locus `types.ts:543`） */
  supportedEfforts?: EffortLevel[]
  /** 该模型默认的 effort（玩家没改时使用） */
  defaultEffort?: EffortLevel
}

/**
 * PlotCraft v0.1 内置模型列表 —— 只给 ProviderEditModal "从模型库添加" 用
 *
 * v0.1.3+：v0.1 暂时只留一个 MiniMax 官方主推的 Claude Sonnet 4.5 作为占位。
 * 玩家要更多 model 走 "手动添加"（id + name 两个 input）或者 Locus import。
 */
export const BUILTIN_MODELS: readonly BuiltinModel[] = [
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    contextWindow: 200_000,
    note: '200K context · MiniMax 官方主推',
    supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
  },
]

/** 按 id 查 model（找不到返回 undefined）—— ProviderEditModal 用 */
export function findModel(id: string): BuiltinModel | undefined {
  return BUILTIN_MODELS.find((m) => m.id === id)
}

/** 拿一个 model 的 supported efforts（强制 `none` 永远在第一位） */
export function getSupportedEfforts(model: BuiltinModel | undefined): EffortLevel[] {
  const all: EffortLevel[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max']
  if (!model || !model.supportedEfforts || model.supportedEfforts.length === 0) {
    return all
  }
  // 确保 `none` 永远在第一位（即便 model.supportedEfforts 没显式列）
  const supported = new Set<EffortLevel>(model.supportedEfforts)
  if (!supported.has('none')) {
    return ['none', ...model.supportedEfforts]
  }
  return model.supportedEfforts
}

/** 拿一个 model 的默认 effort（找不到 / 自定义 → `none`） */
export function getDefaultEffort(model: BuiltinModel | undefined): EffortLevel {
  return model?.defaultEffort ?? 'none'
}

// === Grouping for Locus-style ModelEffortSelector ===
//
// v0.1.3+：chat selector 不再分组 builtin models —— 只显示玩家 add 的 custom providers。
// 每个 custom provider 各自一个段头（DEEPSEEK / MINIMAX / WINKY-XXX 风格，段头大写）。
// 数据从 SessionView 传过来（`customProviderShortcuts`），组件只负责按段头渲染。

/** Selector 用的 model group（参考 Locus `ModelSelectorGroup`） */
export interface ModelSelectorGroup {
  key: string
  label: string
  /** 段头 lowercase 还是 normal case（v0.1.2+ Locus 风格：custom provider 段头大写 UPPERCASE） */
  uppercaseLabel: boolean
  /** custom provider 段头：单个 model option（用 provider.defaultModel 当 id） */
  customProvider?: { id: string; name: string; defaultModel: string }
}

/** v0.1.2+ 玩家 enabled 且有 defaultModel 的 custom provider 各自一个段头
 *  段头 label = provider.name（Locus 风格，UI 渲染时大写） */
export function groupCustomProviderShortcuts(
  customProviders: { id: string; name: string; defaultModel: string }[],
): ModelSelectorGroup[] {
  return customProviders.map((cp) => ({
    key: `custom:${cp.id}`,
    label: cp.name,
    uppercaseLabel: true, // Locus DEEPSEEK / WINKY-XXX 大写段头
    customProvider: cp,
  }))
}
