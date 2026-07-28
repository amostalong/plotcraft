# AGENTS.md — PlotCraft

> 给 AI agent（和未来自己）的项目导览。读完这一份，应该能上手、知道边界、不踩老坑。
>
> 跟 Locus 关系：**同栈不同品**，参考设计思想，不复用代码。Locus 仓库在 `C:\Users\dd\Documents\QxLocusProject\Locus`，只读 reference，不 import。

---

## 1. 项目一句话

PlotCraft = 给独立 / 业余 RPG / VN 创作者的 **AI 编剧搭档** 桌面工具（Tauri 2 + Vue 3 + Rust + bun）。

**玩家主导，AI 辅助**：AI 给 3-5 个备选，玩家挑+改，AI 永不自动覆盖玩家内容。

---

## 2. v0.1 状态（2026-07-28 启动）

| 维度 | 状态 |
|------|------|
| Chat tab（SessionView，驱动 LLM 流式）| ✅ **实装** |
| Setting tab（SettingsView，API key / endpoint / model）| ✅ **实装** |
| 6 tab 框架（vue-router，概览/世界/人物/剧情/设定图/会话/设置）| ✅ **实装** |
| 4 个非 v0.1 tab（概览/世界/人物/剧情/设定图）| 🟡 Placeholder（"v0.2 实装"）|
| 新建项目流（4 个 starter md）| ✅ **实装** |
| LLM 客户端（OpenAI 兼容流式）| ✅ **实装** |
| 反卡顿基础设施（spawn_blocking + mpsc + 16ms emit 节流）| ✅ **实装** |
| Markdown 渲染（marked + DOMPurify，主线程同步）| ✅ **实装** |
| 启动分阶段（phase 1 < 500ms）| ✅ **实装** |
| 性能验收 P1-P8 | ✅ **实装**（手动测量，详见 CHECKLIST §1）|
| AI stub / 假流式 | ❌ 取消（v0.1 直接接真 LLM，用户决策）|
| 关系图 / 图片生成 / 多 provider | ❌ 推到 v0.2+ |

完整路线 → `docs/ROADMAP.md`。设计意图 → `docs/DESIGN.md`。v0.1 启动清单 → `docs/CHECKLIST.md`。

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
│   ├── App.vue            ← 7-tab 框架
│   ├── style.css
│   ├── lib/               ← 纯函数 wrapper（LLM / settings / project / markdown）
│   ├── stores/            ← pinia stores（chat / project / settings）
│   ├── composables/       ← useStreamReducer 等
│   ├── views/             ← 7 个 view（SessionView/SettingsView 实装，5 个 placeholder）
│   ├── router/            ← vue-router 配置
│   └── types/             ← TS 类型（chat.ts 等）
└── src-tauri/             ← Rust 后端
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/      ← Tauri 2 permission 配置
    └── src/
        ├── main.rs / lib.rs
        ├── error.rs       ← thiserror + AppError enum
        ├── commands/      ← Tauri command 入口（llm / project / settings）
        ├── llm/           ← LLM client（config / streaming / types）
        └── project/       ← 项目文件夹 IO + 4 个 starter md 模板
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
6. **v0.1 不上**：vue-i18n、vitest、CI、macOS/Linux、multi-provider、multiplayer。决策记录在 `CHECKLIST §12`。
7. **frontmatter `created_at` / `updated_at` 是 `TODO` 占位**（不加 chrono 依赖，玩家手动填）。等上 chrono 时再做 ISO 8601 解析。
8. **chat store init 绑在 SessionView 生命周期上**。离开 SessionView → `teardown()` 解绑 listener。重新进 → `init()` 重绑。**已知边界**：流中切走 + 切回之间的事件会丢（v0.2+ 改成 app-level init）。

---

## 8. v0.2+ 推到后面

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
| 6 tab 路由定义 | `src/router/index.ts` |
| Tab UI 渲染 | `src/App.vue` |
| Chat 流式管道 | `src-tauri/src/llm/streaming.rs` + `src/lib/llm.ts` |
| Chat state 状态机 | `src/composables/useStreamReducer.ts` |
| Chat store（init/teardown）| `src/stores/chat.ts` |
| LLM 系统 prompt | `src/stores/chat.ts` 顶部 `SYSTEM_PROMPT` |
| 新建项目流 | `src-tauri/src/commands/project.rs` + `src-tauri/src/project/templates.rs` |
| 4 个 starter md 模板 | `src-tauri/src/project/templates.rs` |
| config.json schema | `src/lib/settings.ts`（前端） + `src-tauri/src/llm/config.rs`（后端）|
| AppError 枚举 | `src-tauri/src/error.rs` |
| 性能验收指标 P1-P8 | `docs/CHECKLIST.md §1` + `docs/CHAT_LLM_DESIGN.md §4` |
| 启动分阶段实现 | `src/main.ts` |
| 项目数据模型（9 大类）| `docs/CHAT_LLM_DESIGN.md §5.1` |

---

## 11. PowerShell 5.1 已知坑（提交时记住）

- `git commit -m "..."` 内部带 `"` 会截断 token 当 pathspec。**改用 `git commit -F <file>`** 或 subject 改单引号 + 内部 `"` 改 `'`。
- `git stash drop stash@{0}` 单引号包裹（`@{0}` 会被当 hashtable 语法）。
- `rm -rf` / `Remove-Item` 在本环境下被安全策略拦 → 用 `mavis-trash <path>`。
- bash 命令在 PowerShell 里行为差，**先**用 PowerShell cmdlet，**必须**用 bash 时切换到 `node` / `python`。

---

**AGENTS.md 结束**。改这一份前先看 `docs/CHECKLIST.md §13 决策记录`。
