# AGENTS.md — PlotCraft

> 给 AI agent（和未来自己）的项目导览。读完这一份，应该能上手、知道边界、不踩老坑。
>
> 跟 Locus 关系：**同栈不同品**，参考设计思想，不复用代码。Locus 仓库在 `C:\Users\dd\Documents\QxLocusProject\Locus`，只读 reference，不 import。

---

## 1. 项目一句话

PlotCraft = 给独立 / 业余 RPG / VN 创作者的 **AI 编剧搭档** 桌面工具（Tauri 2 + Vue 3 + Rust + bun）。

**玩家主导，AI 辅助**：AI 给 3-5 个备选，玩家挑+改，AI 永不自动覆盖玩家内容。

---

## 2. v0.4+ 状态（2026-07-30 启动，tool calling 轮）

| 维度 | 状态 |
|------|------|
| Chat tab（SessionView，驱动 LLM 流式）| ✅ **实装**（v0.1）|
| Setting tab（SettingsView，API key / endpoint / model）| ✅ **实装**（v0.1）|
| 8 tab 框架（vue-router：世界/人物/剧情/设定图/会话/设置/概念/概览）| ✅ **实装**（v0.1 + 概念 v0.2+；概览路由保留但 tab 栏摘除）|
| 新建项目流（4 个 starter md + plot.cat 标记）| ✅ **实装**（v0.2+）|
| LLM 客户端（OpenAI 兼容流式）| ✅ **实装**（v0.1）|
| 反卡顿基础设施（spawn_blocking + mpsc + 16ms emit 节流）| ✅ **实装**（v0.1）|
| Markdown 渲染（marked + DOMPurify，主线程同步）| ✅ **实装**（v0.1）|
| 启动分阶段（phase 1 < 500ms）| ✅ **实装**（v0.1）|
| 性能验收 P1-P8 | ✅ **实装**（手动测量，详见 CHECKLIST §1）|
| **产品级 chat error feedback（8 分类 + 玩家文案 + retry + partial 保留）**| ✅ **实装**（v0.2）|
| **session schema v2（last_user_message 持久化，retry 跨重启用）**| ✅ **实装**（v0.2）|
| **OpenAI 兼容 SSE 兼容智谱 GLM reasoning_content**| ✅ **实装**（v0.2）|
| **3 个 streaming 实现共用 emit_chat_error helper**| ✅ **实装**（v0.2）|
| **测试 fixtures 加 partial: None + 3 个 session.rs unit test（v2 roundtrip / v1→v2 兼容 / empty serialize）**| ✅ **实装**（v0.2）|
| AI stub / 假流式 | ❌ 取消（v0.1 直接接真 LLM，用户决策）|
| 设定图 tab（ConceptArtView，art/ 图库 + prompt 管理 + 占位图）| ✅ **实装**（v0.2+，不接真生成 / 不做 AI 写 prompt，用户决策）|
| 启动恢复 last project（open_project command + recentProjects 持久化）| ✅ **实装**（v0.2+）|
| chat 等待响应效果（streaming 首 chunk 前 "正在思考" 动画）| ✅ **实装**（v0.2+）|
| **概念 tab（ConceptView，8 号 tab：6 步概念设计漏斗 + LLM 备选 + 每步对话 + chat 宪法注入）**| ✅ **实装**（v0.2+，v0.3+ 改用单 AiChatPanel，v0.5+ 改 7 层严格派生模型）|
| **世界 tab（WorldView，通用 docs 模块第一个 collection：5 节 + LLM 备选/对话带概念宪法 context）**| ✅ **实装**（v0.2+，v0.3+ 改用单 AiChatPanel）|
| **AI 面板重构：单 AiChatPanel + presets chips + 备选内联化（v0.3+ 替换 v0.2 AlternativesPicker + StepChatPanel 两件套）**| ✅ **实装**（v0.3+）|
| **非流式 `generate` command（test_provider 骨架泛化；v0.3+ 改为无调用方，保留为 v0.4+ AI 验收类功能）**| ✅ **实装**（v0.2+，v0.3+ 注释标无调用方）|
| **Tool calling 协议级支持（OpenAI Chat Completions + OpenAI Responses + Anthropic 3 协议；channel 改 StreamEvent enum + emit 分发 chat:chunk / chat:tool_call）**| ✅ **实装**（v0.4+）|
| **3 个内置 tool schema（ask_user_question / update_doc_item / ask_free_text）+ 玩家主导默认权限（ask_user_question/ask_free_text = auto, update_doc_item = ask）**| ✅ **实装**（v0.4+）|
| **Settings tab 工具/工具权限双 sub-tab（enable 开关 + auto/ask/deny radio；Locus 风格）**| ✅ **实装**（v0.4+）|
| **多轮 tool calling（玩家点 AltCard → 调 LLM 第二轮 → LLM 调 update_doc_item → 玩家点"确认写入" → 写编辑器；stepChat.sendToolResult API）**| ✅ **实装**（v0.4+）|
| **resolveEnabledTools 过滤关闭的 tool（用户硬要求：关闭的 tool 不在 prompt 给 LLM）**| ✅ **实装**（v0.4+）|
| **概念设计 6 步漏斗 → 7 层严格派生模型**（L1 立意 / L2 抽象规则 / L3 世界 / L4 地点可选 / L5 人物 / L6 故事 / L7 核心体验）| ✅ **实装**（v0.5+）|
| **L2 pillars 4 态成熟度**（empty / draft / evolving / finalized，编辑器 maturity chip 切）| ✅ **实装**（v0.5+）|
| **设计循环：改任何 step → markStale 上下游 → 黄点 ? 提示 + 校准 chip 触发 LLM**（旧 6 步漏斗自动迁移，core-fantasy 归 L7）| ✅ **实装**（v0.5+）|
| **4 校准 preset（RECALIBRATE_DOWNSTREAM / RECALIBRATE_UPSTREAM / RECALIBRATE_FULL_CHAIN / PILLAR_REVERSE_CHECK） + L1 立意专用**| ✅ **实装**（v0.5+）|
| **Path A 方法论索引注入**（McKee controlling idea / Fullerton Iterative / Fullerton 戏剧元素 / McKee 故事三角 / Playcentric / System Dynamics ~200 字 system prompt）| ✅ **实装**（v0.5+）|
| 概览 tab | ⏸️ 从 tab 栏摘除（2026-07-30 用户决策：最后设计；路由 + 文件保留）|
| 3 个非 v0.1 tab（人物/剧情 + 概览）| 🟡 Placeholder（"v0.3+ 实装"；v0.3+ AI 面板重构已为它们预留接口）|
| 关系图 / 图片生成 / 多 provider | ❌ 推到 v0.4+ |
| i18n / vitest / CI | ❌ 推到 v0.4+ |

完整路线 → `docs/ROADMAP.md`。设计意图 → `docs/DESIGN.md`。v0.1 启动清单 → `docs/CHECKLIST.md`。v0.2 错误反馈设计 → `docs/CHAT_LLM_DESIGN.md §8`。v0.3+ AI 面板重构设计 → `docs/AI_PANEL_DESIGN.md`。**v0.4+ tool calling 设计** → `docs/AI_PANEL_DESIGN.md §6` + `docs/CHAT_LLM_DESIGN.md §9`。**v0.5+ 7 层概念设计 + 设计循环** → `docs/CONCEPT_REDESIGN_PLAN.md` + `docs/CONCEPT_OPTIONAL_METHODS.md`（方法论索引参考）。

---

## 3. Stack & 严格版本

| 层 | 选型 | 版本约束 |
|----|------|----------|
| Frontend | Vue 3 + TypeScript + Vite | vue ^3.5.13 / vite ^5.4 / vue-tsc ^2.1 |
| State | Pinia | ^3.0 |
| Markdown | marked + DOMPurify | marked ^13 / dompurify ^3.1 |
| Icons | lucide-vue-next | ^0.460 |
| Backend | Tauri 2 + Rust | **tauri =2.11.1（严格 pin）** |
| Plugin | @tauri-apps/plugin-dialog | **=2.6.0（严格 pin）** |
| Async | tokio | ^1（full features）|
| HTTP | reqwest + rustls-tls | ^0.12（**不用** native-tls，Windows OpenSSL 编译坑）|
| Allocator | mimalloc | ^0.1（Windows 多线程小对象显著优于系统堆）|
| Package mgr | bun | 1.2.x |

**Tauri 版本号必须 npm ↔ Rust 同号**（`@tauri-apps/api =2.11.1` ↔ `tauri =2.11.1`）。版本错配 → 启动时 panic。改版本时**两处同时**改。

**reqwest 不开 default-features**，关掉 native-tls，Windows 上 OpenSSL 链接是已知的踩坑点。

---

## 4. 跑起来

```bash
# 在 D:\Projects\PlotCraft\
bun install
bun run typecheck          # vue-tsc --noEmit，0 error 才算过
cd src-tauri && cargo check  # 0 error 才算过
cd .. && bun run tauri dev # 弹窗，首次需先在 Setting tab 填 API key
```

`bun run tauri dev` 首次跑会从 `C:\Users\dd\AppData\Roaming\PlotCraft\config.json` 读配置（不存在用 default，default 的 `llm.api_key` 是空串）。要真接 LLM，先去 Setting tab 填 endpoint / apiKey / model。

---

## 5. 仓库布局

```
PlotCraft/
├── AGENTS.md              ← 本文件
├── README.md              ← 项目介绍 + 跟 Locus 关系
├── package.json           ← npm 依赖 + scripts
├── vite.config.ts         ← Vite + @vitejs/plugin-vue + @/ alias
├── tsconfig*.json         ← TS 配置
├── index.html             ← Vite 入口
├── docs/
│   ├── DESIGN.md          ← 总设计
│   ├── CHAT_LLM_DESIGN.md ← v0.1 专项：反 Locus 4 处卡顿
│   ├── CHECKLIST.md       ← v0.1 启动清单 + 性能验收 P1-P8
│   └── ROADMAP.md         ← v0.1 → v0.4+ 时间线
├── src/                   ← Vue 3 前端
│   ├── main.ts            ← 启动分阶段（phase 1 mount → phase 2 async init）
│   ├── App.vue            ← 7-tab 框架（概览已摘除，路由/文件保留）
│   ├── style.css
│   ├── lib/               ← 纯函数 wrapper（LLM / settings / project / markdown / concept / docs）
│   ├── stores/            ← pinia stores（chat / project / settings / art / concept / world）
│   ├── components/        ← ai/（v0.3+ 通用 AI 面板：单 AiChatPanel + AltCard 子组件；v0.2 AlternativesPicker/StepChatPanel 已删）+ chat/ + project/ + settings/
│   ├── composables/       ← useStreamReducer 等
│   ├── views/             ← 8 个 view（Session/Settings/ConceptArt/Concept/World 实装，3 个 placeholder）
│   ├── router/            ← vue-router 配置
│   └── types/             ← TS 类型（chat.ts / concept.ts / world.ts / ai.ts 等）
└── src-tauri/             ← Rust 后端
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/      ← Tauri 2 permission 配置
    └── src/                # 模块风格 B：<dir>.rs 入口 + <dir>/ 子模块（Rust 2018+ edition，Cargo edition = "2021"）
        ├── main.rs / lib.rs
        ├── error.rs       ← thiserror + AppError enum
        ├── commands/      ← Tauri command 入口（llm / project / settings / art / concept / docs / session / chats / locus_import）
        ├── llm/           ← LLM client（config / streaming / streaming_anthropic / streaming_openai_responses / types）
        ├── project/       ← 项目文件夹 IO + 5 个 starter 文件（子模块 templates）
        ├── art.rs         ← 设定图图库 IO（art/ 目录扫描 + prompt 读写）
        ├── chats.rs       ← 会话存档 IO
        ├── concept.rs     ← 概念漏斗 7 步定义 + concept/ 目录 IO + 宪法摘要
        ├── docs.rs        ← 通用"固定分节文档集合"（collection 注册表，第一个 = world 5 节）
        ├── console.rs
        └── model_catalog.rs
```

**前后端 boundary**：
- 前端 `lib/*` → `invoke<T>('command_name', { args })` 调 Rust
- 后端通过 `app.emit("event:name", payload)` 推流式事件，前端 `listen<T>('event:name', ...)` 收
- 字段名走 **snake_case** 跨 boundary（Locus 的做法，Tauri serde 默认也是 snake_case）

---

## 6. 核心设计决策（v0.1 反 Locus 卡顿）

Locus 实测 4 个卡顿源 → 4 个反制。**学架构思想，不照搬代码**。

| # | Locus 问题 | PlotCraft 反制 | 在哪 |
|---|------------|----------------|------|
| 1 | SSE chunk 解析在 tokio runtime 默认线程池跑，CPU 密集 | `tokio::task::spawn_blocking` 隔离 SSE + JSON 解析 | `src-tauri/src/llm/streaming.rs` |
| 2 | 1K token/秒 = 1000 次 emit，跨 IPC 无节流 | `tokio::sync::mpsc::channel` 解耦 parse/emit + 16ms rAF 节流 + 256 char batch | `src-tauri/src/llm/streaming.rs` |
| 3 | `useStreamReducer` 35+ 字段，深 reactive，主线程 35k 状态 | 砍到 **8 字段 / 8 mutations** + `shallowRef` 包 state | `src/composables/useStreamReducer.ts` |
| 4 | markdown 解析在 worker（适合 Locus lute 重解析）| **主线程同步**（marked + DOMPurify 1KB 解析 < 1ms，worker overhead 更大）| `src/lib/markdown.ts` |

**8 字段 chat state**：`sessionId / status / messages / currentText / currentRunId / error / startedAt / lastEventAt`。
**8 mutations**：`start / appendChunk / complete / fail / cancel / addUserMessage / loadSession / clearSession`。
**关键 trick**：`appendChunk` 只 append `currentText`，**绝不动 `messages` 数组引用**（Locus `useStreamReducer.ts:410-414` 学来）。

---

## 7. 硬规则（改之前先想）

1. **结构对齐 Locus，代码 PlotCraft 自写**。Locus 是 `C:\Users\dd\Documents\QxLocusProject\Locus` 的 reference —— 读 Locus 的 schema / 架构 / 设计模式对齐，**不**直接 import / 复制粘贴 Locus 的代码文件到 PlotCraft 仓库。
   - 例外（用户 2026-07-28 决策）：LLM 存储 schema 走 Locus 同构（`providers + modelDefaults + modelCatalog`），但代码仍 PlotCraft 自写，不引 Locus crate / 文件
   - 底线：Locus 那一坨 1290 行 config.rs + 22 个 Settings 子组件，**不**整块搬过来——按 PlotCraft v0.1 scope（单 provider / 手填 model / 无 OAuth / 无 subagent）写 Locus-shaped 的轻量实现
2. **Tauri 版本严格 pin**。改 `Cargo.toml` 的 tauri 版本必须**同步**改 `package.json` 的 `@tauri-apps/api` 版本（带 `=` 号）。
3. **reqwest 保持 `default-features = false` + `rustls-tls`**。开了 native-tls 在 Windows 上 link OpenSSL 会爆。
4. **AppError enum 是**前后端错误传递的唯一类型。`Result<T, AppError>`，前端 `lib/error.ts` 统一收口。**不**返回 String 错误。
5. **配置写入直接覆盖**（文件 ≤ 1KB，无所谓 atomic write）。
6. **v0.2+ 不上**：vue-i18n、vitest、CI、macOS/Linux、multi-provider、multiplayer。决策记录在 `CHECKLIST §12` 和 `ROADMAP §决策日志`。
7. **chrono 已用**（v0.2+ session.rs `updated_at: chrono::Utc::to_rfc3339()`，console.rs `timestamp_millis`）—— v0.1 那条"不加 chrono 依赖"硬规则已废。
8. **chat store listener 绑在 store 上，不绑 view 生命周期**（v0.2+ 修过）。离开 SessionView 不解绑 listener，切走期间 stream 继续 emit、currentText 继续累积。`init()` 真幂等——首次进 chat tab 触发一次后不再 reload session。`teardown()` 是 no-op，函数签名留给 v0.3+ app-level cleanup（关 app 时清 unlisten + saveTimer）。
9. **v0.2+ chat error feedback**：所有 stream 抛错路径先 `emit_chat_error(&app, &run_id, &msg)` 再 `return Err`——AGENTS.md 硬规则 #4 的硬实施。前端玩家文案走 `lib/error-messages.ts`（不直接显示 OpenSSL/TLS 错误字符串）。
10. **store 往外传"ref 包对象"必须 `markRaw`**（v0.2+ StepChatState 踩过，v0.3+ 仍生效）：Pinia setup store 的返回对象会被深度 reactive 化，普通对象里嵌套的 ref/computed 会被自动解包——组件期望 `Ref`/`ComputedRef` 却拿到裸值，`.value` 直接崩。store 组合 `StepChatState`（或其他含 ref 的对象）传给组件时，`markRaw({...})` 包一层。
11. **v0.3+ AI 面板 per-item Map 化**（concept/world store 踩过）：step chat 的 `messages` / `text` / `streaming` / `errorKind` / `errorRaw` / `runId` 全部用 `shallowRef(new Map())` 维护；`shallowRef` 的 Map set/get **不自动追踪**响应性，必须显式 `triggerRef(ref)`。派生 computed 按 `currentXxxId` ref 取值，组件拿到的是当前 item 的派生。切步保留历史，切项目调 `clearAllStepChats()` 全清（不同项目 item 同 id 语义不同，叠加会乱）。
12. **v0.3+ PresetAction 的 prompt 拼在 user message，不拼在 system**（concept/world store 踩过）：system message 永远讲 markdown 对话规则 + 玩家主导；具体"输出 JSON 数组"等形态约束放在 preset.prompt（user message），由 `preset.output: 'json' | 'markdown'` 决定流完渲染分支。`ChatMessage.preset?: string` 字段（label only）**前端 UI 用，发后端前必须 strip**（后端 Rust ChatMessage 不加这个字段）。
13. **v0.4+ 关闭的 tool 不传给 LLM**（用户 2026-07-30 硬要求）：`lib/ai-tools.ts:resolveEnabledTools(config)` 过滤 `enabled=false` 的 tool → Rust 端 `start_chat` 接 `tools: Option<Vec<ToolDefinition>>`，build body 时 `if let Some(tools) = tools` 才写 `tools` 字段，**不写 = LLM 不知道存在**（既不在 schema 也不在 system prompt 描述）。Settings tab 工具 sub-tab 关掉的 tool → 不进 `tools` 数组。
14. **v0.4+ tool calling 跨 request 回放必须带 tool_calls / tool_call_id**（OpenAI 协议要求）：LLM 调 tool 后，前端把玩家选择作为 `role: 'tool', tool_call_id: callId, content: "玩家选 X"` 加到 messages 再调 LLM 第二轮。`stepChat.sendToolResult(toolCallId, content)` API（concept/world store 都实现）。`store.send` 拼 messages 时**必须透传** `tool_calls` / `tool_call_id` 字段——漏传 LLM 看到 tool_use 上下文丢失。
15. **v0.4+ 玩家主导默认 permission = ask**（写编辑器类 tool）：`ask_user_question` / `ask_free_text` 默认 `auto`（只问不写，直接执行）；`update_doc_item` 默认 `ask`（写编辑器前玩家确认——AiChatPanel 走"AI 建议写入 X" + 确认按钮）。**v0.4+ permission 'ask' 用 inline 确认按钮实现**（不用 modal popup，跟 v0.3+ 整体采用条一致风格）。
16. **v0.4+ AltCard 加 `title` / `description` props**（替代 v0.3+ 仅 `text`）：`ask_user_question` tool 的每个 option 有 label（10 字内 header）+ description（hover tooltip） + preview（采用后内容）。v0.3+ 老路径（polish/expand markdown bubble）不传这俩 props，AltCard header 不显示（保持 v0.3+ 视觉一致）。
17. **v0.4+ LLM 流式通道改 StreamEvent enum**（不只是 text）：`pub enum StreamEvent { Text(String), ToolCalls(Vec<ToolCallPartial>) }`，mpsc 通道改 `StreamEvent` 而非 `String`。`emit_throttled` 分发：text 走 16ms rAF 节流 → `chat:chunk`；tool calls 不节流 → `chat:tool_call`。三个 streaming 实现（OpenAI Chat / OpenAI Responses / Anthropic）都解析对应协议格式（`delta.tool_calls[]` / `output_item.added` + `function_call_arguments.delta` / `content_block_start.tool_use` + `input_json_delta`）。
18. **v0.4+ 三协议 schema 自动转**：`lib/ai-tools.ts` 统一存 OpenAI 格式 `ToolDefinition`（`{type: function, function: {name, description, parameters}}`）。Rust 端 build body 时按 `api_format` 转：
    - **OpenAI Chat Completions**：原样用 `tools: [{type, function: {name, description, parameters}}]`
    - **OpenAI Responses**：tools 字段在顶层平铺 `[{type, name, description, parameters}]`（**不**是 Chat Completions 的嵌套 `function` ！）—— v0.4.1+ 之前用 `to_value(tools)` 直发，2026-07-31 deepseek openai_responses 报 `tools[0]: missing field 'name'`，玩家 copy 诊断信息后定位的。**`streaming_openai_responses.rs:build_openai_responses_body` 现在手动 flatten 一下**。
    - **Anthropic Messages**：转 `tools: [{name, description, input_schema: parameters}]`（`input_schema` 不是 OpenAI 的嵌套 `function`）
    - 工具消息跨协议转换：OpenAI 用 `role: 'tool', tool_call_id`，Anthropic 用 `role: 'user', content: [{type: 'tool_result', tool_use_id, content}]`
    - Assistant 消息带 tool_calls：OpenAI 原样用 `tool_calls` 字段；Anthropic 转 `content: [{type: 'text', text}, {type: 'tool_use', id, name, input}]`
19. **v0.5+ 概念设计 7 层派生模型**（L1 立意 / L2 抽象规则 / L3 世界 / L4 地点可选 / L5 人物 / L6 故事 / L7 核心体验）：后端 STEPS 7 个固定 + group/level/maturity 字段；旧项目兼容靠 `infer_group_level` 推断（旧 core-fantasy 自动归 L7）；`concept_summary` 改 7 层分组标签注入。**改 frontmatter 必须保留 `group` / `level` 字段**——`build_frontmatter` 写盘是 5 字段固定（title/step/group/level/status/updated/maturity），解析少字段 → 自动走 infer。详见 `docs/CONCEPT_REDESIGN_PLAN.md §2`。
20. **v0.5+ 设计循环：mtime → markStale 上下游 → 黄点 ? 提示**（核心要求，**绝不自动改**任何内容）：`stores/concept.ts:markStaleAfterSave` 按 step 派生位置 mark 上下游（改 L1 → L2-L7；改 L2-L6 → 自己+上游+L7；改 L7 → L1-L6）。**v0.5.1 mtime hash 对比上线**（修"改一下全黄"问题）：`save()` 内 oldContent / newContent 字符串对比 + oldMaturity / newMaturity 对比，**真有变化才 markStale**——避免 debounce 重复触发、纯 markConfirmed 重复保存、纯 markConfirmed 切步等场景。maturity 单独变化也算改（L2 草稿→定型要重新校准下游）。**黄点本身就是"有改动"的信号**，大小改区分交回玩家：错别字 X 忽略，方向大改 ? 跑校准。**L7 5min cooldown**：避免 toast 刷屏（`window.__lastL7Stale` 简单防抖）。**黄点消失条件**：(a) 玩家点 X 忽略（mtime 记录保留，下次再改再出现）；(b) 玩家点黄点 ? 跑校准 chip 主动消点。详见 `docs/CONCEPT_REDESIGN_PLAN.md §3.1-§3.4`。
21. **v0.5+ L2 pillars 4 态成熟度**（empty / draft / evolving / finalized）：仅 L2 步骤接受 maturity 字段，其他步骤传 maturity 被后端忽略（`save_concept_step` Rust 端 `if def.id == "pillars"` 守护）。前端编辑区 UI 走 maturity chip 切换 → 直接走 `concept.save(stepId, content, true, maturity)` 落盘，独立 frontmatter 字段。**maturity 是 frontmatter 字段，不是 content**——切 maturity 不会触发 `onMaturityChange` 误改编辑器。
22. **v0.5+ 校准 chip 是反思对话，不是写入**：校准 chip（'calibrate' action）走 markdown bubble 渲染，**不**显示「采用」/「写入编辑器」按钮——LLM 输出就是反思，**玩家自己读完照做**。跟 polish/expand（'replace' mode）区分。PresetAction.action 联合类型加了 `'calibrate'`，types/chat.ts ChatMessage.action 也加。

---

## 8. v0.5+ 推到后面

- 人物 / 剧情 tab 实装（v0.3+ 已为它们预留 AiChatPanel + PresetAction 接口；待它们自己有 store 即可接入）
- 概览 tab 重新设计 / 上 tab 栏（路由 + 文件保留，最后设计）
- 增量 JSON parser（v0.3+ 流中只显示占位，done 后才判定卡片 vs 气泡；v0.4+ 考虑按 preset.output 分流）
- step chat 落盘持久化（v0.3+ 内存 per-item，关 app 才丢；玩家反馈"想保留"再加）
- 预设动作玩家自定义（v0.3+ 写死，v0.4+ prompt 模板库雏形）
- Monaco editor（文字 view 升级）
- 关系图（人物 ↔ 事件 ↔ 地点）
- AI 引导 3-5 问（v0.1 直接 chat，v0.2 拆 OnboardingView）
- vitest 覆盖 reducer + llm client + 工具函数
- CI（GitHub Actions typecheck + cargo check）
- vue-i18n（出海时）
- macOS / Linux 适配
- 多 LLM provider（Claude / Gemini 等）

---

## 9. Smoke test 流程（v0.1 不写单测）

release 前必跑 11 项 → `docs/CHECKLIST.md §10`。**核心 3 项**：
1. `bun run typecheck` 0 error
2. `cd src-tauri && cargo check` 0 error
3. `bun run tauri dev` → Setting 填 API key → Session 新建项目 → 发消息看到流式 markdown

---

## 10. 找东西速查

| 我想找... | 位置 |
|-----------|------|
| 7 tab 路由定义（概览已摘除，路由保留）| `src/router/index.ts` |
| Tab UI 渲染 | `src/App.vue` |
| Chat 流式管道 | `src-tauri/src/llm/streaming.rs` + `src/lib/llm.ts` |
| Chat state 状态机 | `src/composables/useStreamReducer.ts` |
| Chat store（init/teardown）| `src/stores/chat.ts` |
| LLM 系统 prompt | `src/stores/chat.ts` 顶部 `SYSTEM_PROMPT` |
| 新建项目流 | `src-tauri/src/commands/project.rs` + `src-tauri/src/project/templates.rs` |
| 5 个 starter 文件（4 md + plot.cat） | `src-tauri/src/project/templates.rs` |
| PlotCraft 项目识别规则 | `src-tauri/src/commands/project.rs:check_or_migrate_plot_cat`（plot.cat 存在；老项目 world/ 自动补 plot.cat 迁移）|
| 启动恢复 last project | `src/stores/project.ts:init` + `src-tauri/src/commands/project.rs:open_project` |
| 设定图图库 | `src-tauri/src/art.rs` + `src-tauri/src/commands/art.rs` + `src/stores/art.ts` + `src/views/ConceptArtView.vue` |
| 概念设计漏斗（7 层 + LLM 辅助）| `src-tauri/src/concept.rs` + `src-tauri/src/commands/concept.rs` + `src/stores/concept.ts` + `src/views/ConceptView.vue` |
| 非流式 generate command | `src-tauri/src/commands/llm.rs:generate`（test_provider 骨架泛化）+ `src/lib/llm.ts:generate` |
| chat 宪法注入（concept 摘要进 system prompt）| `src/stores/chat.ts:buildSystemPrompt` + `src-tauri/src/concept.rs:concept_summary` |
| 世界 tab（分项集合模式）| `src-tauri/src/docs.rs` + `src-tauri/src/commands/docs.rs` + `src/stores/world.ts` + `src/views/WorldView.vue` |
| 通用 AI 面板（v0.3+ 单 AiChatPanel：消息列表 + presets chips + composer；备选走流式 + JSON parse 内联）| `src/components/ai/AiChatPanel.vue` + `src/components/ai/AltCard.vue` + `src/types/ai.ts`（PresetAction / StepChatState）+ `src/lib/alternatives.ts` + `src/lib/llm-connection.ts` |
| **v0.4+ tool calling schema 定义 + BUILTIN_TOOLS + resolveEnabledTools**| `src/lib/ai-tools.ts`（前端 schema） + `src-tauri/src/llm/types.rs:ToolDefinition/ToolCallInfo`（后端类型）|
| **v0.4+ tool call 流式解析（3 协议）**| `src-tauri/src/llm/streaming.rs:parse_openai_sse_buffer` + `streaming_anthropic.rs:parse_anthropic_sse_buffer` + `streaming_openai_responses.rs:parse_responses_sse_buffer` |
| **v0.4+ tool call 事件订阅**| `src/lib/llm.ts:onChatToolCall` + `src/types/chat.ts:ChatToolCallPayload` |
| **v0.4+ per-item tool call 累积（concept + world store）**| `src/stores/concept.ts:chatToolCalls / accumulateToolCallPartial` + `src/stores/world.ts`（同款）|
| **v0.4+ 多轮 tool calling（sendToolResult API）**| `src/stores/concept.ts:sendStepChat + sendToolResult + runChatRound` + `src/stores/world.ts`（同款） |
| **v0.4+ Settings tab 工具 / 工具权限 sub-tab**| `src/components/settings/ToolsSettings.vue` |
| config.json schema | `src/lib/settings.ts`（前端） + `src-tauri/src/llm/config.rs`（后端）|
| AppError 枚举 | `src-tauri/src/error.rs` |
| 性能验收指标 P1-P8 | `docs/CHECKLIST.md §1` + `docs/CHAT_LLM_DESIGN.md §4` |
| 启动分阶段实现 | `src/main.ts` |
| 项目数据模型（9 大类）| `docs/CHAT_LLM_DESIGN.md §5.1` |
| **v0.4+ tool calling 协议 schema 转（OpenAI ↔ Anthropic）**| `src-tauri/src/llm/streaming.rs:build_openai_request_body (tools)` + `src-tauri/src/llm/streaming_anthropic.rs:build_anthropic_request_body (tools + tool_result + tool_use)` |
| **v0.5+ 7 层概念模型**（后端 STEPS + 旧项目兼容 + 单元测试 15 个）| `src-tauri/src/concept.rs` (STEPS, infer_group_level, parse_frontmatter) + `src-tauri/src/commands/concept.rs` (save_concept_step 接 maturity) |
| **v0.5+ 7 层前端子系统**（types + lib + store + view）| `src/types/concept.ts` (STEP_IDS/ConceptGroup/StepMaturity) + `src/lib/concept.ts` (saveConceptStep) + `src/lib/chats.ts` (12 itemKey) + `src/lib/ai-tools.ts` (item_id 7 步) |
| **v0.5+ 设计循环**（staleFlags + 4 校准 preset + 黄点）| `src/stores/concept.ts` (STEP_HINTS/PRESETS/markStaleAfterSave/clearStale + 4 校准 PROMPT) + `src/views/ConceptView.vue` (7 层 stepper + 黄点 UI + maturity chip) |
| **v0.5+ Path A 方法论索引**（system prompt 注入 ~200 字）| `src/stores/chat.ts:buildSystemPrompt` (METHODS_HINT const) |
| **v0.5+ 设计哲学 / 7 层设计 / 设计循环**（完整 plan）| `docs/CONCEPT_REDESIGN_PLAN.md`（§1-§14）+ `docs/CONCEPT_OPTIONAL_METHODS.md`（6 个方法论参考）|

---

## 11. PowerShell 5.1 已知坑（提交时记住）

- `git commit -m "..."` 内部带 `"` 会截断 token 当 pathspec。**改用 `git commit -F <file>`** 或 subject 改单引号 + 内部 `"` 改 `'`。
- `git stash drop stash@{0}` 单引号包裹（`@{0}` 会被当 hashtable 语法）。
- `rm -rf` / `Remove-Item` 在本环境下被安全策略拦 → 用 `mavis-trash <path>`。
- bash 命令在 PowerShell 里行为差，**先**用 PowerShell cmdlet，**必须**用 bash 时切换到 `node` / `python`。

---

**AGENTS.md 结束**。改这一份前先看 `docs/CHECKLIST.md §13 决策记录`。
