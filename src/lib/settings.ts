// PlotCraft v0.1 settings wrapper（前端 Tauri command wrapper）

import { invoke } from '@tauri-apps/api/core'

export interface LlmConfig {
  endpoint: string
  api_key: string
  model: string
}

export interface UiConfig {
  theme: string
}

export interface Config {
  version: number
  llm: LlmConfig
  ui: UiConfig
  recent_projects: string[]
}

export async function loadConfig(): Promise<Config> {
  return invoke<Config>('load_config')
}

export async function saveConfig(config: Config): Promise<void> {
  await invoke('save_config', { config })
}

export const DEFAULT_CONFIG: Config = {
  version: 1,
  llm: { endpoint: 'https://api.openai.com/v1', api_key: '', model: 'gpt-4o-mini' },
  ui: { theme: 'dark' },
  recent_projects: [],
}
