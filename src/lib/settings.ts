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

/** 已保存的第三方 provider（OpenAI 兼容端点，saved library） */
export interface CustomProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  /** API 协议（跟 Locus `ApiFormat` 同：openai_chat | anthropic_messages）*/
  apiFormat: ApiFormat
  enabled: boolean
}

/** LLM API 协议（参考 Locus `ApiFormat` = openai_chat | openai_responses | anthropic_messages）*/
///
/// PlotCraft 实现（v0.1 全 3 种）：
/// - `openai_chat`：OpenAI Chat Completions API（`/v1/chat/completions`）
/// - `openai_responses`：OpenAI Responses API（`/v1/responses`，OpenAI 新版）
/// - `anthropic_messages`：Anthropic Messages API（`/v1/messages`，Claude）
export type ApiFormat = 'openai_chat' | 'openai_responses' | 'anthropic_messages'

export const DEFAULT_API_FORMAT: ApiFormat = 'openai_chat'

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
  model: 'gpt-4o-mini',
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
}
