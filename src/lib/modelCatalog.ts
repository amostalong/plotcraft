// PlotCraft v0.1 built-in model catalog
//
// v0.1 设计：
// - 静态列表，玩家选 / 手填都行（UI 用 HTML <datalist>，详见 [ModelDefaults.vue]）
// - 数据跟 Locus `stores/model.ts` 的 `codexFallbackModels` / `builtinModels` 子集对齐
// - provider 字段（`openai` / `anthropic`）跟后端 `ApiFormat` 对应：
//   - `openai` 兼容 `openai_chat` + `openai_responses` 两种 format
//   - `anthropic` 兼容 `anthropic_messages` 一种 format
// - v0.2+ 走远端 fetch + snapshot 缓存（schema 留 `modelCatalog: Option<ModelCatalog>`）
//
// 数据本身是公开模型名 + context window（厂商公开），不 import Locus 文件（AGENTS.md 硬规则）

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
  /** 默认勾选 / 第一次启动时填进 mainModel */
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
 * PlotCraft v0.1 内置模型列表
 *
 * 选取原则：
 * 1. OpenAI 官方主力（gpt-4o / gpt-4o-mini / o1 / o3-mini）—— 真实 OpenAI endpoint 用
 * 2. 主流 OpenAI 兼容模型（DeepSeek / Qwen / Llama）—— 自建 endpoint / proxy 用
 * 3. Anthropic 官方主力（claude-opus-4-1 / sonnet-4-5 / 3-5-sonnet）—— Anthropic endpoint 用
 *    （v0.1+ 支持 anthropic_messages API 格式后才有意义）
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
    isDefault: true,
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
    note: '200K context · 推理强',
    supportedEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
  },
  {
    id: 'o1-mini',
    name: 'o1 mini',
    provider: 'openai',
    contextWindow: 128_000,
    note: '128K context · 推理性价比',
    supportedEfforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
  },
  {
    id: 'o3-mini',
    name: 'o3 mini',
    provider: 'openai',
    contextWindow: 200_000,
    note: '200K context · 最新推理',
    supportedEfforts: ['none', 'low', 'medium', 'high'],
    defaultEffort: 'medium',
  },
  // --- OpenAI 兼容（自建 endpoint / proxy）---
  {
    id: 'deepseek-chat',
    name: 'DeepSeek-V3 (deepseek-chat)',
    provider: 'openai',
    contextWindow: 64_000,
    note: '64K · 走 https://api.deepseek.com/v1',
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek-R1 (deepseek-reasoner)',
    provider: 'openai',
    contextWindow: 64_000,
    note: '64K · 推理模型 · 慢',
    supportedEfforts: ['none', 'low', 'medium', 'high'],
    defaultEffort: 'medium',
  },
  {
    id: 'qwen-plus',
    name: 'Qwen Plus (DashScope OpenAI-compat)',
    provider: 'openai',
    contextWindow: 128_000,
    note: '128K · 走 DashScope 兼容端点',
  },
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B (Groq)',
    provider: 'openai',
    contextWindow: 128_000,
    note: '128K · 走 api.groq.com/openai/v1',
  },
  // --- Anthropic 官方 ---
  {
    id: 'claude-opus-4-1',
    name: 'Claude Opus 4.1',
    provider: 'anthropic',
    contextWindow: 200_000,
    note: '200K context · Anthropic 旗舰',
    supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'medium',
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    provider: 'anthropic',
    contextWindow: 200_000,
    note: '200K context · 性价比',
    supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'medium',
  },
  {
    id: 'claude-3-5-sonnet-latest',
    name: 'Claude 3.5 Sonnet (latest)',
    provider: 'anthropic',
    contextWindow: 200_000,
    note: '200K context · 老款旗舰',
    supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'medium',
  },
  {
    id: 'claude-3-5-haiku-latest',
    name: 'Claude 3.5 Haiku (latest)',
    provider: 'anthropic',
    contextWindow: 200_000,
    note: '200K context · 便宜快',
    supportedEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'medium',
  },
]

/** 默认 model —— 第一次启动 Settings 时填这个 */
export const DEFAULT_MAIN_MODEL: string =
  BUILTIN_MODELS.find((m) => m.isDefault)?.id ?? 'gpt-4o-mini'

/** 按 id 查 model（找不到返回 undefined） */
export function findModel(id: string): BuiltinModel | undefined {
  return BUILTIN_MODELS.find((m) => m.id === id)
}

/** 按 provider 过滤（v0.1 全是 openai，留接口给 v0.2+） */
export function modelsByProvider(provider: BuiltinModel['provider']): BuiltinModel[] {
  return BUILTIN_MODELS.filter((m) => m.provider === provider)
}

/** 拿一个 model 的 supported efforts（强制 `none` 永远在第一位）
 *
 *  玩家手填 / 不在 BUILTIN_MODELS 列表的 model → 返回 6 个全 effort（让玩家自己选，
 *  后端对不支持的 model 静默 no-op，不会报错）。
 */
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
// Locus 那边 model 下拉按 provider 分组（OpenRouter / Anthropic / Claude Code / OpenAI Codex / Custom）。
// PlotCraft v0.1 简化为 2 组：
// - `openai` 组（含 8 个 OpenAI 兼容模型 + sub-providers 不分）
// - `anthropic` 组（4 个 Claude）
// 段头用 provider label 展示，跟 Locus `ModelSelector` 同位

export const PROVIDER_LABELS: Record<BuiltinModel['provider'], string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  custom: 'Custom',
}

/** Selector 用的 model group（参考 Locus `ModelSelectorGroup`） */
export interface ModelSelectorGroup {
  key: string
  label: string
  provider: BuiltinModel['provider']
  models: BuiltinModel[]
}

/** 把 builtin models 按 provider 分组（保留 provider 出现顺序） */
export function groupModelsForSelector(
  models: readonly BuiltinModel[],
): ModelSelectorGroup[] {
  const seen: BuiltinModel['provider'][] = []
  const grouped = new Map<BuiltinModel['provider'], BuiltinModel[]>()
  for (const m of models) {
    if (!grouped.has(m.provider)) {
      seen.push(m.provider)
      grouped.set(m.provider, [])
    }
    grouped.get(m.provider)!.push(m)
  }
  return seen.map((p) => ({
    key: p,
    label: PROVIDER_LABELS[p] ?? p,
    provider: p,
    models: grouped.get(p)!,
  }))
}

/** 格式化 context window 展示（"128000" → "128K"） */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}
