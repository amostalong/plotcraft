// PlotCraft v0.1 markdown 渲染
//
// 设计选择：主线程同步渲染（不用 worker）
// 理由：v0.1 用 marked + DOMPurify 1KB markdown 解析 < 1ms，
//       worker overhead 比解析时间还大（postMessage 序列化 + 跨线程调度）
//       worker 是给 Locus lute (Go -> JS 编译) 那种重解析用的，
//       PlotCraft 不需要 —— "学 Locus 架构思想，不照搬技术选型"
//
// 安全：DOMPurify 必走（任何用户可控的 markdown 都不能直接 v-html 渲染）
//
// 性能估算：1K token/秒流式 → 节流后 60 emit/秒 → 60 markdown render/秒
//           1KB markdown 解析 < 1ms → 60ms/秒 ≈ 6% CPU（可接受）
//
// v0.2+ 复杂 markdown（lute 那种 / 大文档 / 嵌套表格）才考虑上 worker

import { marked } from 'marked'
import DOMPurify from 'dompurify'

// 全局 marked 配置（v0.1 简单版：GFM + 软换行）
marked.setOptions({
  gfm: true,
  breaks: true,
  async: false,
})

// 主线程 DOMPurify（Tauri webview 有 window）
const purifier = DOMPurify(window)

/**
 * 同步 markdown 渲染
 * @param md markdown 源文
 * @returns sanitized HTML 字符串
 */
export function renderMarkdown(md: string): string {
  if (!md) return ''
  const dirty = marked.parse(md, { async: false }) as string
  return purifier.sanitize(dirty, {
    USE_PROFILES: { html: true },
  })
}
