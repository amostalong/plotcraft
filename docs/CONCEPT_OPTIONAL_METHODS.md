# 概念设计可选方法论（参考索引）

> **这份文档不是 PlotCraft 的规则。**
>
> 它只是**外部设计圈总结的方法论索引**——如果玩家在创作过程中想参考某些方法，可以打开这份文档找对应方法。
>
> **PlotCraft 的立场**：每个创作者都有自己的方式。**工具给引导，不强加方法论。**
>
> 如果你完全不用这些方法也能写好故事，那就完全不用。

---

## 怎么用这份文档

1. **不是必读**——你可以一辈子不打开它
2. **遇到问题时打开**——比如"我的故事写到一半卡住了，立意写不准"——看下哪个方法能帮你
3. **可以混用**——6 个方法可以选 1-2 个适合你的组合用，没有"应该全用"的规则
4. **可以弃用**——用一半发现不适合就丢掉，没成本
5. **PlotCraft 不会**因为你的设计方法而改变行为

---

## 6 个方法论速查

| # | 方法 | 一句话 | 适合解决 |
|---|------|--------|----------|
| 1 | Robert McKee Controlling Idea | 故事 = 1 句话价值走向 | 立意写不准、不知道故事在"说什么" |
| 2 | Tracy Fullerton Iterative Design | 概念→原型→测试→修订 | 设计卡住、不知道下一步该做什么 |
| 3 | Tracy Fullerton 戏剧元素 | 故事 = 挑战/玩耍/假定/人物/故事 | 不知道你的故事缺什么元素 |
| 4 | McKee 故事三角 | 经典/最小/反结构 3 种结构 | 不确定你的故事是什么类型 |
| 5 | Playcentric Design | 设计师是玩家代表 | LLM 提示词不替玩家写、玩家主导哲学 |
| 6 | System Dynamics / Emergence | 简单规则涌现复杂行为 | 沙盒/模拟向 RPG，不写线性故事 |

---

## 1. Robert McKee《故事》Controlling Idea

**作者**：Robert McKee（编剧教练，500+ 页书但极度浓缩）

**一句话**：故事的"中心思想" = **1 句话抽象 + 价值走向**

**格式**：`"如果 X，那么 Y"`
- X = 故事设定 / 主人公处境
- Y = 最终价值走向（positive/negative/ambivalent）

**例子**：
- 《鱿鱼游戏》controlling idea: "如果玩家靠智力/权力/善良都无法改变输赢，那么运气就是终极裁判"
- 走向：ambivalent（运气的"公平"反而揭示了不公）
- 你的故事 controlling idea: "如果个体在强权秩序下反抗，那么他会失去纯真"（走向：negative）

**怎么用**：
1. 写完 L1 立意后回头看：你能用"如果...那么..."一句话概括吗？
2. 如果不能——你的立意可能**还没成型**
3. 写完后问自己：故事最终往哪个方向走？（好转/恶化/无解）

**适用**：
- L1 立意（核心矛盾 / 主题）
- L7 核心体验（玩家体验到的价值走向）

**进一步阅读**：
- McKee《故事：材质、结构、风格和银幕剧作的原理》（原书）
- 《救猫咪》Blake Snyder（"logline"概念类似 controlling idea 的简化版）

**PlotCraft 立场**：参考，不强制。PlotCraft 的 L1 立意 hint 不会强制写"如果...那么..."格式——你写 1 句、3 句、诗、图都行。

---

## 2. Tracy Fullerton《Game Design Workshop》Iterative Design

**作者**：Tracy Fullerton（USC 游戏设计系主任）

**一句话**：游戏设计 = **4 阶段循环**——**概念化 → 原型化 → 测试 → 修订**

```
Conceptualization → Prototyping → Playtest → Revision
       ↑____________________________________|
```

**关键洞察**：
- **Playtest 不是开发完才做**——每个阶段都要 playtest
- 设计师是**玩家代表**（advocate for the player）
- **迭代 = 学习**——每轮迭代让你更懂玩家想要什么

**怎么用**：
1. 写完 L1 立意 → **测试**（问自己"这个立意我自己想玩吗？")
2. 写完 L3 世界 → **测试**（问自己"这个世界有趣吗？")
3. 写完 L6 故事 → **测试**（问自己"这故事我想经历吗？")
4. 任何阶段**卡住** → 回到 L1 重看

**适用**：
- 整个 7 层设计的**工作流**
- LLM 校准循环（PlotCraft 的"改任何层触发反思"就是 Iterative Design 的工具化体现）

**进一步阅读**：
- Tracy Fullerton《Game Design Workshop: A Playcentric Approach》
- IDEO 的 "Design Thinking"（类似循环：Empathize → Define → Ideate → Prototype → Test）

**PlotCraft 立场**：PlotCraft 的"设计循环反馈"机制（plan §3）就是 Iterative Design 的工具化体现——但**PlotCraft 不强制你按 4 阶段循环走**。你可以写完 L1 直接跳 L6 再回头改 L3——只要作品好，怎么走都对。

---

## 3. Tracy Fullerton 戏剧元素（Dramatic Elements）

**作者**：Tracy Fullerton（同上）

**一句话**：游戏不只有"formal elements"（规则），还有"dramatic elements"（故事）

**戏剧元素清单**：
- **挑战**（challenge）：玩家面对的困难
- **玩耍**（play）：玩家在故事中"玩"什么
- **假定**（premise）：故事前提
- **人物**（character）：角色
- **故事**（story）：剧情
- **戏剧性弧线**（dramatic arc）：从起点到终点的情感曲线

**怎么用**：
1. 写完 L1-L6 后，**对照清单检查**每个元素是否到位
2. **找出缺的**——比如"我的故事有人物、有故事、但没挑战"——补一个 L3 世界规则或 L5 人物冲突
3. **找出弱的**——比如"人物写得不错，但戏剧性弧线没体现"

**适用**：
- 全局诊断工具——任何阶段都可对照
- 特别适合 L6 三幕（戏剧性弧线）
- 适合 L7 核心体验（"玩家玩什么"是 Fullerton 的"play"维度）

**进一步阅读**：
- Tracy Fullerton《Game Design Workshop》第 4 章
- Chris Crawford《Chris Crawford on Interactive Storytelling》

**PlotCraft 立场**：PlotCraft 的 7 层模型**部分覆盖**这些元素——L1 假定、L5 人物、L6 故事直接对应；"挑战"分散在 L3+L5；"play"在 L7 核心体验。**不强求你写"戏剧性弧线"章节**——但你可以在 L6 故事里写它。

---

## 4. McKee 故事三角（Story Triangle）

**作者**：Robert McKee

**一句话**：故事有 3 种基本结构——**经典 / 最小 / 反结构**

| 类型 | 特点 | 例子 |
|------|------|------|
| **经典设计** | 因果闭合、主动主人公、清晰三幕 | 《教父》《公民凯恩》 |
| **最小主义** | 开放结局、被动观察、留白多 | 《感官世界》《大河恋》 |
| **反结构** | 反传统、意识流、可能无情节 | 《八部半》《重庆森林》 |

**怎么用**：
1. 写完 L6 三幕前问自己：**我的故事是哪一类？**
2. **经典**：你可以按"建置-冲突-解决"清晰写
3. **最小**：三幕的"解决"是开放的——LLM 应该知道你的三幕是"半成品"
4. **反结构**：你可以**完全跳过 L6**——PlotCraft 不会强求你写三幕

**适用**：
- L6 三幕（决定 LLM 怎么帮你写）
- L7 核心体验（玩家体验是闭合还是开放）

**进一步阅读**：
- McKee《故事》第 14 章
- Vladimir Propp《故事形态学》（"31 种叙事功能"——比三角更细）

**PlotCraft 立场**：**PlotCraft 的 L6 three-act 是按"经典设计"假设写的**——但 L6 是**可选 step**（你写 1 行也算写过），**不强制你按"经典"写**。如果你的故事是最小/反结构，写 1 句"这是反结构"就够。

---

## 5. Playcentric Design（玩家中心设计）

**作者**：Tracy Fullerton + 多位 USC 教授

**一句话**：**设计师的核心角色 = 玩家代表**（advocate for the player）

**关键原则**：
- 设计师**永远从玩家视角**评估设计
- 设计师**不替玩家**做决定
- 设计要问"**我想让玩家体验什么？**" 而不是"我想做什么酷的东西？"

**怎么用**：
1. 写完任何 layer 后，问自己"**玩家会怎么感受？**"
2. LLM 提示词 / chip 命名可以**反映玩家视角**（"立意校准"chip = 帮玩家想清楚他想表达什么，不是 AI 替他表达）
3. AI 永远是**辅助**——**不替玩家写**（这条 PlotCraft 工具立场也遵守）

**适用**：
- LLM 提示词（chip 名称、prompt 措辞）
- 玩家主导哲学（PlotCraft 的核心）
- 整个 7 层——任何层都要问"这层对玩家来说意味着什么"

**进一步阅读**：
- Fullerton《Game Design Workshop》第 1 章
- Jesse Schell《The Art of Game Design》第 1 章
- uxdesign.cc / NN/g 的 UX 设计文献

**PlotCraft 立场**：**PlotCraft 整个工具设计都遵循这个原则**——但**这是工具的内部立场**，不是塞给玩家的方法论。玩家在创作时**不需要每步都问"玩家会怎么感受"**——如果他做的是"自己玩"的项目，玩家就是他自己。

---

## 6. System Dynamics / Emergence（系统动力学 / 涌现）

**作者**：Will Wright（《模拟城市》《模拟人生》创始人）

**一句话**：**简单规则涌现复杂行为**——底层规则不多，玩家行为无限可能

**例子**：
- 《模拟城市》：底层规则 = 税收/区域规划/污染；涌现 = 复杂城市生态
- 《MineCraft**：底层规则 = 方块 + 重力 + 物理；涌现 = 无限创作
- D&D：底层规则 = d20 + 职业 + 阵营；涌现 = 无限剧情

**怎么用**：
1. 你的 RPG / 模拟游戏想**让玩家自己造故事** → 写**少而精的规则**
2. 你的故事**不按剧情走** → 不写 L6 三幕，只写 L3 世界规则
3. 写完 L3 后**自检**：你的规则会涌现出**足够有趣的玩家行为**吗？

**适用**：
- L3 世界规则（底层规则）
- L4 地点（具体空间的物理规则）
- L7 核心体验（玩家"玩"什么 = 跟规则互动）

**进一步阅读**：
- Will Wright 多场 GDC 演讲（"Design Lessons from..." 系列）
- 《Rules of Play》Katie Salen & Eric Zimmerman 第 17-19 章
- Ian Bogost《Persuasive Games》

**PlotCraft 立场**：**PlotCraft 不强加"涌现式"或"线性式"**——玩家自己选。如果你的项目是涌现式（沙盒模拟），可以**完全跳过 L6 三幕**（plan 标注 L6 是可选）。如果你的项目是线性剧本，按经典三幕写。**PlotCraft 给工具，不挑方法**。

---

## 怎么选

**不需要"全用 6 个"**——按你卡的点选：

| 你卡在哪 | 看哪个方法 |
|----------|-----------|
| 立意写不准 | McKee Controlling Idea |
| 不知道下一步做什么 | Fullerton Iterative Design |
| 不知道故事缺什么 | Fullerton 戏剧元素 |
| 不知道是哪种故事 | McKee 故事三角 |
| AI 不懂玩家 | Playcentric Design |
| 想做沙盒/模拟 | System Dynamics |

**PlotCraft 工具本身不引用这些方法**——但 LLM 提示词在某些 chip 写出来时，**作者可能引用**。你打开一个 chip 看到"参考 McKee controlling idea 思路"——那是**作者建议，不是 PlotCraft 强规则**。

---

## 注意事项

1. **方法论是脚手架**——**不是建筑本身**。脚手架拆了，建筑还在；用错脚手架，浪费 1 周。
2. **不同方法可以混用**——Fullerton 自己也说"没有银弹方法论"
3. **没有"应该用哪个"**——你试一个不行就换
4. **独立创作者 vs 工作室**——大部分方法论是从**大型游戏开发**经验提炼，独立创作者做 1 个故事**可能不需要全部**
5. **PlotCraft 立场不变**：工具中立，方法自选

---

## 参考资料清单

- **Robert McKee**《故事：材质、结构、风格和银幕剧作的原理》— 编剧圣经
- **Tracy Fullerton**《Game Design Workshop: A Playcentric Approach》— USC 教材
- **Blake Snyder**《救猫咪》— logline 简化版 controlling idea
- **Jesse Schell**《The Art of Game Design》— "lens"框架
- **Chris Crawford**《Chris Crawford on Interactive Storytelling》— 交互叙事先驱
- **Will Wright** 多场 GDC 演讲 — 涌现系统实践
- **Katie Salen & Eric Zimmerman**《Rules of Play》— 游戏规则理论
- **John Truby**《The Anatomy of Story》— 故事结构另一种思路
- **极乐迪斯科 (Disco Elysium)** ZA/UM 团队 GDC 演讲 — 编剧主导 RPG 实践

**注**：这份清单是"如果你想深入研究，可以从这里开始"——**不是必读**。你完全可以在不读这些书的情况下用 PlotCraft 写出好故事。
