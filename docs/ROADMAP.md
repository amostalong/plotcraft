# PlotCraft Roadmap

> **版本时间线 + 目标追踪**。每个 release 完成后更新状态总览。
> 详细设计见 [DESIGN.md](./DESIGN.md)，v0.1 启动前收尾项见 [CHECKLIST.md](./CHECKLIST.md)。

---

## 状态总览

| 版本 | 状态 | 目标交付 | 详细 |
|------|------|----------|------|
| **v0.1** | ✅ 已完成 | 6 tab 框架 + Chat + Setting 实装 + 真 LLM + 反 Locus 卡顿 | [§v0.1](#v01) |
| **v0.2** | ✅ 已完成 | 产品级 chat error feedback（8 分类 + 玩家文案 + retry + 详情链接）| [§v0.2](#v02) |
| **v0.3+** | ✅ 已完成 | AI 面板重构（单 AiChatPanel + presets chips + 备选内联化）+ 概念 tab + 世界 tab + concept/world 通用 store 形状 | [§v0.3+](#v03) |
| **v0.4+** | ✅ 已完成 | Tool calling 替代 JSON 解析（3 个内置 tool + Settings tab 工具/工具权限 UI + 多轮 send）| [§v0.4+](#v04-tool-calling-替代-json-解析) |
| **v0.5+** | ✅ 已完成 | 概念设计 6 步漏斗 → 7 层严格派生模型 + 设计循环（黄点 + 4 校准 preset）+ Path A 方法论索引注入 | [§v0.5+ 7 层概念 + 设计循环](#v05-7-层概念--设计循环) |

**状态图例**：⬜ 未启动 / 🟡 进行中 / ✅ 已完成 / ⏸️ 暂停 / ❌ 取消

---

## v0.1 ✅

**目标**：6 tab 框架跑起来，**Chat + Setting 实装**，真 LLM 接入，**反 Locus 卡顿从第一行起就位**。

> ⚠️ **范围 2026-07-28 重切**（用户决策）。原计划 AI stub 验证管道改为**直接接真 LLM**。
> 详见 [CHAT_LLM_DESIGN.md](./CHAT_LLM_DESIGN.md)（v0.1 启动的最终设计依据）。

**完成情况**（2026-07-29 收尾）：
- ✅ Tauri 2 + Vue 3 + Rust + bun 骨架
- ✅ 7 tab 路由（vue-router）—— 7 个 view 含 Setting
- ✅ **Chat tab（SessionView）实装**：
  - 8 字段 / 8 mutation `useStreamReducer`（v0.1）
  - LLM client（OpenAI 兼容，spawn_blocking 隔离 SSE 解析）
  - 16ms emit 节流 + mpsc channel 解耦 parse / emit
  - markdown 渲染走主线程同步（marked + DOMPurify，1KB 解析 < 1ms）
- ✅ **Setting tab（SettingsView）实装**：API key / endpoint / model / 主题 / 最近项目
- ✅ **新建项目流**（4 个 starter md）
- ✅ **create_project / list_projects** Tauri 命令
- ✅ **反卡顿基础设施**：
  - `mimalloc` 全局 allocator
  - 所有 Tauri commands `async fn`
  - `tokio::task::spawn_blocking` 隔离 CPU 密集解析
  - `tokio::sync::mpsc::channel` 解耦 parse / emit
  - 16ms rAF 节流 emit（60 fps）
  - `shallowRef` 包大对象
  - 启动分阶段（phase 1 < 500ms 目标）
- ✅ 性能验收 P1-P8
- ✅ 根 `AGENTS.md`

**4 个 Placeholder tab**（v0.1 仅占位）：
- 概览 (Overview) / 世界 (World) / 人物 (Characters) / 剧情 (Plot) / 设定图 (Concept Art) — "v0.2+ 实装"

**v0.1 不做**（已决）：
- ❌ AI stub（v0.1 直接接真 LLM，2026-07-28 决策）
- ❌ 关系图可视化（v0.3）
- ❌ 真实图片生成（v0.3）
- ❌ 独立 OnboardingView（v0.1 引导流在 chat tab 内完成，v0.2 再分）
- ❌ i18n（v0.4+）
- ❌ vitest 自动化测试（v0.4+）
- ❌ CI / GitHub Actions（v0.1 手动 cargo check + typecheck）
- ❌ 多人协作 / 云端同步（v0.4+）
- ❌ 模板市场（v0.4+）
- ❌ macOS / Linux 适配（v0.3+）

**详细设计**：[CHAT_LLM_DESIGN.md](./CHAT_LLM_DESIGN.md) — v0.1 启动的**最终设计依据**。

**v0.1 → v0.2 衔接遗留 bug**（v0.1 收尾时修）：
- ❌ `test_provider` invoke 外层 key `opts` 跟后端 `params` 不匹配 → 前端改 `params: opts` ✅
- ❌ `stream_chat` 异步抛错只 eprintln 不 emit event → 全路径加 `emit_chat_error` ✅
- ❌ `parse_openai_sse_buffer` 不读 `reasoning_content` 字段 → content 缺时 fallback ✅
- ❌ 诊断 log `[stream] first chunk / closed` 全 chat 路径都打噪音 → 只在 total_deltas=0 打 ✅

---

## v0.2（当前）

**目标**：从 v0.1 "技术性错误直给玩家" 升级到 **产品级 chat error feedback**。

> ⚠️ **范围 2026-07-29 重切**（用户决策）。原计划 v0.2 写的是"真实 AI 集成 + 引导流 + 共创模式"——但这些 v0.1 已经实装。
> v0.2 重新对齐实际开发节奏：v0.1 收尾撞到 chat 错误反馈对玩家黑盒的产品级问题，按"feature > version limit"原则 1-5 全做。

**核心交付**（v0.2.0 — chat error feedback 全套）：

1. **错误分类 + 玩家文案**
   - 后端 `ChatErrorKind` 8 种：network / auth / model_not_found / bad_request / rate_limit / server_error / stream_protocol / unknown
   - `classify_error()` 函数按 HTTP status + 错误文本前缀自动归类
   - 前端 `lib/error-messages.ts`：kind → { title, description, hint, canRetry, technicalDetails }
   - 玩家默认看不到 OpenSSL/TLS 错误字符串，点 "查看详情" 才展开

2. **保留 partial response**（LLM 流到一半挂的情况）
   - `useStreamReducer.ts` fail mutation 改：保留 `currentText` 作为 partial assistant message（带 `partial: true` 标记）
   - transcript 渲染时 partial 末尾加 "(回复中断)" marker
   - 视觉差异：partial message 边框用 dashed + opacity 0.85

3. **重试入口**（3 处）
   - composer 顶部错误条 "重试" 按钮
   - transcript 错误块 "重试" 按钮
   - 快捷键 `Ctrl/Cmd+Shift+R`（跟 Locus "retry last" 同款）
   - 重试用 `chat.retryLast()` 一键重发 lastUserMessage（不重输）

4. **lastUserMessage 持久化**
   - session schema v1 → v2 加 `last_user_message` 字段
   - send / retry 时自动写入 state.lastUserMessage
   - 启动时从 session 文件 load 回来（重启 app 不丢 retry 上下文）
   - 老 v0.1 session 兼容读（`#[serde(default)]` 兜底）

5. **"查看详情" 链接**
   - 错误条右边按钮 → 跳 Settings → Console tab，filter by run_id
   - `route.query.tab` / `route.query.runId` 透传到 `SettingsView` / `ConsoleSettings`
   - ConsoleSettings 加 `runIdFilter` prop，自动设 searchQuery

**反卡顿 v0.1 → v0.2 升级**：
- chat state 8 → 12 字段（+ errorKind / lastUserMessage / lastFailedRunId / lastErrorAt）
- mutations 8 → 10（+ retry / dismissError）
- 仍远小于 Locus 35+ 字段（增加 < 一倍），反卡顿哲学保留（shallowRef / identity-stable array）

**后端 / 前端 / 测试**：
- 后端：streaming.rs ChatError 加 kind 字段 + classify 函数 + emit_chat_error helper（pub(crate) 三个 streaming 实现共用）
- 后端：commands/session.rs schema v1 → v2 + 3 个 unit test（v2 roundtrip / v1→v2 兼容 / empty serialize）
- 后端：src-tauri/src/llm/types.rs ChatMessage 加 partial 字段（`Option<bool>` + `#[serde(default)]` 兼容老 session）
- 前端：types/chat.ts ChatErrorPayload + ChatErrorKind 枚举 + ChatMessage.partial
- 前端：lib/error-messages.ts 新文件（玩家文案 util）
- 前端：useStreamReducer.ts 8→12 字段 / 8→10 mutations
- 前端：stores/chat.ts retryLast() + dismissError() + lastUserMessage 跟踪
- 前端：lib/llm.ts loadSession/saveSession 改 SessionFileV2 shape
- 前端：SessionView.vue composer + transcript 错误条改造 + partial 渲染 + Ctrl+Shift+R 快捷键
- 前端：SettingsView + ConsoleSettings 加 runIdFilter prop（详情链接跳转）

**v0.2 不做**（推到 v0.3+）：
- ❌ reasoning vs content 分离显示（智谱 GLM reasoning_content 现在混在 content 里显示，v0.3+ 再加折叠 UI 区分）
- ❌ 4 个 placeholder tab 实装
- ❌ 关系图 / 真实图片生成
- ❌ i18n / vitest / CI
- ❌ 多 provider（Anthropic / Gemini 等）

**依赖**：v0.1 全部完成（基础流式管道 + 反卡顿 + 真 LLM 接入）

## v0.3+ ✅

**目标**：统一 AI 面板形态（备选 = 聊天的一部分）+ 实装概念 tab + 实装世界 tab。

> ⚠️ **2026-07-30 用户决策**：v0.3 范围重切为"AI 面板重构 + 概念/世界 tab"——原计划的"关系图 + 图片生成"推迟到 v0.5+。
> 详见 [AI_PANEL_DESIGN.md §1-6](AI_PANEL_DESIGN.md)。

**核心交付**（v0.3.0）：
- ✅ **AI 面板统一**：单 `AiChatPanel.vue` 替代 v0.2 的 `StepChatPanel` + `AlternativesPicker` 两件套
  - 消息列表 + presets chips + composer
  - assistant 备选内联进消息（AltCard 卡片组；流中只显示 "AI 在想..." 占位）
  - 整体采用条：取本轮（最后 user msg 之后）所有 AI 回复拼接
  - `polishExpandFailed` 兜底（v0.4+ 删，因为 JSON 解析路径已删）
- ✅ **概念 tab**（6 步漏斗：种子→核心体验→支柱→世界规则→人物功能→三幕）
  - 6 步 × 4 presets（生成/反思/润色/扩展）= 24 chip
  - step chat per-item Map 化 + 自动落盘（`项目/.chats/concept/<stepId>.json`）
  - chat 宪法注入（`项目/concept/` 摘要进 system prompt）
- ✅ **世界 tab**（5 节固定分节：overview / geography / history / magic-system / factions）
  - 通用 docs 模块（collection 注册表，concept / world 共用一套 IO）
  - step chat 跟 concept 形状对称
  - 概念宪法 + 其他节摘要进 AI context
- ✅ **Settings store 形态**：config.json 持久化，UI 改动自动落盘
- ✅ **chat listener 跟 view 生命周期解耦**（切 tab 不丢 stream）

**反卡顿 v0.2 → v0.3+ 升级**：
- `useStreamReducer` 12 字段（v0.2）→ 改为 per-item Map（v0.3+）+ 5 个 shallowRef Map（messages / text / streaming / errorKind / errorRaw / runId）
- component 派生 computed 按 `currentXxxId` ref 自动取当前 item 的状态
- store 暴露 `stepChat: markRaw({ messages, text, streaming, errorKind, errorRaw, send, reset })` 给组件

**新增非流式 `generate` command**（test_provider 骨架泛化）：
- v0.3+ 当前无调用方（备选走流式 chat + JSON parse 内联）
- 保留为 v0.4+ AI 验收类功能（"批量检查所有 step 是否满足宪法"）

**v0.3+ 不做**（推到 v0.5+）：
- ❌ 关系图可视化
- ❌ 真实图片生成
- ❌ macOS 适配
- ❌ 3 个非 v0.1 tab 实装（人物/剧情/概览）

**依赖**：v0.2 全部完成

---

## v0.4+ ✅ 已完成

**目标**：tool calling 替代 JSON 数组解析（更可靠 + 多轮"采用 button 类似 ask_question"流程），Settings tab 工具/工具权限 UI。

> ⚠️ **2026-07-30 用户决策**：v0.4+ 范围重切为"tool calling"——原计划的 i18n / vitest / 模板市场 / 协作推迟到 v0.5+。
> 详见 [AI_PANEL_DESIGN.md §7](AI_PANEL_DESIGN.md)。

**核心交付**（v0.4.0）：
- ✅ **Tool calling 协议级支持**（Rust streaming.rs 3 协议 + 事件分发）
  - `pub enum StreamEvent { Text(String), ToolCalls(Vec<ToolCallPartial>) }` 替换 mpsc `String` 通道
  - OpenAI Chat Completions 解析 `delta.tool_calls[]`
  - OpenAI Responses 解析 `output_item.added` + `function_call_arguments.delta`
  - Anthropic Messages 解析 `content_block_start.tool_use` + `input_json_delta`
  - `chat:chunk` / `chat:tool_call` / `chat:done` / `chat:error` 4 事件分发
- ✅ **3 个内置 tool schema**（`lib/ai-tools.ts`）
  - `ask_user_question`（2-5 个备选让玩家选；OpenAI Chat 风格的"question + options[]" 结构）
  - `update_doc_item`（LLM 主动写编辑器；item_id enum = concept 6 步）
  - `ask_free_text`（LLM 反问开放问题）
- ✅ **resolveEnabledTools 过滤关闭的 tool**（用户硬要求："关闭的 tool 不在 prompt 给 LLM"）
  - `enabled: false` → 完全不在 `tools` 字段
  - 不在 system prompt 描述
  - LLM schema 里看不到
- ✅ **Settings tab 工具/工具权限双 sub-tab**（Locus 风格）
  - 工具 sub-tab：3 toggle 启用/禁用
  - 工具权限 sub-tab：auto / ask / deny radio（Locus 风格权限策略）
  - 默认值：ask_user_question/ask_free_text = auto（只问不写），update_doc_item = ask（写编辑器前确认）
- ✅ **多轮 tool calling 核心**（`stepChat.sendToolResult` API）
  - 玩家点 AltCard → 调 LLM 第二轮（带 tool result）→ LLM 调 update_doc_item → 玩家点"确认写入" → 写编辑器
  - 跨 request 回放：assistant 消息必须带 `tool_calls`，tool 消息必须带 `tool_call_id`（OpenAI 协议要求）
  - 协议 schema 自动转：OpenAI 原样用 `tools`，Anthropic 转 `tools: [{name, description, input_schema}]`；tool message 跨协议转换（OpenAI `role: tool` / Anthropic `role: user + content: [{type: tool_result}]`）
- ✅ **AltCard 加 title/description props**（v0.4+ ask_user_question option 用；v0.3+ 老路径不传 = header 不显示）
- ✅ **AiChatPanel 重构**：删 `parseAlternatives` JSON 解析 + `polishExpandFailed` 兜底；新增 `assistant-tool-question` / `assistant-tool-freetext` / `assistant-tool-update` 3 种渲染分支

**`permission: 'ask'` 实现方式**（v0.4+ 简化）：
- 走 inline 确认按钮（"AI 建议写入 X" + 确认按钮），跟 v0.3+ 整体采用条一致风格
- modal popup 留 v0.5+ 扩展

**v0.4+ 不做**（推到 v0.5+）：
- ❌ `permission: 'ask'` modal popup（v0.4+ 用 inline 按钮）
- ❌ tool schema 扩展到 world 5 节 / characters / plot
- ❌ tool 主动 read/write 文件（read_file / write_file / search_project）
- ❌ i18n / vitest / CI / macOS / 协作
- ❌ 关系图 / 真实图片生成

**依赖**：v0.3+ 全部完成

---

## v0.5+ 7 层概念 + 设计循环 ✅ 已完成

**目标**：从 6 步漏斗改造成 7 层严格派生模型 + 螺旋设计循环（改任何层触发全链路反思提示）。Path A 方法论索引注入（不强制玩家使用，LLM 在玩家卡住时自动引用）。

> ⚠️ **2026-07-30 ~ 07-31 用户决策**：v0.5+ 范围重切为"7 层概念设计 + 设计循环"——原计划的"关系图 / 真实图片生成 / i18n / vitest / CI / macOS"继续推迟。
> 详见 [CONCEPT_REDESIGN_PLAN.md](./CONCEPT_REDESIGN_PLAN.md)（25KB 完整 plan）+ [CONCEPT_OPTIONAL_METHODS.md](./CONCEPT_OPTIONAL_METHODS.md)（6 个方法论参考）。

**核心交付**（v0.5.0）：

- ✅ **概念设计 6 步漏斗 → 7 层严格派生模型**
  - L1 立意（seed）             → 故事的根，1 句哲学
  - L2 抽象规则（pillars）      → 设计的硬约束，独立演进（4 态 maturity）
  - L3 世界（world-rules）      → 宏观设定
  - L4 地点（locations, 可选）  → 具体空间
  - L5 人物（character-functions）→ 角色功能（被世界+地点推到位置）
  - L6 故事（three-act）        → 时间轴上的展开
  - L7 核心体验（core-fantasy） → 玩家视角的 1 句话总结
- ✅ **后端 7 层 model + 旧项目兼容**
  - `src-tauri/src/concept/mod.rs`: STEPS 7 个 + `Group` / `Level` / `Maturity` 字段
  - `infer_group_level` 自动推断（兼容旧 frontmatter 无 `group`/`level` 字段）
  - 旧 `core-fantasy.md` 自动归 L7（**关键兼容测试** `legacy_project_6_to_7_compat`）
  - 旧 `pillars.md` / `seed.md` / `world-rules.md` / `character-functions.md` / `three-act.md` 按 id 推断
  - 旧项目无 `locations.md` → scan 返 empty（L4 是 v0.5+ 新加）
  - `concept_summary` 改 7 层分组标签注入（`[L1 立意]` / `[L2 抽象规则（成熟度：演进 v2+）]` / `[L4 地点（可选）]` 等）
  - 15 个单元测试（含 `scan_and_save_roundtrip` / `legacy_project_6_to_7_compat` / `group_level_mapping` / `step_order_is_derivation_chain` / `only_locations_is_optional` / 5 个 parse_frontmatter 等）
- ✅ **L2 pillars 4 态成熟度**（`StepMaturity` 类型）
  - empty / draft / evolving / finalized
  - 仅 L2 步骤接受 maturity（其他步骤传 maturity 被后端忽略）
  - 编辑区 maturity chip 一键切换 → 走 `concept.save(stepId, content, true, maturity)` 落盘
  - maturity 是 frontmatter 字段，独立于 content
- ✅ **设计循环：mtime → markStale 上下游 → 黄点 ? 提示**
  - `stores/concept.ts:markStaleAfterSave(stepId)` 按派生链位置 mark
  - 改 L1 → L2-L7 全 stale（最重）
  - 改 L2-L6 → 自己 + 上游 + L7 stale
  - 改 L7 → L1-L6 全 stale（5min cooldown 避免 toast 刷屏）
  - **绝不自动改**任何内容——黄点是提示，校准由玩家主动触发，LLM 跑预设的"全链路检查"preset **只指出问题，不替玩家改**（玩家主导哲学）
  - 玩家点黄点 → 切到该步 + 跑校准 chip
  - 玩家点 X → 忽略黄点（mtime 记录保留，下次再改再出现）
- ✅ **4 校准 preset + 1 L1 立意专用**（`STEP_PRESETS` 每层 5 chip = 4 基础 + 1 校准）
  - `RECALIBRATE_DOWNSTREAM_PROMPT`（上游刚改，当前 step 可能不一致）→ L1 立意校准 chip
  - `RECALIBRATE_UPSTREAM_PROMPT`（你刚改，回看 L1+L2 是否一致）→ L3-L6 上游校准 chip
  - `PILLAR_REVERSE_CHECK_PROMPT`（用 L3-L6 反推 pillars 是不是写偏了）→ L2 反向检验 chip
  - `RECALIBRATE_FULL_CHAIN_PROMPT`（L7 改了，6 步全链路一致性检查）→ L7 全链路整合 chip
  - 校准 chip `action: 'calibrate'`：渲染走 markdown bubble，**不**显示「采用」/「写入编辑器」按钮
- ✅ **Path A 方法论索引注入**（用户决策"用户自主调用 skill 反而更不靠谱"）
  - `src/stores/chat.ts:buildSystemPrompt` 末尾拼 `METHODS_HINT` const（~200 中文字符 ≈ 150-200 tokens/每次 chat 固定开销）
  - 6 条方法论索引：McKee controlling idea / Fullerton Iterative / Fullerton 戏剧元素 / McKee 故事三角 / Playcentric / System Dynamics
  - 始终注入（不只在概念设计 chat）
  - 4 条 LLM 行为约束写在 hint 里（不主动推销 / 卡住时引用 / 玩家可弃用 / 不替写原则）
  - 完整设计见 [CONCEPT_REDESIGN_PLAN.md §13](./CONCEPT_REDESIGN_PLAN.md) + [CONCEPT_OPTIONAL_METHODS.md](./CONCEPT_OPTIONAL_METHODS.md)
  - B 路径（玩家自主调用 skill 模块）已砍——玩家容易忘、要查工具清单；跟 PlotCraft 玩家主导哲学冲突

**v0.5+ 不做**（推到 v0.6+）：
- ❌ 关系图（人物 ↔ 事件 ↔ 地点）
- ❌ 真实图片生成（设定图 tab 当前只占位图）
- ❌ i18n / vitest / CI
- ❌ macOS / Linux 适配
- ❌ 多 LLM provider 抽 `LlmClient` trait
- ❌ mtime hash 优化（v0.5+ 简化为"每次 save 都 mark stale"）
- ❌ `permission: 'ask'` modal popup（v0.4+ 用 inline 按钮）
- ❌ tool schema 扩展到 world 5 节 / characters / plot

**依赖**：v0.4+ 全部完成（tool calling + Settings tab 工具/工具权限 UI）

---

## v0.4+

**目标**：横向扩展（多语言 / 多平台 / 协作 / 评测 / 生态），纵向加固（测试 / 工具调用 / 自动摘要）。

**候选清单**（不排优先级，按需选）：
- **i18n**：vue-i18n + zh-CN / en 两套
- **单元测试**：vitest 覆盖 chat reducer / llm client / 工具函数
- **多 provider**：抽 `LlmClient` trait，加 Anthropic / Google / Ollama / DeepSeek
- **工具调用**：AI 主动 read_file / write_file / search_project / list_files
- **自动 context 摘要**：超出 8k token 时 AI 摘要历史
- **多 session 切换 / 搜索 / 标签 / 收藏**
- **提示词模板库**：玩家可保存自己的"AI 补"prompt
- **Image 输入**：概念图参考（多模态）
- **OAuth 流程**：Claude Code / Codex
- **Rate limit 显示 / quota 监控**
- **Linux 适配**（WebKitGTK 调试）
- **模板市场**：玩家分享"项目文件夹模板"
- **导出成 Notion / World Anvil**
- **多人协作**：Yjs + WebSocket
- **LLM 评测**：多个模型对比生成结果

**优先级原则**：
- 用户量增长后，先做 i18n
- 玩家反馈 bug 多，先做 vitest
- 玩家要求更多 LLM 选型，先做多 provider
- 协作需求出现，先做 Yjs 同步

---

## 跨版本关注点（每个版本都考虑）

### 性能
- v0.1：流式不掉帧、启动 < 1.5s、tab 切换 < 100ms
- v0.2：真 AI 流式 + context 截断不卡
- v0.3：关系图渲染 100 节点 < 100ms
- v0.4+：多 session / 大项目（100MB+）扫描 / 多人协作同步延迟

### 安全
- v0.1：API key 裸存 config.json（个人项目风险可接受）
- v0.2：考虑升 keyring crate（OS keychain）
- v0.3+：可选加密 config（passphrase）
- v0.4+：OAuth + token rotation

### 兼容性
- v0.1：Windows 10/11
- v0.3：+ macOS
- v0.4+：+ Linux

### 反卡顿（每个版本继承 Locus 教训）
- 数组 identity 保护（streaming / list 渲染）
- shallowRef 包大对象
- patch-style reducer（不每次创建大 state 对象）
- 长列表虚拟化（v0.1 数据量小可不管，v0.2+ 上）
- 计算密集型丢 web worker（v0.1 stub 接口预留，v0.2+ 实装）

### 玩家主导原则（永不破）
- AI 永远不自动覆盖玩家内容
- 玩家随时可 Reload project / 撤销 AI 修改
- AI 给 3-5 备选，玩家挑 + 改

---

## 决策日志

| 日期 | 决策 | 影响 |
|------|------|------|
| 2026-07-28 | v0.1 不上 i18n（vue-i18n），全中文硬编码 | v0.4+ 再做 |
| 2026-07-28 | v0.1 不上 vitest，靠 manual smoke 11 项 | v0.4+ 再做 |
| 2026-07-28 | v0.1 不上 CI（GitHub Actions） | 个人项目成本 > 收益 |
| 2026-07-28 | App icon 走开源 SVG + 自导出 5 尺寸 | 不复制 Locus icons |
| 2026-07-28 | App icon 选型 → Iconoir | MIT，1.6k+ icons，写书主题贴合 |
| 2026-07-28 | v0.1 直接接真 LLM，不做 AI stub | 用户决策，"自用先行"节奏 |
| 2026-07-28 | v0.1 范围重切：Chat + Setting 实装 + 4 tab placeholder | 原 6 tab 全部 placeholder 改为实装 2 个 |
| 2026-07-28 | 反 Locus 卡顿：spawn_blocking + 16ms emit 节流 + mpsc channel | Locus 4 个具体卡顿源（带行号引用）见 CHAT_LLM_DESIGN §2 |
| 2026-07-28 | chat state 砍到 ≤ 8 字段 / 8 mutation | Locus 是 35+ 字段 |
| 2026-07-28 | markdown 渲染走 worker | 学 Locus `markdown.worker.ts`，简化用 marked+dompurify |
| 2026-07-28 | 新增 6 tab：Setting 独立（原 6 tab 不含） | v0.1 改 API key 必须 |
| 2026-07-28 | v0.1 引导流用 chat tab 完成 | v0.2 再开独立 OnboardingView |
| 2026-07-28 | "游戏剧情设计需要哪些东西"完整清单 | CHAT_LLM_DESIGN §5.1，作为数据模型 backbone |
| 2026-07-28 | 性能验收新增 P5-P8 | 真 LLM 流式 / markdown worker / spawn_blocking 隔离 / phase 1 < 500ms |
| 2026-07-29 | v0.1 收尾撞 chat 错误反馈对玩家黑盒 → 启动 v0.2 产品级 error feedback | 1-5 全做：玩家文案 + partial 保留 + retry + 持久化 + 详情链接 |
| 2026-07-29 | v0.1→v0.2 衔接遗留 4 个 bug 全修 | test_provider key / stream_chat emit / reasoning_content 兼容 / log 噪音控制 |
| 2026-07-29 | v0.2 chat state 8→12 字段 / 8→10 mutations | 仍 < Locus 35 字段一半，反卡顿哲学保留 |
| 2026-07-29 | session schema v1→v2 加 `last_user_message` | retry 跨 app 重启不丢；老 v0.1 session 兼容读 |
| 2026-07-29 | 设定图 tab v0.2+ 只实装图库 + prompt 管理 + 占位图 | 不接真生成 / 不做 AI 写 prompt（用户决策）；v0.3 只剩"生成"半边 |
| 2026-07-29 | 概念 tab（8 号 tab）实装：6 步概念设计漏斗（种子→核心体验→支柱→世界规则→人物功能→三幕）+ LLM 备选 + 每步对话 + chat 宪法注入 | 交互形态用户选定"混合：向导骨架 + 每步可展开对话"；concept/ 目录懒创建，旧项目零迁移；新增非流式 `generate` command（test_provider 骨架泛化） |
| 2026-07-30 | 概览 tab 从 tab 栏摘除，最后设计（路由 + 文件保留）| 用户决策："概览包含后面所有"方向存疑，先设计分项；概览 vs 概念撞名问题随摘除消解 |
| 2026-07-30 | 世界 tab 实装（分项 tab 第一站）+ AI 面板组件通用化 | 后端通用 docs 模块（collection 注册表，world = 5 节固定分节）；`components/ai/` props 驱动，concept/world 共用；AI context = 概念宪法 + 分节摘要；世界不做 confirmed 状态机 |
| 2026-07-30 | v0.4+ tool calling 替代 JSON 数组解析 | 用户提"和 ai 多聊几次，又出现 LLM 的原文了"+ "用 tool 让玩家选"+"类似 locus 的 ask_question"；删 v0.3+ `parseAlternatives` + `polishExpandFailed` 路径；新 3 个 tool schema（`ask_user_question` / `update_doc_item` / `ask_free_text`）；Rust streaming 3 协议都加 tool call 解析；多轮 `sendToolResult` API；Settings tab 加 Locus 风格工具/工具权限 UI |
| 2026-07-30 | 关闭的 tool 不在 prompt 给 LLM（用户硬要求）| `resolveEnabledTools` 过滤 `enabled=false` → 完全不在 `tools` 字段 + system prompt 描述；跟 Locus 不同（Locus 关了 tool 还能在 system prompt 描述）|
| 2026-07-30 | 玩家主导默认 `permission = ask` | `ask_user_question` / `ask_free_text` 默认 `auto`（只问不写，直接执行）；`update_doc_item` 默认 `ask`（写编辑器前玩家确认）—— Locus 风格双 sub-tab（工具 / 工具权限）|
| 2026-07-30 | 概念设计 6 步漏斗 → 7 层严格派生模型 | 用户 RPG 设计心法（立意第一 + 先抽象规则再有具体世界 + 人物被世界波浪推到位置）；L1 立意 / L2 抽象规则 / L3 世界 / L4 地点（可选） / L5 人物 / L6 故事 / L7 核心体验；L2 pillars 独立演进（4 态 maturity）反映"很难一次设计完整，要不断反馈"；L7 核心体验 = 方案 2 整合层（最后位置）跟 L1 立意是孪生抽象 |
| 2026-07-31 | 设计循环：mtime → markStale → 黄点 ? 提示 | 改任何 step → 标上下游 stale → 玩家点黄点跑校准 chip → LLM 只指出问题不替改；改 L1 → L2-L7 全 stale；改 L2-L6 → 自己+上游+L7；改 L7 → L1-L6 + 5min cooldown；**绝不自动改**任何内容（玩家主导哲学）|
| 2026-07-31 | 4 校准 preset 加到 STEP_PRESETS 通用区 | RECALIBRATE_DOWNSTREAM（上游刚改） / RECALIBRATE_UPSTREAM（你刚改回看上游） / PILLAR_REVERSE_CHECK（用 L3-L6 反推 pillars） / RECALIBRATE_FULL_CHAIN（L7 改了全链路）；L1 立意专用（问 3 尖锐问题帮玩家确认"大改方向还是精化措辞"）|
| 2026-07-31 | 旧项目兼容：旧 core-fantasy 自动归 L7 | 6 步漏斗第 2 步 core-fantasy = L7 核心体验整合层（最抽象+最后写）；`infer_group_level` 推断兼容旧 frontmatter 无 group/level 字段；旧项目无 locations.md → scan 返 empty（L4 是 v0.5+ 新加） |
| 2026-07-31 | Path A 方法论索引注入，砍 B 路径 | 用户："用户自主调用 skill 反而更不靠谱"——玩家容易忘、要查工具清单；LLM 在 system prompt 里自动可用对应方法论，零玩家成本；~200 字 system prompt 固定开销；4 条 LLM 行为约束写在 hint 里（不主动推销/卡住时引用/玩家可弃用/不替写） |

**更新规则**：每次 release 完成 / 大决策变更时，更新本表 + 状态总览。

---

**ROADMAP 结束**。下次更新预计：v0.1 第一个 PR 完成后（更新"v0.1 进行中"状态）。
