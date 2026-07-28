# PlotCraft Roadmap

> **版本时间线 + 目标追踪**。每个 release 完成后更新状态总览。
> 详细设计见 [DESIGN.md](./DESIGN.md)，v0.1 启动前收尾项见 [CHECKLIST.md](./CHECKLIST.md)。

---

## 状态总览

| 版本 | 状态 | 目标交付 | 详细 |
|------|------|----------|------|
| **v0.1** | 🟡 设计收尾中 | 6 tab 框架 + Chat + Setting 实装 + 真 LLM + 反 Locus 卡顿 | [§v0.1](#v01当前) |
| v0.2 | ⬜ 未启动 | 真实 AI 集成 + 引导流 + 共创模式 | [§v0.2](#v02) |
| v0.3 | ⬜ 未启动 | 关系图 + 真实图片生成 + macOS 适配 | [§v0.3](#v03) |
| v0.4+ | ⬜ 未启动 | i18n / vitest / 模板市场 / 协作 / 评测 / 导出 | [§v0.4](#v04) |

**状态图例**：⬜ 未启动 / 🟡 进行中 / ✅ 已完成 / ⏸️ 暂停 / ❌ 取消

---

## v0.1（当前）

**目标**：6 tab 框架跑起来，**Chat + Setting 实装**，真 LLM 接入，**反 Locus 卡顿从第一行起就位**。

> ⚠️ **范围 2026-07-28 重切**（用户决策）。原计划 AI stub 验证管道改为**直接接真 LLM**。
> 详见 [CHAT_LLM_DESIGN.md](./CHAT_LLM_DESIGN.md)（v0.1 启动的最终设计依据）。

**核心交付**：

- ✅ Tauri 2 + Vue 3 + Rust + bun 骨架（package.json / Cargo.toml / vite / tauri.conf / capabilities / icons）
- ✅ 6 tab 路由（vue-router）—— 7 个 view 含 Setting
- ✅ **Chat tab（SessionView）实装**：
  - 简化版 `useStreamReducer`（≤ 8 字段 / 8 mutation，identity-stable array 模式学 Locus 410-414）
  - 简化版 LLM client（OpenAI 兼容，spawn_blocking 隔离 SSE 解析）
  - 16ms emit 节流 + mpsc channel 解耦 parse / emit
  - markdown 渲染走 worker（学 Locus `markdown.worker.ts`，用 marked + dompurify 简化）
  - abort signal + 错误重试（参考 Locus `retry.rs`）
- ✅ **Setting tab（SettingsView）实装**：API key / endpoint / model / 主题 / 最近项目
- ✅ **新建项目流**：5 问引导（chat tab 内完成）→ 落 4 个 starter md
- ✅ **create_project / list_projects** Tauri 命令
- ✅ **反卡顿基础设施**：
  - `mimalloc` 全局 allocator（Locus 同款）
  - 所有 Tauri commands `async fn`
  - `tokio::task::spawn_blocking` 隔离 CPU 密集解析
  - `tokio::sync::mpsc::channel` 解耦 parse / emit
  - 16ms rAF 节流 emit（60 fps）
  - `shallowRef` 包大对象（messages / currentText）
  - 启动分阶段（phase 1 < 500ms 目标）
- ✅ 性能验收 P1-P8（流式不卡 / 启动 < 1.5s / tab 切换 < 100ms / 100MB 扫描不卡 / **P5 真 LLM 流式 / P6 markdown worker 延迟 / P7 spawn_blocking 隔离 / P8 phase 1 严格 < 500ms**）
- ✅ 根 `AGENTS.md`（基于 CHECKLIST.md）

**4 个 Placeholder tab**（v0.1 仅占位）：
- 概览 (Overview) / 世界 (World) / 人物 (Characters) / 剧情 (Plot) / 设定图 (Concept Art) — "v0.2 实装"

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

---

## v0.2

**目标**：从 AI stub 升级到真 AI，玩家第一次新建项目就能跟 AI 完成"3-5 问引导 → 生成最小原型"全流程。

**核心交付**：
- 真实 LLM 集成
  - `OpenAiCompatibleClient`（用 `reqwest` 流式 HTTP + `tokio-util` Decoder）
  - API key 从 `%APPDATA%/PlotCraft/config.json` 读
  - 流式响应：`app.emit("chat:chunk", ...)` 推 token
  - abort signal：玩家点 Stop → 关 reqwest 连接
- 引导模式（onboarding）
  - 3-5 问：genre / era / tone / 主角 / 核心冲突
  - Q1-Q4 写死在 Rust 端（玩家单选/多选）
  - Q5 自由文本
  - AI 生成最小原型：README.md + world/overview.md + characters/protagonist.md + plot/main-arc.md
  - Tauri event：`onboarding:question` / `onboarding:prototype`
- 共创模式（alternatives）
  - 每个 view 内 `<AiAssistButton>` 组件
  - 调 `generate_alternatives` command → 3-5 个备选
  - `<AlternativesPicker>` 卡片横排
  - 玩家挑 / 全部不要 / 重新生成
- 对话模式（chat）真流式
  - `useStreamReducer.ts` 简化版（5-8 mutation type，identity-stable array 模式）
  - chat state 字段 ≤ 8：{ sessionId, status, messages, currentText, error }
  - ChatTranscript.vue 严格 < 300 行，computed 链 ≤ 2 层
- Context 策略
  - 全局 system prompt（动态拼 project 状态）
  - 单 call ≤ 8k token，超出前端截断
  - file watcher + debounce ≥ 200ms（v0.1 手动 Reload，v0.2 自动监听）
- Session 管理
  - `<project>/sessions/YYYY-MM-DD-<short-id>.md` 一个文件一个 session
  - frontmatter：id / title / created_at / updated_at / model / total_tokens
  - "最近 N 个"列表 + 点击打开
  - v0.1 不做搜索 / 标签 / 收藏

**v0.2 不做**（推到 v0.3+）：
- ❌ 关系图可视化（v0.3 elkjs / vis.js）
- ❌ 真实图片生成（v0.3 SD / ComfyUI / MJ）
- ❌ 多 provider 支持（v0.4+ Anthropic / Ollama / Gemini）
- ❌ 工具调用（v0.4+ AI 主动操作文件）
- ❌ 自动 context 摘要（v0.4+）
- ❌ macOS / Linux（v0.3+）

**依赖**：v0.1 全部完成（流式管道 + 启动分阶段是 v0.2 真 AI 的基础设施）

---

## v0.3

**目标**：补齐"可视化"和"图片"两块短板，让玩家能看到人物关系、能给角色/场景生图。

**核心交付**：
- 关系图可视化
  - elkjs 或 vis.js 渲染 `characters/relationships.json`
  - 节点 = 人物，边 = 关系（带类型：朋友/敌对/师徒/...）
  - 拖拽 / 缩放 / 点击节点 → 跳到人物 sheet
- 真实图片生成
  - 接入 ComfyUI / SD API / Midjourney（v0.3 选一个起步）
  - `art/characters/foo.png` 旁放 `foo.prompt.txt`（DESIGN 已定约定）
  - 占位图 → 真实生成的迁移：保留原 prompt，玩家点"重生成"覆盖
- macOS 适配
  - Tauri 2 跨平台已 ok，主要是 .icns icon + 路径兼容
  - 在 macOS 上跑一次完整 smoke test

**v0.3 不做**：
- ❌ Linux 适配（v0.4+）
- ❌ 模板市场（v0.4+）
- ❌ 协作（v0.4+）
- ❌ 评测（v0.4+）

**依赖**：v0.2 全部完成（图片生成需要真 AI 集成做后端）

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

**更新规则**：每次 release 完成 / 大决策变更时，更新本表 + 状态总览。

---

**ROADMAP 结束**。下次更新预计：v0.1 第一个 PR 完成后（更新"v0.1 进行中"状态）。
