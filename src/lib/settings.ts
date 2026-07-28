// PlotCraft v0.1 settings wrapper（前端 Tauri command wrapper）
//
// 跟 Locus `Config` 同构思路：providers + modelDefaults + modelCatalog + ui + recentProjects。
// v0.1 实装：只 `providers.openai` + `modelDefaults.mainModel` + `ui.theme` + `recentProjects`。
// v0.2+ 加 Claude / Gemini 等 provider 不用动 schema —— 直接加 key。
//
// 后端 schema 见 [src-tauri/src/llm/config.rs]（serde camelCase）

import { invoke } from '@tauri-apps/api/core'

// --- 跟 Rust struct 一一对应 ---

export interface ProviderConfig {
  endpoint: string
  apiKey: string
  enabled: boolean
}

export interface ModelDefaults {
  mainModel: string
}

export interface ModelCatalog {
  source: string | null
  fetchedAt: string | null
}

export interface UiConfig {
  theme: string
}

export interface Config {
  version: number
  providers: Record<string, ProviderConfig>
  modelDefaults: ModelDefaults
  modelCatalog: ModelCatalog | null
  ui: UiConfig
  recentProjects: string[]
}

// --- Tauri command wrappers ---

export async function loadConfig(): Promise<Config> {
  return invoke<Config>('load_config')
}

export async function saveConfig(config: Config): Promise<void> {
  await invoke('save_config', { config })
}

// --- default config（v0.1 单 provider openai，hardcoded）---

export const DEFAULT_CONFIG: Config = {
  version: 1,
  providers: {
    openai: {
      endpoint: 'https://api.openai.com/v1',
      apiKey: '',
      enabled: true,
    },
  },
  modelDefaults: { mainModel: 'gpt-4o-mini' },
  modelCatalog: null,
  ui: { theme: 'dark' },
  recentProjects: [],
}
