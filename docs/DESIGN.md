# PlotCraft v0.1 设计文档

> **给下一个 agent 的上手说明**：读完整篇即可启动 v0.1 实现。所有决策点都标注了理由，开放问题列在最末。

---

## 项目一句话

PlotCraft 是一个**面向独立 / 业余 RPG / VN 创作者的 AI 协作桌面工具**——和 Locus 同类（都是 Tauri 2 + Vue 3 + Rust 栈的桌面 app），但定位完全不同。AI 帮玩家把脑子里的**世界、人物、剧情**落到一个**结构化的、可读可改可 git 的文件夹**里。

类比定位：Locus ≈ "Unity 开发的 AI 同事"，PlotCraft ≈ "RPG 设定工作的 AI 编剧搭档"。

---

## Quick Start（下一个 agent 接手后第一件事）

```bash
# 1. 进入项目根
cd D:\Projects\PlotCraft

# 2. 铺前端骨架（参考本文件「仓库结构」一节）
#    - package.json / vite.config.ts / tsconfig*.json / index.html
#    - src/main.ts / App.vue / style.css / router/ / views/ / stores/ / lib/
#    - AGENTS.md / README.md / .gitignore

# 3. 铺 Tauri 后端骨架
#    - src-tauri/Cargo.toml / tauri.conf.json / build.rs
#    - src-tauri/src/main.rs / lib.rs
#    - src-tauri/capabilities/default.json
#    - src-tauri/icons/（从 Locus 复制）

# 4. 装依赖并验证
bun install
bun run typecheck             # vue-tsc
cd src-tauri && cargo check   # rust
cd .. && bun run tauri dev    # 起一次完整 app 验
```

---

## 目标用户

- **主**：独立游戏开发者、业余 RPG / VN 编剧
- **次**：网文作者想试试游戏化设定
- **不针对**：3A 工作室（他们有自己的工具链）

---

## v0.1 范围

### ✅ In（v0.1 必须有）

- **桌面 app**（Tauri 2 + Vue 3 + Rust + bun 栈）
- **新建项目流**：玩家 → 选输出文件夹 → AI 引导下生成最小原型（一句话世界 + 一个主角 + 三幕骨架）
- **tab 化 UI（6 个 tab）**：
  - 概览 (Overview) — 项目摘要、最近修改
  - 世界 (World) — 地理 / 历史 / 魔法体系 / 阵营
  - 人物 (Characters) — 人物档案 / 关系图
  - 剧情 (Plot) — 主线 / 章节 / 任务
  - 设定图 (Concept Art) — 占位图 + 提示词
  - 会话 (Session) — AI 聊天
- **AI 集成（BYO API key，OpenAI 兼容端点）**
- **共创模式**：每步 AI 给 3-5 个备选，玩家挑 + 自由改；玩家主导，AI 辅助
- **设定图 v0.1 用占位**（不接 SD/MJ/ComfyUI）
- **输出文件夹约定**：每个游戏 = 一个文件夹，markdown + JSON + 占位图，可读可改可 git

### ❌ Out（v0.1 不做）

- 真实图片生成（SD / MJ / ComfyUI 接入）
- 多人协作 / 云端同步
- 模板市场
- 移动端 / Web 端
- 项目之间的导入导出
- AI 自动覆盖玩家内容（**永远不**）

> ⚠️ **v0.1 范围 2026-07-28 重切**（用户决策）：
> - 6 tab → **7 tab**（新增独立 Setting tab，原 6 tab 不含）
> - Chat + Setting **实装**，其余 4 tab（Overview / World / Characters / Plot / Concept Art）**placeholder**
> - **直接接真 LLM**，取消 AI stub
> - 反卡顿基础设施（spawn_blocking / 16ms emit 节流 / mpsc channel / markdown worker / 启动分阶段）从第一行起就位
> - 详细 v0.1 设计：[CHAT_LLM_DESIGN.md](./CHAT_LLM_DESIGN.md)

---

## 技术栈

| 层 | 选型 | 版本（与 Locus 对齐） | 备注 |
|---|---|---|---|
| 后端 | Rust | edition 2021 | 复用 Locus 栈 |
| Tauri | tauri / tauri-build | `=2.11.1` / `2` | 严格 pin 避免 npm-rust 版本错配 |
| Tauri plugin | tauri-plugin-dialog | `2.6.0` | 仅此一个；v0.1 只要 folder picker |
| 前端框架 | Vue | `^3.5.13` | Locus 同款 |
| 路由 | vue-router | `^4.4` | Locus 没用到，我们用 |
| 状态 | pinia | `^3.0.4` | Locus 同款 |
| 构建 | Vite | `^5.4` | — |
| TS | typescript + vue-tsc | `~5.6` / `^2.1` | — |
| 包管理 | bun | latest | Locus 已用 |
| 字体 / 图标 | 系统默认 + lucide | — | Locus 已用 lucide |
| AI | OpenAI 兼容 API | — | BYO key，存哪见「开放问题」 |

**dev 端口：14201**（避 Locus 的 14901，可同时跑两边）

---

## v0.1 依赖清单（完整 + 故意不引入）

> 这节是**给下个 agent 写 Cargo.toml / package.json 用的 ground truth**。
> 严格按这个清单加，**不要**自动 `cargo add` / `bun add` 没列出来的包。

### Rust 后端（Cargo.toml）

| crate | 版本 | 用途 | 必加 |
|---|---|---|---|
| `tauri` | `=2.11.1` | Tauri runtime | ✅ |
| `tauri-build` | `2` | 构建脚本 | ✅ |
| `tauri-plugin-dialog` | `2.6.0` | 文件夹选择 | ✅ |
| `serde` | `1` + `derive` | IPC 参数序列化 | ✅ |
| `serde_json` | `1` | JSON IPC | ✅ |
| `tokio` | `1` + `full` | async runtime（`spawn` / `join!` / 文件 IO） | ✅ |
| `mimalloc` | `0.1` | 全局 allocator（Windows 性能） | ✅ |
| `thiserror` | `2` | Rust 侧统一错误类型 | ⚠️ 建议 |

**故意不加**（v0.1 不需要）：
- ❌ `uuid` / `chrono` —— 用 timestamp + 简单字符串 ID 就够
- ❌ `notify` —— 文件监听 v0.2+ 才有
- ❌ `reqwest` —— v0.1 假流式不调 HTTP；v0.2 接真 AI 再加
- ❌ `serde_yaml` —— frontmatter 解析在 v0.2+；v0.1 markdown 全文读
- ❌ `anyhow` —— 用 `thiserror` 就够
- ❌ `tracing` / `tracing-subscriber` —— Locus 用了但 PlotCraft v0.1 不需要
- ❌ `keyring` —— API key 存哪见开放问题 1

---

### 前端（package.json）

| npm 包 | 版本 | 用途 | 必加 |
|---|---|---|---|
| `vue` | `^3.5.13` | 框架 | ✅ |
| `vue-router` | `^4.4` | 6 个 tab 路由 | ✅ |
| `pinia` | `^3.0.4` | 状态管理 | ✅ |
| `@tauri-apps/api` | `=2.11.1` | Tauri JS bridge | ✅ |
| `@tauri-apps/plugin-dialog` | `=2.6.0` | folder picker | ✅ |
| `marked` | `^13` 或 latest | markdown 渲染 | ✅ **关键** |
| `dompurify` | `^3` | XSS sanitize | ✅ **关键** |
| `gray-matter` | `^4` | frontmatter 解析 | ⚠️ 建议（v0.2+ 可后端解析） |
| `lucide-vue-next` | `^0.4xx` | icon 库 | ✅ |
| `@tauri-apps/cli` | `=2.11.1` | `tauri dev` / `tauri build` | ✅ devDeps |
| `@vitejs/plugin-vue` | `^5.1` | Vite Vue 插件 | ✅ devDeps |
| `typescript` | `~5.6` | TS 编译器 | ✅ devDeps |
| `vite` | `^5.4` | 构建 | ✅ devDeps |
| `vue-tsc` | `^2.1` | 类型检查 | ✅ devDeps |

**故意不加**（v0.1 不需要）：
- ❌ `@codingame/monaco-vscode-api` —— 不做代码编辑器
- ❌ `highlight.js` / `katex` —— 人物 sheet 暂时不嵌代码 / 公式
- ❌ `turndown` —— 不做 HTML→MD 反向（chat 直接输出 MD）
- ❌ `axios` / `ky` —— `fetch` + `@tauri-apps/api` 的 `invoke` 够了
- ❌ `tailwindcss` / `unocss` —— Locus 也没用，PlotCraft 简单 scoped CSS
- ❌ `i18n` 库 —— v0.1 UI 中文为主 + 关键术语保留英文；v0.2+ 再考虑 i18next
- ❌ `web-worker` 框架 —— v0.1 stub 接口预留；v0.2+ 用原生 `Worker`
- ❌ 测试框架 —— v0.1 不写单测（用户接受）；v0.2+ 加 `vitest`
- ❌ `marked-highlight` / `marked-gfm-heading-id` 等插件 —— v0.1 标准 marked 够用

---

### 一致性原则

- **Rust 和 npm 的 Tauri 版本严格 pin 一致**（`=2.11.1`）—— Locus AGENTS.md 警告过版本错配的 panic
- **`@tauri-apps/plugin-dialog` Rust 和 npm 同号**（都是 2.6.0）—— 跨生态锁步
- **marked 输出的 HTML 必走 dompurify** —— 任何用户可控的 markdown 都不能直接 `v-html` 渲染

---

## 多线程 / 性能原则（重要 · 从 v0.1 第一行起就要考虑）

> PlotCraft 要处理大量 markdown 文本 + AI 流式输出 + 文件 IO——**任何主线程卡顿都会毁掉"AI 协作"的体验**。这部分跟"复用 Locus 模式"同等优先。

### 后端 (Rust/Tauri)

- 所有 Tauri 命令默认 `async fn`，避免阻塞 IPC 线程
- 长时间操作（AI 推理、文件夹扫描）**不 return 完整结果**，**用 Tauri event 流式推**进度（`app.emit("xxx:chunk", payload)`）
- 文件 IO 优先 `tokio::fs` 而不是 `std::fs`
- 重活（embedding、压缩、批量读）`tokio::spawn` 丢 worker pool
- 全局 allocator 用 `mimalloc`（Locus 也在用，理由：Windows 系统堆在多线程小对象分配下劣化严重）

### 前端 (Vue/JS)

- 大对象用 `shallowRef` 而不是 `ref`（AI message 数组、文件树、关系图、人物档案）
- 长列表 v0.2+ 用虚拟化（v0.1 数据量小可先不管）
- Markdown 渲染：长内容分块、增量更新（参考 Locus 的 `streamingMarkdownBlocks`，PlotCraft 写简化版）
- 计算密集型（Markdown AST 解析、模板渲染）丢 web worker（v0.1 stub 接口预留，v0.2 实装）
- 文件监听 debounce，避免高频触发
- 避免在 `computed` 里跑重逻辑；用 `shallowRef` + 手动 `triggerRef` 控制更新粒度

### AI 流式 (v0.2+)

- 后端：`start_chat(msg)` 立即返回 `session_id`，然后 `app.emit("chat:chunk", ...)` 流式推 token
- 前端：subscribe `chat:chunk` 事件，增量更新 transcript
- PlotCraft 写一个简化版 `useStreamReducer`（思路对齐 Locus 35k 的同名文件，代码量小一个数量级）

### 文件 IO 模式

- 单文件读写：async Tauri command，**不**需要流（亚毫秒级）
- 项目扫描 / 大目录列举：stream 文件列表 via Tauri events
- 批量写：`tokio::spawn` N 个 task，`tokio::join!` 合并，emit 进度
- 玩家手动编辑了项目文件夹里的文件：v0.1 靠手动 Reload 按钮，v0.2+ 加 file watcher + debounce

### v0.1 最小要求（避免埋雷）

- Tauri commands 全部 `async`
- AI stub（v0.1 没真 AI，但写一个**假流式管道**——每 100ms 推一个假 chunk 给前端）验证整条链路 OK
- 引入 `mimalloc`（Locus 同款）
- 不引入 web worker 框架（v0.2+），但留接口

---

## Locus 实地考察（带批判 · 4 文件 + AGENTS.md）

> 这节是**写之前**实地读 Locus 源码的结论，不是推论。每个判断都标了来源文件。
> **立场**：学 Locus 的**架构和反卡顿技术**，避开它的**过度工程**。

### ✅ 学什么（Locus 的优点）

**1. Chat 流式的 identity-stable array 技巧**（来自 `composables/useStreamReducer.ts:410-414`）

> "the structural mutations below are only emitted when they would actually change a part, so the `liveRenderParts` array keeps its identity (and the transcript does not re-render) while text is merely growing."

这是 Locus **反卡顿的核心**——streaming 时大量 text delta，但只 append 到 part.content，**数组引用不变**，配合 shallowRef 就能避免整个 transcript 重渲染。**PlotCraft 必须照搬这条**，否则 v0.2 一接真 AI 就会卡死。

**2. 架构分层（pinia + composables + services）**（来自 `App.vue` 头部 50 行 + services/ 目录）

- **stores/**：纯状态、跨 view 共享
- **composables/**：可复用行为（流式、键盘、resize）
- **services/**：跟 Tauri 通信、业务规则
- **components/**：纯 UI

PlotCraft 沿用。

**3. 异步 + mimalloc + Tauri event 流式**（来自 `lib.rs:10-13` + 多个 commands）

- 所有 Tauri commands 全 `async fn`
- `mimalloc` 作全局 allocator（Windows 专用，避免堆争用）
- 长操作 emit 进度事件，不 return 完整结果

PlotCraft 沿用。

**4. Settings 的 key-value reactive 模式**（来自 `composables/useSettingsState.ts` 头部）

- 通用 reactive store + Tauri 持久化
- 改动立即同步磁盘
- PlotCraft 写一个简化版（4-5 个 setting：API key / model / theme / output folder）

---

### ❌ 不学什么（Locus 的过度工程 / 反面教训）

**1. View runtime（83k `viewRuntime.ts`）— 不学**

- Locus 的 tab 系统是**动态 SFC 编译 + 加载**：runtime 编译 .vue 文件，export 到子进程的 view pool
- 解决的是"view 包分发"问题（plot / canvas / graph / table 等模块要 export 给 view-runtime 子进程用）
- PlotCraft **没有这个需求**——我们的 view 就 6 个静态页面，vue-router 够了
- 抄过来 = 90% 代码没用，还引入 SFC 编译 runtime 依赖

**2. 35+ 字段的 chat state — 不学**

- Locus `StreamState` 25+ 字段、35+ mutation 类型
- 同时管 text delta、code block delta、thinking、tool calls、render parts、todos、questions、tool confirms、undo、compact
- 这么多字段，**任何 mutation 都触发一片 reactivity**——这是 Locus 卡顿的真因之一
- PlotCraft v0.1 chat state ≤ 8 字段：`{ sessionId, status, messages, currentText, error }`
- mutation 类型 ≤ 8：`{ startChat, appendChunk, completeChat, failChat, cancelChat, addUserMsg, loadSession, clearSession }`

**3. 多窗口 / sub-window 池子 — 不学**

- Locus 有 main window + view pool（多个 sub-window）
- 每个 sub-window 独立 Vue 进程，独立 IPC
- PlotCraft **单窗口** app 就够；v0.3+ 再说
- 抄过来 = 90% 代码白写 + IPC 复杂度翻倍

**4. 5 周 workspace_root vs unity_root 重构 — 警惕 over-abstract**

- Locus 5 周时间做"工作区根 vs Unity 根"拆分
- 推到一半用户叫停——P2-P6 全 revert
- **教训**：项目概念别过度抽象
- PlotCraft 直接"**项目 = 文件夹**"，**不**分 workspace_root / project_root
- 玩家选输出文件夹 = 项目根，没歧义

**5. 138k 的 ChatTranscript / 119k 的 RichChatInput — 别复制**

- Locus 自己的卡顿源之一
- PlotCraft v0.1：ChatTranscript 简单 props 列表（< 10 个 prop），RichChatInput 退化成 `<textarea>` + 提交按钮
- v0.2+ 再考虑 rich input

---

### 🚨 Locus 卡顿源 + PlotCraft 反制（具体到行）

| 卡顿源 | Locus 现状 | PlotCraft 反制 |
|---|---|---|
| **数组 identity 每次变** | `useStreamReducer.ts:282` 返回 `StreamMutation[]`，每次都 push 结构性 mutation → 数组引用必变 | **学 Locus 的修法**：纯文本 delta **不**动 parts 数组，只 append 到 `part.content` |
| **35 字段 state 整体 reactive** | `stores/chat.ts:112k`，每次 mutation 影响多个字段 → 全树 reactivity 触发 | v0.1 chat state ≤ 8 字段；用 `shallowRef` 包大对象；mutation 只触碰必要字段 |
| **深 computed / watcher** | `ChatTranscript.vue:138k` 嵌套组件，computed 链长 | PlotCraft 的 ChatTranscript 单文件 < 300 行，computed 链 ≤ 2 层 |
| **同步 file IO** | Locus 部分 `std::fs` 还在用 | PlotCraft **只**用 `tokio::fs`；批量 IO 走 `tokio::spawn` |
| **复杂 input 阻塞主线程** | `RichChatInput.vue:119k`，mention popup / file preview / 工具栏状态计算 | PlotCraft v0.1 用纯 `<textarea>`，mention/popup v0.2+ |
| **重初始化时阻塞** | Locus 启动要 init theme / fonts / model catalog / omnisharp 状态 | PlotCraft 启动**严格分阶段**：phase 1 必须 < 500ms（窗口显示 + 首屏），phase 2 异步 init（model catalog / 缓存预热） |
| **每 chunk 创建大对象** | `reduceStreamEvent` 每次创建新 state 对象（25 字段全替换） | PlotCraft 用 patch-style reducer：只返回变化字段的对象，shallowRef + `triggerRef` 强制更新 |

---

### 📋 Locus 经验总结（4 个文件 80% 信息）

| 文件 | 读了几行 | 关键信息 |
|---|---|---|
| `AGENTS.md` | 426 / 28k | 项目布局、merge workflow、commit 规范（跟 PlotCraft 关系小，但 commit 格式可参考） |
| `composables/useStreamReducer.ts` | 500 / 35k | **identity-stable array 技巧**（最重要） |
| `components/view/viewRuntime.ts` | 200 / 83k | 确认是动态 SFC 加载 → PlotCraft 不学 |
| `composables/useSettingsState.ts` | 150 / 62k | key-value reactive 模式 → PlotCraft 简化版 |

**没读（够用就行）**：
- `stores/chat.ts:112k` —— 大但模式已经在 useStreamReducer 里看清
- `ChatTranscript.vue:138k` —— 太长，且已知是卡顿源，不读不亏
- `App.vue` 全文 —— App.vue 头部 import 已看，足够理解分层

---

## 仓库结构

```
D:\Projects\PlotCraft\
├── docs/
│   └── DESIGN.md          # 本文档
├── package.json           # 依赖 + bun scripts
├── vite.config.ts         # dev 端口 14201
├── tsconfig.json / .app.json / .node.json
├── index.html
├── AGENTS.md              # 项目自己的 AGENTS（v0.2+ 由下一个 agent 维护）
├── README.md
├── .gitignore
├── src/                   # Vue 3 前端
│   ├── main.ts            # createApp + pinia + router
│   ├── App.vue            # shell：tab 栏 + 当前 view
│   ├── style.css          # 深色主题（#1d1d21 底 / #f0a040 强调）
│   ├── vite-env.d.ts
│   ├── router/
│   │   └── index.ts       # 6 个 tab 的路由
│   ├── views/             # 6 个 tab 各一个 view
│   │   ├── OverviewView.vue
│   │   ├── WorldView.vue
│   │   ├── CharactersView.vue
│   │   ├── PlotView.vue
│   │   ├── ConceptArtView.vue
│   │   └── SessionView.vue
│   ├── components/        # 共享组件
│   ├── stores/            # pinia: project, ai, ui
│   ├── lib/               # tauri command wrappers
│   ├── types/             # TS 类型
│   └── assets/            # 静态资源
└── src-tauri/             # Rust 后端
    ├── src/
    │   ├── main.rs        # entry; 调 plotcraft_lib::run()
    │   ├── lib.rs         # tauri::Builder + invoke_handler
    │   ├── commands/      # Tauri 命令分模块
    │   │   ├── mod.rs
    │   │   ├── project.rs # 新建/打开/列出项目
    │   │   └── system.rs  # version / paths
    │   ├── project/       # 项目 IO 逻辑
    │   ├── ai/            # AI 集成（v0.1 stub，v0.2 真正接）
    │   └── settings/      # 配置 / API key（v0.1 stub）
    ├── capabilities/
    │   └── default.json   # core:default + dialog:default
    ├── icons/             # 从 Locus 复制（5 个必需）
    ├── Cargo.toml
    ├── tauri.conf.json
    └── build.rs
```

### v0.1 最小可交付（推荐第一个 PR）

**只做这些**——能让 app 起来、tab 切换、新建项目、生成最小原型，**所有长操作（AI/IO）都走 async + 流式路径，不让 UI 线程卡顿**：

1. 上述 6 个 view 各放一个 placeholder（显示 tab 名 + "v0.2 实装"）
2. `commands/project.rs` 暴露 2 个 Tauri 命令：
   - `create_project(folder: String, name: String)` → 写入 `README.md` + `world/overview.md` + `characters/protagonist.md` + `plot/main-arc.md` 4 个 starter 文件
   - `list_projects(folder: String)` → 扫描子文件夹
3. `commands/system.rs` 暴露 `plotcraft_version`
4. `lib.rs` 注册所有命令
5. `tauri.conf.json` 配 dialog plugin
6. `capabilities/default.json` 配权限
7. **多线程 + 反卡顿基础设施**（跟 1-6 同步做，别留到 v0.2）：
   - 所有 Tauri 命令 `async fn`
   - 引入 `mimalloc` 作全局 allocator（Locus 同款）
   - 加一个 `commands/ai_stub.rs`，暴露 `start_ai_stream(prompt)` 命令——它**不**调真 AI，每 100ms 通过 `app.emit("ai:chunk", ...)` 推一个假 chunk，用来端到端验证流式管道（前端 + 后端 + Tauri event + Vue 订阅）
   - **stream reducer 用 identity-stable array 模式**（学 Locus `useStreamReducer.ts:410`）：纯文本 delta 只 append 到 part.content，不动 parts 数组引用
   - chat state 字段 ≤ 8 个，全用 `shallowRef`；mutation 只触碰必要字段
   - ChatTranscript.vue 严格 < 300 行、computed 链 ≤ 2 层
   - 启动分阶段：phase 1 < 500ms（窗口显示 + 首屏），phase 2 异步（缓存预热、API key 校验）
   - 文件 IO 全 `tokio::fs`；批量 `tokio::spawn` + `tokio::join!`
   - 文件监听 debounce ≥ 200ms

8. **性能验收标准**（v0.1 release 前必测）：
   - 1000 token 流式渲染不掉帧（DevTools Performance 录制确认主线程 block < 16ms/帧）
   - 100MB 项目文件夹扫描不卡 UI（用 stream emit，不用 blocking read）
   - 启动到首屏 < 1.5s（cold start）
   - 6 个 tab 切换 < 100ms

**故意不做（推到 v0.2+）**：
- AI 集成（v0.2：BYO key + 会话 tab 真实聊天）
- 关系图可视化（v0.3+）
- 真实图片生成（v0.3+）

---

## 输出文件夹结构（"项目 = 文件夹"）

玩家在 PlotCraft 里创建游戏时，**整个游戏项目就是一个文件夹**，存放在用户选的任意位置：

```
<用户选的位置>/<游戏名>/
├── README.md                  # 项目元信息（标题、类型、genre、创建时间）
├── world/
│   ├── overview.md            # 世界观速览
│   ├── geography.md
│   ├── history.md
│   ├── magic-system.md
│   └── factions.md
├── characters/
│   ├── protagonist.md         # 主角
│   ├── party.md               # 队友
│   ├── npcs.md                # NPC 群像
│   └── relationships.json     # 结构化关系数据
├── plot/
│   ├── main-arc.md            # 主线三幕
│   ├── chapters/              # 章节详细
│   │   ├── 01-prologue.md
│   │   └── ...
│   └── quests.md
├── art/
│   ├── characters/            # 占位图 + 同名 .prompt.txt
│   ├── scenes/
│   └── items/
└── sessions/
    └── YYYY-MM-DD.md          # AI 会话日志
```

### 约定

- 每个 `.md` 文件 frontmatter 含元数据：
  ```yaml
  ---
  title: 大陆纪年
  tags: [world, history]
  status: draft
  updated: 2026-07-28
  ---
  ```
- 玩家可在 PlotCraft 外直接编辑这些文件，**app 重启时重新加载**（不要缓存）
- `relationships.json` 用结构化数据，方便 v0.3+ 关系图可视化
- `art/*/foo.png` 旁边同放 `foo.prompt.txt` 存提示词

### 玩家在 PlotCraft 外编辑的处理

- **v0.1 不做** 文件监听 / 自动 re-import
- 玩家改完手动 "Reload project" 按钮即可
- v0.2+ 加 file watcher

---

## AI 交互模式

### 核心原则：玩家主导，AI 辅助

- **不**自动覆盖玩家的内容
- 每个 AI 建议都呈现为 **3-5 个备选**，玩家挑一个 + 自由编辑
- 大块创作（写一段历史）AI 一次给完整提议，玩家用对话修
- 细节选择（命名、决策）AI 给 3-5 备选，玩家点

### v0.1 minimum

- BYO API key（OpenAI 兼容端点）
- key 存哪：见「开放问题 1」
- **会话 tab** 能跟 AI 聊，AI 回复作为 chat 展示
- **创作工具**（AI 给备选）v0.2 实现

### v0.2+ AI 能力

- "新建项目" 引导流：AI 问 3-5 个问题（genre / 时代 / tone / 主角类型），然后生成最小原型
- 每个 view 内的 "AI 补" 按钮：给当前选中区域生成 3-5 备选
- "AI 重写"：选中一段文字，让 AI 重写

---

## LLM 驱动设计（v0.1 + v0.2+ 预留）

> PlotCraft 跟"普通 markdown 编辑器"的区别就在这一套——AI 是共创搭档，不是自动机。
> **核心原则：玩家主导，AI 辅助**（来自 v0.1 范围），所有 LLM call 都有玩家可控点。

### 三种 AI 驱动的 UX 模式

| 模式 | 何时触发 | AI 行为 | 玩家行为 | v0.1? |
|---|---|---|---|---|
| **引导模式** | 新建项目流 | AI 主动问 3-5 个问题（genre / 时代 / tone / 主角类型） | 回答问题 | ✅ |
| **共创模式** | view 内点 "AI 补" 按钮 | AI 给 3-5 个备选 | 挑一个 + 自由编辑 | ✅ |
| **对话模式** | 会话 tab 自由聊天 | AI 流式回复 | 任意追问 | ✅ |

引导模式的具体流程（v0.1）：
```
新建项目
  → AI 问 Q1: "你想要什么 genre？奇幻/科幻/现代/架空历史/其他？"
  → 玩家选
  → AI 问 Q2: "主角是？凡人/有特殊能力/非人类？"
  → ... 共 3-5 问
  → AI 生成最小原型：
      README.md
      world/overview.md (一句话世界观)
      characters/protagonist.md (一句话主角)
      plot/main-arc.md (三幕骨架)
  → 玩家点 "进项目" → 进入主界面
```

共创模式的具体形态：
```
view 内选中一段文字 / 一个空字段
  → 点 "AI 补"
  → AI 返回 3-5 个备选（JSON 数组）
  → 前端展示 3-5 个卡片
  → 玩家点其中一个 → 写入文件
  → 或者全部不要，自己写
  → 写完点 "AI 重写" → 重新生成
```

---

### 后端实现（Rust）

**1 个 LLM client**（封装 OpenAI 兼容 API）：
- 模块：`src-tauri/src/llm/mod.rs`
- trait：`LlmClient`（async fn chat_stream / chat_complete / generate_alternatives）
- v0.1 只实现 `OpenAiCompatibleClient`（用 `reqwest` 流式 HTTP）
- v0.2+ 抽 trait，加 Anthropic / Ollama 实现

**3 个 Tauri commands**（v0.1）：
| 命令 | 用途 | 流式? |
|---|---|---|
| `start_onboarding(project_path, answer?)` | 引导模式（无 answer 返回下一问，有 answer 返回原型或下一问） | 否 |
| `generate_alternatives(project_path, context, field)` | 共创模式，返回 3-5 备选 | 否（小 call） |
| `start_chat(project_path, session_id, message)` | 对话模式，返回 session_id | **是** |

**Tauri events 流式协议**（v0.1 通用）：
| event | payload | 含义 |
|---|---|---|
| `chat:chunk` | `{ session_id, text }` | 文本增量 |
| `chat:done` | `{ session_id, usage }` | 完成（带 token usage） |
| `chat:error` | `{ session_id, error }` | 错误（带可读消息） |
| `onboarding:question` | `{ question_id, text, options? }` | 引导下一步问题 |
| `onboarding:prototype` | `{ project_path, files: [...] }` | 原型生成完 |
| `alternatives:result` | `{ request_id, items: string[] }` | 备选返回 |

所有 Tauri commands **async fn**，所有长操作都走 `tokio::spawn` + event，**不 return 完整结果**。

**HTTP 客户端**：
- v0.1 用 `reqwest`（`stream` feature）+ `tokio-util` 的 `Decoder`
- 流式响应：每收到 chunk → `app.emit("chat:chunk", ...)` → 前端渲染
- 取消：玩家点 "Stop" → Tauri command 接收 abort signal → 关闭 reqwest 连接

---

### 前端实现（Vue）

**3 个核心模块**：
| 模块 | 位置 | 职责 |
|---|---|---|
| `lib/llm.ts` | `src/lib/` | Tauri command wrappers + event 订阅 |
| `stores/llm.ts` | `src/stores/` | LLM 状态（api key / endpoint / model / loading） |
| `composables/useStreamReducer.ts` | `src/composables/` | **identity-stable array 模式**（学 Locus `useStreamReducer.ts:410`） |

**`useStreamReducer.ts`（v0.1 简化版）**：
- PlotCraft 不需要 35+ mutation type，**5-8 个就够**：
  ```ts
  type StreamMutation =
    | { type: 'start'; sessionId; runId }
    | { type: 'appendText'; runId; text }      // 关键：只 append，不动 parts 数组
    | { type: 'complete'; runId; usage? }
    | { type: 'fail'; runId; error }
    | { type: 'cancel'; runId }
  ```
- **数组 identity 保护**：`appendText` 不 push 新 part，只 mutate `parts[i].content`
- `shallowRef` 包 state → 单帧只触发一次 transcript 重渲染（即使有 1000 chunk/sec）

**每个 view 内的 "AI 补" 按钮**：
- World / Characters / Plot / Concept Art 4 个 view 各放一个统一的 `<AiAssistButton>` 组件
- props：`field: string, context: object`
- emit：`alternatives-requested` → 触发 `generate_alternatives` command
- 收到结果 → 弹 `<AlternativesPicker>`（3-5 个卡片）

**会话 tab**：
- 复用 ChatTranscript 模式（多 session 切换）
- v0.1 简化：单 session 也行，多 session v0.2
- 玩家可"暂停" / "继续" / "重新生成"

---

### Context 策略（v0.1）

**全局 system prompt**（每次 LLM call 都带）：
```markdown
你是 PlotCraft —— 一个帮玩家设计 RPG / VN 世界观、人物、剧情的 AI 编剧搭档。

## 核心原则
1. 玩家主导，AI 辅助。AI 给建议，玩家挑+改，AI 永远不自动覆盖玩家内容
2. 共创模式：每步给 3-5 个备选让玩家挑
3. 保持项目文件夹结构：world/ characters/ plot/ art/ sessions/
4. 输出 markdown 格式，每个文件带 frontmatter 元信息

## 当前项目
名称：{project_name}
类型：{genre}
时代：{era}
基调：{tone}

## 玩家已有的设定摘要
{project_summary}
```

**每次 call 的 message 结构**（OpenAI chat format）：
```json
[
  { "role": "system", "content": "<上面那段，含动态 project 状态>" },
  { "role": "user", "content": "<当前操作（引导回答 / 共创 context / 聊天消息）>" },
  { "role": "assistant", "content": "<可选：最近 3-5 轮历史>" }
]
```

**Context 准备时机**：
- 引导模式：玩家回答后，**前端组装 system prompt + 当前 answer**，Tauri command 透传
- 共创模式：玩家点按钮时，**前端把当前文件内容 + 选中区域**打包，Tauri command 调 LLM
- 对话模式：玩家发消息时，**前端把当前文件 + 最近 5 条对话**打包

**Context 长度控制**（v0.1）：
- 单次 call ≤ 8k token（保护 API quota + 速度）
- 超出 → **前端截断**：超长文件只发头 2000 字符 + "..." 提示
- v0.2+ 加自动摘要（context 摘要放 web worker）

---

### Session 管理（v0.1）

**文件位置**：
```
<project>/sessions/
├── YYYY-MM-DD-<short-id>.md   # 每个 session 一个文件
├── YYYY-MM-DD-<short-id>.md
└── ...
```

**文件结构**（frontmatter + body）：
```markdown
---
id: a1b2c3d4
title: "世界观灵感"
created_at: 2026-07-28T10:00:00Z
updated_at: 2026-07-28T10:30:00Z
model: gpt-4
total_tokens: 1234
---

# 2026-07-28 10:00:00
**user**: 我想做一个克苏鲁风格的都市奇幻 RPG...

# 2026-07-28 10:01:23
**assistant**: 听起来很有意思！这个 setting 让我想到...

# 2026-07-28 10:05:12
**user**: 主角是个失意的私家侦探，意外继承了一家古董店...
```

**为什么用 .md 而非 .json**：
- 跟项目其它文件结构一致
- 玩家可直接用任何编辑器查看
- git diff 友好
- 简单的"打开看"行为

**v0.1 简化**：
- 不做 session 搜索 / 标签 / 收藏
- 只做"最近 N 个"列表 + 点击打开
- v0.2+ 加搜索 + 标签 + 收藏

---

### Configuration（v0.1）

**API key 存哪**（开放问题 1，推荐答案）：

| 方案 | 优点 | 缺点 | v0.1? |
|---|---|---|---|
| A. OS keychain（`keyring` crate） | 安全 | Windows 行为有时 tricky；`keyring` crate 3 个 feature（Locus 用了 windows-native / apple-native / sync-secret-service） | v0.2+ |
| B. App config 文件（`%APPDATA%/PlotCraft/config.json`） | 简单，跨平台一致 | key 裸存 | ✅ v0.1 |
| C. 加密的 config 文件（passphrase 提示） | 安全 + 跨平台 | 实现复杂 | v0.3+ |

**v0.1 选 B**——简单、个人项目、玩家自己用。v0.2 加 A 升级路径。

**配置结构**（`%APPDATA%/PlotCraft/config.json`）：
```json
{
  "version": 1,
  "llm": {
    "endpoint": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "model": "gpt-4o-mini"
  },
  "ui": {
    "theme": "dark",
    "language": "zh-CN"
  },
  "recentProjects": ["D:/Games/MyRPG", "D:/Games/MyVN"]
}
```

**Settings tab UI**（v0.1）：
- LLM section：endpoint / apiKey（password input）/ model（text input）
- UI section：theme toggle
- 通用：最近项目列表（点击打开）
- 不做：OAuth、rate limit 显示、quota 显示（v0.2+）

---

### v0.2+ 预留（不做但留接口）

- **多 provider 支持**：Anthropic / Google / Ollama —— 抽 `LlmClient` trait
- **工具调用**：read_file / write_file / search_project / list_files —— AI 主动操作文件
- **自动 context 摘要**：超出 8k token 时，AI 摘要历史
- **多 session 切换 / 搜索 / 标签 / 收藏**
- **提示词模板库**：玩家可保存自己的"AI 补"prompt
- **Image 输入**：概念图参考（多模态）
- **OAuth 流程**：Claude Code / Codex（参考 Locus）
- **Rate limit 显示 / quota 监控**（参考 Locus `useSettingsState.ts:140+`）

---

### 反卡顿要点（LLM 流式特别重要）

| 风险 | 反制 |
|---|---|
| 1000 token / sec 流式时 transcript 重渲染 | identity-stable array（学 Locus）+ shallowRef |
| 每次 mutation 创建大 state 对象 | patch-style reducer：只返回变化字段 |
| LLM call 阻塞主线程 | 全部走 tokio task + Tauri event emit |
| Context 准备阻塞（读大文件 + 序列化） | v0.1 简单：单文件 ≤ 2000 字符；v0.2+ 丢 web worker |
| HTTP 连接不释放 | abort signal + `reqwest` 的 `drop` 显式关连接 |
| Abort 后后端还推 chunk | 前端订阅时绑 runId，过滤掉已 cancel 的 run 的 chunk |

---

## 视觉风格

- **底色**：`#1d1d21`（与 Locus 一致，便于共用深色习惯）
- **强调色**：`#f0a040`（暖橙，比 Locus 偏冷青的强调色更"故事感"）
- **次要文字**：`#999`
- **字体**：系统默认（Segoe UI / -apple-system / Microsoft YaHei）
- **icon**：`lucide-vue-next`（Locus 已在用）

---

## v0.2+ 方向（仅供参考，不要现在做）

- AI 真实集成（BYO key + OpenAI 兼容）
- "新建项目" 引导流（AI 问 3-5 个问题 → 生成最小原型）
- 每个 view 的 AI 补 / 重写按钮
- 关系图可视化（elkjs 或 vis.js）
- 真实图片生成接入（ComfyUI / SD API）
- 模板市场（玩家分享"项目文件夹模板"）
- 导出成 Notion / World Anvil
- 多人协作（Yjs + WebSocket）
- LLM 评测（多个模型对比生成结果）
- **i18n（vue-i18n + zh-CN / en 两套）** — v0.1 全中文硬编码，出海再做
- **单元测试（vitest 覆盖 chat reducer / llm client / 工具函数）** — v0.1 靠 manual smoke 11 项，reducer 复杂了再加
- macOS / Linux 适配

---

## 开放问题（v0.1 之前必须解决）

1. **AI API key 存哪？** ✅ **已推荐 B（v0.1）+ A（v0.2+）**
   - v0.1：app config 文件（`%APPDATA%/PlotCraft/config.json`），裸 key 但个人项目风险可接受
   - v0.2+：升级到 OS keychain（`keyring` crate，Locus 用了 windows-native / apple-native / sync-secret-service）
   - v0.3+：可选加密 config（passphrase）
2. **项目元信息格式？** ✅ **已推荐 A（README.md frontmatter）**
   - 跟输出文件夹里其它 .md 文件**用同一套 frontmatter 约定**，玩家只学一种格式
   - 不引入 `manifest.json` 这种"系统级"文件干扰（玩家可能误编辑）
   - 实施：`README.md` 头部放 `{title, type, genre, era, tone, created_at, updated_at}`，LLM 用作 system prompt 的项目摘要源
3. **UI 主语言？** ✅ **已推荐：中文为主 + 关键术语保留英文**
   - 跟 Locus `AGENTS.md` 一致：中文叙述、代码标识符英文、关键术语（"tab" / "stream" / "session" / "view" / "store"）保留英文
   - **不**做 i18n 框架（v0.1），所有界面字符串写死中文 + 关键英文混排
   - 写代码注释、commit message、PR 描述同款风格
   - v0.3+ 视需要再上 i18next
4. **设定图提示词存储？** ✅ **已推荐：同名 `<name>.prompt.txt` 旁放**
   - 关注点分离：图片是图片、提示词是文本
   - 前端不需要 markdown 解析器去嵌 frontmatter 字段
   - 玩家可直接用任何编辑器编辑 .prompt.txt
   - 文件结构示例：
     ```
     art/characters/
       hero.png
       hero.prompt.txt    # 内容: "a young swordsman, anime style, ..."
       villain.png
       villain.prompt.txt
     ```
5. **"概览" tab 展示什么？** ✅ **已推荐：3 块内容**
   - **最近修改**：项目文件夹里按 mtime 排序的最近 5 个文件（点击直接打开对应 view）
   - **当前 session 状态**：如果会话 tab 有活跃 session，显示 session 标题 + 状态（idle / streaming）+ 快捷"继续对话"按钮
   - **AI 操作历史**：最近 10 条 AI 行为（"AI 补：世界观概述 给了 3 个备选，玩家选了 #2"），点击可跳到对应位置
   - **不**做：项目"心跳"、全局统计、收藏、推荐等 v0.2+ 功能

---

## 非目标（明确不做）

- 不做云端、AI 训练用用户数据
- 不做付费功能
- 不做跨平台（先 Windows，macOS/Linux v0.3 再考虑）
- 不做项目模板市场（v0.2 也不做）
- 不做 AI 自动覆盖玩家内容（**永远不**，玩家主导是核心原则）

---

## 决策记录（重要：避免下个 agent 重新走弯路）

- **不复用 Locus 的 src/ 代码**——Locus 的 Vue 端是 Monaco editor + Unity bridge 专用，跟 PlotCraft 没关系；只复用 Tauri 工程骨架
- **不复用 Locus 的 tauri.conf.json**——Locus 有大量 Unity 专属 beforeDevCommand / beforeBuildCommand；PlotCraft 用最简配置
- **dev 端口用 14201**——避免和 Locus 的 14901 冲突
- **版本严格 pin**——Tauri 2.11.1 是 npm / rust 两边都最高的稳定版；新装必须 npm 和 cargo 同步
- **Tauri 2.11.1 不支持 `git init -b main`**（老 git < 2.28 不支持）；用 `git init` + `git symbolic-ref HEAD refs/heads/main` 绕开
- **bunx create-tauri-app 在本机 fetch 卡死**（依赖解析阶段停住）；手动 scaffold 比交互式更快
- **AGENTS.md 模板**：参考 Locus 的，但内容必须是 PlotCraft 专属
- **复用程度 = A 模式类似**：PlotCraft 自己的 tab/chat/settings，架构（pinia + composables + services + 流式 + 持久化）跟 Locus 对齐，代码独立。**不做共享包 B**（要 ref Locus 风险大），**不直接搬 C**（Locus 组件深度耦合 Locus stores，搬过来要重写一半，比从零写还累）
- **多线程从 v0.1 开始考虑**：Locus 早期是同步的，后期改造痛苦。具体原则见「多线程 / 性能原则」一节
- **反卡顿从 v0.1 第一行代码开始**：Locus 的卡顿来自 5 个具体源头（数组 identity 变 / 35 字段 state / 深 computed / 同步 IO / 重 init）。PlotCraft 每个都反制——具体见「Locus 实地考察」一节
- **identity-stable array 是 chat 流式反卡顿核心**：纯文本 delta 只 append 到 part.content，**不动数组引用**。配合 shallowRef，transcript 不重渲染。这条从 Locus `useStreamReducer.ts:410-414` 学的，PlotCraft 必须照搬
- **不 over-abstract**：Locus 5 周重构 workspace_root vs unity_root 推到一半被 revert 是血的教训。PlotCraft 直接"项目=文件夹"，**不**分多级根
- **Tab 用 vue-router 不学 Locus view runtime**：Locus 的 view runtime（83k）是动态 SFC 编译 export 给子进程用，PlotCraft 没这个需求

### 2026-07-28 新增决策（v0.1 范围重切后）

- **v0.1 直接接真 LLM，不做 AI stub**——用户决策，"自用先行"节奏，stub 验证管道没真实价值
- **v0.1 范围：6 tab 框架 + Chat + Setting 实装 + 4 tab placeholder**——6 tab 全部实装改为 2 实装 + 4 placeholder（原 §"v0.1 范围"被本决策 supersede，详细看 [CHAT_LLM_DESIGN.md §1](./CHAT_LLM_DESIGN.md#1-v01-范围重切)）
- **新增第 7 个 tab：Setting**——原 6 tab 不含 Setting，但 v0.1 改 API key 必须独立 tab（不是 chat tab 内的子菜单）
- **反 Locus 4 个卡顿源 + PlotCraft 4 条反制**：spawn_blocking 隔离 SSE 解析 / 16ms emit 节流 / mpsc channel 解耦 / markdown 渲染走 worker（详细 + 行号引用：[CHAT_LLM_DESIGN.md §2-3](./CHAT_LLM_DESIGN.md#2-locus-实地考察4-个具体卡顿源)）
- **chat state 砍到 ≤ 8 字段 / 8 mutation**——Locus 是 35+ 字段 / 35+ mutation，PlotCraft 不学复杂度
- **"游戏剧情设计需要哪些东西"完整清单**——CHAT_LLM_DESIGN §5.1 列出 9 大类（世界观 / 人物 / 剧情 / 设定图 / 主题 / 叙事 / 玩法 / 元信息 / 资产），v0.1 只落最小子集 4 个 starter md，v0.2+ 扩展时数据模型不重构
- **v0.1 引导流用 chat tab 完成**——不开独立 OnboardingView（v0.2 再分）
- **性能验收 P1-P8**（P5-P8 新增）——真 LLM 流式不卡 / markdown worker 渲染延迟 / spawn_blocking 隔离 / 启动 phase 1 < 500ms
- **App icon 选 Iconoir**（MIT，1.6k+ icons，写书主题贴合）——CHECKLIST §12 TODO-1 已决
- **v0.1 不上 CI（GitHub Actions）**——CHECKLIST §12 TODO-3 推荐方案，个人项目 CI 维护成本 > 收益
- **v0.1 不上 i18n / vitest**——CHECKLIST §12 TODO-4 / TODO-5 已决，v0.4+ 再做

---

## 跟 Locus 的关系

- 独立项目，**不是 fork**
- 复用栈（Tauri 2 + Vue 3 + Rust + bun），不复用代码
- **复用程度 = A 模式类似**：架构对齐（pinia + composables + services 三层分层 + 流式管道 + 持久化模式），代码独立
- 不做共享包 / 不直接搬 Locus 组件
- 视觉上保持深色主题一致，但强调色不同（PlotCraft 暖橙 / Locus 冷青）
- 跟 Locus 同级放在 `C:\Users\dd\Documents\` 旁边（在 `D:\Projects\` 下，不在 QxLocusProject/ 里）

---

**文档结束**。下一个 agent 拿到这个文件后，先看「Quick Start」和「v0.1 最小可交付」两节，再回头看其他节。
