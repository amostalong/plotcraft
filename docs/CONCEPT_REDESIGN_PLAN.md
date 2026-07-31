# Concept Redesign Plan — 7 层派生 + 螺旋设计循环

> **目标**：把 v0.3+ 的 6 步漏斗（seed / core-fantasy / pillars / world-rules / character-functions / three-act）改造成 7 层严格派生模型 + 设计循环反馈机制。
>
> **设计哲学根**：用户 RPG 设计心法（2026-07-30 ~ 07-31 多轮讨论沉淀）：
> - 立意第一性（核心矛盾是灵魂，不是 input 字段）
> - 先抽象规则，再具体世界——但抽象规则很难一次设计完整，要**不断反馈**
> - 世界 → 地点 → 人物 → 故事：派生链，世界创造人物，人物被世界波浪推着走
> - 核心体验是**双位置**——最抽象 + 最后写（整合所有层）
>
> **改动面**：11-13 个文件，预计 1-2 个 commit。
>
> **状态**：⚠️ **本文件为 plan，等用户审完才动手**。

---

## 1. 设计哲学（3 条不可破）

### 1.1 7 层严格派生

```
L1 立意            seed                       故事的根，1 句哲学
    ↓ 派生
L2 抽象规则        pillars                    设计的硬约束，独立演进
    ↓ 派生
L3 世界            world-rules                宏观设定 / 时代
    ↓ 派生
L4 地点            locations（可选）           具体空间
    ↓ 派生
L5 人物            character-functions        角色功能（被世界+地点推到位置）
    ↓ 派生
L6 故事            three-act                  派生 L1-L5 的具体剧情序列
    ↓ 整合
L7 核心体验        core-fantasy               整合所有层，玩家视角的 1 句话总结
```

**每层都是上一层的具象**——L3 世界不能违反 L2 pillars、L5 人物欲望应该追溯到 L3+L4、L6 三幕应该服务 L1 立意。

### 1.2 立意第一性

L1 立意是**整个设计的哲学根**——改 L1，整个下游链路**理论上都要重看**（"全链路反思"由 LLM 主动提示，不自动改）。

### 1.3 螺旋设计循环（核心要求）

**改任何一层 → 触发全链路反思提示**——这是设计循环的核心机制：

- 改 L1 立意 → L2-L7 列表项旁**黄点"?"**（手动触发 LLM 校准）
- 改 L2 pillars → L3-L7 黄点
- 改 L3 world / L4 locations → L1+L2 提示"上游可能需要重看"+ L5-L7 黄点
- 改 L5 character / L6 story → L1-L4 提示 + L7 黄点
- 改 L7 core-fantasy → **全链路一致性反思**（最重，影响所有层）

**绝不自动改**任何内容——黄点是"提示"，校准由玩家主动触发，LLM 跑预设的"全链路检查"preset **只指出问题，不替玩家改**（符合 PlotCraft 玩家主导哲学）。

---

## 2. 7 层模型详解

### L1 立意（seed）

- **写什么**：1 句话核心矛盾 / 故事要讨论的命题
  - 模板：抽象的不可越张力（X 处境 + Y 欲望 + Z 不可越；X/Y/Z 无名无姓）
  - 例："个体在强权秩序下的反抗能否保持纯真"
- **派生关系**：**根**——所有下游派生自 L1
- **LLM 行为**：写 L1 时主动给"立意校准"preset（问 3 个尖锐问题逼玩家想清楚）；改 L1 时下游黄点
- **反馈行为**：改 L1 → L2-L7 黄点；最重提示

### L2 抽象规则（pillars）

- **写什么**：3-5 条**硬约束 / 否决性原则**
  - 模板："任何方案违反 X 就打回"
  - 例："资源始终稀缺" / "每个敌人都必须是威胁" / "情感负担不可逃避"
- **派生关系**：派生 L1——"立意说表达什么 → 抽象规则说不能违反什么"
- **演进型**：4 态成熟度（empty / 草稿 v1 / 演进 v2+ / 定型）
  - LLM 行为按成熟度动态调整
  - 改 L2 → L3-L7 黄点
- **关键差异（vs PlotCraft 旧 pillars）**：**之前抄 Locus 抄过头了**——Locus pillars 是 3A 大作的工具，独立创作者做 1 个故事不需要这个抽象层。**这次保留是因为用户洞察"很难一次设计完整，要不断反馈"——它不是静态规则，是持续演进的活物**。
- **LLM 行为**：
  - empty：主动问 3 个尖锐问题（"你这条故事，哪些是不能违反的边界？"）
  - 草稿：给 3-5 条备选
  - 演进：跑"反向检验"preset——用 L3-L6 现状反推 pillars 是不是写偏了
  - 定型：当成硬约束，注入 LLM 用作 veto

### L3 世界（world-rules）

- **写什么**：宏观设定（时代 / 规则 / 政治 / 经济 / 物理）
  - 模板："<现象> + <造成什么冲突> + <是否构成硬约束>"
  - 例："魔法枯竭 300 年 → 施法者稀缺 → 普通人用替代品"
- **派生关系**：派生 L1 立意 + L2 pillars——"立意说表达什么 + 抽象规则说不能违反什么 → 世界怎么落地"
- **关键变化**：L2 pillars 独立出去后，world-rules hint 改回"普通规则"为主（不再有 pillars 语义叠加）
- **LLM 行为**：严格按 L1+L2 注入——"你正在写 L3 世界，它必须服务 L1 立意 + 满足 L2 pillars"

### L4 地点（locations，可选）

- **写什么**：具体空间（地理 / 氛围 / 物理特征 / 跟立意/世界的连接）
  - 模板："<名称> + <地理位置> + <氛围> + <立意连接>"
  - 例："永安镇 — 北方边境码头城市 — 萧条 + 多派角力 — 王朝末年权力真空的最前线"
- **派生关系**：派生 L3 世界——"世界规则在哪些具体空间显形"
- **可选 step**（L4 stepper 标"可选"）：
  - 密室 / 单场景剧 / 极简抽象剧不强制写
  - 空 locations.md → LLM 用通用背景
- **不写 NPC**（那是 L5 人物的事）——地点只写**空间和氛围**
- **LLM 行为**：写 L4 时注入 L3 世界，告诉 LLM"这个地点必须显形 L3 世界的某条规则"

### L5 人物（character-functions）

- **写什么**：每个角色的"想要什么 + 为什么得不到"
  - 模板："<角色> + <欲望> + <阻碍> + <阻碍追溯到 L3+L4 哪条>"
  - 例："主角 — 想维护家族崛起 — 王朝末年权力真空反扑 — 追溯到 L3 王朝末年 + L4 永安镇权力角力"
- **派生关系**：派生 L3 世界 + L4 地点——"世界波浪推到位置，人物功能是回应"
- **关键变化**：hint 改写——"人物欲望应追溯到 L3+L4，不是凭空生成"
- **新 preset chip**："🌊 人物从世界长出来：检查每个功能是否从 L3+L4 派生"
- **LLM 行为**：注入 L1+L2+L3+L4——"你正在写 L5 人物，它必须派生自 L3 世界 + L4 地点，受 L1 立意 + L2 pillars 约束"

### L6 故事（three-act）

- **写什么**：冲突加压序列 / 关键转折点
  - 模板："<幕> + <压力> + <转折> + <转折如何服务 L1>"
  - 例："第一幕 — 王朝崩塌迹象 — 主角被迫离开永安镇 — 服务'个体在强权下的反抗'立意"
- **派生关系**：派生 L1-L5——"所有前置抽象 + 具象 → 时间轴上的展开"
- **关键变化**：从 PlotCraft 现状的 6 步"第 6 步"提升为 L6 "故事"层
- **LLM 行为**：注入 L1-L5 全套——"你正在写 L6 三幕，每一幕都应服务立意 + 满足 pillars + 派生自世界+地点+人物"

### L7 核心体验（core-fantasy）

- **写什么**：玩家视角的 1 句话体验
  - 模板："你扮演 <角色>，在 <处境> 做 <事>，<玩家感受到什么>"
  - 例："你扮演来自底层的小人物，在秩序崩塌的边缘做选择——每个选择都有代价，没有正确答案"
- **派生关系**：**整合 L1-L6**——所有层设计完才能精准定
- **位置特殊性**：
  - **最抽象**（1 句话总结整件事）—— 跟 L1 立意是孪生抽象
  - **最后写**（其他层都定了才能精准）—— 跟 L1 早期可粗相反
  - **可以早期写粗版**（方向感），**所有层都设计完后再精化**
- **LLM 行为**：跑"全链路整合"preset——汇总 L1-L6 现状，问玩家"核心体验是否对得上整链路"
- **改 L7 → 触发全链路一致性反思**（最重提示）

---

## 3. 设计循环机制（核心）

### 3.1 改检测：mtime 监听 + 显式 trigger

**两层检测**：

1. **被动检测**：玩家编辑某 step 并落盘 → mtime 变了 → 触发下游黄点
2. **主动 trigger**：玩家主动点 stepper 里的"?"黄点 → 手动触发 LLM 校准

**实现**：
- `concept store` 维护 `staleFlags: Map<ConceptStepId, boolean>` 记录哪些 step 需要校准
- `save_concept_step` 返回的 updated 跟 in-memory 之前的"快照 hash"对比 → 变了就 mark stale
- 改 L1/L2 → mark L2/L3/L4/L5/L6/L7 stale（除了自己）
- 改 L3-L6 → mark 自己 + 上游 + L7 stale
- 改 L7 → mark L1-L6 stale

### 3.2 黄点 UI

stepper 列表项旁的状态点扩展：

| 状态 | 颜色 | 含义 |
|------|------|------|
| empty | 灰 | 没内容 |
| confirmed | 绿 | 有内容（玩家写过/采用过） |
| **stale** | **黄 + ?** | 上下游有改动，可能需要重看 |
| stale + confirmed | 黄 + 绿圈 | 有内容但被标 stale（点黄点触发 LLM 校准）|

**点黄点** → 自动切换到该 step + 跑预设的"全链路校准"preset + LLM 指出问题点（**不替玩家改**）。

### 3.3 LLM 校准 preset（新增 4 个）

加在 `src/stores/concept.ts:STEP_PRESETS` 通用区（不绑特定 step）：

```ts
// === 设计循环校准 preset（v0.5+ 新增） ===

const RECALIBRATE_DOWNSTREAM_PROMPT =
  '上游刚刚改过。' +
  '当前 step 内容可能与新上游不一致。' +
  '逐条检查：' +
  '1. 当前 step 的关键论断是否还被新上游支持？' +
  '2. 哪些句子需要重写、哪些保留？' +
  '3. 指出具体段落 + 建议方向（不替玩家写完整版）。'

const RECALIBRATE_UPSTREAM_PROMPT =
  '当前 step 刚刚改过。' +
  '它可能跟上游 L1+L2 不一致。' +
  '逐条检查：' +
  '1. 当前 step 是否还服务 L1 立意？' +
  '2. 当前 step 是否违反 L2 pillars？' +
  '3. 哪些句子需要回看 L1+L2 才能确定？' +
  '指出问题点 + 建议方向（不替玩家写完整版）。'

const RECALIBRATE_FULL_CHAIN_PROMPT =
  'L7 核心体验刚刚改过（或上游关键层有重大变化）。' +
  '跑全链路一致性检查：' +
  '1. L1 立意 → L2 pillars：pillars 还服务于立意吗？' +
  '2. L1+L2 → L3 世界：世界还满足 pillars + 服务立意吗？' +
  '3. L3 → L4 地点：地点还显形 L3 规则吗？' +
  '4. L3+L4 → L5 人物：人物欲望还派生自世界+地点吗？' +
  '5. L1-L5 → L6 故事：三幕还派生整链路吗？' +
  '6. L1-L6 → L7 核心体验：核心体验还反映整链路吗？' +
  '指出每层的不一致点 + 建议方向（不替玩家写）。'

const PILLAR_REVERSE_CHECK_PROMPT =
  '用 L3-L6 现状反推 L2 pillars：' +
  '1. L3 世界规则里有没有"硬约束"性质但没写进 L2 的？' +
  '2. L5 人物功能里有没有"贯穿"性质但没写进 L2 的？' +
  '3. L6 三幕里有没有"不可越线"性质但没写进 L2 的？' +
  '建议补充哪些 pillars（不替玩家写完整版）。'
```

**每个 step 的 STEP_PRESETS 里**根据层级加 1-2 个校准 chip：

- L1 立意：`+ "🎯 立意校准"`（问 3 个尖锐问题，**重写**立意）
- L2 pillars：`+ "🔄 反向检验"`（用 L3-L6 反推）
- L3-L6：每个都 `+ "⬆️ 上游校准"`（改本层后回看 L1+L2）
- L7 核心体验：`+ "🌀 全链路整合"`（汇总裁决）

### 3.4 改 L1 的特殊流程

改 L1 立意**是触发最重的改动**——理论上下游所有层都要重看。

UI 行为：
- 保存 L1 → 自动 mark L2-L7 all stale（黄点全亮）
- 弹一次非阻塞 toast 提示"立意已更新，L2-L7 标为'需重看'，可逐一校准"
- **不强制玩家**逐一点——玩家可以忽略黄点直接继续工作

---

## 4. 7 步 stepper UI 形态

```
┌─────────────────────────────────────┐
│ 📌 L1 立意                          │
│   ● 种子              [confirmed]   │
├─────────────────────────────────────┤
│ ⚙️ L2 抽象规则                      │
│   ● 抽象规则          [v2 演进]    │
├─────────────────────────────────────┤
│ 🌐 L3 世界                          │
│   ● 世界规则          [confirmed]   │
├─────────────────────────────────────┤
│ 📍 L4 地点（可选）                  │
│   ● 地点              [stale ?]     │  ← 黄点提示
├─────────────────────────────────────┤
│ 👤 L5 人物                          │
│   ● 人物功能          [confirmed]   │
├─────────────────────────────────────┤
│ 🎬 L6 故事                          │
│   ● 三幕骨架          [empty]       │
├─────────────────────────────────────┤
│ ✨ L7 核心体验                       │
│   ● 核心体验          [empty]       │
└─────────────────────────────────────┘
```

**视觉规范**：
- L1 立意永远置顶、强调色
- L4 地点标"（可选）"—— 玩家知道不写也 OK
- 状态点用 SVG 圆点：empty=灰 / confirmed=绿 / stale=黄 + ? 角标
- 黄点点一下 → 切到该 step + 跑校准 preset

---

## 5. LLM system 注入格式（concept_summary 改写）

**`src-tauri/src/concept/mod.rs:concept_summary` 改后输出**：

```text
# [L1 立意] 故事的根 —— 核心矛盾 / 主题
## 种子
个体在强权秩序下的反抗能否保持纯真

# [L2 抽象规则] 设计的硬约束（成熟度：演进 v2）
## 抽象规则
- 资源始终稀缺
- 每个敌人都必须是威胁
- 情感负担不可逃避

# [L3 世界] 宏观设定
## 世界规则
- 魔法枯竭 300 年 → 施法者稀缺
- 王朝末年 → 权力真空 → 各方势力蠢蠢欲动

# [L4 地点]（可选）具体空间
## 地点
- 永安镇：北方边境码头城市
- 王都：内陆宫殿，积灰 3 寸

# [L5 人物] 角色功能（被世界+地点推到位置）
## 人物功能
- 主角：想维护家族崛起 → 阻碍 = 王朝反扑
  （追溯：L3 王朝末年 + L4 永安镇权力角力）

# [L6 故事] 时间轴上的展开
## 三幕骨架
- 第一幕：王朝崩塌迹象 → 主角离开永安镇

# [L7 核心体验] 玩家视角的 1 句话
## 核心体验
（empty）

---

[任务上下文]
你正在帮玩家写 L5 人物。
L1 立意 + L2 pillars + L3 世界 + L4 地点 = 已确定。
你的生成必须：
1. 服务 L1 立意
2. 满足 L2 pillars（不能违反硬约束）
3. 派生自 L3 世界 + L4 地点
4. 不替玩家写完整版 —— 3-5 个备选，玩家挑+改
```

**注入时机**：`ChatMessage.system` 字段，`buildSystemPrompt` 调用 `concept_summary` 时。

**分组标签让 LLM 知道每一层的"职责"**——`[L1 立意]` / `[L2 抽象规则]` / `[L3 世界]` / `[L4 地点]` / `[L5 人物]` / `[L6 故事]` / `[L7 核心体验]`。

---

## 6. 7 步内容模板

每个 step 的 frontmatter + hint：

### 6.1 seed.md（L1 立意）

```yaml
---
title: 立意
step: seed
group: theme
level: 1
status: confirmed
updated: 2026-07-31T...
---
```

**hint**：
> 立意 = 故事要讨论的东西。

### 6.2 pillars.md（L2 抽象规则）

**hint**：
> 3-5 条硬约束 / 否决性原则。每条都是"任何方案违反 X 就打回"。**这些规则不会一次写完**——会在写世界/人物/故事过程中反复回来修改。成熟度：empty / 草稿 v1 / 演进 v2+ / 定型。

**frontmatter 扩展**（加 maturity 字段）：
```yaml
---
title: 抽象规则
step: pillars
group: principles
level: 2
maturity: draft  # empty | draft | evolving | finalized
status: draft
updated: 2026-07-31T...
---
```

### 6.3 world-rules.md（L3 世界）

**hint**：
> 宏观设定——时代 / 物理 / 魔法 / 政治 / 经济。每条 = 是什么 + 造成什么冲突。**注意：硬约束（"不能违反"）属于 L2 抽象规则**——这里只写普通规则。

### 6.4 locations.md（L4 地点，可选）

**hint**：
> 具体空间——地理 / 氛围 / 物理特征 / 跟立意/世界的连接。**这是可选的**——密室 / 单场景剧可以跳过。不写 NPC（那是 L5 人物）。

### 6.5 character-functions.md（L5 人物）

**hint**：
> 角色功能——每个人 = 想要什么 + 为什么得不到。**人物欲望应追溯到 L3 世界 + L4 地点**——不是凭空生成。人物被世界的波浪推到某个位置，他们想要的是对世界压力的回应。

### 6.6 three-act.md（L6 故事）

**hint**：
> 冲突加压序列——每一幕压力比上一幕大，直到终幕爆发。**派生 L1-L5**——每幕转折点都应服务 L1 立意 + 满足 L2 pillars + 反映 L3 世界 + L4 地点 + L5 人物。

### 6.7 core-fantasy.md（L7 核心体验）

**hint**：
> 玩家视角的 1 句话体验——"你扮演 X，在 Y 处境，做 Z"。**所有层设计完才能精准定**——可以先写粗版（方向感），其他层定下来再回来精化。

---

## 7. 文件改动清单

| # | 文件 | 改动 | 行数预估 |
|---|------|------|---------|
| 1 | `src-tauri/src/concept/mod.rs` | STEPS 6→7 + group/level/maturity 字段 + `concept_summary` 改 7 层分组格式 | +80 -30 |
| 2 | `src/types/concept.ts` | STEP_IDS 6→7 + ConceptStep 加 group/level 字段 + StepMaturity 类型 | +40 -20 |
| 3 | `src/stores/concept.ts` | STEP_HINTS / STEP_PRESETS 重组（每层 3-5 chip） + 4 个校准 preset + staleFlags 状态 | +200 -50 |
| 4 | `src/views/ConceptView.vue` | stepper 改 7 层分组 UI + 黄点 + 校准 chip 接入 | +150 -80 |
| 5 | `src/lib/chats.ts` | 11 itemKey → 13 itemKey（+ locations + core-fantasy） | +20 -5 |
| 6 | `src/lib/ai-tools.ts` | tool schema item_id 枚举扩 7 步 | +15 -5 |
| 7 | `src/stores/chat.ts` | `buildSystemPrompt` 注入新格式 concept_summary | +20 -10 |
| 8 | `src-tauri/src/concept/mod.rs` 单元测试 | 5 个 test 更新 + 2 新 test（maturity / stale） | +60 -10 |
| 9 | `docs/AGENTS.md` | v0.5+ 状态更新（6 步 → 7 层 + 设计循环） | +40 -20 |
| 10 | `docs/DESIGN.md` | 6 步漏斗段改 7 层派生 + 设计循环段 | +100 -40 |
| 11 | `docs/ROADMAP.md` | v0.5+ 时间线更新 | +30 -10 |
| 12 | `docs/CHAT_LLM_DESIGN.md` | concept_summary 格式更新（v0.5+） | +30 -10 |

**总计**：~+785 / -290 ≈ +495 净增，1-2 commit。

---

## 8. 旧项目兼容

### 8.1 6 步 → 7 步迁移

旧项目只有 6 个 md（seed / core-fantasy / pillars / world-rules / character-functions / three-act）。

新模型 7 步 = seed / **pillars** / world-rules / **locations**（新）/ character-functions / three-act / **core-fantasy**（独立出来）。

**迁移策略**：
- 旧 `core-fantasy.md` → **改名 / 重新归位**为 L7 核心体验
- 旧 `pillars.md` → 保留但改 hint（成熟度默认 draft）
- 新 `locations.md` → 不存在，扫描时 status=empty
- 旧 `seed.md` / `world-rules.md` / `character-functions.md` / `three-act.md` → 不动，扫描时按 id 推断 group/level

**`scan_concept` 兼容逻辑**：

```rust
fn infer_group_level(step_id: &str, frontmatter_group: Option<&str>) -> (Group, Level) {
    if let Some(g) = frontmatter_group {
        // 新 frontmatter 含 group 字段 → 直接用
        return (parse_group(g), level_from_group(g));
    }
    // 旧 frontmatter 没 group 字段 → 按 id 推断
    match step_id {
        "seed" => (Group::Theme, 1),
        "core-fantasy" => (Group::CoreFantasy, 7),  // ★ 关键：旧 core-fantasy 归 L7
        "pillars" => (Group::Principles, 2),
        "world-rules" => (Group::World, 3),
        "character-functions" => (Group::Character, 5),
        "three-act" => (Group::Story, 6),
        _ => (Group::Other, 0),
    }
}
```

### 8.2 chat 持久化兼容

旧 `.chats/concept/{seed,core-fantasy,pillars,...}.json` → 7 步后保留全部（11 → 13 itemKey，新增 `locations` 和 `core-fantasy` 是新空）。

旧 core-fantasy 的 chat 历史**继续可用**——玩家在新模型下访问 L7 核心体验时，看得到旧 chat。

### 8.3 工具权限（v0.4+ tool calling）

`update_doc_item` tool 的 `item_id` 枚举从 6 扩 7——`ask_user_question` / `ask_free_text` 不受影响。

**风险**：如果玩家在升级前开了 chat 流，正在跟 LLM 交互，itemKey 旧值不会冲突（按 step_id 字符串匹配）。

---

## 9. 风险点 + 缓解

| # | 风险 | 缓解 |
|---|------|------|
| 1 | **旧项目 core-fantasy 误判**：旧 core-fantasy 内容其实是 L7 玩家体验，但旧玩家可能写过 L3 世界+人物的东西到 core-fantasy 里 | 迁移时**保留 core-fantasy 原内容**+ 在 L7 hint 里提示"如果你以前写的是世界/人物内容，可能需要搬" |
| 2 | **黄点不消失**：玩家改 L1 但不想校准下游，黄点一直亮 | 黄点有"忽略"按钮（点 X 移除黄点，但 mtime 记录保留，下次再有改动又会出现） |
| 3 | **改 L1 弹 toast 太烦**：玩家小幅改 L1 不想触发全链路反思 | toast 3 秒自动消失；玩家可在 Settings 里关"改 L1 提示" |
| 4 | **mtime 比较误判**：玩家编辑后又撤回，mtime 变了但内容没变 | save 写盘前 hash 内容，hash 没变就不触发 stale mark |
| 5 | **chat 持久化跨项目残留**：旧 .chats/concept/core-fantasy.json 是旧项目 → 新项目不应该有 | 已有 `clearAllStepChats` 处理切项目（AGENTS.md 硬规则 #11） |
| 6 | **tool schema item_id 枚举过时**：v0.4+ tool schema 写死了 6 个 item_id | `ai-tools.ts` 枚举同步改 7 个；后端 `update_doc_item` 接受新 itemKey |
| 7 | **stepper 列表太长**：7 项 vs 6 项，sidebar 变长 | 接受——这就是设计循环的物理表现，sidebar 应该够长 |
| 8 | **L7 核心体验如果玩家早期就写粗版，后期反复改**：mtime 变化频繁 → 频繁 mark L1-L6 stale | 改 L7 触发**全链路**反思**用 cooldown**——同一 5 分钟内多次改 L7 只触发 1 次反思 toast |

---

## 10. commit 计划

**commit 1**（核心结构）：
- 后端 STEPS 6→7
- 前端 STEP_IDS 同步
- 旧项目兼容（scan_concept 推断 group/level）
- hint 重写
- 单元测试更新

**commit 2**（设计循环 + 视觉）：
- 4 个校准 preset
- 黄点 UI
- mtime 检测 + staleFlags 状态
- concept_summary 改 7 层格式
- buildSystemPrompt 同步

**commit 3**（文档）：
- AGENTS.md / DESIGN.md / ROADMAP.md / CHAT_LLM_DESIGN.md 同步

**或者 1 个大 commit**（如果用户偏好）——按 PlotCraft v0.x 历史都是 1-2 commit。

---

## 11. 验收 checklist

### 11.1 编译检查
- [ ] `bun run typecheck` 0 error
- [ ] `cd src-tauri && cargo check` 0 error
- [ ] `cargo test --package plotcraft concept::` 0 fail

### 11.2 smoke test

#### 旧项目（6 步）
- [ ] 打开旧项目（v0.3 建的）→ 7 步都识别
- [ ] L1 立意（seed）= 旧 seed 内容
- [ ] L7 核心体验（core-fantasy）= 旧 core-fantasy 内容
- [ ] L4 地点（locations）= empty
- [ ] 黄点逻辑：改 L1 → L2-L7 黄点全亮

#### 新项目
- [ ] 新建项目 → 7 步全 empty
- [ ] 写 L1 → L1 status 变 confirmed
- [ ] 写 L2 → 成熟度字段写"draft"
- [ ] 改 L1（小幅）→ L2-L7 黄点全亮 + toast
- [ ] 点 L3 黄点 → 跑"上游校准"preset
- [ ] LLM 指出问题 + 不替玩家改
- [ ] L4 地点留空 → LLM 用通用背景（不报错）

#### 设计循环
- [ ] 改 L3 → L1 提示 toast"上游可能需要重看"
- [ ] 改 L7 → 触发全链路反思 toast
- [ ] 同 5 分钟内多次改 L7 → 只触发 1 次反思 toast（cooldown）

### 11.3 LLM 行为（手动跑）
- [ ] 写 L5 人物时，LLM 知道派生自 L3+L4
- [ ] 写 L6 三幕时，LLM 知道服务 L1 立意 + 满足 L2 pillars
- [ ] 写 L2 pillars 时，LLM 跑"反向检验"反推合理
- [ ] LLM 行为符合"加血肉"还是"服务立意"——看是否符合哲学意图

---

## 12. 设计意图总结（写到 AGENTS.md / DESIGN.md）

**新设计哲学**（2026-07-30 ~ 07-31 沉淀）：

> **PlotCraft 的概念设计不是 6 步漏斗，是 7 层严格派生的螺旋设计循环。**
>
> **立意第一性**——L1 是故事的根，1 句话核心矛盾。
> **抽象规则独立演进**——L2 pillars 是设计的硬约束，**很难一次写完**，要随设计过程反复精化。
> **派生链**——L3 世界 → L4 地点 → L5 人物 → L6 故事，每一层都是上一层的具象。
> **整合层**——L7 核心体验是所有层的 1 句话总结，最抽象 + 最后写。
> **设计循环**——改任何层都触发全链路反思提示（手动校准，不自动改）。**这是螺旋设计哲学的工具化体现**。
>
> **哲学根**：用户 RPG 设计心法（2026-07-30-07-31）——立意第一 + 先抽象规则再有具体世界 + 人物被世界波浪推到位置。

---

---

## 13. Path A: 可选方法论索引注入（system prompt 注入）

> **2026-07-31 用户决策**：方法论**只做 A 路径**（LLM system prompt 注入），**不做 B 路径**（玩家自主调用 skill 模块）。理由："用户自主调用 skill 反而更不靠谱"——玩家容易忘、需要查工具清单，不如让 LLM 在 prompt 里自动可用。

### 13.1 设计意图

**核心思想**：方法论是 LLM 的"知识背景"——玩家卡住时 LLM 主动引用对应方法给建议，**不强制玩家使用**。

**两条路径对比**：

| 路径 | 形式 | 玩家主动 vs LLM 主动 | 评估 |
|------|------|---------------------|------|
| **A（采纳）** | 200 字方法论索引注入 `buildSystemPrompt` | LLM 在玩家卡住时自动引用 | ✅ 零玩家成本、不破坏玩家主导 |
| B（砍掉） | 工具栏 / slash command / 按钮 | 玩家主动调方法论模板 | ❌ 玩家容易忘、要查工具清单；跟 PlotCraft 玩家主导哲学冲突 |

**为什么 A 比 B 靠谱**：
1. **零玩家成本**——不需要玩家"知道"方法论存在
2. **不破坏工作流**——卡住时 LLM 主动问"要不要试试 X 方法"，玩家可以拒绝
3. **方法论是参考不是规则**——注入 prompt 后 LLM 把方法当"知识"用，不是当"必做清单"用
4. **不增加 UI 复杂度**——不需要新按钮、新菜单、新视图

### 13.2 注入内容（200 字）

**位置**：`src/stores/chat.ts:buildSystemPrompt`，在概念设计相关 chat 时拼接在 system message 末尾。

**`METHODS_HINT` 字符串**（写入 chat store 顶部 const）：

```ts
const METHODS_HINT = `[可选方法论索引 — 玩家主导，非强规则]
- 立意卡住 → McKee controlling idea（1 句价值走向，如"正义必胜"或"纯真会失去"）
- 设计卡住 → Fullerton Iterative（概念→原型→测试→修订，先粗糙再迭代）
- 不知道缺什么 → Fullerton 戏剧元素清单（玩家/目标/冲突/输入/边界/反馈/输出/控制）
- 不知道故事类型 → McKee 故事三角（经典/最小主义/反结构，对应不同美学）
- 玩家要 AI 替写完整内容 → 违反 Playcentric，必须指出"我不替玩家写完整版"
- 玩家做沙盒/涌现式游戏 → 跳过 L6 三幕；只设计 L1-L5 物理规则
这些是参考方法，玩家可弃用。你（AI）不主动推销方法论，只在玩家明显卡住 / 表达困惑时引用对应方法。`
```

**注入时机**：
- **总是注入**（不只在概念设计 chat）——因为方法论也可能用于其他场景（人物卡住、剧情卡住等）
- 拼接在 system prompt 末尾，独立 `[可选方法论索引]` 段落
- 不影响 concept_summary 注入逻辑

### 13.3 LLM 行为约束（hint 内嵌）

注入字符串里**写死**以下行为约束：
1. **不主动推销**——"你（AI）不主动推销方法论"
2. **只在卡住时引用**——"只在玩家明显卡住 / 表达困惑时"
3. **玩家可弃用**——"这些是参考方法，玩家可弃用"
4. **不替写原则**——"玩家要 AI 替写完整内容 → 违反 Playcentric，必须指出不替写"

**为什么写在 hint 里**：
- LLM 直接看到约束，比写在代码注释里更有效
- 防止 LLM "热情过度"——把方法论当推荐品推销
- 防止"工具性"——LLM 主动教玩家"你应该用 X 方法"

### 13.4 文件改动

| # | 文件 | 改动 | 行数 |
|---|------|------|------|
| 1 | `src/stores/chat.ts` | 顶部加 `METHODS_HINT` const + `buildSystemPrompt` 末尾拼接 | +30 -5 |

**总计**：~+30 / -5 ≈ +25 净增，**可独立 commit**：`feat(chat): inject optional method index in system prompt`

### 13.5 token 占用评估

`METHODS_HINT` 字符串约 200 中文字符 ≈ **150-200 tokens**（按 Qwen/GLM 中文 1 char ≈ 0.75-1 token 估）。

**每次 chat 调用都会带**（注入 system message）——这是固定开销，不随对话增长。

**风险**：
- 对短 chat（< 10 round）影响**几乎无感**
- 对长 chat（> 50 round）system prompt 多了 200 tokens，**对 LLM 上下文理解没影响**（system prompt 本来就长）
- **不写**：v0.4+ 默认开启，不做 Settings 开关（玩家主导 ≠ 玩家配置每个细节；玩家可忽略方法论建议即可）

### 13.6 验收

- [ ] `src/stores/chat.ts:buildSystemPrompt` 末尾出现 `[可选方法论索引]` 段落
- [ ] 概念设计 chat 触发后，console 打印 system prompt 能看到方法论索引
- [ ] 手动测试：跟 LLM 说"立意卡住了，不知道怎么写" → LLM 引用 McKee controlling idea
- [ ] 手动测试：跟 LLM 说"你帮我写完整版 L5 人物" → LLM 拒绝并提示"我不替玩家写"
- [ ] `bun run typecheck` 0 error
- [ ] `cd src-tauri && cargo check` 0 error（A 路径不涉及 Rust，纯前端）

### 13.7 B 路径（已砍）—— 记录给未来

**B 路径原本设计**：
- `src/components/methodology/` — 方法论工具栏（按钮 / 卡片）
- `src/lib/methodology-templates.ts` — 6 个方法论模板（McKee controlling idea / Fullerton Iterative / Fullerton 戏剧元素 / McKee 故事三角 / Playcentric / System Dynamics）
- 玩家主动点"用 McKee 改立意"按钮 → 走预定义 prompt template

**为什么砍**：
1. **玩家主导哲学冲突**——PlotCraft 工具不强加方法论；工具栏出现"McKee 按钮"会让玩家觉得"PlotCraft 推 McKee"
2. **玩家自主调用更不靠谱**（用户原话）——容易忘、需要查工具清单、跟 v0.1 开始的"AI 给 3-5 备选，玩家挑+改"哲学冲突
3. **A 路径更轻**——200 字 prompt 注入，零 UI 改动，零新文件

**未来如果需要 B 路径**：
- 必须经过新一轮用户决策 + audit
- 不在 v0.5+ 路线图内
- 可能形态：Settings 里的"高级方法论" sub-tab（默认隐藏，不污染主流程）

---

## 14. 实施顺序（按 A 路径独立 ship 决策更新）

> **2026-07-31 用户决策**：先做 A 路径（方法论注入），再做 7 层模型 + 设计循环。**A 路径可独立 commit、独立验收**，跟主线（7 层改造）解耦。

**Phase 1（独立 commit，可立即 ship）**：
- A 路径：方法论索引注入 `buildSystemPrompt`
- 验收：见 §13.6
- commit: `feat(chat): inject optional method index in system prompt`

**Phase 2（主线，1-2 commit）**：
- 7 层模型改造（§1-§12）
- 设计循环（§3）
- 验收：见 §11

**Phase 3（docs 同步）**：
- AGENTS.md / DESIGN.md / ROADMAP.md / CHAT_LLM_DESIGN.md

**为什么 Phase 1 独立**：
- A 路径是**通用 chat 改进**（不只是概念设计受益）
- 7 层模型是大重构，风险高、可独立 ship 才稳
- 用户工作节奏：先 ship 一个小的高价值改动，验证 LLM 行为再继续

---

**Plan 写完（含 A 路径设计）。停下等用户审。**
