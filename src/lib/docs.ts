// PlotCraft 通用"固定分节文档集合"前端 wrapper（world/ 等目录）
//
// 数据约定（镜像 Rust `src-tauri/src/docs/mod.rs`，snake_case 跨 boundary）：
//   <project>/<collection>/<filename> —— 一节一个 md 文件（frontmatter 存 title/updated）
// invoke 参数顶层 key 传 camelCase（Tauri 自动转 snake_case，跟 lib/concept.ts 同款约定）

import { invoke } from '@tauri-apps/api/core'

import type { DocEntry } from '@/types/world'

/** 扫描项目 <collection>/ 全部分节，缺文件返回 exists=false + 空内容（不报错） */
export async function listDocs(projectRoot: string, collection: string): Promise<DocEntry[]> {
  return invoke<DocEntry[]>('list_docs', { projectRoot, collection })
}

/** 保存一节内容（atomic write + frontmatter title/updated）
 *  docId 不在 collection 注册表内 → 后端抛错 */
export async function saveDoc(
  projectRoot: string,
  collection: string,
  docId: string,
  content: string,
): Promise<DocEntry> {
  return invoke<DocEntry>('save_doc', { projectRoot, collection, docId, content })
}

/** 汇总 exists 且内容非空的分节（每节截断）—— 给 AI context 用
 *  全部为空 → 返回空串 */
export async function getDocsSummary(projectRoot: string, collection: string): Promise<string> {
  return invoke<string>('get_docs_summary', { projectRoot, collection })
}
