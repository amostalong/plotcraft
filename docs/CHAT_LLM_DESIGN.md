# PlotCraft v0.1 Chat LLM 专项设计

> **目的**：v0.1 接入 chat 驱动 LLM，仿 Locus 但解决 Locus 的卡顿源。
> **范围**：6 tab 框架 + Chat 实装 + Setting 实装 + 4 tab placeholder + 反卡顿基础设施。
> **关联**：[DESIGN.md](./DESIGN.md)（总设计）· [CHECKLIST.md](./CHECKLIST.md)（v0.1 启动清单）· [ROADMAP.md](./ROADMAP.md)（版本时间线）

---

## 1. v0.1 范围（重切）

| 项 | v0.1 状态 |
|---|---|
| Tauri 2 + Vue 3 + bun 骨架 | ✅ 实装 |
| 6 tab 路由（vue-router）| ✅ 实装 |
| **Chat tab（SessionView）** | ✅ **实装**（驱动 LLM）|
| **Setting tab（SettingsView）**| ✅ **实装**（API key / endpoint / model）|
| Overview / World / Characters / Plot / Concept Art tab | 🟡 Placeholder（"v0.2 实装"占位）|
| `create_project` / `list_projects` 命令 | ✅ 实装（落 4 个 starter md）|
| LLM client（OpenAI 兼容）| ✅ 实装 |
| 假流式管道（v0.1 设计稿里是 stub）| ❌ 取消——v0.1 直接接真 LLM |
| 反卡顿基础设施（mimalloc / spawn_blocking / 节流 / markdown worker）| ✅ 实装 |
| 启动分阶段（phase 1 < 500ms）| ✅ 实装 |
| 性能验收 P1-P4 | ✅ 实装 |
| 关系图 / 图片生成 / 真实 AI 集成 | ❌ 推到 v0.2+ |

**为什么 v0.1 直接接真 LLM，不做 AI stub**：用户决策（2026-07-28）。"自用先行"节奏下，stub 验证管道没真实价值——真实端到端用一次就知道 stub 的局限。

---

## 2. Locus 实地考察：4 个具体卡顿源

参考 Locus 仓库（`C:\Users\dd\Documents\QxLocusProject\Locus`）的实际代码。

### 2.1 后端 SSE chunk 解析没 `spawn_blocking`

**文件**：`src-tauri/src/llm/chat_completions.rs:205-244`

```rust
// Locus 实际做法：所有 SSE + JSON 解析在 tokio runtime 默认线程池
let mut stream = response.bytes_stream();
let mut buffer = String::new();
while let Some(chunk) = stream.next().await {
    let chunk_text = String::from_utf8_lossy(&chunk);
    buffer.push_str(&chunk_text);
    if drain_sse_buffer(&mut buffer, false, debug, &mut state, ...)? {  // ← CPU 密集
        ...
    }
}
```

**问题**：
- `drain_sse_buffer` 是同步 CPU 密集（SSE 状态机 + JSON 解析 + thinking tag 过滤）
- 在 tokio runtime 默认线程池上跑，**会跟别的 async task 抢线程**
- 当 chat 流式 + 文件 IO + UI event 同时进行 → runtime 抖动

**验证**：Locus 代码全文搜 `spawn_blocking` 在 `llm/` 下出现 0 次（仅出现在 `unity_docs.rs` / `ref_graph.rs` 等非 LLM 模块）。

### 2.2 后端 emit Tauri event 同步串行

**文件**：`src-tauri/src/llm/chat_completions.rs:50-58, 226-231`

```rust
// Locus：on_text_delta 闭包同步 emit
let mut response = ...;
while let Some(chunk) = response.stream.next().await {
    match chunk {
        LanguageModelStreamChunkType::Text(delta) => {
            on_delta(delta);  // ← 同步 emit Tauri event，不节流
        }
        ...
    }
}
```

**问题**：
- 1K token/秒 = 1000 次 `app.emit("chat:chunk", ...)` / 秒
- 每次 emit 都要跨 IPC 边界（Rust → JS via wry）
- **没有节流 / batching**

### 2.3 前端 useStreamReducer 主线程跑 35k 状态

**文件**：`src/composables/useStreamReducer.ts:1-450`（Locus 这文件 35k，DESIGN.md §"Locus 实地考察" 已记录 410-414 行 identity-stable array 核心）

**问题**：
- 整个 chunk state machine（text delta / code block start / thinking / tool calls / questions / todos / undo / compact）在主线程跑
- 35+ mutation type，每 chunk 触发一部分 reactivity
- 即便有 identity-stable array 保护 `parts` 数组，**state 自身 35 字段**还是每 chunk 过一遍 reactive 系统

**用户原话**（2026-07-28）："Locus 也有自己问题，比如没有考虑 work 线程去降低压力"

### 2.4 前端 markdown 渲染 Locus 用了 worker ✅

**文件**：`src/workers/markdown.worker.ts` + `src/services/markdownWorkerClient.ts` + `src/components/ui/WorkerMarkdownRenderer.vue`

**Locus 模式**（学习）：
- 走 `postMessage` RPC：`{ id, op: 'render', content, hash }` / `{ id, html, elapsed } | { id, error }`
- 客户端 AbortSignal cancel（worker 总是跑完，client 丢弃）
- 用 Vite `?raw` 注入 lute.min.js（PlotCraft 不用 lute，用 `marked` + `dompurify`，更轻）

---

## 3. PlotCraft 反制：4 条核心措施

### 反制 1：后端 SSE 解析走 `spawn_blocking`

```rust
// src-tauri/src/llm/streaming.rs（v0.1 简化版）
use tokio::task::spawn_blocking;

pub async fn stream_chat(
    api_key: String,
    model: String,
    base_url: String,
    messages: Vec<serde_json::Value>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    // 1. 拿 reqwest stream（async 拿，不阻塞）
    let mut stream = build_chat_stream(api_key, model, base_url, messages).await?;
    
    // 2. 解析 + emit 拆两条 task
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(64);
    let app_clone = app.clone();
    
    // 解析 task 跑 spawn_blocking（CPU 密集）
    let parse_handle = tokio::spawn(async move {
        let mut buffer = String::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("stream error: {}", e))?;
            // 把 bytes 转成 String + 解析 SSE → 都丢 spawn_blocking
            let parsed = tokio::task::spawn_blocking(move || {
                let text = String::from_utf8_lossy(&chunk).into_owned();
                parse_sse_chunk(&text)  // 返回 Vec<String> 多 delta
            }).await
            .map_err(|e| format!("spawn_blocking join: {}", e))??;
            for delta in parsed {
                if tx.send(delta).await.is_err() {
                    return Ok::<(), String>(());
                }
            }
        }
        Ok(())
    });
    
    // emit task 跑独立 async（16ms 节流）
    tokio::spawn(async move {
        let mut batch = String::new();
        let mut last_emit = std::time::Instant::now();
        while let Some(delta) = rx.recv().await {
            batch.push_str(&delta);
            // 节流：16ms 内或 batch 够大才 emit
            if last_emit.elapsed() >= std::time::Duration::from_millis(16) 
                || batch.len() >= 256 {
                let _ = app_clone.emit("chat:chunk", &ChatChunkPayload { text: batch.clone() });
                batch.clear();
                last_emit = std::time::Instant::now();
            }
        }
        // flush 剩余
        if !batch.is_empty() {
            let _ = app_clone.emit("chat:chunk", &ChatChunkPayload { text: batch });
        }
        let _ = app_clone.emit("chat:done", &ChatDonePayload { usage: None });
    });
    
    parse_handle.await.map_err(|e| e.to_string())??;
    Ok(String::new())
}
```

**关键**：
- `spawn_blocking` 隔离 SSE 状态机 + JSON 解析的 CPU 压力
- `mpsc::channel` 解耦 parse 和 emit
- 16ms 节流 emit（60 fps），batch ≤ 256 字符
- 不用 `on_text_delta` 闭包，改成 explicit channel

### 反制 2：前端 chat state 砍到 ≤ 8 字段

```typescript
// src/composables/useStreamReducer.ts（v0.1 简化版）
type ChatState = {
  sessionId: string | null;     // 当前 session
  status: 'idle' | 'streaming' | 'error' | 'cancelled';
  messages: ChatMessage[];       // 历史（user / assistant，shallowRef）
  currentText: string;           // 正在 stream 的 assistant 文本（shallowRef）
  error: string | null;          // 错误信息
  runId: string | null;          // 当前 run 标识（abort 用）
}

type StreamMutation =
  | { type: 'start'; sessionId; runId }
  | { type: 'appendChunk'; runId; text }   // ← 关键：只 append currentText，不动数组
  | { type: 'complete'; runId; usage? }
  | { type: 'fail'; runId; error }
  | { type: 'cancel'; runId }
  | { type: 'addUserMessage'; message: ChatMessage }
  | { type: 'loadSession'; messages: ChatMessage[] }
  | { type: 'clearSession' }
```

**vs Locus（35+ 字段、35+ mutation）**：
- ❌ 不要 `thinking` 分离（v0.1 简单，v0.2+ 再分）
- ❌ 不要 `tool calls`（v0.2+ 再加）
- ❌ 不要 `questions` / `todos` / `undo` / `compact`（v0.2+ 再加）
- ✅ 保留 `appendChunk` 关键 trick：text delta 只 append 到 `currentText`，**不动 `messages` 数组引用**（学 Locus 410-414）

**shallowRef 包 `messages` 和 `currentText`**：
```typescript
const state = shallowRef<ChatState>(initialState)
function reduce(mutation: StreamMutation) {
  state.value = { ...state.value, /* 只触碰必要字段 */ }
}
```

### 反制 3：markdown 渲染走 worker（学 Locus 简化）

```typescript
// src/workers/markdown.worker.ts
import { marked } from 'marked'
import DOMPurify from 'dompurify'

interface RenderRequest { id: string; runId: string; md: string }
interface RenderResponse { id: string; runId: string; html: string; elapsed: number }
interface RenderError { id: string; runId: string; error: string }

// 协议：主线程 → worker
self.onmessage = (e: MessageEvent<RenderRequest>) => {
  const { id, runId, md } = e.data
  const start = performance.now()
  try {
    const dirty = marked.parse(md, { gfm: true, breaks: true })
    const clean = DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true } })
    const response: RenderResponse = { id, runId, html: clean, elapsed: performance.now() - start }
    ;(self as any).postMessage(response)
  } catch (err) {
    const error: RenderError = { id, runId, error: String(err) }
    ;(self as any).postMessage(error)
  }
}
```

**主线程客户端**（`src/lib/markdownWorkerClient.ts`）：
```typescript
const pending = new Map<string, (html: string) => void>()
let nextId = 0

export function renderMarkdown(runId: string, md: string): Promise<string> {
  return new Promise((resolve) => {
    const id = `${runId}:${nextId++}`
    pending.set(id, resolve)
    worker.postMessage({ id, runId, md })
  })
}

worker.onmessage = (e: MessageEvent<RenderResponse | RenderError>) => {
  const cb = pending.get(e.data.id)
  if (cb) {
    if ('html' in e.data) cb(e.data.html)
    pending.delete(e.data.id)
  }
}
```

**v0.1 简化**：
- 用 `marked` + `dompurify`（DESIGN 已定），不用 lute（Locus 用 lute 因为有更复杂需求）
- 不做节流 / batch（v0.1 数据量小，v0.2+ 多个 message 同时 render 再上 batch）
- 不用 AbortSignal cancel（Locus 那种"worker 跑完 client 丢弃"模式 PlotCraft v0.1 用不到）

### 反制 4：启动分阶段

```typescript
// src/main.ts
const t0 = performance.now()

// phase 1: 同步 mount UI（< 500ms 目标）
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

const t1 = performance.now()
console.log(`[phase1] mount: ${t1 - t0}ms`)

// phase 2: 异步 init（不阻塞 UI）
;(async () => {
  const { initConfig } = await import('./lib/config')
  await initConfig()
  
  const { initLLMClient } = await import('./lib/llm')
  await initLLMClient()
  
  const t2 = performance.now()
  console.log(`[phase2] init: ${t2 - t1}ms`)
})()
```

**关键**：
- `app.mount` 之前不 await
- phase 2 用 dynamic import 拆 chunk
- 任何 phase 2 失败都不阻塞 UI（用默认 fallback）

---

## 4. 6 tab 框架（v0.1 实装 vs placeholder）

| Tab | v0.1 状态 | 内容 |
|---|---|---|
| 概览 (Overview) | 🟡 Placeholder | "v0.2 实装：项目摘要 + 最近修改 + AI 操作历史" |
| 世界 (World) | 🟡 Placeholder | "v0.2 实装：地理 / 历史 / 魔法体系 / 阵营" |
| 人物 (Characters) | 🟡 Placeholder | "v0.2 实装：人物档案 / 关系图" |
| 剧情 (Plot) | 🟡 Placeholder | "v0.2 实装：主线 / 章节 / 任务" |
| 设定图 (Concept Art) | 🟡 Placeholder | "v0.2 实装：占位图 + 提示词" |
| **会话 (Session)** | ✅ **实装** | Chat 面板 + 历史 + 流式 + abort + markdown worker |
| **设置 (Settings)** | ✅ **实装** | API key / endpoint / model / 主题 / 最近项目 |

**注**：原 DESIGN 的 6 tab 不含"设置"，现在加进来（独立 tab）——v0.1 玩家改完设置才能用 chat。

**vue-router 路由**（`src/router/index.ts`）：
```typescript
const routes = [
  { path: '/', redirect: '/session' },
  { path: '/overview', component: () => import('@/views/OverviewView.vue') },
  { path: '/world', component: () => import('@/views/WorldView.vue') },
  { path: '/characters', component: () => import('@/views/CharactersView.vue') },
  { path: '/plot', component: () => import('@/views/PlotView.vue') },
  { path: '/art', component: () => import('@/views/ConceptArtView.vue') },
  { path: '/session', component: () => import('@/views/SessionView.vue') },
  { path: '/settings', component: () => import('@/views/SettingsView.vue') },
]
```

---

## 5. 思考：游戏剧情设计需要哪些东西

> 用户 2026-07-28 说"一个游戏剧情设计需要哪些东西，你可以思考下"。
> 这份清单是 PlotCraft 整个数据模型的 backbone——v0.1 只落最小子集，**v0.2+ 扩展时不能改模型，只能加字段**。

### 5.1 完整清单（v0.1 + 未来扩展）

#### 世界观 (World)
- **元信息**：genre / era / tone / theme / setting_type（奇幻/科幻/现代/架空/都市）
- **地理**：地图 / 主要地点 / 气候 / 城市 / 地形
- **历史**：编年史 / 重大事件 / 神话传说
- **体系**：魔法体系 / 科技水平 / 宗教 / 政治制度
- **阵营**：国家 / 势力 / 派系（每个阵营有信条 + 领袖 + 领土）
- **文化**：语言 / 习俗 / 经济 / 服饰

#### 人物 (Characters)
- **主角**：背景 / 性格 / 动机 / 成长弧光 / 核心冲突
- **队友**：技能 / 性格 / 关系 / 个人支线
- **NPC**：角色卡 / 位置 / 派系 / 出现场景
- **反派**：动机 / 弱点 / 弧光 / 跟主角关系
- **关系图**：朋友 / 敌对 / 师徒 / 亲族 / 暧昧 / 复杂（v0.3+ 可视化）

#### 剧情 (Plot)
- **主线**：三幕 / 起承转合 / 核心冲突 / 主旨
- **章节**：场景 / 节奏 / 钩子 / POV
- **任务**：主线任务 / 支线任务 / 日常任务
- **分支**：决策点 / 多结局 / 道德抉择
- **节奏**：紧张 / 缓冲 / 危机 / 反转

#### 设定图 (Concept Art)
- **人物**：主角 / 队友 / 反派 / 关键 NPC 立绘
- **场景**：关键地点 / 战斗场地 / 城市全景
- **物品**：武器 / 道具 / 关键物件
- **阵营纹章 / 标志**：每个阵营一个图标
- **v0.1 占位图** + `*.prompt.txt` 提示词旁放

#### 主题 (Theme)
- **核心冲突**：人物 vs 自己 / 他人 / 世界 / 命运
- **主题词**：成长 / 救赎 / 爱 / 复仇 / 真相 / 自由
- **基调**：黑暗 / 轻松 / 史诗 / 阴谋 / 治愈 / 黑色幽默
- **风格**：戏剧 / 喜剧 / 悬疑 / 史诗 / 反英雄

#### 叙事 (Narrative)
- **POV**：第一人称 / 第三人称有限 / 第三人称全知
- **叙事视角**：主角 / 队友 / 旁观者
- **对话风格**：诗意 / 口语 / 古风 / 现代
- **章节结构**：线性 / 分支 / 多线并行

#### 任务/玩法 (Gameplay)
- **战斗系统**：回合制 / 即时 / 策略 / 文字冒险
- **技能树**：职业 / 转职 / 自由加点
- **探索**：地图 / 谜题 / 隐藏要素
- **收集**：装备 / 道具 / 成就 / 图鉴

#### 元信息 (Meta)
- **项目名 / 类型 / 目标平台 / 时长预估**
- **受众定位**：核心玩家 / 一般玩家 / 文字冒险爱好者
- **灵感来源**：参考作品 / 风格基调
- **版本 / 更新日志**

#### 资产 (Assets) — v0.3+ 才管理
- **音乐**：BGM / 主题曲 / 环境音
- **音效**：UI / 战斗 / 环境
- **配音**：主角 / 关键 NPC
- **UI 主题**：色板 / 字体 / icon

### 5.2 v0.1 最小子集（4 个 starter md）

| 文件 | 内容 | 字段数 |
|------|------|--------|
| `README.md` | 项目名 / 类型 / genre / era / tone / created_at / updated_at | 7 字段 frontmatter |
| `world/overview.md` | 一句话世界观（≤ 200 字）| 5 字段 frontmatter |
| `characters/protagonist.md` | 一句话主角（背景 + 动机，≤ 200 字）| 5 字段 frontmatter |
| `plot/main-arc.md` | 三幕骨架（起 / 承 / 转 / 合 各 ≤ 100 字）| 5 字段 frontmatter |

**约束**：
- v0.1 项目文件夹结构 = 上面 4 个 md
- v0.2+ 才加 `world/geography.md` / `characters/party.md` / `plot/chapters/` 等
- v0.2+ 才加 `relationships.json` / `art/`
- **不**做"如果玩家手编辑加新文件，app 自动识别"——v0.1 4 个 md 是 hardcode 范围

### 5.3 引导模式（v0.1 实现）

**新建项目流**：
1. 玩家点"新建项目" → 选输出文件夹
2. AI 问 Q1: "你想要什么 genre？奇幻/科幻/现代/架空历史/都市奇幻/其他"（单选）
3. AI 问 Q2: "故事发生在什么时代？远古/中世纪/近现代/未来/后启示录"（单选）
4. AI 问 Q3: "整体基调？黑暗/轻松/史诗/阴谋/治愈/黑色幽默"（多选 ≤2）
5. AI 问 Q4: "主角是？凡人/有特殊能力/非人类/反派/群像"（单选）
6. AI 问 Q5: "故事核心冲突？（自由文本 ≤ 200 字）"
7. AI 生成 4 个 starter md（按上面最小子集）

**v0.1 用 chat tab 完成**（不开独立 OnboardingView）：
- 玩家新建项目后，**chat tab 自动加载引导 prompt**
- 玩家在 chat 里跟 AI 一问一答
- AI 返回 prototype 内容时，前端写入文件夹
- 玩家点"完成引导" → 跳回正常 chat 模式

**为什么不开独立 OnboardingView**：v0.1 范围精简，chat 能复用——v0.2+ 再分独立 view。

---

## 6. 风险点 + 验证标准

### 6.1 风险点

| 风险 | 缓解 |
|------|------|
| 真 LLM API key 用户没填 → `invoke("start_chat")` 失败 | SettingsView 必填项检查 + 启动时 config 校验 |
| LLM endpoint 网络不通（防火墙 / 代理）| spawn_blocking 不阻塞 + 错误 emit `chat:error` + 前端 toast |
| 流式中途断网 | 解析 task 检测 stream 错误 → emit `chat:error` + run 状态标 error |
| 玩家点 abort 中途 | `AbortController` + 后端关 reqwest 连接（参考 Locus `retry.rs`） |
| 1000 token/秒极端流式还是卡 | rAF 节流 + 16ms emit + shallowRef + 验证 P1 |
| markdown worker 慢（marked 是单线程）| v0.1 简单 markdown 应该 < 1ms，v0.2+ 上 batch 节流 |
| LLM 端 SSE 格式不标准（非 OpenAI）| v0.1 只支持 OpenAI 兼容端点；v0.2+ 加 flavor detection（学 Locus） |
| API key 裸存 config.json | DESIGN §开放问题 1 已决 v0.1 接受；v0.2 升 keyring |

### 6.2 验证标准（v0.1 release 硬门槛）

跟 [CHECKLIST.md §1](./CHECKLIST.md#1-v01-性能验收标准从-design-性能验收标准补测量法) 一致：

| # | 指标 | 阈值 |
|---|------|------|
| P1 | 1000 token 流式渲染不掉帧 | 主线程 block < 16ms/帧 |
| P2 | 启动到首屏 | cold start < 1.5s（dev 模式）|
| P3 | 6 tab 切换 | < 100ms |
| P4 | 100MB 项目文件夹扫描 | 不卡 UI |

**新增（v0.1 范围调整后）**：

| # | 指标 | 阈值 | 验证方法 |
|---|------|------|----------|
| P5 | 真 LLM 流式（1K token）不卡 | 主线程 block < 16ms/帧 | DevTools Performance 录制真流式 |
| P6 | markdown worker 渲染延迟 | < 5ms / 1KB markdown | worker postMessage roundtrip |
| P7 | spawn_blocking 解析压力隔离 | runtime 抖动 < 5ms | 跑流式时跑别 IO task，验证不卡 |
| P8 | 启动 phase 1 严格 < 500ms | measured | performance.now 打点 |

### 6.3 Manual Smoke Test（v0.1 release 前必跑）

在 [CHECKLIST.md §10](./CHECKLIST.md#10-manual-smoke-test-流程v01-不写单测) 11 项基础上加：

```
□ 打开 Settings tab，填 API key + endpoint + model，点保存
□ 重启 app，验证 config 重新加载
□ 打开 Chat tab，发消息 → 真 LLM 流式回复
□ 流式过程中点 Stop → 立刻 abort
□ 流式过程中刷新 Chat tab → 进度保留
□ 引导流：点"新建项目" → 选文件夹 → 5 问 → 4 个 starter md 落盘
□ 打开项目文件夹看 4 个 md 内容完整
□ markdown 渲染：发一段含代码块/列表/链接的消息，渲染正确
□ 假断网：断网后发消息，chat:error 触发 + toast 提示
□ 6 tab 切换流畅（验证 P3）
□ 启动 phase 1 < 500ms（验证 P8）
□ 1K token 真流式不卡（验证 P5）
```

---

## 7. 反 Locus 学习清单（给下个 agent）

| Locus 学什么 | Locus 避什么 | PlotCraft 怎么改 |
|---|---|---|
| identity-stable array 模式 | 35 字段 state / 35 mutation type | 砍到 8 字段 / 8 mutation |
| markdown worker（lute） | markdown worker 是 lute，重 | 用 marked + dompurify，轻 |
| 反卡顿意识 | 没用 spawn_blocking 隔离 LLM 解析 | spawn_blocking 隔离 SSE 解析 |
| 错误重试 / abort 机制 | 同步 emit 不节流 | 16ms 节流 + channel 解耦 |
| keyring crate 模式（v0.2+）| v0.1 裸 key | v0.1 裸 key / v0.2 升 keyring |
| `useStreamReducer` 状态机思想 | 主线程跑整 35k state | v0.1 主线程跑 8 字段；v0.2+ 视情况上 worker |

---

## 8. 决策记录（追加到 DESIGN.md §"决策记录"）

- **v0.1 直接接真 LLM，不做 AI stub**（用户决策 2026-07-28）
- **反 Locus 卡顿：spawn_blocking 解析 + 16ms emit 节流 + channel 解耦**
- **chat state 砍到 ≤ 8 字段 / ≤ 8 mutation**（学 Locus 410-414 identity-stable array，砍 Locus 35+ 字段的复杂度）
- **markdown 渲染走 worker**（学 Locus `markdown.worker.ts`，用 marked+dompurify 简化）
- **6 tab 框架 v0.1 实装 2 个**（Chat + Setting），4 个 placeholder（Overview / World / Characters / Plot / Concept Art → v0.2 实装）
- **设置 tab 独立**（原 DESIGN 6 tab 不含 Setting）
- **v0.1 引导流用 chat tab 完成**（不开独立 OnboardingView，v0.2 再分）
- **"游戏剧情设计需要哪些东西" 完整清单**（§5.1）作为数据模型 backbone，v0.1 只落最小子集（4 个 starter md）

---

**CHAT_LLM_DESIGN 结束**。本文件是 v0.1 启动的**最终设计依据**——CHECKLIST / ROADMAP / DESIGN 的 v0.1 章节都引用本文件。
