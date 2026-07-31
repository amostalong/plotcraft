// 解析 LLM 备选输出 —— 概念 / 世界 tab 的「给 3-5 个备选」共用
//
// v0.3+ 严格化: **只接受 JSON**, 不再 fallback 按 `\n\n` 切段。
//
// 为什么去掉 fallback:
// - 之前 LLM 不返 JSON 时会按 `\n\n+` 切段, 每个段被当 AltCard 渲染, 每个都带"采用"按钮
//   → 玩家看到一堆莫名其妙的"采用"按钮 (LLM 的 preamble / 思考 / 多版本都用 markdown 输出时)
// - 玩家完全分不清哪个是真正的"备选", 哪个是 LLM 啰嗦
//
// v0.3+ 兼容的 JSON 形态 (response_format: json_object 下 LLM 常见的几种返法):
//   1. `["v1", "v2", "v3"]`                    - 纯字符串数组 (最理想)
//   2. `[{"content":"v1"},{"content":"v2"}]`  - 对象数组, 抽 `content` 字段
//   3. `[{"text":"v1"},{"text":"v2"}]`        - 对象数组, 抽 `text` 字段
//   4. `{"alternatives":[...]}` / `{"answer":[...]}` / `{"results":[...]}` 等
//      - 顶层对象, 从常见字段名里找数组
//   5. `{"answer":"..."}` / `{"content":"..."}` - 顶层对象, 单字符串
//      - 当成 1 项数组返回 (让玩家看到, 不造假多版本)
//   6. 其他 / 解析失败 → 返回空数组 (caller 走 markdown bubble 渲染)
//
// AiChatPanel 的 watch 会把 raw content + parse 结果打到 console, 玩家排查 "为什么
// 没出 cards" 时第一站 = 看那条 log 知道 LLM 实际返了什么 (是 markdown / 是
// `{"answer": "..."}` / 还是其他形态)。

/** 从 LLM 解析出的 JSON value 里抽字符串数组
 *  - 接受 string[] / object[] (抽 content/text 字段) / {field: [...]} 几种形态
 *  - 全部失败返回空数组 (caller 走 markdown bubble) */
function extractStrings(value: unknown): string[] {
  // 1) 纯字符串数组
  if (Array.isArray(value)) {
    const strs = value.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    if (strs.length > 0) return strs
    // 2) 对象数组, 抽 content / text 字段
    const objStrs = value
      .map((x) => {
        if (x && typeof x === 'object' && !Array.isArray(x)) {
          const o = x as Record<string, unknown>
          // 按常见字段名优先顺序抽
          for (const k of ['content', 'text', 'value', 'body', 'output']) {
            const v = o[k]
            if (typeof v === 'string' && v.trim() !== '') return v
          }
        }
        return null
      })
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    if (objStrs.length > 0) return objStrs
    return []
  }
  // 3) 顶层对象, 找常见数组字段
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    // 优先尝试数组字段
    for (const k of ['alternatives', 'options', 'results', 'items', 'choices', 'data', 'response', 'answer', 'content', 'text']) {
      const v = o[k]
      if (Array.isArray(v)) {
        const inner = extractStrings(v)
        if (inner.length > 0) return inner
      }
    }
    // 4) 顶层对象, 单字符串字段 → 当成 1 项数组
    for (const k of ['answer', 'content', 'text', 'result', 'output']) {
      const v = o[k]
      if (typeof v === 'string' && v.trim() !== '') return [v]
    }
  }
  // 5) 单字符串 → 当成 1 项数组 (同样让玩家看到, 不造假多版本)
  if (typeof value === 'string' && value.trim() !== '') return [value]
  return []
}

/** 解析 LLM 输出 → 备选数组
 *  - 严格: 必须返回合法 JSON (markdown / 纯文本 / 空 → 返回空数组)
 *  - 兼容多种 JSON 形态 (纯数组 / 对象数组 / 顶层对象) — 详见 extractStrings */
export function parseAlternatives(raw: string): string[] {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
  // 先尝试整段是 JSON
  try {
    return extractStrings(JSON.parse(stripped))
  } catch {
    // 整段不是 JSON, 试试抠出第一个 `{...}` 或 `[...]` (有些 LLM 在 JSON 前后加废话)
    const objMatch = stripped.match(/\{[\s\S]*\}/)
    if (objMatch) {
      try {
        return extractStrings(JSON.parse(objMatch[0]))
      } catch {
        // fall through
      }
    }
    const arrMatch = stripped.match(/\[[\s\S]*\]/)
    if (arrMatch) {
      try {
        return extractStrings(JSON.parse(arrMatch[0]))
      } catch {
        // fall through
      }
    }
    return []
  }
}


