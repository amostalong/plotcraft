# Concept & Tabs Plan — 6 层抽象蒸馏 + 3 tab 完整展开（v0.5.3+）

> **目标**：把 v0.5+ 7 层概念（seed / pillars / world-rules / locations / character-functions / three-act / core-fantasy）改造成 **6 层抽象蒸馏模型** + **3 tab 完整展开路线**。
>
> **设计哲学根**（用户 2026-08-04 多轮讨论沉淀）：
> - **抽象 vs 展开二分**：6 层 concept 是"核心设定"（抽象，1-3 段话），不是完整作品
> - **核心故事承上启下**：立意是哲学根，核心故事是叙事脊柱，吸收旧 pillars + three-act
> - **核心玩法整合**：吸收旧 core-fantasy + 新增"核心机制"内容
> - **完整作品需要 3 tab**：剧情 / 人物 / 玩法（v0.6+ 路线）
>
> **改动面**：10 个文件，预计 1-2 commit。
>
> **状态**：🚧 v0.5.3+ 设计 plan，等用户审完动手。

---

## 1. 设计哲学（3 条不可破）

### 1.1 6 层严格派生 + 抽象-展开二分

**概念 tab（6 层抽象，核心设定）**：

```
L1 立意          seed               故事的根，1 句哲学
   ↓ 派生
L2 核心故事      core-story         叙事脊柱 + 戏剧结构
   ↓ 派生
L3 世界规则      world-rules        宏观设定 + 运作法则
   ↓ 派生
L4 地点          locations（可选）   具体空间
   ↓ 派生
L5 人物          character-functions 角色功能
   ↓ 派生
L6 核心玩法      core-gameplay      核心机制 + 1 句话体验
```

**完整作品（3 tab，v0.6+ 路线）**：

```
概念 tab（核心）        展开 tab（完整作品）
├── L1 立意          ──┐
├── L2 核心故事        │
├── L3 世界规则        │  剧情 tab
├── L4 地点            │  （用 世界/地点/人物 展开成完整剧本）
├── L5 人物          ──┘
│
└── L6 核心玩法      ──→ 玩法 tab（展开成完整机制 / 系统 / 进度）
                     ──→ 人物 tab（展开成详细人物卡 / 关系网 / 弧线）
```

每层都是上一层的具象——L3 世界规则不能违反 L2 核心故事、L5 人物欲望应追溯到 L3+L4、L6 核心玩法 整合 L1-L5。

### 1.2 抽象 vs 展开（关键洞察）

**v0.5+ 7 层模型的痛点**：把所有内容塞进 concept tab，玩家写完 7 层后**整个其实没玩**——每层只是 1-3 段话的高度抽象。

**v0.5.3+ 6 层 + 3 tab 的解决**：
- **概念 tab**：6 层 = 核心设定（抽象，1-3 段话）
- **剧情 / 人物 / 玩法 tab**：用概念的核心设定**展开成完整作品**

**类比**：
- 概念 = 电影的"剧本大纲"（剧情梗概 + 主题）
- 剧情 tab = 完整剧本（场景序列、对话、选择点）
- 玩法 tab = 游戏设计文档（机制、数值、系统）
- 人物 tab = 人物百科（详细设定、关系网、弧线）

### 1.3 螺旋设计循环（v0.5+ 沿用，6 层适配）

**改任何层 → markStale 上下游 → 黄点 ? 提示**：

- 改 L1 立意 → L2-L6 全标 stale（最重）
- 改 L2-L5 → 自己 + 上游 + L6 stale
- 改 L6 → L1-L5 全标 stale
- 改概念 → 剧情 / 玩法 / 人物 tab 出"上游改动"提示（v0.6+ 实装）

**绝不自动改**任何内容——黄点是"提示"，校准由玩家主动触发。

---

## 2. 6 层模型详解

### L1 立意（seed）

- **写什么**：1 句话核心矛盾 / 故事要讨论的命题
  - 模板：X 处境 + Y 欲望 + Z 不可越（X/Y/Z 无名无姓）
  - 例："个体在强权秩序下的反抗能否保持纯真"
- **派生关系**：哲学根，所有下游派生自 L1
- **hint**：
  > 立意 = 故事要讨论的东西。1 句话核心矛盾 / 主题。
  > 模板：X 处境 + Y 欲望 + Z 不可越。例：「个体在强权秩序下的反抗能否保持纯真」。

### L2 核心故事（core-story）

- **写什么**：1-2 段话级别的核心叙事弧线 + 戏剧结构
  - 模板：弧线（1 句话）+ 3 幕压力走向（每幕 1 句话）
  - 例："主角从纯真到被腐蚀的弧线；第 1 幕：建立日常；第 2 幕：秩序崩塌；第 3 幕：纯真/腐蚀的最终选择"
- **派生关系**：派生 L1 立意——把"主题要表达什么"转成"故事要演什么"
- **吸收的旧内容**（v0.5+ 7 层 → v0.5.3+ 6 层迁移）：
  - 旧 L2 抽象规则（pillars）——"硬约束/否决原则"角度
  - 旧 L6 故事（three-act）——"3 幕结构"角度
  - 两者在 L2 核心故事合并为"叙事脊柱 + 戏剧结构"
- **关键变化**：v0.5+ 旧 L2 抽象规则 4 态成熟度（empty/draft/evolving/finalized）**删除**
  - L2 核心故事 不需要"演进型"——它是个"什么"层，不是"怎么约束"层
  - 规则功能被 L2 内的"叙事脊柱"吸收（弧线本身就隐含约束）
- **hint**：
  > L2 核心故事 = 这条故事的叙事脊柱 + 戏剧结构。1-2 段话级别。
  > 模板：弧线（1 句话）+ 3 幕压力走向（每幕 1 句话）。
  > 派生 L1 立意——把"主题要表达什么"转成"故事要演什么"。

### L3 世界规则（world-rules）

- **写什么**：宏观设定（时代 / 物理 / 魔法 / 政治 / 经济）+ 运作法则
  - 模板：是什么 + 怎么运作 + 造成什么冲突
  - 例："魔法枯竭 300 年（是什么）→ 施法者稀缺（怎么运作）→ 普通人用替代品（冲突）"
- **派生关系**：派生 L1 立意 + L2 核心故事
- **关键变化**：v0.5+ 旧 L3 世界 改名"世界规则"
  - 强调"设定 + 法则"是同一个东西——"魔法枯竭 300 年"既是设定也是规则
  - 跟 L2 核心故事 不再混淆：L2 是叙事，L3 是世界
- **hint**：
  > 世界规则 = 宏观设定 + 运作法则。每条 = 是什么 + 怎么运作 + 造成什么冲突。
  > 派生 L1 立意 + L2 核心故事。
  > 注：旧 v0.5+ L3 世界 跟 L2 抽象规则 容易混淆——这里合并为"世界规则"。

### L4 地点（locations，可选）

- **写什么**：具体空间（地理 / 氛围 / 物理特征 / 跟立意/世界的连接）
  - 模板：名称 + 地理位置 + 氛围 + 立意连接
  - 例："永安镇 — 北方边境码头城市 — 萧条 — 王朝末年权力真空的最前线"
- **派生关系**：派生 L3 世界规则——"世界在哪些具体空间显形"
- **可选 step**（L4 stepper 标"可选"）：
  - 密室 / 单场景剧 / 极简抽象剧不强制写
  - 空 locations.md → LLM 用通用背景
- **不写 NPC**（那是 L5 人物的事）——地点只写**空间和氛围**
- **hint**：
  > 具体空间——地理 / 氛围 / 物理特征 / 跟立意/世界的连接。
  > 这是可选的——密室 / 单场景剧可以跳过。不写 NPC（那是 L5 人物）。

### L5 人物（character-functions）

- **写什么**：每个角色的"想要什么 + 为什么得不到"
  - 模板：角色 + 欲望 + 阻碍 + 阻碍追溯到 L3+L4
  - 例："主角 — 想维护家族崛起 — 王朝反扑 — 追溯 L3 王朝末年 + L4 永安镇"
- **派生关系**：派生 L3 世界规则 + L4 地点——人物被世界的波浪推到位置
- **hint**：
  > 角色功能——每个人 = 想要什么 + 为什么得不到。
  > 人物欲望应追溯到 L3 世界规则 + L4 地点——不是凭空生成。
  > 人物被世界的波浪推到某个位置，他们想要的是对世界压力的回应。

### L6 核心玩法（core-gameplay）

- **写什么**：核心机制（玩什么）+ 1 句话玩家体验（怎么玩 + 感受到什么）
  - 模板：核心机制（短列表） + "你扮演 X，在 Y，做 Z"
  - 例："回合制策略 + 资源管理 + 角色羁绊" + "你扮演末代王朝的小人物，在资源稀缺的世界做选择——每个选择都有代价"
- **派生关系**：整合 L1-L5
  - 核心机制派生自 L3 世界规则 + L5 人物
  - 1 句话体验 整合整链路
- **吸收的旧内容**：v0.5+ 旧 L7 核心体验（1 句话体验） + 新增"核心机制"内容
- **关键变化**：
  - 旧 L7 核心体验 独立成 L6 核心玩法（合并了"核心机制"）
  - L6 玩法 = 旧 L6 故事 + 旧 L7 核心体验 + 新增"核心机制"
  - 完整玩法 → v0.6+ 玩法 tab 展开
- **hint**：
  > L6 核心玩法 = 玩家玩什么 + 怎么玩 + 感受到什么。两部分：
  > 1. 核心机制（回合制 / 文字冒险 / 资源管理 / 角色羁绊 / 选择驱动 / 等）
  > 2. 1 句话玩家体验（「你扮演 X，在 Y，做 Z」）
  > 派生 L1-L5——核心机制派生世界 + 人物；体验整合整链路。

---

## 3. 设计循环机制（v0.5+ 沿用）

### 3.1 改检测：mtime 监听 + 显式 trigger

**两层检测**（同 v0.5+）：
1. **被动检测**：玩家编辑某 step 并落盘 → mtime 变了 → 触发上下游黄点
2. **主动 trigger**：玩家主动点 stepper 里的"?"黄点 → 手动触发 LLM 校准

**6 层 markStale 规则**：
- 改 L1 → L2-L6 全 stale
- 改 L2-L5 → 自己 + 上游 + L6 stale
- 改 L6 → L1-L5 全 stale

### 3.2 黄点 UI

stepper 列表项旁的状态点：
| 状态 | 颜色 | 含义 |
|------|------|------|
| empty | 灰 | 没内容 |
| confirmed | 绿 | 有内容（玩家写过/采用过） |
| **stale** | **黄 + ?** | 上下游有改动，可能需要重看 |
| stale + confirmed | 黄 + 绿圈 | 有内容但被标 stale（点黄点触发 LLM 校准）|

### 3.3 LLM 校准 preset（v0.5.3+ 简化：4 → 3）

**3 个校准 prompt**（删 v0.5+ 旧 PILLAR_REVERSE_CHECK + RECALIBRATE_DOWNSTREAM 单独版）：

```ts
// L1 立意专用：问 3 个尖锐问题
const L1_RECALIBRATE_PROMPT =
  '立意刚刚改过（或上游有重大变化）。' +
  '立意是整个设计的哲学根：' +
  '1. 这次改立意是要「大改方向」还是「精化措辞」？' +
  '2. 如果是大改方向 —— 玩家准备好 L2-L6 全部重看吗？' +
  '3. 玩家希望先看 L1 新立意 vs 旧下游的不一致点，还是先继续写 L2+？' +
  '根据玩家回答决定下一步（不替玩家做决定）。' + OPTION_TAIL

// L2-L5 通用：检查当前 step 是否还服务 L1 + L2
const RECALIBRATE_UPSTREAM_PROMPT =
  '当前 step 刚刚改过（或上游有变化）。' +
  '它可能跟上游 L1 立意 + L2 核心故事 不一致。' +
  '逐条检查：' +
  '1. 当前 step 是否还服务 L1 立意？' +
  '2. 当前 step 是否还派生 L2 核心故事 的弧线？' +
  '3. 哪些句子需要回看 L1+L2 才能确定？' +
  '指出问题点 + 建议方向（不替玩家写完整版）。' + OPTION_TAIL

// L6 核心玩法专用：跑整链路一致性检查
const RECALIBRATE_FULL_CHAIN_PROMPT =
  'L6 核心玩法 刚刚改过（或上游关键层有重大变化）。' +
  '跑全链路一致性检查：' +
  '1. L1 立意 → L2 核心故事：故事弧线还服务于立意吗？' +
  '2. L1+L2 → L3 世界规则：世界还派生 L2 + 服务立意吗？' +
  '3. L3 → L4 地点：地点还显形 L3 规则吗？' +
  '4. L3+L4 → L5 人物：人物欲望还派生自世界 + 地点吗？' +
  '5. L1-L5 → L6 核心玩法：核心机制 + 体验还反映整链路吗？' +
  '指出每层的不一致点 + 建议方向（不替玩家写）。' + OPTION_TAIL
```

**每个 step 的 STEP_PRESETS**：
- L1 立意：`+ "🎯 立意校准"`（L1_RECALIBRATE）
- L2-L5：`+ "⬆️ 上游校准"`（RECALIBRATE_UPSTREAM）
- L6 核心玩法：`+ "🌀 全链路整合"`（RECALIBRATE_FULL_CHAIN）

---

## 4. 6 步 stepper UI 形态

```
┌─────────────────────────────────────┐
│ 📌 L1 立意                          │
│   ● 种子              [confirmed]   │
├─────────────────────────────────────┤
│ 📖 L2 核心故事                       │
│   ● 核心故事          [confirmed]   │
├─────────────────────────────────────┤
│ 🌐 L3 世界规则                       │
│   ● 世界规则          [confirmed]   │
├─────────────────────────────────────┤
│ 📍 L4 地点（可选）                  │
│   ● 地点              [stale ?]     │  ← 黄点提示
├─────────────────────────────────────┤
│ 👤 L5 人物                          │
│   ● 人物              [confirmed]   │
├─────────────────────────────────────┤
│ 🎮 L6 核心玩法                       │
│   ● 核心玩法          [empty]       │
└─────────────────────────────────────┘
```

**视觉规范**：
- L1 立意永远置顶、强调色
- L4 地点标"（可选）"——玩家知道不写也 OK
- 状态点用 SVG 圆点：empty=灰 / confirmed=绿 / stale=黄 + ? 角标
- 黄点点一下 → 切到该 step + 跑校准 preset

---

## 5. LLM system 注入格式（concept_summary 改写）

**`src-tauri/src/concept.rs:concept_summary` 改后输出**：

```text
# [L1 立意] 故事的根 —— 核心矛盾 / 主题
## 种子
个体在强权秩序下的反抗能否保持纯真

# [L2 核心故事] 叙事脊柱 + 戏剧结构
## 核心故事
主角从纯真到被腐蚀的弧线；第 1 幕：建立日常；第 2 幕：秩序崩塌；第 3 幕：纯真/腐蚀的最终选择

# [L3 世界规则] 宏观设定 + 运作法则
## 世界规则
- 魔法枯竭 300 年 → 施法者稀缺 → 普通人用替代品
- 王朝末年 → 权力真空 → 各方势力蠢蠢欲动

# [L4 地点]（可选）具体空间
## 地点
- 永安镇：北方边境码头城市
- 王都：内陆宫殿，积灰 3 寸

# [L5 人物] 角色功能（被世界+地点推到位置）
## 人物
- 主角：想维护家族崛起 → 阻碍 = 王朝反扑
  （追溯：L3 王朝末年 + L4 永安镇权力角力）

# [L6 核心玩法] 核心机制 + 玩家体验
## 核心玩法
- 核心机制：回合制策略 + 资源管理 + 角色羁绊
- 体验：你扮演末代王朝的小人物，在资源稀缺的世界做选择——每个选择都有代价

---
[任务上下文]
你正在帮玩家写 L5 人物。
L1 立意 + L2 核心故事 + L3 世界规则 + L4 地点 = 已确定。
你的生成必须：
1. 服务 L1 立意
2. 派生 L2 核心故事 的弧线
3. 派生自 L3 世界规则 + L4 地点
4. 不替玩家写完整版 —— 3-5 个备选，玩家挑+改
```

**注入时机**：`ChatMessage.system` 字段，`buildSystemPrompt` 调用 `concept_summary` 时。

**分组标签让 LLM 知道每一层的"职责"**：`[L1 立意]` / `[L2 核心故事]` / `[L3 世界规则]` / `[L4 地点]` / `[L5 人物]` / `[L6 核心玩法]`。

---

## 6. 6 步内容模板

每个 step 的 frontmatter + hint：

### 6.1 seed.md（L1 立意）

```yaml
---
title: 立意
step: seed
group: theme
level: 1
status: confirmed
updated: 2026-08-04T...
---
```

**hint**：立意 = 故事要讨论的东西。

### 6.2 core-story.md（L2 核心故事）

```yaml
---
title: 核心故事
step: core-story
group: core-story
level: 2
status: confirmed
updated: 2026-08-04T...
---
```

**hint**：
> L2 核心故事 = 这条故事的叙事脊柱 + 戏剧结构。1-2 段话级别。
> 模板：弧线（1 句话）+ 3 幕压力走向（每幕 1 句话）。
> 派生 L1 立意——把"主题要表达什么"转成"故事要演什么"。

### 6.3 world-rules.md（L3 世界规则）

```yaml
---
title: 世界规则
step: world-rules
group: world-rules
level: 3
status: confirmed
updated: 2026-08-04T...
---
```

**hint**：
> 世界规则 = 宏观设定 + 运作法则。每条 = 是什么 + 怎么运作 + 造成什么冲突。
> 派生 L1 立意 + L2 核心故事。

### 6.4 locations.md（L4 地点，可选）

```yaml
---
title: 地点
step: locations
group: locations
level: 4
status: confirmed
updated: 2026-08-04T...
---
```

**hint**：
> 具体空间——地理 / 氛围 / 物理特征 / 跟立意/世界的连接。
> 这是可选的——密室 / 单场景剧可以跳过。不写 NPC（那是 L5 人物）。

### 6.5 character-functions.md（L5 人物）

```yaml
---
title: 人物
step: character-functions
group: character
level: 5
status: confirmed
updated: 2026-08-04T...
---
```

**hint**：
> 角色功能——每个人 = 想要什么 + 为什么得不到。
> 人物欲望应追溯到 L3 世界规则 + L4 地点——不是凭空生成。
> 人物被世界的波浪推到某个位置，他们想要的是对世界压力的回应。

### 6.6 core-gameplay.md（L6 核心玩法）

```yaml
---
title: 核心玩法
step: core-gameplay
group: core-gameplay
level: 6
status: confirmed
updated: 2026-08-04T...
---
```

**hint**：
> L6 核心玩法 = 玩家玩什么 + 怎么玩 + 感受到什么。两部分：
> 1. 核心机制（回合制 / 文字冒险 / 资源管理 / 角色羁绊 / 选择驱动 / 等）
> 2. 1 句话玩家体验（「你扮演 X，在 Y，做 Z」）
> 派生 L1-L5——核心机制派生世界 + 人物；体验整合整链路。

---

## 7. 文件改动清单

| # | 文件 | 改动 | 行数预估 |
|---|------|------|---------|
| 1 | `src-tauri/src/concept.rs` | STEPS 7→6 + Group enum 改（Maturity 删）+ concept_summary 改 6 层 + 旧项目迁移 + tests 重写 | +180 -200 |
| 2 | `src-tauri/src/commands/concept.rs` | save_concept_step signature 改（去 maturity 参数） | +3 -3 |
| 3 | `src/types/concept.ts` | ConceptStepId 7→6 + ConceptGroup 改 + ConceptStep 去 maturity + STEP_IDS 改 | +15 -25 |
| 4 | `src/lib/concept.ts` | saveConceptStep signature 改（去 maturity） | +3 -3 |
| 5 | `src/stores/concept.ts` | STEP_HINTS 6 项 + STEP_PRESETS 6 × 3 chip + 删 4 校准 prompt 改 3 + save signature 改 | +60 -150 |
| 6 | `src/views/ConceptView.vue` | stepper 6 项 + 去 maturity selector + 去 onMaturityChange | +15 -45 |
| 7 | `src/lib/ai-tools.ts` | update_doc_item item_id enum 7 → 6 | +5 -5 |
| 8 | `docs/AGENTS.md` | 状态表更新（v0.5.3+ 6 层）+ 硬规则 #20 改 | +30 -20 |
| 9 | `docs/CONCEPT_REDESIGN_PLAN.md` | 重写（7 层 → 6 层 + 3 tab 路线） | +300 -250 |

**总计**：~+611 / -701 ≈ -90 净减，1-2 commit。

---

## 8. 旧项目兼容

### 8.1 7 步 → 6 步文件迁移

**v0.5+ 旧 7 步**：
```
seed.md / pillars.md / world-rules.md / locations.md / character-functions.md / three-act.md / core-fantasy.md
```

**v0.5.3+ 新 6 步**：
```
seed.md / core-story.md / world-rules.md / locations.md / character-functions.md / core-gameplay.md
```

**`scan_concept` 入口处一次性跑 `migrate_legacy_concept`**：

```rust
fn migrate_legacy_concept(project_root: &Path) -> AppResult<()> {
    let dir = project_root.join(CONCEPT_DIR);
    let mut migrated = false;
    
    // 1. pillars.md + three-act.md → core-story.md（合并内容）
    let pillars = dir.join("pillars.md");
    let three_act = dir.join("three-act.md");
    let core_story = dir.join("core-story.md");
    if !core_story.is_file() {
        let pillars_content = if pillars.is_file() {
            Some(std::fs::read_to_string(&pillars)?)
        } else { None };
        let three_act_content = if three_act.is_file() {
            Some(std::fs::read_to_string(&three_act)?)
        } else { None };
        
        if pillars_content.is_some() || three_act_content.is_some() {
            let mut merged = String::new();
            if let Some(c) = pillars_content {
                merged.push_str(&c);
            }
            if let Some(c) = three_act_content {
                if !merged.is_empty() {
                    merged.push_str("\n\n## 戏剧结构（旧）\n\n");
                }
                merged.push_str(&c);
            }
            std::fs::write(&core_story, &merged)?;
            migrated = true;
        }
    }
    
    // 2. core-fantasy.md → core-gameplay.md（改名）
    let core_fantasy = dir.join("core-fantasy.md");
    let core_gameplay = dir.join("core-gameplay.md");
    if !core_gameplay.is_file() && core_fantasy.is_file() {
        std::fs::rename(&core_fantasy, &core_gameplay)?;
        migrated = true;
    }
    
    Ok(())
}
```

**chat 历史兼容**：
- 旧 `concept:pillars` / `concept:three-act` / `concept:core-fantasy` 落盘文件**保留但不加载**（不兼容，新 step 重新积累）
- 不迁移 chat 文本（避免歧义）—— 玩家在 6 层新模型下重新聊

### 8.2 旧 frontmatter 字段兼容

旧 frontmatter 字段（`group: principles` / `group: world` / `group: story` / `group: core-fantasy` / `maturity: evolving` 等）→ **走 `infer_group_level` 推断**（用 step_id 推断新的 group/level），不读旧 group/maturity 字段：

- 旧 group "principles" 走 step_id "pillars" → 推断 (CoreStory, 2) — 但 pillars.md 已被 §8.1 迁移，不存在独立 pillars.md
- 旧 group "story" 走 step_id "three-act" → 推断 (CoreStory, 2) — 同上
- 旧 group "core-fantasy" 走 step_id "core-fantasy" → 推断 (CoreGameplay, 6) — 已被 §8.1 改名
- 旧 group "world" 走 step_id "world-rules" → 推断 (WorldRules, 3) — 旧 group 字符串 "world" 不再存在，新写盘用 "world-rules"

**`infer_group_level` 改后**：

```rust
fn infer_group_level(step_id: &str) -> (Group, Level) {
    match step_id {
        "seed" => (Group::Theme, 1),
        "core-story" => (Group::CoreStory, 2),
        "world-rules" => (Group::WorldRules, 3),
        "locations" => (Group::Locations, 4),
        "character-functions" => (Group::Character, 5),
        "core-gameplay" => (Group::CoreGameplay, 6),
        // 旧 v0.5+ step_id 走迁移路径（§8.1），不应独立存在
        "pillars" | "three-act" => (Group::CoreStory, 2),
        _ => (Group::Other, 0),
    }
}
```

---

## 9. v0.6+ 3 tabs 路线（待 v0.5.3+ 完成后另开 release）

### 9.1 设计动机

v0.5.3+ 6 层 concept 是**核心设定**（抽象，1-3 段话），不是完整作品。完整作品需要：

- **剧情 tab**：用概念的世界/地点/人物展开成完整剧本（场景序列、对话、选择点、节奏）
- **人物 tab**：用概念 L5 人物 展开成详细人物卡（设定、关系网、弧线）
- **玩法 tab**：用概念 L6 核心玩法 展开成完整机制（规则、数值、UI、玩家路径）

### 9.2 关系：概念 → 展开

```
概念 tab（核心）        展开 tab（完整作品）
├── L1 立意          ──┐
├── L2 核心故事        │
├── L3 世界规则        │  剧情 tab
├── L4 地点            │  （用 世界/地点/人物 展开成完整剧本）
├── L5 人物          ──┘
│
└── L6 核心玩法      ──→ 玩法 tab（展开成完整机制 / 系统 / 进度）
                     ──→ 人物 tab（展开成详细人物卡 / 关系网 / 弧线）
```

- 概念 = source of truth（小、稳定、1-3 段话/层）
- 剧情 / 人物 / 玩法 = 读概念展开成大文档
- 改概念 → 剧情 / 玩法 / 人物 出"上游改动"提示（复用 v0.5+ 黄点机制）

### 9.3 实现要点（v0.6+ 详细设计另开 plan）

- **3 个新 tab 路由**：
  - 剧情（`/plot`）—— 现有 placeholder tab 实装
  - 人物（`/characters`）—— 现有 placeholder tab 实装
  - 玩法（`/gameplay`）—— 新建 tab（当前 tab 栏未列出）
- **每个 tab 独立 store**（跟 concept store 一样）：
  - `stores/plot.ts`
  - `stores/character.ts`
  - `stores/gameplay.ts`
- **数据存储**：
  - `<project>/plot/<scene>.md` —— 完整剧本
  - `<project>/characters/<character>.md` —— 人物卡
  - `<project>/gameplay/<mechanic>.md` —— 机制说明
- **概念→展开"上游改动"提示**：
  - concept store 改 → 通知 plot/character/gameplay store markStale
  - 复用 v0.5+ 黄点 UI（stepper 概念项 + 展开 tab 项都标黄点）
- **LLM 辅助**：每 tab 配 3-5 chip（generate / reflect / polish / expand / ...），跟 concept store 同款

### 9.4 估计

- 1 release / tab = 3 releases
- 每 release 估 2-3 commit
- 总估 6-9 commit

### 9.5 顺序

按依赖关系排序：
1. **v0.6+ 人物 tab** —— 最简单（人物卡是独立单元，不依赖剧情顺序）
2. **v0.6+ 玩法 tab** —— 跟剧情 tab 互相依赖（玩法影响剧情可玩性）
3. **v0.6+ 剧情 tab** —— 最复杂（依赖人物 + 玩法的设定）

或按玩家使用频率：
1. 剧情 tab（最常用）
2. 人物 tab
3. 玩法 tab

具体顺序等 v0.5.3+ 落地后用户决定。

---

## 10. 实施 checklist

v0.5.3+ 6 层落地：

- [ ] `docs/CONCEPT_REDESIGN_PLAN.md`（本文件）
- [ ] `src-tauri/src/concept.rs`
  - [ ] STEPS 7→6
  - [ ] Group enum：删 Principles/Story/CoreFantasy，加 CoreStory/CoreGameplay，World→WorldRules
  - [ ] 删 Maturity enum + maturity 字段
  - [ ] `infer_group_level` 改（按新 step_id）
  - [ ] `concept_summary` 改 6 层标签
  - [ ] 加 `migrate_legacy_concept` 函数
  - [ ] `scan_concept` 入口调 `migrate_legacy_concept`
  - [ ] `build_frontmatter` 去 maturity 处理
  - [ ] `parse_frontmatter` 去 maturity 解析
  - [ ] 删 `maturity_zh` 函数
  - [ ] 单元测试：删 4 个旧测试 + 加 6 个新测试
- [ ] `src-tauri/src/commands/concept.rs`
  - [ ] `save_concept_step` signature 改（去 maturity 参数）
- [ ] `src/types/concept.ts`
  - [ ] `ConceptStepId` 7→6
  - [ ] `ConceptGroup` 改（6 个值）
  - [ ] `ConceptStep` 去 maturity 字段
  - [ ] `STEP_IDS` 改 6 项
- [ ] `src/lib/concept.ts`
  - [ ] `saveConceptStep` signature 改（去 maturity）
- [ ] `src/stores/concept.ts`
  - [ ] `STEP_HINTS` 6 项
  - [ ] 删 4 校准 prompt 改 3（L1_RECALIBRATE / RECALIBRATE_UPSTREAM / RECALIBRATE_FULL_CHAIN）
  - [ ] 删 PILLAR_REVERSE_CHECK + RECALIBRATE_DOWNSTREAM
  - [ ] `STEP_PRESETS` 6 × 3 chip（4 基础 + 1 校准 → 3 基础 + 1 校准）
  - [ ] `save` signature 改（去 maturity）
  - [ ] `markStaleAfterSave` 逻辑不变（6 层适配）
- [ ] `src/views/ConceptView.vue`
  - [ ] stepper 6 项
  - [ ] 删 maturity selector UI
  - [ ] 删 `MATURITY_LABELS` / `MATURITIES` 常量
  - [ ] 删 `onMaturityChange` 函数
  - [ ] 注释更新（"7 层" → "6 层"）
- [ ] `src/lib/ai-tools.ts`
  - [ ] `UPDATE_DOC_ITEM_SCHEMA` item_id enum 7→6
- [ ] `docs/AGENTS.md`
  - [ ] §2 v0.5+ 状态表 → v0.5.3+ 6 层
  - [ ] §3 硬规则 #20 改（L2 pillars 4 态 → L2 核心故事 无 maturity）
  - [ ] §10 找东西速查 更新
- [ ] 验证：`bun run typecheck` + `cd src-tauri && cargo check`
- [ ] commit

---

**plan 结束**。改这一份前先跟用户确认 v0.6+ 3 tab 顺序（按依赖 / 按使用频率）。
