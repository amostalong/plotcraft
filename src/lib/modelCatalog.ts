// PlotCraft v0.1 built-in model catalog
//
// v0.1.3+ 设计：
// - BUILTIN_MODELS 不再自动展示在 chat selector —— chat selector 只显示玩家在
//   Settings → Providers 主动 add 的 custom provider 及其 defaultModel
// - BUILTIN_MODELS 仍然存在，只作为 ProviderEditModal "从模型库添加" dropdown 的候选源
//   （玩家在 add provider 时可以快速挑已知模型 + 拿 context window / default effort 元数据）
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
 * 选取原则：
 * 1. OpenAI 官方主力（gpt-4o / gpt-4o-mini / o1 / o3-mini）—— 真实 OpenAI endpoint 用
 * 2. 主流 OpenAI 兼容模型（DeepSeek / Qwen / Llama）—— 自建 endpoint / proxy 用
 * 3. Anthropic 官方主力（claude-opus-4-1 / sonnet-4-5 / 3-5-sonnet）—— Anthropic endpoint 用
 */
export const BUILTIN_MODELS: readonly BuiltinModel[] = [
  // --- OpenAI 官方 ---
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    contextWindow: 128_000,
    note: '128K context · 旗舰多模态',
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    provider: 'openai',
    contextWindow: 128_000,
    note: '128K context · 默认 · 便宜',
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    provider: 'openai',
    contextWindow: 128_000,
    note: '128K context · 老旗舰',
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    provider: 'openai',
    contextWindow: 16_385,
    note: '16K context · 极便宜',
  },
  {
    id: 'o1',
    name: 'o1',
    provider: 'openai',
    contextWindow: 200_000,
    note: '200K context · reasoning',
    supportedEfforts: ['none', 'low', 'medium', 'high'],
    defaultEffort: 'high',
  },
  {
    id: 'o1-mini',
    name: 'o1 mini',
    provider: 'openai',
    contextWindow: 128_000,
    note: '128K context · 轻量 reasoning',
    supportedEfforts: ['none', 'low', 'medium', 'high'],
    defaultEffort: 'high',
  },
  {
    id: 'o1-preview',
    name: 'o1 preview',
    provider: 'openai',
    contextWindow: 128_000,
    note: '128K context · 老 reasoning',
    supportedEfforts: ['none', 'low', 'medium', 'high'],
    defaultEffort: 'high',
  },
  {
    id: 'o3-mini',
    name: 'o3 mini',
    provider: 'openai',
    contextWindow: 200_000,
    note: '200K context · 新 reasoning',
    supportedEfforts: ['none', 'low', 'medium', 'high'],
    defaultEffort: 'high',
  },
  {
    id: 'o4-mini',
    name: 'o4 mini',
    provider: 'openai',
    contextWindow: 200_000,
    note: '200K context · 新 reasoning',
    supportedEfforts: ['none', 'low', 'medium', 'high'],
    defaultEffort: 'high',
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek-V3 Chat',
    provider: 'openai',
    contextWindow: 64_000,
    note: '64K context · 兼容 openai_chat',
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek-R1',
    provider: 'openai',
    contextWindow: 64_000,
    note: '64K context · reasoning · 兼容 openai_chat',
    supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
  },
  {
    id: 'qwen-plus',
    name: 'Qwen Plus',
    provider: 'openai',
    contextWindow: 128_000,
    note: '128K context · 阿里云',
  },
  {
    id: 'qwen-turbo',
    name: 'Qwen Turbo',
    provider: 'openai',
    contextWindow: 128_000,
    note: '128K context · 阿里云便宜',
  },
  {
    id: 'llama-3.1-70b',
    name: 'Llama 3.1 70B',
    provider: 'openai',
    contextWindow: 128_000,
    note: '128K context · Meta',
  },

  // --- Anthropic 官方 ---
  {
    id: 'claude-opus-4-1',
    name: 'Claude Opus 4.1',
    provider: 'anthropic',
    contextWindow: 200_000,
    note: '200K context · 旗舰',
    supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    contextWindow: 200_000,
    note: '200K context · 主力',
    supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
  },
  {
    id: 'claude-3-5-sonnet-latest',
    name: 'Claude 3.5 Sonnet (latest)',
    provider: 'anthropic',
    contextWindow: 200_000,
    note: '200K context · 老主力',
    supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
  },
  {
    id: 'claude-3-5-haiku-latest',
    name: 'Claude 3.5 Haiku (latest)',
    provider: 'anthropic',
    contextWindow: 200_000,
    note: '200K context · 便宜快',
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
