// PlotCraft v0.1 settings wrapper（前端 Tauri command wrapper）
//
// 跟 Locus `AppConfig` 字面兼容（参考 Locus `src-tauri/src/config.rs:280-430`）：
// - 顶层 24 个 Locus 字段（snake_case）
// - nested `code_analysis_tools` 字段是 camelCase
// - PlotCraft 加 3 个扩展字段（`apiKey` / `ui.theme` / `recentProjects`）——
//   Locus 看到自动忽略，PlotCraft 看到会用到
//
// 后端 schema 见 [src-tauri/src/llm/config.rs]（serde 字符串 key 跟 Locus 一致）

import { invoke } from '@tauri-apps/api/core'

// --- 跟 Locus AppConfig 字段一一对应（snake_case）---

export type AppCloseBehavior = 'exit' | 'minimizeToTray'

// Locus 的 DynamicToolLoadingMode 是 enum；PlotCraft v0.1 不用此字段，透传字符串
export type DynamicToolLoadingMode = string

export interface CodeAnalysisToolsConfig {
  codeSymbolSearch: boolean
  codeGotoDefinition: boolean
  codeFindReferences: boolean
  codeDiagnostics: boolean
  editWriteDiagnostics: boolean
  codeHover: boolean
  unityCodeUsages: boolean
  unityAnalyzers: boolean
}

// --- PlotCraft 扩展字段 ---

export interface UiConfig {
  theme: string
}

/** 单个 model 条目（per-provider 列表里的元素）v0.1.3+
 *
 *  vs Locus `CustomProviderModel` 12 字段 —— PlotCraft v0.1 简化只取：
 * - `id`：model id（发给 LLM API 的 `model` 字段值）
 * - `name`：UI 显示名（缺省 = id）
 *
 *  contextLength / supportedEfforts 从 BUILTIN_MODELS lookup（id 匹配时）
 */
export interface ProviderModel {
  id: string
  name: string
}

/** 已保存的第三方 provider（OpenAI 兼容端点，saved library） */
export interface CustomProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  /** API 协议（跟 Locus `ApiFormat` 同：openai_chat | anthropic_messages）*/
  apiFormat: ApiFormat
  enabled: boolean
  /** v0.1.3+ 该 provider 下的 model 列表
   *  - 通过 modal 的「从模型库添加」/「手动添加」按钮增删
   *  - chat selector 选该 provider 时用 `defaultModel`（fallback 到 `models[0].id`）
   *  - v0.1.1/v0.1.2 旧 config 没这个字段 → 自动空数组
   */
  models: ProviderModel[]
  /** 该 provider 发请求时用的默认 model id
   *  必须是 `models[]` 里某个的 id；空 → 玩家没设（fallback 到 models[0]）
   *  chat selector 选该 provider 时用这个
   */
  defaultModel: string
}

/** LLM API 协议（参考 Locus `ApiFormat` = openai_chat | openai_responses | anthropic_messages）*/
///
/// PlotCraft 实现（v0.1 全 3 种）：
/// - `openai_chat`：OpenAI Chat Completions API（`/v1/chat/completions`）
/// - `openai_responses`：OpenAI Responses API（`/v1/responses`，OpenAI 新版）
/// - `anthropic_messages`：Anthropic Messages API（`/v1/messages`，Claude）
export type ApiFormat = 'openai_chat' | 'openai_responses' | 'anthropic_messages'

export const DEFAULT_API_FORMAT: ApiFormat = 'openai_chat'

/** Reasoning effort / thinking level（跟 Locus `EffortLevel` 一字一致）
 *
 *  v0.1 用法：
 *  - OpenAI Chat / OpenAI Responses：只 `low` / `medium` / `high` 真正下发
 *    （其他值后端静默忽略，对应 o-series / reasoning 模型的 thinking 控制）
 *  - Anthropic：除 `none` 全部映射到 `thinking.budget_tokens`（low=1k/medium=4k/high=16k/xhigh=32k/max=64k）
 *  - Chat UI / Settings UI 都用这个枚举（跟 Locus `ModelOption.supportedEfforts` 同位）
 */
export type EffortLevel = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const DEFAULT_EFFORT: EffortLevel = 'none'

/** Effort 顺序（用于 UI 排序 + 推断默认） */
export const EFFORT_ORDER: readonly EffortLevel[] = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

/** Effort 人类可读 label（UI dropdown / trigger chip 用，跟 Locus `defs[].label` 一字一致）
 *
 *  Locus: `None` / `Low` / `Med`（缩写）/ `High` / `XHigh`（CamelCase）/ `Max`
 *  PlotCraft v0.1 跟 Locus 对齐 —— trigger 跟 dropdown 都用这套 label
 */
export const EFFORT_LABELS: Record<EffortLevel, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
}

/** ApiFormat 的人类可读 label（UI dropdown 用） */
export const API_FORMAT_LABELS: Record<ApiFormat, string> = {
  openai_chat: 'OpenAI Chat Completions',
  openai_responses: 'OpenAI Responses API',
  anthropic_messages: 'Anthropic Messages',
}

/** ApiFormat → 默认 base URL（玩家首次切到该 format 时建议填的 endpoint） */
export const DEFAULT_ENDPOINTS: Record<ApiFormat, string> = {
  openai_chat: 'https://api.openai.com/v1',
  openai_responses: 'https://api.openai.com/v1',
  anthropic_messages: 'https://api.anthropic.com',
}

// --- 完整 Config ---

export interface Config {
  // Locus 字段
  model: string
  base_url: string | null
  debug: boolean
  file_tool_workspace_boundary: boolean
  close_behavior: AppCloseBehavior
  dynamic_tool_loading_mode: DynamicToolLoadingMode
  dynamic_tool_loading_native_migrated: boolean
  anthropic_native_lazy_enabled: boolean
  default_skill_package_namespace: string
  view_windows_above_main: boolean
  view_open_in_existing_window: boolean
  unity_background_hook_enabled: boolean
  unity_state_probe_enabled: boolean
  csharp_lsp_enabled: boolean
  unity_sidecar_compiler: boolean
  unity_in_process_compile_fallback: boolean
  unity_hot_reload: boolean
  unity_native_bridge_enabled: boolean
  unity_inline_force_evaluate_enabled: boolean
  code_analysis_tools: CodeAnalysisToolsConfig
  llm_retry_max_attempts: number
  llm_strip_inline_think_tags: boolean
  subagent_max_depth: number
  subagent_max_concurrent: number

  // PlotCraft 扩展字段
  apiKey: string
  ui: UiConfig
  recentProjects: string[]
  customProviders: CustomProvider[]
  /** Active connection 用的 API 协议（"Use" provider 时同步）*/
  apiFormat: ApiFormat
  /**
   * v0.1+ 全局默认 reasoning effort / thinking level
   * - 玩家在 chat tab 选了 effort → 写这里 + save
   * - chat init 没显式选时 → 优先用这个，再回退到 model.defaultEffort
   * - null / undefined → 没默认，用 model 自己的 defaultEffort
   */
  effort: EffortLevel | null
  /**
   * v0.4+ AI tool calling 开关
   * - 每个 tool 一个 enabled: false → 那个 tool 不在 LLM request body 的 tools 字段
   *   → LLM 完全不知道存在（用户硬要求："关闭的tool不要在prompt里面提示给LLM"）
   * - permission: Locus 风格权限策略（auto = 直接执行 / ask = 弹确认 / deny = 拒绝）
   *   - ask_user_question / ask_free_text 默认 auto（只问不写）
   *   - update_doc_item 默认 ask（写编辑器前玩家确认）
   * - 缺这字段（老 config）→ 前端 normalizeToolsConfig 补全（default）
   * - 镜像 Rust 端 AppConfig.tools（camelCase）
   */
  tools?: {
    ask_user_question: { enabled: boolean; permission: 'auto' | 'ask' | 'deny' }
    update_doc_item: { enabled: boolean; permission: 'auto' | 'ask' | 'deny' }
    ask_free_text: { enabled: boolean; permission: 'auto' | 'ask' | 'deny' }
  }
}

// --- Tauri command wrappers ---

export async function loadConfig(): Promise<Config> {
  return invoke<Config>('load_config')
}

export async function saveConfig(config: Config): Promise<void> {
  await invoke('save_config', { config })
}

// --- default config（v0.1 单 provider openai-compatible，hardcoded）---

const DEFAULT_CODE_ANALYSIS_TOOLS: CodeAnalysisToolsConfig = {
  codeSymbolSearch: true,
  codeGotoDefinition: true,
  codeFindReferences: true,
  codeDiagnostics: false,
  editWriteDiagnostics: true,
  codeHover: false,
  unityCodeUsages: true,
  unityAnalyzers: true,
}

export const DEFAULT_CONFIG: Config = {
  // Locus 字段 default
  // v0.1.3+：model 默认空串 —— active model 由 chat selector 从 customProviders 解析
  // （之前是 'gpt-4o-mini'，导致老用户 config.model 卡在 builtin model id，
  // 切 provider 时不会被正确识别为 custom provider 的 defaultModel）
  model: '',
  base_url: 'https://api.openai.com/v1',
  debug: false,
  file_tool_workspace_boundary: false,
  close_behavior: 'exit',
  dynamic_tool_loading_mode: '',
  dynamic_tool_loading_native_migrated: true,
  anthropic_native_lazy_enabled: true,
  default_skill_package_namespace: '',
  view_windows_above_main: false,
  view_open_in_existing_window: true,
  unity_background_hook_enabled: true,
  unity_state_probe_enabled: true,
  csharp_lsp_enabled: false,
  unity_sidecar_compiler: true,
  unity_in_process_compile_fallback: true,
  unity_hot_reload: false,
  unity_native_bridge_enabled: true,
  unity_inline_force_evaluate_enabled: true,
  code_analysis_tools: { ...DEFAULT_CODE_ANALYSIS_TOOLS },
  llm_retry_max_attempts: 3,
  llm_strip_inline_think_tags: true,
  subagent_max_depth: 1,
  subagent_max_concurrent: 3,

  // PlotCraft 扩展字段 default
  apiKey: '',
  ui: { theme: 'dark' },
  recentProjects: [],
  customProviders: [],
  apiFormat: DEFAULT_API_FORMAT,
  effort: null,
  // v0.4+ tool calling 开关（默认全开 + 玩家主导默认权限）—— 玩家在 Settings tab 控制
  tools: {
    ask_user_question: { enabled: true, permission: 'auto' },
    update_doc_item: { enabled: true, permission: 'ask' },
    ask_free_text: { enabled: true, permission: 'auto' },
  },
}
