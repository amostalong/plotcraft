// PlotCraft v0.2+ Chat 错误玩家文案
//
// 设计目标：
// - 玩家默认看到 title + description（人话）+ hint（做什么）
// - 原始错误字符串（OpenSSL/TLS/HTTP body）默认隐藏，点 "查看详情" 才展开
// - 不写"网络错误" / "系统异常" 这种空话，每条都告诉玩家具体在哪改
//
// 跟后端 ChatErrorKind 镜像（snake_case 字符串），kind 加一个新值这里
// 就要加一套文案。unknown 兜底（永远不要让玩家看到裸字符串）

import type { ChatErrorKind } from '@/types/chat'

/** 玩家视角的错误信息
 *  - `title`：粗体短句（"AI 暂时连不上"）
 *  - `description`：解释发生了什么（"网络层失败" 之类的低技术词）
 *  - `hint`：行动建议（"去 Settings → Providers 改 endpoint" / "等会儿再试"）
 *  - `technicalDetails`：原始错误字符串（玩家点"查看详情"才显示）
 *  - `canRetry`：能不能 retry（network/server/rate_limit 可以，auth/model/bad_request 不行）
 */
export interface PlayerErrorMessage {
  title: string
  description: string
  hint: string
  technicalDetails: string
  canRetry: boolean
}

const UNKNOWN: Omit<PlayerErrorMessage, 'technicalDetails'> = {
  title: 'AI 出错了',
  description: '回复时出了点问题',
  hint: '试着重发一次；还不行就看看 Console 日志',
  canRetry: true,
}

const MESSAGES: Record<ChatErrorKind, Omit<PlayerErrorMessage, 'technicalDetails'>> = {
  network: {
    title: 'AI 暂时连不上',
    description: '网络层失败 —— endpoint 不通 / DNS 解析失败 / 连接超时 / TLS 握手失败',
    hint: '检查网络；确认 endpoint 拼写对；如果是中转代理，确认中转服务还活着',
    canRetry: true,
  },
  auth: {
    title: 'API key 错 / 中转代理不认',
    description: 'endpoint 回了 HTTP 401 / 403 —— 鉴权失败',
    hint: '去 Settings → Providers 库 → 找到这条 provider → 编辑 → 改 API key',
    canRetry: false,
  },
  model_not_found: {
    title: '模型不存在',
    description: 'endpoint 不认这个 model id（HTTP 404）',
    hint: '去 Settings → Providers 库 → 找到这条 provider → 编辑 → 改 model id（中转代理的 model id 可能跟官方不一样）',
    canRetry: false,
  },
  bad_request: {
    title: '请求格式被拒',
    description: 'endpoint 回了 HTTP 400 —— 请求 body 格式它不认',
    hint: '可能是中转代理不兼容 OpenAI 协议 / 不认 reasoning_content 字段；换 endpoint 或换 provider',
    canRetry: false,
  },
  rate_limit: {
    title: '中转代理限流',
    description: 'endpoint 回了 HTTP 429 —— 请求太频繁',
    hint: '等 1-2 分钟再试；或者去 Settings 改用别的 provider',
    canRetry: true,
  },
  server_error: {
    title: '中转代理上游挂了',
    description: 'endpoint 回了 HTTP 5xx —— 中转代理背后的真实 API 出了问题',
    hint: '等会儿再试；如果是中转代理本身挂了，换 endpoint',
    canRetry: true,
  },
  stream_protocol: {
    title: '中转代理 SSE 协议不兼容',
    description: '流解析失败 —— endpoint 流的字节不是标准 OpenAI SSE 格式（可能不是 SSE，可能用 thinking_content 之类的私有字段）',
    hint: '中转的 OpenAI 兼容层有 bug；换 endpoint 或直接用官方 API',
    canRetry: false,
  },
  unknown: UNKNOWN,
}

/** 把后端给的 ChatErrorKind + 原始 error 字符串转成玩家文案 */
export function getErrorMessage(
  kind: ChatErrorKind | null | undefined,
  rawError: string,
): PlayerErrorMessage {
  const k: ChatErrorKind = kind ?? 'unknown'
  const base = MESSAGES[k] ?? UNKNOWN
  return {
    ...base,
    technicalDetails: rawError,
  }
}

/** 简短 inline 版本 —— 给 composer 顶部小错误条用（不显示 hint/canRetry） */
export function getErrorTitle(
  kind: ChatErrorKind | null | undefined,
  rawError: string,
): string {
  return getErrorMessage(kind, rawError).title
}
