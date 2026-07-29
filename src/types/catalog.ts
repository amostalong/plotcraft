// PlotCraft v0.1 models.dev catalog 类型
//
// 跟 src-tauri/src/model_catalog.rs 的 ResolvedCatalog schema 一一对应
// （serde 字段已经 camelCase 化，TS 端直接用）

export interface CatalogModel {
  /** model id（key in provider.models）—— 玩家发给 LLM 的 model 字段 */
  id: string
  /** display name（"Claude Sonnet 4.5"） */
  name: string
  /** 上下文窗口 token 数 */
  context_window: number
  /** 最大输出 token 数 */
  output_limit: number
  /** 是否支持 reasoning / thinking */
  reasoning: boolean
  /** 是否支持 tool_call */
  tool_call: boolean
  /** 是否支持 vision（attachment=true） */
  vision: boolean
  /** ISO 发布日期（"2025-09-29"） */
  release_date?: string
  /** 'deprecated' 等 */
  status?: string
}

export interface CatalogProvider {
  /** provider id（'anthropic' / 'openai' / 'deepseek' ...） */
  id: string
  /** display name（"Anthropic"） */
  name: string
  /** 已 fallback 的 endpoint（优先 provider.api，否则 OFFICIAL_API_FALLBACKS） */
  endpoint: string
  /** npm SDK id（前端用这判断 suggested_api_format） */
  npm?: string
  /** 建议的 apiFormat（'anthropic_messages' / 'openai_chat'） */
  suggested_api_format: 'anthropic_messages' | 'openai_chat'
  /** listable models（过滤掉 deprecated + 没 tool_call 的） */
  models: CatalogModel[]
}

export interface ModelCatalog {
  /** snapshot fetched_at（ISO 8601 字符串） */
  fetched_at: string
  /** 过滤出来的有 endpoint 的 provider 列表 */
  providers: CatalogProvider[]
}
