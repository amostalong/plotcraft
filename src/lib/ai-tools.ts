// PlotCraft v0.4+ AI tool schema 定义 + resolveEnabledTools
//
// 三个内置 tool（玩家主导原则下 LLM 可调的工具集）：
// - ask_user_question: 给玩家 N 个备选让 ta 选
// - update_doc_item: LLM 主动把内容写入某项（替代 v0.3+ 的"采用"按钮）
// - ask_free_text: LLM 反问玩家一个开放问题（反思类 chip 用）
//
// **关键设计**：关闭的 tool 不在 prompt 里给 LLM（用户硬要求）
// - 工具不在 tools schema 字段 → LLM 完全不知道存在
// - 不在 system prompt 里描述 → 双重保险
// - resolveEnabledTools(config) 过滤 settings.config.tools.enabled = true 的 tool
//   → 关闭的不进 request body 的 tools 字段
//
// 跟 Locus 差异：PlotCraft 是玩家主导 + 工具精简（v0.4+ 只 3 个），
// 跟 Locus 几十个 AI 主导工具不同
//
// 跨 OpenAI / Anthropic 协议都通用：build body 时 Rust 端按 api_format 转 schema
// （OpenAI 用 parameters 字段，Anthropic 转 input_schema）

import type { Config } from '@/lib/settings'
import type { ToolDefinition } from '@/types/chat'

// === 单个 tool schema 定义 ===

/** ask_user_question —— 给玩家 N 个备选让 ta 选
 *  - 替代 v0.3+ 的 JSON 数组解析（LLM 不再返 [A, B, C] 文本，改走 tool call）
 *  - 强制 2-5 项 options（schema min/max 约束，LLM 调时 schema 强制）
 *  - 每个 option: label (10字内) + preview (完整备选内容) + description (可选，hover 显示)
 *  - 跟 Locus ask_user_question 类似但去掉了 "always allow custom input" 限制
 *    （PlotCraft v0.4+ 玩家主导，custom input 通过普通 composer 输入，不在 option 里） */
export const ASK_USER_QUESTION_SCHEMA: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ask_user_question',
    description:
      '向玩家提出一个多选问题，提供 2-5 个互斥的备选方案让 ta 选。' +
      '适合给方向、选项、取舍。' +
      '每项 option 必须：label = 10 字内短标题；preview = 完整备选内容（采用后写入编辑器）；' +
      'description = 为什么这个方向（hover 显示，可选）。' +
      '**不要**在 content 字段里给 "Other" / "Custom" 之类的兜底选项 —— 玩家想自己写就直接在 composer 输入。',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: '问玩家的核心问题。要具体，让 ta 知道选哪个会得到什么。',
        },
        options: {
          type: 'array',
          minItems: 2,
          maxItems: 5,
          items: {
            type: 'object',
            properties: {
              label: {
                type: 'string',
                description: '卡片标题（10 字以内，玩家一眼能扫到）',
              },
              preview: {
                type: 'string',
                description: '完整备选内容。玩家点"采用"后这个文本会写入编辑器。',
              },
              description: {
                type: 'string',
                description: '为什么这个方向（hover 提示，可选）',
              },
            },
            required: ['label', 'preview'],
          },
        },
      },
      required: ['question', 'options'],
    },
  },
}

/** update_doc_item —— LLM 主动把内容写入某项
 *  - 替代 v0.3+ 的"采用"按钮（玩家点 AltCard 触发写入）
 *  - v0.4+：LLM 自己调这个 tool → 前端弹"AI 建议覆盖 / 追加 X，确认吗" → 玩家确认
 *  - item_id 枚举：v0.5+ 限 concept 7 步（world 5 节 / characters / plot 等它们自己有 store 再加）
 *  - 玩家可以关闭这个 tool（在 Settings tab）→ LLM 完全不能改编辑器，要改让玩家手动写
 *  - **v0.4.1+ mode 区分**:
 *    - 'replace' = 覆盖编辑器（默认；完整新立意 / 完整新内容）
 *    - 'append'  = 追加到编辑器末尾（局部补全 / 一句话 / 一条规则）
 *    - **不要**在不区分完整度时瞎猜 —— 想清楚是"完整内容"还是"局部补全"再调
 *    - 反思类输出（"立意的格式来看还缺 3 块"）**不要**调这个 tool，那是说明不是内容 */
export const UPDATE_DOC_ITEM_SCHEMA: ToolDefinition = {
  type: 'function',
  function: {
    name: 'update_doc_item',
    description:
      '把玩家选定 / 修改后的内容写入文档某一项。' +
      '**只**在玩家已经明确表达过要这个方案时调（例如玩家问"用 A 改暗版"，或玩家从 ask_user_question 选了一个 option）。' +
      '**不要**在没确认的情况下主动调这个 —— 玩家主导，绝不替玩家做决定。' +
      '**反思 / 提问 / 解释**类输出**不要**用这个 tool —— 反思用 ask_user_question 或 ask_free_text。' +
      'item_id 当前限定为 concept 7 步：seed / pillars / world-rules / locations / character-functions / three-act / core-fantasy。' +
      'content 是最终内容（玩家改过的优先于 LLM 原始备选）。',
    parameters: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          enum: [
            'seed',
            'pillars',
            'world-rules',
            'locations',
            'character-functions',
            'three-act',
            'core-fantasy',
          ],
          description: '要写入的 doc item id',
        },
        mode: {
          type: 'string',
          enum: ['replace', 'append'],
          description:
            '"replace" = 覆盖编辑器（默认；适合完整新内容）;' +
            '"append" = 追加到末尾（适合局部补全 / 一句话 / 一条规则）。' +
            '**不传默认 replace**。区分: 整段完整内容 → replace; 只是一句补充 / 一条新规则 → append。',
        },
        content: {
          type: 'string',
          description: '最终内容（玩家改过的优先于 LLM 原始备选）',
        },
      },
      required: ['item_id', 'content'],
    },
  },
}

/** ask_free_text —— LLM 反问玩家一个开放问题
 *  - 反思类 chip 用（"反问我 3 个尖锐问题"、"检查规则有没有冲突"）
 *  - LLM 不给选项，让玩家自己想
 *  - 跟 ask_user_question 区别：ask_user_question 强制 2-5 个选项（备选场景），
 *    ask_free_text 是开放问题（"你怎么理解 X"） */
export const ASK_FREE_TEXT_SCHEMA: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ask_free_text',
    description:
      '向玩家提出一个需要 ta 自己想清楚的开放问题。' +
      '**不要**给选项 —— 这种问题没有标准答案，要让玩家自己想。' +
      '适合反思类追问（"你的核心体验里"什么"是什么" / "这条规则实际怎么运作"）' +
      '跟 ask_user_question 的区别：ask_user_question 给方向性备选，ask_free_text 是真正需要玩家自己想的。',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: '要问玩家的开放问题（没有标准答案，要让 ta 停下来想）',
        },
      },
      required: ['question'],
    },
  },
}

// === 内置 tool 注册表 ===

/** v0.4+ 内置 tool 全集 —— 顺序就是 UI 显示顺序
 *  - Settings tab 工具列表从这取
 *  - resolveEnabledTools 从这过滤 */
export interface BuiltinToolMeta {
  /** tool name（跟 schema.name 一致） */
  name: 'ask_user_question' | 'update_doc_item' | 'ask_free_text'
  /** UI 显示名（短） */
  label: string
  /** UI 描述（一行，hover 显示） */
  description: string
  /** 风险等级（UI 显示用） */
  risk: 'low' | 'medium' | 'high'
  /** schema（注入到 LLM request body） */
  schema: ToolDefinition
}

export const BUILTIN_TOOLS: BuiltinToolMeta[] = [
  {
    name: 'ask_user_question',
    label: 'Ask User Question',
    description: '让 LLM 给你 2-5 个备选让你选',
    risk: 'low',
    schema: ASK_USER_QUESTION_SCHEMA,
  },
  {
    name: 'update_doc_item',
    label: 'Update Doc Item',
    description: '让 LLM 把内容自动写入编辑器',
    risk: 'medium',
    schema: UPDATE_DOC_ITEM_SCHEMA,
  },
  {
    name: 'ask_free_text',
    label: 'Ask Free Text',
    description: '让 LLM 反问你一个开放问题',
    risk: 'low',
    schema: ASK_FREE_TEXT_SCHEMA,
  },
]

// === 单个 tool 设置 ===

/** v0.4+ tool 权限策略（Locus 风格，玩家主导 + AI 主导 安全机制）
 *  - `auto`：LLM 调了直接执行（玩家不需要确认）
 *    - 适合只读 / 只问类 tool（ask_user_question / ask_free_text 默认值）
 *  - `ask`：LLM 调了前端弹"AI 建议 X，确认吗" → 玩家点确认才执行
 *    - 适合会改编辑器 / 删文件 / 调外部 API 类 tool（update_doc_item 默认值）
 *  - `deny`：tool 存在 schema 但 LLM 调了前端 reject + 返回错误消息
 *    - 跟 enabled=false 效果接近 —— 区别是 deny 时 LLM 看到 tool 但被前端 reject，
 *      可以让 ta "知道了以后会避免"；enabled=false 时 LLM 完全不知道存在 */
export type ToolPermission = 'auto' | 'ask' | 'deny'

/** 单个 tool 的设置（v0.4+ Settings tab 工具 / 工具权限 用）
 *  - enabled: false → LLM 完全不知道存在（用户硬要求）
 *  - permission: 'auto' | 'ask' | 'deny'（默认 'ask' 玩家主导安全机制） */
export interface ToolSetting {
  enabled: boolean
  permission: ToolPermission
}

/** settings.config.tools 完整结构 */
export interface ToolsConfig {
  ask_user_question: ToolSetting
  update_doc_item: ToolSetting
  ask_free_text: ToolSetting
}

export function defaultToolsConfig(): ToolsConfig {
  return {
    ask_user_question: { enabled: true, permission: 'auto' },
    update_doc_item: { enabled: true, permission: 'ask' },
    ask_free_text: { enabled: true, permission: 'auto' },
  }
}

/** 把 settings.config.tools 标准化（缺字段补 default）—— 老 config 没这字段时
 *  loadConfig 返的对象也没这字段；调用方调这函数保证结构完整 */
export function normalizeToolsConfig(raw: unknown): ToolsConfig {
  const def = defaultToolsConfig()
  if (!raw || typeof raw !== 'object') return def
  const r = raw as Partial<Record<keyof ToolsConfig, Partial<ToolSetting>>>
  const merge = (k: keyof ToolsConfig): ToolSetting => ({
    enabled: r[k]?.enabled ?? def[k].enabled,
    permission: r[k]?.permission ?? def[k].permission,
  })
  return {
    ask_user_question: merge('ask_user_question'),
    update_doc_item: merge('update_doc_item'),
    ask_free_text: merge('ask_free_text'),
  }
}

// === resolveEnabledTools —— API 层过滤 ===

/** 从 settings 解析 LLM 可用的 tool 定义列表
 *  - enabled = false → 不进 list（**LLM 完全不知道存在**，用户硬要求）
 *  - 关闭的 tool 既不在 request body 的 tools 字段，也不在 system prompt 描述
 *  - 全关 → 返空数组（Rust 端不写 tools 字段，跟 v0.3+ 行为一致）
 *
 *  跟 Rust 端 ChatRunOptions.tools 字段一一对应
 */
export function resolveEnabledTools(config: Config | null | undefined): ToolDefinition[] {
  if (!config) return []
  // TS 2352: Config 的 keys 都有具体类型，不能直接 `as Record<string, unknown>`；
  // 先走 unknown 中转（types 已知不是 Config 标准字段时是安全 cast）
  const raw = config as unknown as Record<string, unknown>
  const tools = normalizeToolsConfig(raw.tools)
  return BUILTIN_TOOLS.filter((t) => tools[t.name]?.enabled).map((t) => t.schema)
}
