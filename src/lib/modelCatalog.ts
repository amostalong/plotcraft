// PlotCraft v0.1 built-in model catalog
//
// v0.1 设计：
// - 静态列表，玩家选 / 手填都行（UI 用 HTML <datalist>，详见 [ModelDefaults.vue]）
// - 数据跟 Locus `stores/model.ts` 的 `codexFallbackModels` / `builtinModels` 子集对齐
//   —— 选取 OpenAI 兼容 endpoint 能用的（v0.1 只实装 `openai` provider）
// - v0.2+ 走远端 fetch + snapshot 缓存（schema 留 `modelCatalog: Option<ModelCatalog>`）
//
// 数据本身是公开模型名 + context window（厂商公开），不 import Locus 文件（AGENTS.md 硬规则）

export interface BuiltinModel {
  /** model id，发送给 LLM API（如 `"gpt-4o-mini"`） */
  id: string
  /** UI 显示名（如 `"GPT-4o mini"`） */
  name: string
  /** provider 分类（v0.1 全是 `openai` 兼容） */
  provider: 'openai' | 'anthropic' | 'google' | 'custom'
  /** 上下文窗口 token 数 */
  contextWindow: number
  /** 默认勾选 / 第一次启动时填进 mainModel */
  isDefault?: boolean
  /** 备注（给玩家看的下拉 hint） */
  note?: string
}

/**
 * PlotCraft v0.1 内置模型列表
 *
 * 选取原则：
 * 1. OpenAI 官方主力（gpt-4o / gpt-4o-mini / o1 / o3-mini）—— 真实 OpenAI endpoint 用
 * 2. 主流 OpenAI 兼容模型（DeepSeek / Qwen / Llama）—— 自建 endpoint / proxy 用
 * 3. 暂不放 Locus 的 Claude / Anthropic / openrouter / codex——v0.1 不实装对应 provider
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
  },
  {
    id: 'o1-mini',
    name: 'o1 mini',
    provider: 'openai',
    contextWindow: 128_000,
    note: '128K context · 推理性价比',
  },
  {
    id: 'o3-mini',
    name: 'o3 mini',
    provider: 'openai',
    contextWindow: 200_000,
    note: '200K context · 最新推理',
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

/** 格式化 context window 展示（"128000" → "128K"） */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}
