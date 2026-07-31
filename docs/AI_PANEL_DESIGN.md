# AI 面板重构：统一聊天 + 预设动作 + 备选内联化

> v0.3+ AI 面板设计稿。**实施前必读第 4 节「5 条补丁」** —— 那是从原草稿评审里挑出来的实现细节，原文没写。
>
> **v0.4+ 追加**：tool calling 替代 JSON 解析（§7）。原 v0.3+ JSON 数组解析路径（`parseAlternatives` / `polishExpandFailed` / 整体采用条对 polish-expand 失败兜底）已删除。
>
> 背景：v0.2 用过一轮后，2026-07-30 用户反馈"备选应该是聊天的一部分"+ "每个 tab 的 prompt 要单独设计"。2026-07-30 下午用户提"用 tool calling 替代 JSON 解析"+ "Settings tab 工具/工具权限 UI"+ "关闭的 tool 不在 prompt 给 LLM"（同 Locus 风格的 `ask_user_question`）。

---

## 1. 目标

**AI 面板 = 一个统一聊天组件**（AiChatPanel）。每个 tab 自己配：
- **presets**：每步/节 2-3 个 chip，点一下自动发一条 prompt
- **system prompt 骨架**：每个 tab / step 自己拼，组件不关心
- **context 注入**：tab 内部决定拼什么（宪法 / 前置步骤 / 其他节摘要）

**核心约束**：
- 玩家主导：AI 给 3-5 个备选，玩家挑+改，AI 永不自动覆盖玩家内容
- 流式 + 标记 done：所有 LLM 交互走 start_chat 流式
- 备选 = assistant 消息的"特殊渲染分支"，不独立成 widget

---

## 2. Layout（三栏）

```
┌─ 左：列表 ────┬─ 中：内容 ──────┬─ 右：AI 助手 · {title} ─┐
│ stepper /     │ 编辑区 /       │ [消息列表]               │
│ section list  │ 画布 /         │  - user 气泡             │
│               │ 画廊           │  - assistant 气泡        │
│               │                │  - assistant 备选卡片组* │
│               │                ├─ [chip 1] [chip 2] [chip 3]
│               │                │ [composer: textarea + 发送]
└───────────────┴────────────────┴──────────────────────────┘
```

*备选卡片组 = assistant 回复的特殊渲染：流到 done → `parseAlternatives` 试解 → ≥ 2 项 → 卡片组（每张带「采用」→ 替换编辑器），否则普通气泡（带「写入编辑器」→ 追加到末尾）。

---

## 3. 三个关键决策

### 3.1 备选走流式 chat 路径（不再走非流式 generate）

- 预设 chip 的 prompt 里带"输出 JSON 数组"指令 → 流到 done → 解析分支
- 收益：每 tab 只剩**一条 LLM 路径**（start_chat 流式），删 `generateAlternatives` / `AlternativesPicker` / `generating` 状态
- 后端 `generate` command + 前端 `lib/llm.ts:generate` **保留不动**，注释标注"v0.4+ AI 验收用，当前无调用方"

### 3.2 预设动作（presets）= 每步/每节静态配置，chips 一键发送

```ts
interface PresetAction {
  label: string                          // chip + user 气泡显示（短，emoji + 几个字）
  prompt: string                         // 发给 LLM 的完整指令
  output: 'json' | 'markdown'            // 流完渲染分支：json→卡片组；markdown→气泡
}
```

- 点 chip = 立即发送（不填 composer），user 气泡**只显示 label**，LLM 收到完整 prompt
- 前端 `ChatMessage.preset?: string`（label only），store send 时**strip preset 字段**再发后端（Rust ChatMessage 不加，干净）
- presets 静态配置放各 store 文件 export（`STEP_PRESETS` / `SECTION_PRESETS`），view 按当前 item 传给组件
- chip `title` 属性 = 完整 prompt，hover 1 秒看 tooltip（玩家知道点的是哪条）

### 3.3 step chat 历史升级为内存级 per-item

- 现状：切步清空（ephemeral）—— 备选内联进聊天后，切步丢备选卡片体验差
- 改为 store 里 `Map<itemId, ChatMessage[]>` 等多字段 map —— tab 内切步各自保留，**关 app 才丢，不落盘**
- 切项目 → 全部清（不同项目 itemId 可能冲突 —— 不会，concept stepId / world docId 是固定枚举，但安全起见仍全清）

---

## 4. 5 条实施前补丁（原草稿没说清）

### 4.1 流式 JSON 解析时机

**流中只显示「生成中…」占位**（不渲染字符，避免看到半个 `[` 流过）；**done 后**调 `parseAlternatives` 判定分支（卡片 vs 气泡）。

增量 JSON parser（流到 `]` 立刻切卡片）体验更爽，但 v0.3+ 先上简单版，v0.4+ 再考虑。

### 4.2 PresetAction 字段

`output: 'json' | 'markdown'` 必填，**消除隐式约定**：
- `'json'` preset 的 prompt 必须带"输出 JSON 数组（不要 markdown 代码围栏、不要任何额外文字），3-5 项"指令
- `'markdown'` preset 的 prompt 自由对话
- 当前 `PROMPT_TAIL` 那段（"玩家主导 + JSON 数组"）只对 `output: 'json'` 拼接

### 4.3 per-item 状态全集 Map 化

不只 `messages`：`text` / `streaming` / `errorKind` / `errorRaw` / `runId` 全部 per-item Map 化。

切到别的 step 时旧 run **不取消**（runId 留在 map 里），切回自动续流（listener 按 runId 过滤累积）。

### 4.4 清空对话入口 + 切项目全清

- **清空对话按钮**：AiChatPanel header 加 lucide `Eraser` 小按钮 → 弹确认 → 调 `resetStepChat(itemId)`
- **切项目全清**：store 加 `clearAllStepChats()`，watch `project.current?.folder` 时调（不同项目 step 1 内容可能同，叠加会乱）

### 4.5 adopt emit 协议

`emit('adopt', { text, mode: 'replace' | 'append' })`：

- `mode` 派生自 preset.output / 流式结果分支：
  - 备选卡片点「采用」→ `mode: 'replace'`（替换编辑器）
  - 普通气泡点「写入编辑器」→ `mode: 'append'`（追加到末尾）
- view 层一个 `onAdopt(payload)` handler，按 mode 分支处理

---

## 5. System prompt 骨架

```
你是 PlotCraft 的 AI 编剧搭档，正在帮玩家做「{步骤标题}」。
{该步/节的写作约束}
玩家主导：你给建议、追问、提备选，玩家挑+改，绝不替他做决定。
{context：宪法 + 已有内容}
```

- **system 永远讲 markdown 对话规则**（"输出 markdown，保持简洁"）
- **user 消息带 preset prompt**（如果点 chip 触发）或玩家自由输入
- 备选 JSON 约束**只对 `output: 'json'` 的 preset 在 user 消息里强调**

### 5.1 context 注入规则（沿用现状）

| Tab | Context 内容 |
|---|---|
| 概念 step chat | 前置步骤中 status="confirmed" 的内容（按 STEP_IDS 顺序）|
| 概念 step chat + 当前 step 已有内容 | "当前「{title}」已有的内容：..." 或 "当前「{title}」还是空白，请从零给备选" |
| 世界 step chat | 概念宪法（getConceptSummary）+ 其他分节摘要 + 当前节已有内容 |
| 世界 step chat + 当前节空白 | 同上的 "空白" 分支 |

---

## 6. Presets 设计（11 条，6 步 + 5 节）

每条 2 个 preset：**preset 1 = 生成（💡，output: 'json'）/ preset 2 = 反思（🔍，output: 'markdown'）**。

prompt 全文在 store 文件 export 里（实施时按下面表格的"角度示例"展开），这里只列 label + 意图 + 角度示例。

### 6.1 概念 6 步

| 步骤 | Preset 1（生成，💡，json） | Preset 2（反思，🔍，markdown）|
|---|---|---|
| 种子 | **给 3-5 个一句话种子**<br>画面感 / 情绪 / "如果..." 各试 | **反问我 3 个尖锐问题**<br>玩家想模糊时逼他想清楚 |
| 核心体验 | **给 3-5 个改写**<br>「玩家是___，在___处境，做___」格式 | **检验这句有没有钩子**<br>钩子 = 让玩家想玩下去的张力 |
| 设计支柱 | **从核心体验拆支柱**<br>3-5 条，每条有否决权 | **打回我的废话支柱**<br>「丰富剧情」「画面精美」这种打回 |
| 世界规则 | **从核心体验推规则**<br>每条带「造成什么冲突」| **检查规则有没有冲突**<br>规则间不自洽/规则压死玩法 |
| 人物功能 | **按模式生成人物候选**<br>对手=支柱反面人格化 / 镜子=主角另一种可能 / 推手=推进情节 | **检查人物是不是纸片人**<br>想要什么 + 为什么得不到，缺一打回 |
| 三幕骨架 | **给 3-5 种加压走法**<br>每种三幕各自的加压点（一幕比一幕紧）| **检验压力有没有递增**<br>第二幕是不是比第一幕紧、第三幕是不是没塌 |

### 6.2 世界 5 节

| 节 | Preset 1（生成，💡，json）| Preset 2（反思，🔍，markdown）|
|---|---|---|
| 速览 | **给 3-5 个不同基调的版本**<br>写实冷感 / 史诗浪漫 / 怪奇童话 / 江湖市井 / 后工业废土 之类挑 3-5 | **检查有没有体现核心体验**<br>玩家看这段能感受到核心体验吗 |
| 地理 | **给 3-5 个关键地点设计**<br>每个带「它给故事提供什么舞台/冲突」| **检查是不是纯百科**<br>纯罗列无冲突的地点打回 |
| 历史 | **给 3-5 条关键历史**<br>每条带「它造成了今天的什么」| **检查对现在还有没有影响**<br>无影响的事件不要写 |
| 魔法体系 | **给 3-5 套不同机制**<br>符文 / 血脉 / 信仰 / 炼金 / 契约 之类挑 3-5 | **检查代价/限制够不够**<br>无敌规则标记为可疑并说明 |
| 阵营 | **给 3-5 个阵营**<br>每个带「想要什么 + 跟谁的什么冲突」| **检查冲突网是否闭合**<br>每个阵营至少跟 1 个别的阵营有冲突 |

---

## 7. v0.4+ Tool Calling 升级

### 7.1 设计动机

v0.3+ 走 JSON 数组解析（`parseAlternatives`）：LLM 返 markdown 文本 + JSON 数组藏在 ` ```json ``` ` 围栏里，前端正则抠出来渲染成 AltCard。三个老问题：

1. **脆弱的 prompt 约束**：`JSON_TAIL` 写"第一个字符必须是 `[`" "禁止 preamble"——LLM 经常不听，加一坨 "让我分析一下" 解释文本
2. **schema 不可见**：LLM 不知道什么字段名/什么类型，纯靠 prompt 约束
3. **多轮"采用 button 类似 ask_question" 流程不自然**：玩家点 AltCard 直接写编辑器，LLM 不知道玩家选了哪个

v0.4+ 改用 **OpenAI 协议级 tool calling**：

- LLM 通过 `tools: [{type: function, function: {name, description, parameters: JSON schema}}]` 拿到严格 schema
- LLM 调 tool 时返 `tool_calls: [{id, name, arguments: "..."}]`（结构化）
- 玩家点 AltCard 选完，前端把选择作为 `role: 'tool', tool_call_id, content` 喂回 LLM 第二轮
- LLM 第二轮看到 tool result，可能再调 `update_doc_item` tool 主动写编辑器
- 玩家点"确认写入" → 写编辑器 + 喂回 LLM"已确认"

### 7.2 三个内置 tool

| Tool | 用途 | 风险 | 默认 permission | UI 渲染 |
|------|------|------|----------------|---------|
| `ask_user_question` | LLM 给玩家 2-5 个备选让 ta 选 | 低 | `auto` | AltCard 卡片组（带 title/description/preview）|
| `update_doc_item` | LLM 主动把内容写入某项 | 中 | `ask` | "AI 建议写入 X" + 确认按钮 |
| `ask_free_text` | LLM 反问玩家一个开放问题 | 低 | `auto` | 气泡 + "💭 问题" 提示 |

**Schema 示例**（`ask_user_question`）：

```json
{
  "type": "function",
  "function": {
    "name": "ask_user_question",
    "description": "向玩家提出一个多选问题...",
    "parameters": {
      "type": "object",
      "properties": {
        "question": { "type": "string" },
        "options": {
          "type": "array",
          "minItems": 2,
          "maxItems": 5,
          "items": {
            "type": "object",
            "properties": {
              "label": { "type": "string", "description": "10 字内短标题" },
              "preview": { "type": "string", "description": "完整备选内容" },
              "description": { "type": "string" }
            },
            "required": ["label", "preview"]
          }
        }
      },
      "required": ["question", "options"]
    }
  }
}
```

### 7.3 多轮 tool calling 流程

```
LLM round 1: 调 ask_user_question tool → AltCard 卡片组
  → 玩家点 AltCard（"采用 A"）
  → stepChat.sendToolResult(callId, "A: 完整内容")
  ↓
LLM round 2: 看到 tool result → 调 update_doc_item tool
  → "AI 建议写入 X" + 确认按钮
  → 玩家点"确认写入"
  → emit('adopt', { mode: 'replace', text: X })  → ConceptView 写编辑器
  → stepChat.sendToolResult(callId, "玩家已确认写入")
  ↓
LLM round 3: 看到"玩家已确认" → 出 text 总结 → 走整体采用条 append
```

任意一轮 LLM 都可能**改主意**——round 2 调完 `update_doc_item` 也可能接着调 `ask_user_question` 继续追问（理论上 LLM 不会这么做，但 schema 不阻止）。

### 7.4 Settings tab UI（Locus 双 sub-tab）

```
┌─ Settings → AI → 工具 ─────────────────────┐
│                                               │
│  [工具]  [工具权限]                           │
│                                               │
│  工具 sub-tab：                                │
│    Ask User Question          [● 开]          │
│    Update Doc Item            [● 开]          │
│    Ask Free Text              [● 开]          │
│                                               │
│  工具权限 sub-tab：                            │
│    Ask User Question          [自动][询问][禁止]│
│    Update Doc Item            [自动][询问][禁止]│
│    Ask Free Text              [自动][询问][禁止]│
│                                               │
└───────────────────────────────────────────────┘
```

**关键差异（跟 Locus 比）**：
- Locus 是 AI 主导（几十个 tool 玩家可控制）
- PlotCraft v0.4+ 只 3 个 tool（玩家主导原则 → 工具精简）

**关键差异（跟 v0.3+ 比）**：
- 关闭的 tool = `enabled: false` → 不在 LLM `tools` 字段 → LLM 完全不知道存在（**用户硬要求**）
- 不像 Locus 关了 tool 还能在 system prompt 描述

### 7.5 协议 schema 自动转

`lib/ai-tools.ts` 统一存 OpenAI 格式 `ToolDefinition`（`{type: function, function: {name, description, parameters}}`）。Rust 端 build body 时按 `api_format` 转：

| 协议 | 注入字段 | 工具消息 | assistant 消息带 tool_calls |
|------|---------|---------|---------------------------|
| OpenAI Chat Completions | `tools: [...]` | `role: tool, tool_call_id, content` | `tool_calls: [...]` 原样 |
| OpenAI Responses | `tools: [...]`（同 Chat）| `role: tool, tool_call_id, content` | `tool_calls: [...]` 原样 |
| Anthropic Messages | `tools: [{name, description, input_schema}]` | `role: user, content: [{type: tool_result, tool_use_id, content}]` | `content: [{type: text, text}, {type: tool_use, id, name, input}]` |

### 7.6 关闭的 tool 不在 prompt 给 LLM（用户硬要求）

```ts
// lib/ai-tools.ts
export function resolveEnabledTools(config: Config | null | undefined): ToolDefinition[] {
  if (!config) return []
  const tools = normalizeToolsConfig((config as Record<string, unknown>).tools)
  return BUILTIN_TOOLS.filter((t) => tools[t.name]?.enabled).map((t) => t.schema)
}
```

Rust 端：
```rust
if let Some(tools) = tools {
    if !tools.is_empty() {
        body["tools"] = serde_json::to_value(tools).unwrap_or(serde_json::Value::Null);
    }
}
```

**关键保证**：
- `enabled: false` → 完全不在 `tools` 字段
- 完全不在 system prompt 描述
- LLM schema 里看不到这个 tool

### 7.7 落地文件清单

- `src/lib/ai-tools.ts` (新) — ToolDefinition / BUILTIN_TOOLS / resolveEnabledTools / normalizeToolsConfig
- `src/lib/llm.ts` — `onChatToolCall` 事件订阅 + `ChatRunOptions.tools` 字段
- `src/types/chat.ts` — `ToolCallInfo` / `ToolCallPartial` / `ChatToolCallPayload` + `ChatMessage.tool_calls` / `tool_call_id`
- `src/types/ai.ts` — `StepChatState.sendToolResult`（v0.4+ 新增）
- `src/components/ai/AiChatPanel.vue` — 删 `parseAlternatives` + `polishExpandFailed` 兜底；新增 `assistant-tool-question` / `assistant-tool-freetext` / `assistant-tool-update` 3 种 kind；`onAdoptAltCard` / `onConfirmUpdate` 走 `sendToolResult` 多轮
- `src/components/ai/AltCard.vue` — 新增 `title` / `description` props（v0.3+ 路径不传 = 不显示 header）
- `src/components/settings/ToolsSettings.vue` (新) — Locus 双 sub-tab（工具 / 工具权限）
- `src/stores/concept.ts` + `src/stores/world.ts` — 提取 `runChatRound` 内部函数；新增 `sendToolResult` API；订阅 `onChatToolCall` 累积 tool_calls；`chatToolCalls: Map<itemId, Map<index, ToolCallInfo>>` per-item 状态
- `src/views/SettingsView.vue` — sidebar 加 AI → 工具 入口
- `src-tauri/src/llm/types.rs` — `ToolDefinition` / `ToolFunctionDef` / `ToolCallInfo` + `MessageRole::Tool` + `ChatMessage.tool_calls` / `tool_call_id`
- `src-tauri/src/llm/streaming.rs` — mpsc 改 `StreamEvent` enum + `parse_openai_sse_buffer` 解析 `delta.tool_calls[]` + `emit_throttled` 分发到 `chat:chunk` / `chat:tool_call` + build body 加 `tools` 字段
- `src-tauri/src/llm/streaming_anthropic.rs` — 解析 `content_block_start.tool_use` + `input_json_delta`；build body 时 Anthropic schema 转 `input_schema`；tool message 转 `content: [{type: tool_result, ...}]`
- `src-tauri/src/llm/streaming_openai_responses.rs` — 解析 `output_item.added` + `function_call_arguments.delta`
- `src-tauri/src/llm/config.rs` — `AppConfig.tools: ToolsConfig` (camelCase)；`ToolSetting { enabled, permission }` + `ToolPermission { Auto, Ask, Deny }` enum
- `src-tauri/src/commands/llm.rs` — `start_chat` 接 `tools: Option<Vec<ToolDefinition>>` 参数

### 7.8 已知限制（v0.4+ 后续）

- `permission: 'ask'` 走 inline 确认按钮（"AI 建议写入 X" + 确认按钮）—— 不弹 modal popup，跟 v0.3+ 整体采用条一致风格。modal popup 留 v0.4+ 后扩展
- tool schema 限定 concept 6 步（`update_doc_item.item_id` enum 是 `seed / core-fantasy / pillars / world-rules / character-functions / three-act`）—— world 5 节 / characters / plot 等它们自己有 store 再加
- tool message 累积：per-item `Map<itemId, Map<index, ToolCallInfo>>`（`shallowRef` + `triggerRef` 手动触发），跟 v0.3+ per-item Map 化惯例一致
- 流式 tool call 处理：start chunk 给 id + name，后续 chunk 累积 arguments；done 时 `JSON.parse(arguments)` 成功判定"完整"（前端 `parseAskUserQuestion` / `parseAskFreeText` / `parseUpdateDocItem` 处理）

---

## 7. 改动清单

### 7.1 前端

1. **`src/types/chat.ts`**：`ChatMessage` 加 `preset?: string`（仅前端 UI 用，发送前 strip）
2. **`src/types/ai.ts`**：
   - 新增 `PresetAction { label, prompt, output }`
   - `StepChatState` 改：`messages` 是当前 item 的历史（computed ref）；`text` / `streaming` / `errorKind` / `errorRaw` / `runId` per-item Map；`send(itemId, text, preset?)`；`reset(itemId)` + `clearAll()`
3. **`src/components/ai/AltCard.vue`**（抽出独立 .vue，备选卡片）
4. **`src/components/ai/AiChatPanel.vue`**（新建，替代 StepChatPanel + AlternativesPicker）：
   - props：`{ itemId, title, chat: StepChatState, presets: PresetAction[] }`
   - 常驻面板：header（Sparkles + "AI 助手 · {title}" + Eraser 清空按钮）→ 消息列表 → chips 行 → composer
   - assistant 消息渲染分支：流中显示"生成中…"占位；done → `parseAlternatives` ≥ 2 项 → 卡片组（每张带「采用」emit mode='replace'）；否则气泡（带「写入编辑器」emit mode='append'）
   - user 消息 `preset` 存在 → 气泡显示 preset label + 小图标（💡/🔍），不显示完整 prompt；chip 自带 `title` = 完整 prompt
   - 流式累积显示、错误玩家文案、Enter 发送挡 IME —— 沿用现 StepChatPanel 逻辑
5. **删除** `src/components/ai/AlternativesPicker.vue` + `src/components/ai/StepChatPanel.vue`
6. **`src/stores/concept.ts` + `src/stores/world.ts`**（对称改动）：
   - 删 `generateAlternatives` / `generating`（store return 同步清理）
   - step chat 历史 Map 化：`histories = Map<itemId, ChatMessage[]>`；`messages` / `text` / `streaming` / `errorKind` / `errorRaw` / `runId` per-item Map；`sendStepChat(itemId, text, preset?)`（发送前 strip preset，prompt 走 preset.prompt 或 text）；`resetStepChat(itemId)` 清单个；`clearAllStepChats()` 全清
   - export `STEP_PRESETS` / `SECTION_PRESETS`（按 §6 表格写完整 prompt，角度示例展开）
   - system prompt 按统一骨架重写（角色 + 约束 + 玩家主导）
   - stepChat markRaw 结构同步更新（per AGENTS.md 硬规则 #10）
7. **`src/views/ConceptView.vue` + `src/views/WorldView.vue`**：
   - 右栏 AlternativesPicker + StepChatPanel → 单个 AiChatPanel（`:presets="STEP_PRESETS[currentStepId]"` 等）
   - 切步逻辑里的 `resetStepChat()` 调用删除（历史保留）；切项目 watch 调 `clearAllStepChats()`
   - `onAdoptAlternative` + `onAdoptChatReply` 合并为 `onAdopt({ text, mode })`，按 mode 分支
8. **`src/lib/llm.ts`**：`generate` wrapper 加注释"当前无调用方，v0.4+ AI 验收用"

### 7.2 后端

无改动（`generate` command 保留）。

### 7.3 文档

- `AGENTS.md`：§10 速查"通用 AI 面板"行更新（AiChatPanel + presets）；§2 状态表 AI 面板行更新
- `docs/ROADMAP.md`：决策日志加 2026-07-30（备选内联进聊天 + 预设动作设计）

---

## 8. 明确不做

- ❌ step chat 落盘持久化（内存 per-item 够了，落盘等用户反馈再说）
- ❌ 人物 / 剧情 tab 接入（v0.3+；现 placeholder 没自己的 store）
- ❌ 预设动作玩家自定义（v0.4+ prompt 模板库的雏形）
- ❌ 增量 JSON parser（v0.4+；先 done 后解析）
- ❌ 后端 generate command 删除（保留备用）

---

## 9. 验证

1. `bun run typecheck` 0 error
2. `cd src-tauri && cargo check` 0 error（后端无改动，确认没误碰）
3. 手动 smoke：
   - 概念 tab 第 1 步「种子」：点「💡 给 3-5 个一句话种子」→ 流中显示「生成中…」 → done → 5 张卡片 → 「采用」替换编辑器
   - 点「🔍 反问我 3 个尖锐问题」→ 流中显示「生成中…」→ done → 普通气泡（3 个问题）→ 「写入编辑器」追加
   - 自由输入聊天正常；user 气泡显示 preset label 而非长 prompt；chip hover 看 tooltip
   - 切步再切回：聊天历史还在（含备选卡片）
   - 切项目：所有 step chat 全清
   - 世界 tab 同款验证
   - DevTools Network/后端 log：发给 provider 的 messages **不含** preset 字段

---

**AI_PANEL_DESIGN.md 结束**。改动前先看 §4 5 条补丁。
