# PlotCraft

> **面向独立 / 业余 RPG / VN 创作者的 AI 协作桌面工具** —— AI 帮玩家把脑子里的**世界、人物、剧情**落到一个**结构化的、可读可改可 git 的文件夹**里。

类比定位：**Locus** ≈ "Unity 开发的 AI 同事"，**PlotCraft** ≈ "RPG 设定工作的 AI 编剧搭档"。

---

## 跟 Locus 的关系

| 项 | 关系 |
|---|------|
| 栈 | **同栈**（Tauri 2 + Vue 3 + Rust + bun）|
| 代码 | **不复用**（独立项目，零代码共享）|
| 定位 | **不同**（Locus = Unity 开发工具 / PlotCraft = 编剧搭档）|
| 视觉 | 同款深色主题，强调色不同（Locus 冷青 / PlotCraft 暖橙 #f0a040）|
| dev 端口 | PlotCraft 14201 / Locus 14901（可同时跑两边）|
| 经验复用 | 学 Locus 架构（pinia + composables + services + 流式 + 持久化），避开它的过度工程（view runtime / 35 字段 state / 多窗口）|

详见 [docs/DESIGN.md §"跟 Locus 的关系"](./docs/DESIGN.md#跟-locus-的关系) 和 [§"Locus 实地考察"](./docs/DESIGN.md#locus-实地考察带批判--4-文件--agentsmd)。

---

## v0.1 范围

**6 个 tab**：概览 / 世界 / 人物 / 剧情 / 设定图 / 会话

**核心交互**：
- 新建项目流：选文件夹 → AI 引导 3-5 问 → 生成最小原型（一句话世界 + 主角 + 三幕骨架）
- 共创模式：每个 view 有 "AI 补" 按钮，AI 给 3-5 备选，玩家挑 + 自由改（**永远不自动覆盖玩家内容**）
- BYO API key（OpenAI 兼容端点），存 `%APPDATA%/PlotCraft/config.json`

**反卡顿从第一行起**：
- 所有 Tauri commands `async fn`
- `mimalloc` 全局 allocator
- 长操作走 Tauri event 流式
- identity-stable array 模式（学 Locus `useStreamReducer.ts:410`）
- `shallowRef` 包大对象
- 启动分阶段（phase 1 < 500ms / cold start < 1.5s）

详细见 [docs/DESIGN.md](./docs/DESIGN.md)。

---

## Quick Start

> ⚠️ **当前为设计阶段**（0 代码）。完整 v0.1 启动步骤见 [docs/CHECKLIST.md §11](./docs/CHECKLIST.md#11-第一个-pr-拆-commit-粒度建议)。

```bash
# 1. 装依赖（v0.1 第一个 PR 之后才能跑）
bun install

# 2. 类型检查
bun run typecheck

# 3. Rust 端检查
cd src-tauri && cargo check

# 4. 起 dev（窗口 + 6 tab 可切）
cd .. && bun run tauri dev
```

**环境要求**：
- Windows 10/11（v0.1 仅 Windows）
- Rust 1.82+ / `cargo`
- Bun 1.1+
- WebView2 runtime（Win11 自带 / Win10 需装）
- MSVC build tools

---

## 架构

```
┌────────────────────────────────────────────────────────────┐
│ Frontend (Vue 3 + Vite + TypeScript)                       │
│ ┌──────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│ │ views/   │←→│  components/  │←→│ composables/        │   │
│ │ 6 tabs   │  │  共享 UI      │  │ useStreamReducer    │   │
│ └──────────┘  └──────────────┘  └─────────────────────┘   │
│       ↑                              ↑                     │
│ ┌──────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│ │ stores/  │←→│  services/   │←→│ lib/                │   │
│ │ pinia    │  │  业务规则    │  │ tauri invoke + event │   │
│ └──────────┘  └──────────────┘  └─────────────────────┘   │
└──────────────────────────┬─────────────────────────────────┘
                           │ Tauri IPC (invoke + event)
┌──────────────────────────┴─────────────────────────────────┐
│ Backend (Rust + Tauri 2)                                   │
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│ │ commands/    │  │ project/     │  │ llm/             │  │
│ │ Tauri cmds   │  │ 文件夹 IO    │  │ OpenAI 兼容客户端 │  │
│ └──────────────┘  └──────────────┘  └──────────────────┘  │
│ + mimalloc / tokio::fs / thiserror / 流式 event emit       │
└────────────────────────────────────────────────────────────┘
```

数据流原则：**长操作不 return 完整结果**，走 `app.emit("xxx:chunk", ...)` 事件流。

---

## 项目结构（v0.1 计划）

```
PlotCraft/
├── docs/
│   ├── DESIGN.md          # 完整设计文档（v0.1 已写完）
│   └── CHECKLIST.md       # 设计收尾清单（v0.1 启动前必审）
├── package.json           # 前端依赖 + bun scripts
├── vite.config.ts         # dev 端口 14201
├── tsconfig*.json
├── index.html
├── AGENTS.md              # 项目自己的 AGENTS（v0.1 第一个 PR 后由下一个 agent 维护）
├── src/                   # Vue 3 前端
│   ├── main.ts / App.vue / style.css
│   ├── router/ views/ components/ stores/ composables/ lib/ types/ assets/
└── src-tauri/             # Rust 后端
    ├── src/
    │   ├── main.rs / lib.rs / error.rs
    │   ├── commands/ (project.rs / system.rs / ai_stub.rs / settings.rs)
    │   ├── project/ ai/ settings/
    ├── capabilities/default.json
    ├── icons/             # 5 个必需尺寸
    ├── Cargo.toml / tauri.conf.json / build.rs
```

详细见 [docs/DESIGN.md §"仓库结构"](./docs/DESIGN.md#仓库结构)。

---

## 文档索引

- **[docs/DESIGN.md](./docs/DESIGN.md)** — v0.1 完整设计（目标 / 范围 / 技术栈 / 架构 / LLM 驱动 / 决策记录）
- **[docs/CHECKLIST.md](./docs/CHECKLIST.md)** — v0.1 启动前的设计收尾清单（性能验收 / App icon / AI prompt / 错误约定 / 启动分阶段 / 容错 / commit 规范 / TODO 列表）

---

## License

MIT（个人项目，标准开源协议）

---

## 决策原则

- **玩家主导，AI 辅助** — AI 给建议，玩家挑 + 改，AI 永远不自动覆盖玩家内容
- **反卡顿从第一行起** — 不学 Locus 的 35 字段 state / view runtime / 同步 IO
- **不 over-abstract** — 项目 = 文件夹，不分多级根；6 个静态 view，不上动态 SFC runtime
- **可读可改可 git** — 输出文件夹 = markdown + JSON + 占位图，玩家可用任何编辑器改
