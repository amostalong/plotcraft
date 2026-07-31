// LLM 连接解析 —— 概念 / 世界 tab 的 generate / step chat 共用
//
// 跟 test_provider 同一模式：从 settings store 取，后端不读 config。
// 配置缺失时抛"还没配置 LLM —— …"的玩家文案错误（AlternativesPicker 直显该前缀文案）。

import type { ApiFormat } from '@/lib/settings'
import { useSettingsStore } from '@/stores/settings'

export interface LlmConnection {
  endpoint: string
  apiKey: string
  apiFormat: ApiFormat
  model: string
}

/** 从 settings 解析出可用连接 —— model 空 → 从 enabled customProviders 兜底
 *  （对齐 chat.init 的 effective 逻辑：defaultModel || models[0].id），
 *  兜底命中时连同 provider 的连接信息一起取 */
export async function resolveLlmConnection(): Promise<LlmConnection> {
  const settings = useSettingsStore()
  if (!settings.loaded) await settings.init()
  const config = settings.config

  let endpoint = config.base_url?.trim() || ''
  let apiKey = config.apiKey?.trim() || ''
  let apiFormat = config.apiFormat
  let model = config.model?.trim() || ''

  if (!model) {
    const p = (config.customProviders ?? []).find((cp) => {
      if (!cp.enabled) return false
      return (cp.defaultModel?.trim() || cp.models?.[0]?.id?.trim() || '') !== ''
    })
    if (p) {
      model = p.defaultModel?.trim() || p.models![0].id.trim()
      if (!endpoint) endpoint = p.baseUrl.trim()
      if (!apiKey) apiKey = p.apiKey.trim()
      apiFormat = p.apiFormat
    }
  }

  if (!endpoint || !apiKey || !model) {
    throw new Error('还没配置 LLM —— 请先在设置 tab 配好 provider（endpoint / API key / model）')
  }
  return { endpoint, apiKey, apiFormat, model }
}
