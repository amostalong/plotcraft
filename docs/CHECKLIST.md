# PlotCraft v0.1 设计收尾清单

> **这份是 DESIGN.md 的"补丁包"**——把 DESIGN.md 里"提了但没收尾"的项钉死。
> 写完后 v0.1 第一个 PR 才有可执行的 check 项。
> **状态约定**：✅ 已决 / 🟡 推荐方案待审 / ⚠️ TODO（需要你拍板）。

---

## 1. v0.1 性能验收标准（从 DESIGN §"v0.1 最小可交付"补测量法）

| # | 指标 | 测量方法 | 阈值 | 测量时机 |
|---|------|----------|------|----------|
| P1 | 1000 token 流式渲染不掉帧 | Chrome DevTools Performance 录制跑 5 秒假流式，统计主线程 Long Task 数 | 主线程 block < 16ms/帧（即无 Long Task > 16ms） | v0.1 第二个 PR（流式管道完成时）|
| P2 | 启动到首屏 | PowerShell `Measure-Command { bun run tauri dev }` + 手动观察"窗口出现 → 首屏可交互"差值 | cold start < 1.5s（dev 模式） | v0.1 第一个 PR |
| P3 | 6 个 tab 切换 | DevTools Performance 标记点：click → next route fully loaded | < 100ms | v0.1 第一个 PR |
| P4 | 100MB 项目文件夹扫描 | 脚本造 100MB 项目（500 个 md + 1000 个 png），测扫描时间 + 主线程 block | 扫描期间主线程不出现 > 16ms 阻塞 | v0.1 第三个 PR（流式 scan 完成时）|

**测试工具**（手动测试用）：
- Chrome DevTools（内置）— Performance / Memory / Lighthouse
- `Measure-Command`（PowerShell 内置）— 启动时间
- **不**用 Lighthouse 评分（desktop app 没意义）

**为什么不做自动化 perf test**（v0.1 决策）：
- vitest + Playwright 在 Tauri 桌面 app 上 setup 复杂
- v0.1 数据量小（玩家项目一般 < 10MB），手动 smoke 足够
- v0.2+ 项目大了再考虑加 `@tauri-apps/cli test` 或 rust 端 criterion

---

## 2. App icon 选型 🟡

**搜索结论**（4 个候选，全部开源 / 可商用）：

| 候选 | License | 风格 | 适合 | 决策 |
|------|---------|------|------|------|
| **Iconoir** | MIT | 24x24 grid，线条简洁，1.6k+ icons | ✅ PlotCraft "书写"主题 | 🟡 推荐 |
| Lucide | ISC | 跟 Iconoir 几乎同风格，社区更大 | ✅ | 备选 |
| Phosphor | MIT | 6 种 weight（thin/light/regular/bold/fill/duotone）| ✅ 想做 duotone 风格可考虑 | 备选 |
| Tauri 官方 `app-icon.png` | CC-BY-NC-ND | Tauri 标志性 logo | ❌ **不可商用**，跳过 | 否 |

**🟡 推荐方案**：用 **Iconoir 的 `book-stack` 或 `quill` 风格**作为原型 + **加一个 P/C monogram**（暖橙 #f0a040 描边），自导出 5 个尺寸：
- `32x32.png` / `128x128.png` / `128x128@2x.png`（256x256）/ `icon.icns`（macOS，v0.2+ 才需要）/ `icon.ico`（Windows）

**生成方法**（v0.1 第一个 PR 时做）：
1. 选 SVG 源：`iconoir/icons/regular/book-stack.svg`（或 quill）
2. 用 Figma / Inkscape 加 "P/C" 文字（暖橙描边，深色背景）
3. 用 sharp / svgexport / Python PIL 批量导出 5 个尺寸
4. 存到 `src-tauri/icons/`

**或者更省事**（v0.1 dev 阶段）：
- 直接用 `book-stack.svg` 当源，PowerShell + .NET System.Drawing 缩放成 32/128/256 PNG
- `.ico` 用 ImageMagick 或 rsvg-convert 转换
- v0.2+ 再做正式 P/C monogram 替换

**TODO**：用户拍板用 Iconoir / Lucide / Phosphor 哪个 → 我去找具体 SVG 源

---

## 3. AI Prompt 模板（v0.1 + v0.2+ 草稿）

> DESIGN.md §LLM 驱动设计 已定 global system prompt，下面补 3 个具体场景的 prompt。

### 3.1 引导模式（onboarding）— 3-5 问 ✅

**问题序列**（v0.1 写死在 Rust 端）：

| Q# | 问题 | 类型 | 玩家回答 |
|----|------|------|----------|
| Q1 | 你想要什么 genre？ | 单选 | 奇幻 / 科幻 / 现代 / 架空历史 / 都市奇幻 / 其他 |
| Q2 | 故事发生在什么时代？ | 单选 | 远古 / 中世纪 / 近现代 / 未来 / 后启示录 / 自定义 |
| Q3 | 整体基调（tone）？ | 多选（≤2）| 黑暗 / 轻松 / 史诗 / 阴谋 / 治愈 / 黑色幽默 |
| Q4 | 主角是？ | 单选 | 凡人 / 有特殊能力 / 非人类 / 反派 / 群像 |
| Q5 | 故事核心冲突？ | 自由文本（≤ 200 字）| 玩家写 |

**Q1-Q4 prompt 模板**（Rust 端 `onboarding.rs`）：
```rust
// 每个问题一个函数，返回 (question_id, text, options?)
// 玩家回答后调 LLM 生成下一问或最终 prototype
fn q_genre() -> OnboardingQuestion {
    OnboardingQuestion {
        id: "genre",
        text: "你想要什么 genre？",
        options: vec!["奇幻", "科幻", "现代", "架空历史", "都市奇幻", "其他"],
        multi: false,
    }
}
```

**最终生成 prototype 的 prompt**（v0.1 stub，v0.2+ 调真 LLM）：
```
基于以下玩家回答：
- genre: {answer_Q1}
- era: {answer_Q2}
- tone: {answer_Q3}
- protagonist: {answer_Q4}
- core_conflict: {answer_Q5}

请生成最小 RPG / VN 原型（markdown 格式），文件结构：
1. README.md：项目标题 + 一句话简介 + genre/era/tone 元信息
2. world/overview.md：一句话世界观（≤ 200 字）
3. characters/protagonist.md：一句话主角（≤ 200 字）
4. plot/main-arc.md：三幕骨架（起 / 承 / 转 / 合 各 ≤ 100 字）

约束：玩家主导，AI 辅助。AI 给建议，玩家最终改。
```

### 3.2 共创模式（alternatives）— 3-5 备选 ✅

**调用时机**：玩家在 view 内选中文字 / 空字段 → 点 "AI 补" 按钮

**Prompt 模板**（前端组装 → Tauri command 透传）：
```
你是 PlotCraft 的 AI 编剧搭档。

玩家当前上下文：
- 文件: {current_file_path}
- 选中/光标位置: {field_name}
- 当前内容: "{current_field_content 或空}"

玩家想要：给这个字段生成 3-5 个备选方案。

要求：
- 每个备选 ≤ 100 字
- 风格贴合项目 tone ({project_tone})
- 彼此差异化（玩家要挑，不能都差不多）
- 输出 JSON: ["备选1", "备选2", "备选3", ...]
- 不要解释、不要 markdown
```

**返回处理**（前端 `AlternativesPicker.vue`）：
- 3-5 个卡片横排
- 玩家点选 → 写入文件
- 玩家点 "全部不要，自己写" → 关闭 picker
- 玩家点 "重新生成" → 重新调 LLM

### 3.3 对话模式（chat）— v0.1 stub + v0.2+ 真流式 ✅

**Message 结构**（OpenAI chat format）：
```typescript
type ChatMessage = 
  | { role: 'system'; content: string }  // global system prompt（含 project 状态）
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
```

**Context 准备**（前端 `lib/llm.ts`）：
- system prompt 包含：DESIGN.md §Context 策略 的全局 system prompt
- user message 包含：玩家当前操作（"在 {file} 选中 {field} 区域，输入：{user_msg}"）
- assistant history：最近 3-5 轮

**Context 长度控制**（v0.1）：
- 单 call ≤ 8k token
- 超出 → **前端截断**：超长文件只发头 2000 字符 + "..." 提示
- 截断发生在前端 lib/llm.ts，后端无感

---

## 4. 错误处理约定 ✅

**Rust 端**（`src-tauri/src/error.rs`）：

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    
    #[error("Project not found: {0}")]
    ProjectNotFound(String),
    
    #[error("Project frontmatter invalid: {0}")]
    FrontmatterInvalid(String),
    
    #[error("Config error: {0}")]
    Config(String),
    
    #[error("LLM error: {0}")]
    Llm(String),
    
    #[error("LLM context too long: {used} > {max} tokens")]
    ContextTooLong { used: usize, max: usize },
    
    #[error("Cancelled by user")]
    Cancelled,
}

// 转换为 Tauri 返回值
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::Serializer {
        serializer.serialize_str(&self.to_string())
    }
}
```

**Tauri command 返回类型**：`Result<T, AppError>`（不 return String 错误，类型化）

**前端**（`src/lib/error.ts`）：
- 统一 `handleError(err: unknown): void`
- LLM 错误 → toast + 重试按钮
- IO 错误 → toast + 详情
- Cancelled → silent
- FrontmatterInvalid → 弹 modal 提示玩家修复

**反卡顿**：错误不通过 `app.emit("error", ...)` 推流式（错误是离散事件，toast 即可）

---

## 5. 配置管理细节 ✅

**写入策略**：
- **不**用 atomic write（写临时文件 + rename）— v0.1 简化
- 直接 `tokio::fs::write` 整个 `config.json`（文件 ≤ 1KB，无所谓）
- 写失败 → 保留旧 config 不动，错误 toast 提示

**Schema 校验**（v0.1 简化）：
- **不**用 zod / ts-pattern 之类的 schema 库（v0.1 配置字段就 4-5 个）
- 手写一个 `validate_config(raw: &serde_json::Value) -> Result<Config, AppError>`
- 缺字段 → 补默认值
- 类型错 → 报错，玩家手动修

**变更通知**（settings 改完立即同步）：
- 改完直接 `invoke("update_config", { patch })` → Rust 端合并 + 写盘
- 前端用 `shallowRef` 包 config，避免每次 patch 触发全树 reactivity
- 不做 debounce（settings 改的不频繁）

**位置**：`%APPDATA%/PlotCraft/config.json`（DESIGN 已定 ✅）
- Windows: `C:\Users\<user>\AppData\Roaming\PlotCraft\config.json`
- Tauri 用 `app_config_dir()` 拿（自动跨平台）

---

## 6. 启动分阶段（具体到代码）✅

**phase 1：< 500ms 目标**（窗口显示 + 首屏可交互）
- `main.ts` 同步执行：createApp + pinia + router 注册
- `App.vue` mount：渲染空 shell（tab 栏 + 当前 view 的占位）
- `index.html` 静态 HTML 已经包含 #app + bootstrap CSS
- **不**做：在 mount 之前 await 任何东西

**phase 2：异步 init（窗口已显示）**
- 加载 config（`%APPDATA%/PlotCraft/config.json`）— 失败用默认 config
- 初始化 mock AI stub 状态
- 预热 Lucide icon tree-shaking（Vite 已做，仅首次）
- 预热 markdown 渲染器

**phase 3：project 打开时（v0.2+ 才优化）**
- 项目文件夹扫描预热
- session 历史预读

**实施细节**（v0.1 第一个 PR）：
- `main.ts` 里 `app.mount('#app')` 之前不 await
- `app.mount` 之后再 `app.config.globalProperties.$initPhase2()`
- phase 2 内的失败都**不**阻塞 UI

**测量 P2 验收**：用 `performance.now()` 在 main.ts 头部和 `app.mount` 后打点

---

## 7. 项目文件夹容错 ✅

**v0.1 策略**：

| 异常 | 处理 | 玩家 UX |
|------|------|---------|
| 项目文件夹不存在 | 报错，要求重选 | toast "项目文件夹不存在" |
| `README.md` 缺失 | 视为"未初始化项目"，自动建一个最小 README | 静默 |
| `README.md` frontmatter 损坏 | 弹 modal 展示损坏内容，让玩家修 | 阻塞进入，modal 引导 |
| 单个 .md 文件 frontmatter 损坏 | 跳过该文件，标记为"损坏"，在概览 tab 提示 | 标记 + 可点击修复 |
| `relationships.json` JSON 错 | 同上，标记损坏 | 标记 + 可点击修复 |
| 子目录缺失（如 `world/` 没建） | 自动建空目录，提示玩家"首次使用项目" | 静默 |
| 文件权限错 | 报错 | toast "无权限访问" |

**v0.1 不做**：
- 自动修复 frontmatter（玩家主导，AI 不擅自改）
- 文件 watcher / 自动 reload
- 项目文件夹版本迁移

---

## 8. Commit / Branch 规范 ✅

**Commit message**（沿用 Locus 风格，conventional commits）：
```
<type>(<scope>): <subject>

<body>

<footer>
```

**type**：`feat` / `fix` / `docs` / `refactor` / `style` / `test` / `chore` / `perf`
**scope**（PlotCraft 专属）：
- `editor` — Monaco（v0.2+）
- `chat` — 会话 tab
- `project` — 项目文件夹 IO
- `ai` / `llm` — AI 集成
- `ui` / `tab` — view 通用
- `infra` — 构建 / 依赖 / CI
- `docs` — 文档

**subject**：中文 ≤ 30 字，第一行不结尾句号

**Branch**（沿用 GitFlow 简化版）：
- `main` — 永远可发布
- `feat/*` / `fix/*` / `refactor/*` — 功能开发
- 不用 `develop` 分支（个人项目，单线 main 即可）
- PR → main，**不** squash merge（保留 commit 历史）

**示例**：
```
feat(project): 新建项目流 4 个 starter md

- create_project 命令落 README.md + world/overview.md + characters/protagonist.md + plot/main-arc.md
- frontmatter 模板写在 commands/project.rs
- 错误用 AppError::Io 包装

🤖 Generated with [Claude Code]
```

---

## 9. README.md 纲要 ✅

**根目录 `README.md` 内容**（v0.1 第一个 PR 时写）：
1. **项目一句话**：PlotCraft = RPG/VN 创作者的 AI 编剧搭档
2. **Quick Start**：链接到 docs/CHECKLIST.md + 跑 `bun run tauri dev`
3. **跟 Locus 的关系**：同栈 / 不同定位 / 不共享代码
4. **架构图**：pinia + composables + services 三层 + Rust backend
5. **v0.1 路线图**：6 tab + 流式管道 + AI stub
6. **License**：MIT（个人项目，标准）
7. **设计文档**：`docs/DESIGN.md` 链接

---

## 10. Manual Smoke Test 流程（v0.1 不写单测）✅

**v0.1 release 前必跑**（写进 PR checklist）：

```
□ bun install 干净环境下能装
□ bun run typecheck 0 error
□ cd src-tauri && cargo check 0 error
□ bun run tauri dev 能起窗口
□ 窗口内能看到 6 个 tab，切换流畅（< 100ms / P3）
□ Settings tab 能改 API key + endpoint + model
□ 新建项目流：选文件夹 → AI 引导 3-5 问 → 落 4 个 starter md
□ 假流式管道：会话 tab 发消息，100ms 一 chunk 推完（验证 P1）
□ 概览 tab 显示最近 5 个修改的文件（mtime 排序）
□ 6 tab placeholder 都正常显示
□ 启动 < 1.5s（验证 P2）
□ 关闭窗口进程干净退出（无残留 cargo / bun process）
```

**macOS / Linux 适配**（v0.3+ 才考虑，v0.1 不测）

---

## 11. 第一个 PR 拆 commit 粒度（建议）🟡

按 DESIGN.md §"v0.1 最小可交付" + 反卡顿基础设施，建议拆成 **5 个独立可编译 commit**：

| # | Commit | 内容 | 验证 |
|---|--------|------|------|
| 1 | `chore: 初始 Tauri 2 + Vue 3 + bun 骨架` | package.json / Cargo.toml / vite.config / tauri.conf.json / capabilities / icons / .gitignore / 6 个 view placeholder / 根 README | `bun run tauri dev` 起窗口，6 tab 可切 |
| 2 | `feat(project): create_project / list_projects + ai_stub 流式管道` | commands/project.rs + commands/system.rs + commands/ai_stub.rs + lib.rs 注册 + 假流式端到端 | `bun run typecheck` + 假流式能在 SessionView 渲染 |
| 3 | `feat(infra): 启动分阶段 + 性能基线` | main.ts 分阶段 + performance.now 打点 + P2 验收 | 启动 < 1.5s（测量）|
| 4 | `feat(ui): Settings tab + config.json 读写` | SettingsView + commands/settings.rs + 4-5 个 setting 字段 | 改完写盘 + 重启加载 |
| 5 | `docs: 写根 AGENTS.md` | AGENTS.md（基于 CHECKLIST.md） | 下一个 agent 接手能 build |

> **不一定按这个拆**——也可以一次 commit 全做（如果用户喜欢 atomic PR）。
> 🟡 等待你拍板

---

## 12. 未决 TODO 列表 ⚠️

需要你拍板的项（按优先级）：

1. **TODO-1：App icon 选哪个开源库**（§2）
   - A. Iconoir（推荐，MIT，1.6k+）
   - B. Lucide（ISC，DESIGN 已用 lucide-vue-next）
   - C. Phosphor（MIT，6 种 weight）
   - D. 我有别的想法

2. **TODO-2：第一个 PR 拆粒度**（§11）
   - A. 5 个 commit（推荐）
   - B. 1 个 atomic commit
   - C. 别的拆法

3. **TODO-3：CI 是否上**（v0.1 决策）
   - A. **不**上 CI（v0.1 个人项目，手动 cargo check + typecheck）
   - B. 上 GitHub Actions（typecheck + cargo check + smoke test）
   - 倾向 A——个人项目，CI 维护成本 > 收益

4. ~~**TODO-4：i18n 时机**~~ ✅ **已决（2026-07-28）**
   - **v0.1 不上** `vue-i18n`，全中文 + 关键术语英文硬编码
   - v0.2+ 出海 / 有海外玩家再加 `vue-i18n`（zh-CN + en 两套），写进 DESIGN §"v0.2+ 方向"

5. ~~**TODO-5：测试**~~ ✅ **已决（2026-07-28）**
   - **v0.1 不上** `vitest`，靠 manual smoke test 11 项（§10）
   - v0.2+ chat reducer 复杂了 / bug 多了再上 `vitest` 覆盖 reducer + llm client + 工具函数，写进 DESIGN §"v0.2+ 方向"

---

## 13. 决策记录（追加到 DESIGN.md 之前先列这）

下面这些是这次 CHECKLIST 新增的决策，**v0.1 启动时**会一起回写到 DESIGN.md §"决策记录"末尾：

- **App icon 走开源 SVG + 自导出 5 尺寸**（不复制 Locus icons）
- **第一个 PR 拆 5 commit / 1 commit**（TODO-2 待定）
- **错误处理统一用 thiserror + AppError enum**，前端 handleError 统一入口
- **配置写入直接覆盖，不 atomic write**（文件小，无所谓）
- **手动 smoke test 11 项** 进 PR checklist
- **项目文件夹容错：frontmatter 损坏弹 modal**，AI 不擅自修复
- **性能 P1-P4 + 测量方法** 是 v0.1 release 硬门槛
- **v0.1 不上 i18n**（vue-i18n），全中文硬编码；v0.2+ 出海再加 → DESIGN §"v0.2+ 方向"
- **v0.1 不上 vitest**，靠 manual smoke；v0.2+ reducer 复杂了再加 → DESIGN §"v0.2+ 方向"

---

**CHECKLIST 结束**。v0.1 启动前需要你审完 §12 TODO 列表 5 项。
