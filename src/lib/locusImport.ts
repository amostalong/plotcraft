// PlotCraft v0.1 Locus import wrapper
//
// 跨 app 读 Locus config：
// - 主 config：`%APPDATA%/Locus/config.json`（24 顶层字段，schema 跟 PlotCraft 兼容）
// - custom providers：`%APPDATA%/Locus/custom_providers.json`（独立文件，array of
//   Locus `CustomProvider` with full details: id/name/endpoint/apiFormat/models）
// - API key：Locus 存 OS keychain，跨 app 读不到（玩家需在 PlotCraft 这边手动填）
//
// v0.1 行为：
// - 玩家点 "Import from Locus" → 弹 modal 显示查到的内容
// - 玩家挑要导入的 provider + 决定是否覆盖 active connection
// - 确认 → 写入 PlotCraft `config.json`（customProviders 数组 + 顶层 model/baseUrl/apiFormat）

import { invoke } from '@tauri-apps/api/core'
import type { ApiFormat } from '@/lib/settings'

/** 单个 Locus provider 的 import 数据（前端 UI 展示用） */
export interface LocusProviderImport {
  id: string
  name: string
  endpoint: string
  apiFormat: ApiFormat
  /** Locus 该 provider 下挂的 model 数量（前端 UI 展示 "N 个 model"） */
  modelCount: number
  enabled: boolean
  /** v0.1+ 从 Locus models[0].id 取（PlotCraft 简化 per-provider models[]） */
  defaultModel: string
}

/** Locus import 数据汇总 */
export interface LocusImportData {
  /** Locus config 是否存在（主 config + custom_providers.json 至少一个在） */
  found: boolean
  /** Locus config.json 路径（前端展示用） */
  configPath: string
  /** Locus custom_providers.json 路径（前端展示用） */
  customProvidersPath: string
  /** Locus 主 config 的 `model` 字段 */
  model: string | null
  /** Locus 主 config 的 `base_url` 字段 */
  baseUrl: string | null
  /** 推断的 apiFormat（从 base_url 启发式） */
  inferredApiFormat: ApiFormat | null
  /** Locus custom providers（不含 apiKey —— Locus 把 key 存 keychain） */
  providers: LocusProviderImport[]
}

/** Tauri command wrapper：读 Locus config + custom_providers.json */
export async function importFromLocus(): Promise<LocusImportData> {
  return invoke<LocusImportData>('import_from_locus')
}

/** 玩家在 modal 里的选择：哪些 provider 导入 + 是否覆盖 active connection */
export interface LocusImportSelection {
  /** 要导入的 provider id 列表（玩家挑的） */
  providerIds: string[]
  /** 是否覆盖 active connection（model + baseUrl + apiFormat） */
  applyActiveConnection: boolean
}
