// concept pinia store —— 6 层抽象蒸馏模型 + 设计循环 + LLM 辅助（v0.5.3+）
//
// 照搬 stores/art.ts 形状：
// - steps 用 shallowRef 包（反卡顿惯例：大列表不深 reactive）
// - load() 依赖 useProjectStore().current：无项目 → 清空不报错
// - 不做文件监听：玩家手改 concept/ 后点"刷新"重扫（对齐 art）
//
// step chat（v0.3+ 重构：per-item Map 化 + 备选内联化 + 自动落盘）
// - 复用流式 start_chat，store 级 listener 按 runId 过滤（init 幂等）
// - 状态从 per-item Map<stepId, ...> 派生，currentStepId 切步自动切派生
// - 切步保留历史（v0.3+ 内存 per-item）；切项目 flush 老项目 + 清内存 + load 新项目
// - 备选走流式 chat + JSON parse（done 后判定卡片 vs 气泡），删 v0.2 的 generateAlternatives
// - **自动落盘**（v0.3+ 玩家反馈"想保留"）：watch chatHistories → debounce 1s → saveChat
//   位置 <项目>/.chats/concept/<stepId>.json（详见 [docs/AI_PANEL_DESIGN.md]）
//
// 设计循环（v0.5+，6 层沿用）：
// - 改任何 step → markStale 上游 / 下游（黄点 ? 提示）
// - L1 改 → L2-L6 全标 stale（最重）
// - L2-L5 改 → 自己 + 上游 + L6 标 stale
// - L6 改 → L1-L5 全标 stale
// - 黄点消失条件：玩家手动 clearStale(id) 或跑 preset 校准后
// - 5min cooldown for L6 频繁改动（避免 toast 刷屏）—— store 内部防抖
//
// v0.5.1 mtime hash 对比上线（修 v0.5+ "改一下全黄"问题）：
// - save() 内 oldContent / newContent 字符串对比
// - **只有 content 真有变化才 markStale**——避免 debounce 重复触发、纯 markConfirmed 重复保存等场景
// - v0.5.3+ 删 maturity 对比（旧 L2 pillars 4 态成熟度删除）
// - 错别字/小修 → 标 stale（玩家用 X 手动忽略）；方向大改 → 标 stale（玩家用 ? 跑校准）
//   之前：不管大小改都"全黄"，玩家无法区分；现在：黄点本身就是"有改动"的信号，区分交回玩家
//
// 详细设计见 [docs/AI_PANEL_DESIGN.md] + [docs/CONCEPT_REDESIGN_PLAN.md]

import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef, triggerRef, watch, type Ref } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'

import { resolveEnabledTools } from '@/lib/ai-tools'
import { deleteChat, deleteAllChats, loadChats, makeItemKey, saveChat, type ChatFile } from '@/lib/chats'
import { listConceptSteps, saveConceptStep } from '@/lib/concept'
import { resolveLlmConnection } from '@/lib/llm-connection'
import {
  onChatChunk,
  onChatDone,
  onChatError,
  onChatToolCall,
  startChat as rpcStartChat,
} from '@/lib/llm'
import type { PresetAction, StepChatState } from '@/types/ai'
import type { ChatErrorDiag, ChatErrorKind, ChatMessage, ToolCallInfo, ToolCallPartial } from '@/types/chat'
import { STEP_IDS, type ConceptStep, type ConceptStepId } from '@/types/concept'
import { useProjectStore } from './project'
import { useSettingsStore } from './settings'

// === 6 层静态定义（hint = 写作引导语，编辑区显示 + 拼 LLM prompt 的说明部分） ===

export const STEP_HINTS: Record<ConceptStepId, string> = {
  // L1 立意
  seed: '立意 = 故事要讨论的东西。',
  // L2 核心故事（v0.5.3+ 新名；吸收旧 L2 抽象规则 + L6 故事）
  'core-story':
    'L2 核心故事 = 这条故事的叙事脊柱 + 戏剧结构。1-2 段话级别。' +
    '模板：弧线（1 句话）+ 3 幕压力走向（每幕 1 句话）。' +
    '派生 L1 立意——把「主题要表达什么」转成「故事要演什么」。',
  // L3 世界规则（v0.5.3+ 改名；强调"设定 + 法则"是同一件事）
  'world-rules':
    '世界规则 = 宏观设定 + 运作法则。每条 = 是什么 + 怎么运作 + 造成什么冲突。' +
    '派生 L1 立意 + L2 核心故事。',
  // L4 地点（可选）
  locations: '具体空间——地理 / 氛围 / 物理特征 / 跟立意/世界的连接。这是可选的——密室 / 单场景剧可以跳过。不写 NPC（那是 L5 人物）。',
  // L5 人物
  'character-functions': '角色功能——每个人 = 想要什么 + 为什么得不到。人物欲望应追溯到 L3 世界 + L4 地点——不是凭空生成。人物被世界的波浪推到某个位置，他们想要的是对世界压力的回应。',
  // L6 核心玩法（v0.5.3+ 新名；吸收旧 L7 核心体验 + 新增核心机制）
  'core-gameplay':
    'L6 核心玩法 = 玩家玩什么 + 怎么玩 + 感受到什么。两部分：' +
    '1. 核心机制（回合制 / 文字冒险 / 资源管理 / 角色羁绊 / 选择驱动 / 等）' +
    '2. 1 句话玩家体验（「你扮演 X，在 Y，做 Z」）' +
    '派生 L1-L5——核心机制派生世界 + 人物；体验整合整链路。',
}

// === 设计循环校准 prompt（v0.5.3+ 简化：3 个校准 prompt） ===
// v0.5.3+ 从 v0.5+ 5 个校准 prompt 简化到 3 个：
// - L1 立意校准：问 3 个尖锐问题（立意特殊性扩展）
// - L2-L5 上游校准：检查当前 step 是否还服务 L1 立意 + L2 核心故事
// - L6 全链路整合：跑 L1-L6 整链路一致性检查
// v0.5+ 旧 PILLAR_REVERSE_CHECK（pillars 专用）+ RECALIBRATE_DOWNSTREAM（L1 模板）删除
// 完整设计见 docs/CONCEPT_REDESIGN_PLAN.md §3.3

const RECALIBRATE_UPSTREAM_PROMPT =
  '当前 step 刚刚改过（或上游有变化）。' +
  '它可能跟上游 L1 立意 + L2 核心故事 不一致。' +
  '逐条检查：' +
  '1. 当前 step 是否还服务 L1 立意？' +
  '2. 当前 step 是否还派生 L2 核心故事 的弧线？' +
  '3. 哪些句子需要回看 L1+L2 才能确定？' +
  '指出问题点 + 建议方向（不替玩家写完整版）。'

const RECALIBRATE_FULL_CHAIN_PROMPT =
  'L6 核心玩法 刚刚改过（或上游关键层有重大变化）。' +
  '跑全链路一致性检查：' +
  '1. L1 立意 → L2 核心故事：故事弧线还服务于立意吗？' +
  '2. L1+L2 → L3 世界规则：世界还派生 L2 + 服务立意吗？' +
  '3. L3 → L4 地点：地点还显形 L3 规则吗？' +
  '4. L3+L4 → L5 人物：人物欲望还派生自世界 + 地点吗？' +
  '5. L1-L5 → L6 核心玩法：核心机制 + 体验还反映整链路吗？' +
  '指出每层的不一致点 + 建议方向（不替玩家写）。'

/** L1 立意校准 prompt（立意特殊性扩展，问 3 个尖锐问题） */
const L1_RECALIBRATE_PROMPT =
  '上游刚刚改过，或立意刚改。' +
  '当前 step（立意）内容可能与新上游不一致。' +
  '逐条检查：' +
  '1. 当前 step 的关键论断是否还被新上游支持？' +
  '2. 哪些句子需要重写、哪些保留？' +
  '3. 指出具体段落 + 建议方向（不替玩家写完整版）。' +
  '\n\n立意特殊性 —— 立意是整个设计的哲学根：' +
  '问 3 个尖锐问题帮 ta 确认：' +
  '1. 这次改立意是要「大改方向」还是「精化措辞」？' +
  '2. 如果是大改方向 —— 玩家准备好 L2-L6 全部重看吗？' +
  '3. 玩家希望先看 L1 新立意 vs 旧下游的不一致点，还是先继续写 L2+？' +
  '根据玩家回答决定下一步（不替玩家做决定）。'

// === Preset 共享片段 ===

// v0.5+ 备选类 chip 通用尾巴（强制调 ask_choose_option tool）
// - 玩家 2026-08-03 反馈：点「✨ 润色这一步」后 LLM 完全沉默 → fallback "(AI 无回复)"
// - 根因：旧 JSON_TAIL 写"**优先**用 ask_choose_option tool + **如果不调 tool** 就返 JSON 数组"
//   （软约束 + fallback），跟 SYSTEM_PROMPT "1 round 1 tool call" 硬规则互相打架，
//   deepseek-v4-flash 在矛盾指令下选沉默（既不调 tool 也不出 text）→ AltCard 一个不渲染
// - 修：钉死**必须**调 ask_choose_option tool，去掉 markdown / JSON 数组兜底
//   - LLM 跟 system 提示"必须 tool call"一致，没有退路 → 不再犹豫
//   - 万一 model 真不支持 tool（理论上 v0.4+ 都不该用），就 fallback "(AI 无回复)"（边界 case）
//   - 旧的 JSON 数组解析路径（lib/alternatives.ts）保留作 defense-in-depth，但不靠它走
// - 跟 REFLECT_TAIL（ask_user_question 强制回复）对称：两者都是"必须调某个 tool，无 fallback"
const OPTION_TAIL =
  '**必须**用 ask_choose_option tool 提问（不要返 markdown 文本 / JSON 数组）：\n' +
  '- 调 1 次 ask_choose_option tool（不要调多次）\n' +
  '- options 数组给 2-5 个互斥备选（不要重复 / 不要"其他"兜底）\n' +
  '- 每项：label（≤10 字）+ preview（完整备选内容）+ description（可选，hover tooltip）\n' +
  '- **不要**在 tool call 前后加 preamble / 客套话 / 解释 / 思考过程\n' +
  '基于当前步骤最新内容回答。'

/** 反思/追问类 preset 通用尾巴（v0.5+ 强制走 ask_user_question tool，1 个问题版）
 *  - v0.5+ 旧名 ask_free_text（这个名被"向用户问问题"语义接管了）
 *  - **强制回复**：玩家在下方 composer 直接打字答（v0.4.4.1+ 之前是 bubble 内嵌 N 个 input，
 *    UX 上"上下一对输入框"看着冗余 —— 玩家 2026-08-03 反馈后改成单问题，UX 跟普通聊天一致）
 *  - **调 1 次** ask_user_question tool：question 字段里**只写 1 个问题**（不要用编号拆多个）
 *  - **不要**给选项（ask_choose_option 是另一条路径，给的是备选不是反思）
 *  - **不要**调 update_doc_item（玩家没要求改编辑器）
 *  - 玩家主导：只问问题，玩家自己答，绝不替玩家做决定
 *  - 跟之前 v0.4+ 区别：之前没明确说用哪个 tool，LLM 自作主张可能调 ask_choose_option / update_doc_item / 多次 ask_user_question
 *    ——现在钉死：1 次 ask_user_question + 单问题，UI 整合到 composer，无需拆 N 个 input
 *  - 跟 polish/expand/generate 的 OPTION_TAIL 一样明确"用什么 tool + 输出形态"
 */
const REFLECT_TAIL =
  '**强制走 ask_user_question tool（1 round 1 次调用，question 字段写 1 个问题）**：\n' +
  '1. **调 1 次** ask_user_question（不要调多次 / 不要调 ask_choose_option / 不要调 update_doc_item）\n' +
  '2. **question 字段**里**只写 1 个问题**（不要用 1./2./3. 编号拆多个问题）—— 玩家在下方 composer 直接打字回答，\n' +
  '   UX 跟普通聊天一致，不要让玩家在多个 input 之间跳来跳去\n' +
  '3. 玩家**回车提交**后，UI 自动把内容作为 ask_user_question 的 tool_result 喂回 LLM\n' +
  '4. **不要**给选项 / 不要替玩家做决定 / 不要说"好的""让我分析"等客套话\n' +
  '5. **关键**：所有问题必须**主题层**（"这论断独立成立吗？""玩家能带走吗？"），**不要**问"主角是谁""主角想什么""故事发生在哪里"——那是 L5/L6 的事，不是 L1 立意。\n' +
  '6. 基于当前步骤最新内容回答。'

/** 润色 / 扩展 类 preset 通用指令（v0.3+ 改成"出 3-5 个不同方向的备选"）
 *  - v0.3 早期是"输出完整润色/扩展后的版本" (一个 bubble), 玩家只能采用或放弃
 *  - v0.3 后改成跟 generate 一样: LLM 一次给 3-5 个不同方向, 玩家挑一个
 *  - v0.4+ 改走 tool calling：LLM 优先调 `ask_user_question` tool 返备选，
 *    玩家挑一个后再 LLM round 2 调 `update_doc_item` tool 写入
 *  - 这俩 instruction 拼好后, store sendStepChat 会再 append 当前 step.content
 *    (不依赖 system 注入, 确保 LLM 拿到完整原文做改造) */
const POLISH_INSTRUCTION =
  '把这步的内容润色 3-5 个不同方向。每个备选都要：\n' +
  '- 保持原意，不改方向\n' +
  '- 改进表达：更精炼 / 更有画面感 / 节奏更紧凑\n' +
  '- 删废话，保留关键信息\n' +
  '- 是完整润色后的版本（不是修改说明）\n' +
  '- 长度跟原文相当（不要扩长，那是另一个 chip 的事）'

const EXPAND_INSTRUCTION =
  '把这步的内容扩展 3-5 个不同方向。每个备选都要：\n' +
  '- 保持原意，不改方向\n' +
  '- 加细节 / 加例子 / 加场景 / 加张力\n' +
  '- 让内容更具体、更可玩、更有画面\n' +
  '- 是完整扩展后的版本（不是扩展说明）\n' +
  '- 长度比原文明显更长（至少 1.5 倍，扩写就是要更厚）'

// === 6 层 × 5 chip 静态配置（v0.5.3+ 简化：4 基础 + 1 校准） ===
// v0.5+ 7 层 × 5 chip → v0.5.3+ 6 层 × 5 chip（数量不变，校准 prompt 简化 4→3）
// 每层 5 chip：generate / reflect / polish / expand / 校准
// - L1 立意：校准 chip = "🎯 立意校准"（L1_RECALIBRATE：问 3 尖锐问题）
// - L2 核心故事 / L3 世界规则 / L4 地点 / L5 人物：校准 chip = "⬆️ 上游校准"（RECALIBRATE_UPSTREAM）
// - L6 核心玩法：校准 chip = "🌀 全链路整合"（RECALIBRATE_FULL_CHAIN）
// v0.5+ 旧 PILLAR_REVERSE_CHECK（pillars 专用）+ L2 pillars 的 "🔄 反向检验" chip 删除

const STANDARD_PRESETS: PresetAction[] = [
  {
    label: '✨ 润色这一步',
    prompt: POLISH_INSTRUCTION + OPTION_TAIL,
    action: 'polish',
    // v0.4.4+ 让 LLM 重新调 ask_choose_option 出新备选（玩家可换思路）；不锁 chip
    allowDuringPending: true,
  },
  {
    label: '🌱 扩展这一步',
    prompt: EXPAND_INSTRUCTION + OPTION_TAIL,
    action: 'expand',
    // v0.4.4+ 同上
    allowDuringPending: true,
  },
]

export const STEP_PRESETS: Record<ConceptStepId, PresetAction[]> = {
  // L1 立意
  seed: [
    {
      label: '💡 给 3-5 个立意方向',
      prompt:
        '根据玩家给的素材，给出 3-5 个不同方向的立意版本（不同主题 / 不同设计者论断）。' +
        '每个版本是**设计者要表达的话**（主题 / 论断）——不是故事，不依赖具体人物 / 处境 / 情节。' +
        '**禁止**用「主角在 X 处境下...」「XX 想...」这种故事模板——立意是主题层，比故事高一层。' +
        '能套多个故事也成立的才算立意。' +
        OPTION_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 反问我 3 个尖锐问题',
      prompt: '玩家立意模糊时，先反问 3 个尖锐问题逼玩家想清楚（不要急着给答案）。' + REFLECT_TAIL,
      action: 'reflect',
    },
    ...STANDARD_PRESETS,
    {
      label: '🎯 立意校准',
      prompt: L1_RECALIBRATE_PROMPT + OPTION_TAIL,
      action: 'calibrate',
      // v0.4.4+ 同上
      allowDuringPending: true,
    },
  ],
  // L2 核心故事（v0.5.3+ 新名；吸收旧 L2 抽象规则 + L6 故事）
  'core-story': [
    {
      label: '💡 从立意拆核心故事',
      prompt:
        '从 L1 立意拆 3-5 个不同方向的 L2 核心故事版本：' +
        '每个版本是 1-2 段话 = 弧线（1 句话）+ 3 幕压力走向（每幕 1 句话）。' +
        '派生 L1 立意——把「主题要表达什么」转成「故事要演什么」。' +
        OPTION_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检查弧线是否服务立意',
      prompt:
        '检查玩家写的核心故事弧线是否真的服务 L1 立意（弧线对不上立意 → 故事跑偏）。' +
        REFLECT_TAIL,
      action: 'reflect',
    },
    ...STANDARD_PRESETS,
    {
      label: '⬆️ 上游校准',
      prompt: RECALIBRATE_UPSTREAM_PROMPT + OPTION_TAIL,
      action: 'calibrate',
      // v0.4.4+ 同上
      allowDuringPending: true,
    },
  ],
  // L3 世界规则（v0.5.3+ 改名；强调"设定 + 法则"是同一件事）
  'world-rules': [
    {
      label: '💡 从立意 + 核心故事推世界',
      prompt:
        '从 L1 立意 + L2 核心故事 推 3-5 条世界规则，每条 = 是什么 + 怎么运作 + 造成什么冲突。' +
        OPTION_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检查规则间冲突',
      prompt: '检查玩家写的世界规则有没有规则间冲突 / 压死玩法的情况。' + REFLECT_TAIL,
      action: 'reflect',
    },
    ...STANDARD_PRESETS,
    {
      label: '⬆️ 上游校准',
      prompt: RECALIBRATE_UPSTREAM_PROMPT + OPTION_TAIL,
      action: 'calibrate',
      // v0.4.4+ 同上
      allowDuringPending: true,
    },
  ],
  // L4 地点（可选）
  locations: [
    {
      label: '💡 从世界显形地点',
      prompt: '从 L3 世界规则在哪些具体空间显形 —— 给出 3-5 个地点（地理 + 氛围 + 立意连接）。' + OPTION_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 地点有没有显形 L3',
      prompt: '检查玩家写的地点是不是真的显形 L3 世界规则的某条（显不出来的就是装饰）。' + REFLECT_TAIL,
      action: 'reflect',
    },
    ...STANDARD_PRESETS,
    {
      label: '⬆️ 上游校准',
      prompt: RECALIBRATE_UPSTREAM_PROMPT + OPTION_TAIL,
      action: 'calibrate',
      // v0.4.4+ 同上
      allowDuringPending: true,
    },
  ],
  // L5 人物
  'character-functions': [
    {
      label: '💡 人物从世界长出来',
      prompt:
        '按 L3 世界规则 + L4 地点生成人物候选：' +
        '每个角色写清「想要什么 + 为什么得不到」+ 追溯到 L3+L4 哪条。' +
        '模式：对手 = 核心故事反面人格化；镜子 = 主角另一种可能；推手 = 推进情节。' +
        OPTION_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检查人物是不是纸片人',
      prompt: '检查玩家写的人物是不是纸片人（缺「想要什么」或「为什么得不到」的打回）。' + REFLECT_TAIL,
      action: 'reflect',
    },
    ...STANDARD_PRESETS,
    {
      label: '⬆️ 上游校准',
      prompt: RECALIBRATE_UPSTREAM_PROMPT + OPTION_TAIL,
      action: 'calibrate',
      // v0.4.4+ 同上
      allowDuringPending: true,
    },
  ],
  // L6 核心玩法（v0.5.3+ 新名；吸收旧 L7 核心体验 + 新增核心机制）
  'core-gameplay': [
    {
      label: '💡 给 3-5 种核心玩法',
      prompt:
        '整合 L1-L5 给出 3-5 种核心玩法方向，每种写清 2 部分：' +
        '1. 核心机制（回合制 / 文字冒险 / 资源管理 / 角色羁绊 / 选择驱动 / 等）' +
        '2. 1 句话玩家体验（「你扮演 X，在 Y，做 Z」）' +
        OPTION_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 核心玩法有没有反映整链路',
      prompt:
        '检查玩家写的核心玩法是不是真的反映 L1-L5 整链路（核心机制派生世界 + 人物；体验整合整链路）。' +
        REFLECT_TAIL,
      action: 'reflect',
    },
    ...STANDARD_PRESETS,
    {
      label: '🌀 全链路整合',
      prompt: RECALIBRATE_FULL_CHAIN_PROMPT + OPTION_TAIL,
      action: 'calibrate',
      // v0.4.4+ 同上
      allowDuringPending: true,
    },
  ],
}

/** step chat 的 system prompt（对话形态：所有 preset 走 start_chat 流式 + chip prompt 是 user message）
 *  - 角色 + 约束 + 玩家主导（v0.3+ 统一骨架）
 *  - 具体的"输出 JSON 数组"约束在 preset.prompt 里（user message），但 v0.3+ system 也强调
 *    "严格遵循用户消息的格式要求"，避免 LLM 默认走 markdown 啰嗦模式
 *  - 默认 markdown 形态；用户消息若要求 JSON 则必须 JSON
 *  - **v0.4.1+ 写入模式提示**：调 update_doc_item 时分清 replace vs append —
 *    整段完整内容 → mode=replace (默认); 局部补全/单条规则/一句话 → mode=append。
 *    反思/提问/解释类输出**不要**用 update_doc_item, 用 ask_choose_option / ask_user_question */
function stepChatSystemPrompt(step: ConceptStep): string {
  return (
    `你是 PlotCraft 的 AI 编剧搭档，正在帮玩家做「${step.title}」这一步。\n` +
    `这一步要写什么：${STEP_HINTS[step.id as ConceptStepId] ?? ''}\n` +
    `玩家主导原则：你只给备选/追问/建议，玩家挑+改，绝不替玩家做决定。\n` +
    `**严格遵循用户消息中指定的输出格式**：\n` +
    `- 如果用户要求 JSON 数组 → 第一个字符必须是 \`[\`，**不要**任何额外文字/preamble/思考/解释\n` +
    `- 如果用户没指定 → 输出 markdown，保持简洁\n` +
    `**写入模式**（调 update_doc_item 时）：整段完整内容 → mode=replace（默认）；` +
    `局部补全 / 一句话 / 一条规则 → mode=append。` +
    `反思 / 提问 / 解释 → 用 ask_choose_option / ask_user_question，不要用 update_doc_item。`
  )
}

/** 拼 context：前面步骤的 confirmed 内容（按 STEP_IDS 顺序取当前步之前的） */
function buildContext(steps: ConceptStep[], currentId: string): string {
  const idx = steps.findIndex((s) => s.id === currentId)
  const prior = steps.slice(0, idx === -1 ? 0 : idx).filter((s) => s.status === 'confirmed')
  if (prior.length === 0) return ''
  return (
    '已确认的前置步骤（生成内容必须与之保持一致）：\n' +
    prior.map((s) => `## ${s.title}\n${s.content.trim()}`).join('\n\n')
  )
}

export const useConceptStore = defineStore('concept', () => {
  const steps = shallowRef<ConceptStep[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const currentStepId = ref<string>('seed')

  // === load / save（照搬 art store 形状） ===

  /** 扫描当前项目 concept/ —— 无项目 → 清空（不报错）
   *  v0.3+ 同时加载 .chats/concept/*.json 到 chatHistories（chat 落盘）*/
  async function load(): Promise<void> {
    const project = useProjectStore()
    if (!project.current) {
      steps.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      steps.value = await listConceptSteps(project.current.folder)
      // 加载 chat 历史（v0.3+ 落盘）
      const chats = await loadChats(project.current.folder)
      const next = new Map<string, ChatMessage[]>()
      for (const [itemKey, file] of Object.entries(chats)) {
        // 后端返回的 itemKey 是 "concept:seed" 格式 → store 内部 key 也是 "concept:seed"（落盘 key 与 in-memory 一致）
        next.set(itemKey, file.messages)
      }
      chatHistories.value = next
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      console.error('[concept.load] failed:', e)
    } finally {
      loading.value = false
    }
  }

  /** 保存一步（v0.3+ 永远 markConfirmed=true：玩家操作 = 自动 confirmed，不再有"标记为已确认"按钮）
   *  v0.5.3+ 删 maturity 参数（L2 核心故事 不再有 4 态成熟度）
   *  v0.5+ 设计循环：成功 → markStale(stepId) 触发下游/上游黄点
   *  v0.5.1 mtime hash 对比：保存前拿 oldContent，后端返回 newContent，
   *    真有变化才 markStale——避免 debounce 重复触发、纯 markConfirmed 重复保存等场景下"改一下全黄"
   *  成功用后端返回的 step 替换本地项（shallowRef → 整个数组换新引用）；
   *  失败抛错让 UI 提示 */
  async function save(
    stepId: ConceptStepId,
    content: string,
    markConfirmed: boolean,
  ): Promise<void> {
    const project = useProjectStore()
    if (!project.current) throw new Error('没有打开的项目')
    // v0.5.1 拿旧 content（save 前可能没加载过 steps，oldStep 可能 undefined → 视为变化）
    const oldStep = steps.value.find((s) => s.id === stepId)
    const oldContent = oldStep?.content ?? ''
    const updated = await saveConceptStep(
      project.current.folder,
      stepId,
      content,
      markConfirmed,
    )
    steps.value = steps.value.map((s) => (s.id === stepId ? updated : s))
    // v0.5.1 mtime hash 对比：content 真有变化才 markStale
    // - 字符串比较（O(n) 但 content 不大，不引入 hash 库）
    // - oldStep undefined（极少见：load 失败但还能 save）→ 视为变化触发 markStale，行为保守
    if (oldContent !== updated.content) {
      markStaleAfterSave(stepId)
      // v0.5+ sync：概念 L3/L4 改了 → 通知 world store 标对应 doc stale
      // - 只 L3/L4 跟世界 tab 有派生关系，其他 5 步不动 world
      // - dynamic import 避免循环 module 依赖
      // - 失败不影响保存成功（玩家主导：sync 是软提示）
      if (stepId === 'world-rules' || stepId === 'locations') {
        try {
          const mod = await import('./world')
          mod.useWorldStore().markStaleFromConcept(stepId)
        } catch (e) {
          console.warn('[concept.save] world sync notify failed (non-fatal):', e)
        }
      }
    }
  }

  // === step chat v0.3+ per-item Map 化 + 自动落盘 ===
  //
  // 5 个 Map<stepId, ...> + 1 个 Map<stepId, runId>，shallowRef 包；
  // shallowRef(new Map) 的 set/get 不自动追踪响应性 → 用 triggerRef 显式触发
  // 设计：见 [docs/AI_PANEL_DESIGN.md §3.3 + §4.3]
  //
  // **v0.3+ 落盘**：store 内部 key = "concept:<stepId>"（与后端 item_key 格式一致），
  // 派生 computed `messages` 等按 `concept:${currentStepId}` 取值。
  // chatHistories 整体变化 → debounce 1s → flushChatsToDisk 写盘
  // reset / clearAll 立即 delete（不等 debounce）

  const chatHistories = shallowRef(new Map<string, ChatMessage[]>())
  const chatTexts = shallowRef(new Map<string, string>())
  const chatStreamings = shallowRef(new Map<string, boolean>())
  const chatErrorKinds = shallowRef(new Map<string, ChatErrorKind | null>())
  const chatErrorRaws = shallowRef(new Map<string, string | null>())
  // v0.4.1+ 错误诊断包（endpoint / model / api_format / request_body_preview）——
  // 错误条 "复制诊断信息" 按钮用
  const chatErrorDiags = shallowRef(new Map<string, ChatErrorDiag | null>())
  const chatRunIds = shallowRef(new Map<string, string | null>())

  // v0.4.4+ ask_free_text tool 强制回复协议（"就地输入" 模式，1 round 1 ask_free_text 多问题版）
  // - Map<toolCallId, { question, answer? }>
  //   - LLM 调 1 次 ask_free_text，question 字段里用 1./2./3. 编号列所有要问的问题
  //   - onChatDone 写入 { question }（answer 还没填）
  //   - UI 拆 question 编号 → N 个 input → 玩家在 N 个 input 各自打字 → 实时更新 answer
  //   - 玩家点 "提交所有回答" → sendAllAskFreeTextAnswers → 把 N 个 answer 合成 1 条 tool message 发回 LLM
  //   - 协议要求：1 round 1 个 tool_call → 1 个 tool_result 配对，UI 永远 0/1 pending entry（1 round 1 ask_free_text 调用）
  //   - 答完 → LLM 拿到 tool_result → 决定下一步（可能再调 1 次 ask_free_text 进 round 2，也可能直接出 text）
  // - 跟 chatHistories 一样 per-item，切步保留
  // - shallowRef + triggerRef 手动触发响应
  // - 详见 docs/AI_PANEL_DESIGN.md §ask_free_text 强制回复
  const askFreeTextPending = shallowRef(new Map<string, Map<string, { question: string; answer?: string }>>())

  // v0.4.4+ 全 tool 通用 pending（ask_choose_option / ask_user_question / update_doc_item 都在等玩家反应）
  // - Map<itemId, Set<toolCallId>>
  // - LLM 调 tool 时 add（onChatDone 扫 tool_calls）
  // - 玩家反应时 remove（sendToolResult / sendAllAskFreeTextAnswers 内部）
  // - 玩家"放弃"时 remove（cancelPendingToolCall 内部）
  // - 协议：1 round 1 tool_call → 1 tool_result 配对。set 永远 0/1 entry（v0.4.4+ 钉死 1 round 1 tool_call）
  // - AiChatPanel 据此锁 composer（避免玩家绕开 AltCard 用 composer 输入破坏协议）
  //   → 玩家 2026-08-02 撞 deepseek "No tool output found" bug 根因
  // - 防御性兼容：理论 LLM 1 round 1 tool_call，但万一 LLM 调多次，set 多个 entry 也兼容（每个单独 track）
  const pendingToolCalls = shallowRef(new Map<string, Set<string>>())

  // v0.5+ silently 改写常量（cancelPendingToolCall silently=true 写入 assistant message.content）
  // - runChatRound 拼 messages 时扫 chatHistories，匹配这个 content 的 assistant message → 临时补 tool message
  //   给 LLM（OpenAI 协议层 tool_calls + tool_result 配对），**不**改 chatHistories
  // - 不用维护 separate state（per item Set）——直接 string 匹配（content 固定就是这串）
  // - 永久性：chatHistories 存盘后 replay 仍能 detect
  const SILENTLY_ABANDONED_CONTENT = '玩家放弃这批备选，等玩家打字。'

  function mapGet<T>(ref: Ref<Map<string, T>>, key: string, fallback: T): T {
    return ref.value.get(key) ?? fallback
  }
  function mapSet<T>(ref: Ref<Map<string, T>>, key: string, value: T): void {
    ref.value.set(key, value)
    triggerRef(ref)
  }

  /** 按 runId 找 itemId（chunk/done/error listener 用）*/
  function findItemByRunId(runId: string): string | null {
    for (const [id, rid] of chatRunIds.value) {
      if (rid === runId) return id
    }
    return null
  }

  /** 当前 step 在 store 内部的 chat map key（"concept:<stepId>"）*/
  function currentItemKey(): string {
    return makeItemKey('concept', currentStepId.value)
  }

  // 派生 computed —— 组件拿到的是 currentStepId 对应的那一份
  const messages = computed<ChatMessage[]>(() => mapGet(chatHistories, currentItemKey(), []))
  const text = computed<string>(() => mapGet(chatTexts, currentItemKey(), ''))
  const streaming = computed<boolean>(() => mapGet(chatStreamings, currentItemKey(), false))
  const errorKind = computed<ChatErrorKind | null>(() =>
    mapGet(chatErrorKinds, currentItemKey(), null),
  )
  const errorRaw = computed<string | null>(() => mapGet(chatErrorRaws, currentItemKey(), null))
  const errorDiag = computed<ChatErrorDiag | null>(() =>
    mapGet(chatErrorDiags, currentItemKey(), null),
  )

  // === step chat listener 初始化（幂等） ===

  let listenerInit = false
  const unlistenFns: UnlistenFn[] = []

  /** v0.4+ tool call 累积状态（per-item Map<index, ToolCallInfo>）
   *  - 流式累积：start 时 id+name 已知, arguments 后续累积
   *  - done 时（arguments 合法 JSON 或 done event 触发）→ 转成 ToolCallInfo 存到 chatHistories
   *  - 跟 chatTexts 一样是 per-item Map，shallowRef + triggerRef
   *  - 切步 / 切项目 / reset 时清 */
  const chatToolCalls = shallowRef(new Map<string, Map<number, ToolCallInfo>>())

  // === v0.4.4+ ask_free_text pending helpers ===
  // 浅拷贝 Map + 设值 + triggerRef
  function mapGetAskFreeText(itemId: string): Map<string, { question: string; answer?: string }> {
    return askFreeTextPending.value.get(itemId) ?? new Map()
  }
  function mapSetAskFreeText(
    itemId: string,
    pending: Map<string, { question: string; answer?: string }>,
  ): void {
    askFreeTextPending.value.set(itemId, pending)
    triggerRef(askFreeTextPending)
  }
  function clearAskFreeTextForItem(itemId: string): void {
    const next = new Map(askFreeTextPending.value)
    next.delete(itemId)
    askFreeTextPending.value = next
    triggerRef(askFreeTextPending)
  }

  // === v0.4.4+ 全 tool 通用 pending helpers（ask_choose_option / ask_user_question / update_doc_item 通用）===
  /** 取当前 item 的 pending tool_call id 集合（深拷，UI 直接用） */
  function mapGetPendingToolCalls(itemId: string): Set<string> {
    return new Set(pendingToolCalls.value.get(itemId) ?? [])
  }
  /** 加 tool_call 到 pending（LLM 调 tool 时） */
  function addPendingToolCall(itemId: string, toolCallId: string): void {
    const cur = pendingToolCalls.value.get(itemId)
    const next = cur ? new Set(cur) : new Set<string>()
    next.add(toolCallId)
    pendingToolCalls.value.set(itemId, next)
    triggerRef(pendingToolCalls)
  }
  /** 从 pending 移除 tool_call（玩家反应时 / 玩家放弃时） */
  function removePendingToolCall(itemId: string, toolCallId: string): void {
    const cur = pendingToolCalls.value.get(itemId)
    if (!cur || !cur.has(toolCallId)) return
    const next = new Set(cur)
    next.delete(toolCallId)
    if (next.size === 0) {
      const outer = new Map(pendingToolCalls.value)
      outer.delete(itemId)
      pendingToolCalls.value = outer
    } else {
      pendingToolCalls.value.set(itemId, next)
    }
    triggerRef(pendingToolCalls)
  }
  /** 清空 item 的所有 pending（防御性，正常不调） */
  function clearPendingToolCallsForItem(itemId: string): void {
    const outer = new Map(pendingToolCalls.value)
    if (outer.delete(itemId)) {
      pendingToolCalls.value = outer
      triggerRef(pendingToolCalls)
    }
  }

  /** 解析 ask_free_text tool 的 arguments（JSON 字符串）→ { question }
   *  - 失败 → null
   *  - 跟 AiChatPanel.vue 的 parseAskUserQuestion / parseAskFreeText 同款 try/catch
   *  - store 端单独用一份（不依赖 AiChatPanel 的实现） */
  function parseAskFreeTextArgs(tc: ToolCallInfo): { question: string } | null {
    try {
      const args = JSON.parse(tc.arguments)
      if (typeof args.question !== 'string') return null
      return { question: args.question }
    } catch {
      return null
    }
  }

  function mapGetToolCalls(itemId: string): Map<number, ToolCallInfo> {
    return chatToolCalls.value.get(itemId) ?? new Map()
  }

  function mapSetToolCalls(itemId: string, tc: Map<number, ToolCallInfo>) {
    chatToolCalls.value.set(itemId, tc)
    triggerRef(chatToolCalls)
  }

  /** 流式累积一个 tool call partial 到对应 item 的 tool call 状态 */
  function accumulateToolCallPartial(itemId: string, partial: ToolCallPartial) {
    const tc = new Map(mapGetToolCalls(itemId))
    const existing = tc.get(partial.index)
    if (partial.id || partial.name) {
      // start chunk：建/覆盖 entry
      tc.set(partial.index, {
        id: partial.id ?? existing?.id ?? '',
        name: partial.name ?? existing?.name ?? '',
        arguments: (existing?.arguments ?? '') + partial.arguments_delta,
      })
    } else {
      // delta chunk：arguments 累积
      if (existing) {
        tc.set(partial.index, {
          id: existing.id,
          name: existing.name,
          arguments: existing.arguments + partial.arguments_delta,
        })
      } else {
        // 没 start 直接 delta（异常）：建临时 entry
        tc.set(partial.index, {
          id: '',
          name: '',
          arguments: partial.arguments_delta,
        })
      }
    }
    mapSetToolCalls(itemId, tc)
  }

  async function init(): Promise<void> {
    if (listenerInit) return
    listenerInit = true
    unlistenFns.push(
      await onChatChunk((payload) => {
        const id = findItemByRunId(payload.run_id)
        if (!id) return
        mapSet(chatTexts, id, mapGet(chatTexts, id, '') + payload.text)
      }),
    )
    // v0.4+ tool call 流式事件订阅 —— 按 runId 过滤后累积到 chatToolCalls
    unlistenFns.push(
      await onChatToolCall((payload) => {
        const id = findItemByRunId(payload.run_id)
        if (!id) return
        for (const partial of payload.calls) {
          accumulateToolCallPartial(id, partial)
        }
      }),
    )
    unlistenFns.push(
      await onChatDone((payload) => {
        const id = findItemByRunId(payload.run_id)
        if (!id) return
        const accumulated = mapGet(chatTexts, id, '')
        const tcs = mapGetToolCalls(id)
        // v0.4+ tool call 模式：没 text content（LLM 纯 tool call, 没自然语言）
        // → 写空 content 但带 tool_calls 的 assistant message
        if (accumulated) {
          const cur = mapGet(chatHistories, id, [])
          // 拷触发这条回复的 user message 的 action（决定渲染分支：cards / polish-bubble / expand-bubble / reflect-bubble）
          const lastUser = [...cur].reverse().find((m) => m.role === 'user')
          const toolCalls = tcs.size > 0 ? Array.from(tcs.values()) : undefined
          mapSet(chatHistories, id, [
            ...cur,
            {
              role: 'assistant',
              content: accumulated,
              action: lastUser?.action,
              tool_calls: toolCalls,
            },
          ])
          console.log(
            `[concept.onChatDone] ${id} run=${payload.run_id} OK: contentLen=${accumulated.length}, action=${lastUser?.action ?? 'none'}, toolCalls=${toolCalls?.length ?? 0}`,
          )
          // v0.4.4.1+ 诊断：打出 LLM 实际回复的 content + tool_calls（玩家截图"AI 回复"空内容 bug 排查用）
          // - 仅 dev 模式输出（import.meta.env.DEV 是 Vite 原生 dev 标志）
          // - 生产 release 前可整体删（已修玩家报的 bug，遗留只为后续类似 bug 留排查入口）
          if (import.meta.env.DEV) {
            console.log(
              `[concept.onChatDone.DIAG] ${id} run=${payload.run_id} CONTENT: ${JSON.stringify(accumulated).slice(0, 200)}`,
            )
            if (toolCalls && toolCalls.length > 0) {
              console.log(
                `[concept.onChatDone.DIAG] ${id} run=${payload.run_id} TOOL_CALLS:`,
                toolCalls.map((tc) => ({ name: tc.name, arguments: tc.arguments?.slice(0, 300) })),
              )
            }
          }
        } else if (tcs.size > 0) {
          // v0.4+ 纯 tool call reply（无 text content）
          const cur = mapGet(chatHistories, id, [])
          const lastUser = [...cur].reverse().find((m) => m.role === 'user')
          const toolCalls = Array.from(tcs.values())
          mapSet(chatHistories, id, [
            ...cur,
            {
              role: 'assistant',
              content: '',
              action: lastUser?.action,
              tool_calls: toolCalls,
            },
          ])
          console.log(
            `[concept.onChatDone] ${id} run=${payload.run_id} OK: pure tool_call, toolCalls=${toolCalls.length}, names=${toolCalls.map((t) => t.name).join(',')}`,
          )
        } else {
          // v0.4+ 真沉默（accumulated === '' && tcs.size === 0）：LLM 收到 tool_result / user message 后
          // 既不出 text 也不调 tool —— 协议层异常（理论上 tool_result 必触发 model 重新输出）
          // 玩家 2026-08-03 截图：deepseek-v4-flash 收到 ask_user_question 答完的 tool_result 后沉默
          // - 修：写一条 fallback message 让 chatHistories 增加 entry，UI 不再"卡住"
          // - **v0.5+ 文案智能判断**（玩家 2026-08-03 截图反馈"AI 可以拒绝？"）：
          //   - 上一条 message 是 tool_result → LLM 刚调过 tool + 写完 tool_result → 沉默是"已交付"
          //     → fallback 显示 "✓ 已完成"，让玩家知道 LLM 没出错，是交付完沉默
          //   - 上一条 message 是 user 打字 → LLM 主动沉默（可能是边界 case / model 行为）
          //     → fallback 显示 "（AI 无回复）"（保留旧提示）
          // - console.warn 保留（边界 case 排查用）
          const cur = mapGet(chatHistories, id, [])
          const lastUser = [...cur].reverse().find((m) => m.role === 'user')
          const lastMsg = cur.length > 0 ? cur[cur.length - 1] : undefined
          const fallbackContent =
            lastMsg && (lastMsg.role === 'tool' || (lastMsg.role === 'user' && lastMsg.tool_call_id))
              ? '✓ 已完成'
              : '（AI 无回复）'
          mapSet(chatHistories, id, [
            ...cur,
            { role: 'assistant', content: fallbackContent, action: lastUser?.action },
          ])
          console.warn(
            `[concept.onChatDone] ${id} run=${payload.run_id} empty content (LLM 沉默边界 case: 0 chars + 0 tool_call，写 fallback message "${fallbackContent}")`,
          )
        }
        // v0.4.4+ ask_free_text 强制回复：扫描本轮 tool_calls 把 ask_free_text 写入 pending map
        // - 必须在写 chatHistories **之后**做（chatHistories 是 source of truth，pending 是 UI 派生）
        // - 每次新 round 都覆盖 pending（之前未答的作废，UI 端需要保证不让这种情况发生 —— 上一轮
        //   没提交所有回答 LLM 不会进入下一轮）
        if (tcs.size > 0) {
          const next = new Map<string, { question: string; answer?: string }>()
          for (const tc of tcs.values()) {
            // v0.5+ tool name 重命名：旧 ask_free_text → ask_user_question
            if (tc.name === 'ask_user_question') {
              const parsed = parseAskFreeTextArgs(tc)
              if (parsed && tc.id) {
                next.set(tc.id, { question: parsed.question })
              }
            }
          }
          if (next.size > 0) {
            mapSetAskFreeText(id, next)
            console.log(
              `[concept.onChatDone] ${id} populated ${next.size} ask_free_text pending (forced reply)`,
            )
          } else {
            // 本轮没有 ask_free_text（比如只有 ask_choose_option / update_doc_item）—— 清掉 pending
            // 避免上轮残留（正常情况上轮已经发完，但 chat error 路径可能漏掉清空）
            clearAskFreeTextForItem(id)
          }
        } else {
          // 本轮没 tool call —— 清掉 pending（防御性，正常不会到这里）
          clearAskFreeTextForItem(id)
        }
        // v0.4.4+ 全 tool 通用 pending：把本轮 tool_call 加到 pendingToolCalls（**v0.4.4.1+ ask_free_text 除外**）
        // - ask_user_question → 等玩家点 AltCard / 放弃
        // - update_doc_item → 等玩家确认写入
        // - **v0.4.4.1+ ask_free_text 不再加 pendingToolCalls**（UX 整合到 composer，composer 解锁让玩家打字）
        //   - 协议层仍由 askFreeTextPending 独立 track（onChatDone 写入 question，玩家 composer 提交时清）
        //   - sendAllAskFreeTextAnswers 内部 removePendingToolCall 是 noop（不影响协议配对）
        // - remove 路径：sendToolResult (ask_user_question/update) + sendAllAskFreeTextAnswers (ask_free_text, noop)
        if (tcs.size > 0) {
          for (const tc of tcs.values()) {
            // v0.4.4.1+ ask_user_question (旧名 ask_free_text) 跳过 pendingToolCalls（避免锁 composer）
            if (tc.id && tc.name !== 'ask_user_question') addPendingToolCall(id, tc.id)
          }
        }
        mapSet(chatTexts, id, '')
        mapSet(chatRunIds, id, null)
        mapSet(chatStreamings, id, false)
        // 清 tool call 累积状态
        mapSetToolCalls(id, new Map())
      }),
    )
    unlistenFns.push(
      await onChatError((payload) => {
        const id = findItemByRunId(payload.run_id)
        if (!id) return
        const accumulated = mapGet(chatTexts, id, '')
        const tcs = mapGetToolCalls(id)
        console.error(
          `[concept.onChatError] ${id} run=${payload.run_id} kind=${payload.kind} err="${payload.error}" partialLen=${accumulated.length} partialToolCalls=${tcs.size}`,
        )
        if (accumulated || tcs.size > 0) {
          // 流到一半挂 → 保留 partial（对齐 chat reducer v0.2+ 行为）；同 done，拷 user action
          const cur = mapGet(chatHistories, id, [])
          const lastUser = [...cur].reverse().find((m) => m.role === 'user')
          const toolCalls = tcs.size > 0 ? Array.from(tcs.values()) : undefined
          mapSet(chatHistories, id, [
            ...cur,
            {
              role: 'assistant',
              content: accumulated,
              partial: true,
              action: lastUser?.action,
              tool_calls: toolCalls,
            },
          ])
        }
        mapSet(chatTexts, id, '')
        mapSet(chatRunIds, id, null)
        mapSet(chatStreamings, id, false)
        mapSet(chatErrorKinds, id, payload.kind)
        mapSet(chatErrorRaws, id, payload.error)
        // v0.4.1+ 错误诊断包：endpoint / model / api_format / request_body_preview
        // 4 字段都 optional（老 backend 没发就 null），复制按钮看到 null 就跳过
        if (payload.endpoint || payload.model || payload.api_format || payload.request_body_preview) {
          mapSet(chatErrorDiags, id, {
            endpoint: payload.endpoint ?? '',
            model: payload.model ?? '',
            api_format: payload.api_format ?? '',
            request_body_preview: payload.request_body_preview ?? '',
          })
        } else {
          mapSet(chatErrorDiags, id, null)
        }
        mapSetToolCalls(id, new Map())
      }),
    )
  }

  // === send / reset ===

  /** 发一条 step chat 消息
   *  - preset 存在 → user 气泡用 preset.label；LLM 收到 preset.prompt（不是 text）
   *  - preset 不存在 → 自由输入，user 气泡 = text，LLM 收到 text
   *  - **polish / expand**：prompt 末尾显式追加当前 step.content（不依赖 system 注入的截断版）
   *  - 历史：发后端前 strip preset + action field（后端 ChatMessage 没这俩字段，详见 types/chat.ts 注释）
   *  - 失败抛错让 UI 提示 */
  async function sendStepChat(
    text: string,
    preset?: PresetAction,
    isRetry: boolean = false,
  ): Promise<void> {
    const trimmedText = text.trim()
    let prompt = preset?.prompt ?? trimmedText
    if (!prompt) return
    const id = currentItemKey()
    if (mapGet(chatStreamings, id, false)) {
      console.log(`[concept.sendStepChat] ${id} ignored: already streaming`)
      return
    }
    const step = steps.value.find((s) => s.id === currentStepId.value)
    if (!step) throw new Error('未知步骤')
    await init()

    // 玩家手动 / 自动重试 的诊断
    console.log(
      `[concept.sendStepChat] ${id} starting: preset=${preset?.label ?? '(free text)'}, action=${preset?.action ?? 'none'}, isRetry=${isRetry}, stepContentLen=${step.content.length}`,
    )

    // polish / expand 必须显式附当前 step.content（确保 LLM 拿到完整原文做改造）
    if (preset && (preset.action === 'polish' || preset.action === 'expand')) {
      prompt = `${prompt}\n\n当前「${step.title}」内容：\n${step.content.trim()}`
    }

    // v0.3+ 自动重试: 标记 retry=true (前端 only, 发后端前 strip)
    const userMsg: ChatMessage = preset
      ? { role: 'user', content: prompt, preset: preset.label, action: preset.action, retry: isRetry || undefined }
      : { role: 'user', content: trimmedText, retry: isRetry || undefined }
    const cur = mapGet(chatHistories, id, [])
    mapSet(chatHistories, id, [...cur, userMsg])
    mapSet(chatErrorKinds, id, null)
    mapSet(chatErrorRaws, id, null)
    mapSet(chatErrorDiags, id, null)

    const contextParts: string[] = []
    const ctx = buildContext(steps.value, currentStepId.value)
    if (ctx) contextParts.push(ctx)
    if (step.content.trim()) {
      contextParts.push(`当前「${step.title}」已有的内容：\n${step.content.trim()}`)
    }

    try {
      mapSet(chatStreamings, id, true)
      // model 显式传解析结果：start_chat 的 model: null 走 config.json 兜底，
      // 那里可能是没同步过的失效值（400 invalid model 踩过）——resolveLlmConnection 才跟会话 tab 同源
      const conn = await resolveLlmConnection()
      // v0.4+ 走 tool calling：runChatRound 内部自动 resolveEnabledTools 注入 tools 字段，
      // LLM 收到 schema 强制调 ask_choose_option / update_doc_item 返结构化数据
      await runChatRound({ id, conn })
    } catch (e) {
      mapSet(chatStreamings, id, false)
      console.error('[concept.sendStepChat] startChat FAILED:', e)
      throw e
    }
  }

  /** v0.4+ tool result 喂回 LLM（多轮 tool calling 核心）
   *  - 玩家点 AltCard / 确认 update_doc_item 后调这个
   *  - 加 `role: 'tool'` 消息到 chatHistories，关联到对应 tool_call 的 id
   *  - 调 LLM 第二轮（带 tool_calls / tool_call_id 完整 messages）
   *  - LLM 第二轮可能：
   *    - 调 update_doc_item tool → 走 assistant-tool-update 渲染分支（玩家点"确认写入"再调一次）
   *    - 直接出 text → 走整体采用条 append
   *    - 调 ask_choose_option tool → 又一个 AltCard 循环
   *  - 失败抛错让 UI 提示 */
  async function sendToolResult(toolCallId: string, content: string): Promise<void> {
    const id = currentItemKey()
    if (mapGet(chatStreamings, id, false)) {
      console.log(`[concept.sendToolResult] ${id} ignored: already streaming`)
      return
    }
    if (!steps.value.find((s) => s.id === currentStepId.value)) {
      throw new Error('未知步骤')
    }
    await init()

    console.log(
      `[concept.sendToolResult] ${id} starting: tool_call_id=${toolCallId}, contentLen=${content.length}`,
    )

    // 加 tool result 消息（关联到对应 tool_call）
    const toolMsg: ChatMessage = {
      role: 'tool',
      content,
      tool_call_id: toolCallId,
    }
    const cur = mapGet(chatHistories, id, [])
    mapSet(chatHistories, id, [...cur, toolMsg])
    mapSet(chatErrorKinds, id, null)
    mapSet(chatErrorRaws, id, null)
    mapSet(chatErrorDiags, id, null)
    // v0.4.4+ pendingToolCalls：玩家已反应，从 pending 移除
    removePendingToolCall(id, toolCallId)

    try {
      mapSet(chatStreamings, id, true)
      const conn = await resolveLlmConnection()
      // v0.4+ tool result 二轮：直接走 tool calling 路径，LLM 自己判断下一步要不要 tool call
      await runChatRound({ id, conn })
    } catch (e) {
      mapSet(chatStreamings, id, false)
      console.error('[concept.sendToolResult] startChat FAILED:', e)
      throw e
    }
  }

  // === v0.4.4.1+ ask_free_text 强制回复协议（UX 整合到 composer，单问题版） ===
  // v0.4.4+ 老的"bubble 内嵌 N 个 input"多问题版已删：
  // - setAskFreeTextAnswer / askFreeTextAllAnswered / parseAskFreeTextSubQuestions 等都不再需要
  // - 单问题版：玩家在 composer 打字回车 → sendAllAskFreeTextAnswers(playerText) 内部覆盖 pending.answer
  // - askFreeTextPending 仍是 1 round 1 entry 的 Map（防御性兼容多次），AIChatPanel 拿来显示 LLM 问题 + 锁 chip

  /** 派生的 askFreeTextPending（当前 item）—— AiChatPanel 拿来显示 LLM 问的问题 + 锁 chip
   *  - shallowRef 包 Map<itemId, Map<toolCallId, {question, answer?}>>
   *  - 当前 item 派生 = inner Map（按 currentItemKey 取）
   *  - 切步自动切派生（跟 chatHistories 同一套）
   *  - v0.4.4+ 1 round 1 ask_free_text 调用：实际 0/1 entry，但保持 Map 接口泛型稳 */
  const askFreeTextPendingForItem = computed(() => mapGetAskFreeText(currentItemKey()))

  /** 玩家在 composer 回车发送时调（v0.4.4.1+ UX 整合到 composer）—— 1 条 function_call_output 喂回 LLM
   *  - **v0.4.4.1+ playerText 必填**：玩家在 composer 打的字直接作为 ask_free_text 的 answer
   *  - 1 round 1 ask_free_text 调用（v0.4.4+ 钉死，v0.4.4.1+ 改为单问题版）→ 1 条 tool_result 配对（协议要求）
   *  - 协议层：pending 永远 0/1 entry（因为 1 round 1 ask_free_text），for loop 是防御性兼容
   *  - 必须有非空 playerText（trim 后非空）
   *  - 失败抛错让 UI 提示
   *  - 跟 sendToolResult 走同款 stream 路径（runChatRound 触发 streaming=true）*/
  async function sendAllAskFreeTextAnswers(playerText?: string): Promise<void> {
    const id = currentItemKey()
    if (mapGet(chatStreamings, id, false)) {
      console.log(`[concept.sendAllAskFreeTextAnswers] ${id} ignored: already streaming`)
      return
    }
    if (!steps.value.find((s) => s.id === currentStepId.value)) {
      throw new Error('未知步骤')
    }
    const pending = askFreeTextPendingForItem.value
    if (pending.size === 0) {
      console.log(`[concept.sendAllAskFreeTextAnswers] ${id} ignored: no pending ask_free_text`)
      return
    }
    // v0.4.4.1+ playerText 优先（composer 整合 UX）—— fallback 到 entry.answer 兼容旧 UI 路径
    // 1 round 1 ask_free_text：取唯一那一条 toolCallId
    // for loop 防御性兼容（理论 LLM 1 round 只调 1 个）
    const allAnswered: Array<{ toolCallId: string; content: string }> = []
    const trimmedText = playerText?.trim()
    for (const [toolCallId, entry] of pending) {
      const a = trimmedText || entry.answer?.trim()
      if (!a) {
        throw new Error('还有未填的 ask_free_text 答案')
      }
      allAnswered.push({ toolCallId, content: a })
    }
    // v0.4.4.1+ 玩家在 composer 打字 → 覆盖 pending.answer（保证后续 chatHistories 派生状态一致）
    if (trimmedText) {
      const next = new Map(askFreeTextPending.value)
      for (const toolCallId of pending.keys()) {
        const cur = next.get(toolCallId)
        if (cur) next.set(toolCallId, { question: cur.question, answer: trimmedText })
      }
      mapSetAskFreeText(id, next)
    }

    await init()
    console.log(
      `[concept.sendAllAskFreeTextAnswers] ${id} starting: ${allAnswered.length} tool_results, contentLen=${allAnswered[0]?.content.length ?? 0}`,
    )

    // 加 tool message 到 chatHistories（1 round 1 tool_result：1 条 message）
    let cur = mapGet(chatHistories, id, [])
    for (const { toolCallId, content } of allAnswered) {
      cur = [
        ...cur,
        { role: 'tool' as const, content, tool_call_id: toolCallId },
      ]
    }
    mapSet(chatHistories, id, cur)
    mapSet(chatErrorKinds, id, null)
    mapSet(chatErrorRaws, id, null)
    mapSet(chatErrorDiags, id, null)
    // 清 pending（提交后玩家不能再改）
    clearAskFreeTextForItem(id)
    // v0.4.4+ pendingToolCalls：玩家已提交，从 pending 移除
    for (const { toolCallId } of allAnswered) {
      removePendingToolCall(id, toolCallId)
    }

    try {
      mapSet(chatStreamings, id, true)
      const conn = await resolveLlmConnection()
      await runChatRound({ id, conn })
    } catch (e) {
      mapSet(chatStreamings, id, false)
      console.error('[concept.sendAllAskFreeTextAnswers] startChat FAILED:', e)
      throw e
    }
  }

  /** v0.4.4+ 玩家点"放弃备选"按钮时调 —— 1 条 function_call_output 喂回 LLM
   *  - 用于 ask_choose_option / update_doc_item 场景：玩家不要 LLM 给的备选 / 写入内容
   *  - 非 silently 模式：发 1 条 tool_result（"玩家放弃：<reason>"）→ LLM 知道玩家不要 → 可以出 text 引导 / 让 update_doc_item 跟玩家的写
   *  - 协议层：1 round 1 tool_call → 1 tool_result 配对（不破坏协议）
   *  - 复用 sendToolResult 走 stream 路径
   *  - **v0.4.4+ silently 模式**：玩家点"放弃"时**不想让 LLM 立刻再调 tool**（避免 LLM 又出一批新备选）→
   *    改 chatHistories 写「玩家放弃」语义 + **不调 LLM**。玩家解锁 composer 后自己写 → 下次 sendStepChat 走普通 user message
   *  - **v0.5+ silently 改成主流做法**（玩家 2026-08-03 反馈）：之前 silently 模式用"清 tool_calls 字段 + 改写 content"绕过
   *    OpenAI 协议，**导致 LLM 看不到 tool_call 上下文**——玩家打字问时 LLM 脑补"那我就直接写吧"调 update_doc_item。
   *    主流 agent（Cline / Cursor / LangChain / OpenClaw / OpenAI Cookbook）都是"保留 tool_call 上下文 + 发 tool_result 配对"。
   *    现在 silently 模式改成：
   *    1. **保留** tool_calls 字段（LLM 看到 tool_call + 之前给过什么备选）
   *    2. **改写** assistant content 为短版「玩家放弃这批备选，等玩家打字。」（避免 LLM 顺着 preamble iterate 新备选）
   *    3. **追加** 1 条 tool message（tool_call_id 配对，content 同上）——OpenAI 协议层 tool_calls 必有 tool_result
   *    4. **不调 LLM**——玩家解锁 composer 自己写，下条 user message 走 sendStepChat 普通路径
   *  - 效果：协议层 OK（tool_calls + tool_result 配对，deepseek 不会报 "No tool output found"）+
   *    LLM 看到完整 tool_call 上下文 + 玩家放弃信号 → 玩家打字时 LLM 知道"玩家在打字"（不是"那你就直接写吧"）
   *  - **老 .chats/ 落盘数据不兼容**：v0.4.4+ 之前的 silently 改写 assistant 没 tool_calls 字段（没协议配对），
   *    v0.5+ 新 silently 改写要求 tool_calls + tool_result 配对。需要清掉老 .chats/concept/*.json
   *    （下次启动自动建新 + 落盘新格式）。同款适用于 world store。
   *  - 视觉：assistant message 仍带 tool_calls 字段 + content 改写为"玩家放弃..."——
   *    replay 时 AltCard / 写入确认 UI 仍渲染（tool_call 还在），但 content 显示"玩家放弃"语义
   *    （v0.4+ "tool_call 优先不显示 text"，现在改成显示"玩家放弃..."短句给玩家 UX 提示）*/
  async function cancelPendingToolCall(
    toolCallId: string,
    reason?: string,
    options?: { silently?: boolean },
  ): Promise<void> {
    const id = currentItemKey()
    const finalReason = reason ?? '玩家放弃这个备选'
    const silently = options?.silently ?? false
    console.log(
      `[concept.cancelPendingToolCall] ${id} starting: tool_call_id=${toolCallId}, reason=${finalReason}, silently=${silently}`,
    )
    if (silently) {
      // v0.5+ 主流做法（UI 不重复版）：保留 tool_call 上下文 + 改写 content + **不**追加 tool message to chatHistories
      // - 协议层：assistant tool_calls 必有 tool_result 配对（OpenAI 协议硬要求）→
      //   runChatRound 拼 messages 时**临时**为 silently 放弃的 tool_call 补 1 条 tool message 给 LLM
      //   （从 silentlyAbandonedToolCalls 取 tool_call_id，per item 维护；不存 chatHistories）
      // - UI 层：assistant 改写后**只**显示 1 条 bubble（"✓ 已答"+ 改写后 content）——不追加 tool message
      //   到 chatHistories 避免 UI 重复显示（之前 v0.5+ 错误做法：追加 tool message → UI 走 MessageBubble 又渲染
      //   一次"玩家放弃..." 截图反馈）
      // - 语义层：LLM 看到完整 tool_call 上下文（tool_calls 字段保留 + tool_result 临时补）
      //   + "等玩家打字"——不脑补"那你就直接写吧"
      // - 不调 LLM：玩家解锁 composer 自己写
      // - 改写后的 assistant message 走"✓ 已答"tool-question bubble（pending 已 remove + askFreeTextAnswered 返 null），
      //   AiChatPanel.vue "✓ 已答" else 分支显示 d.msg.content（v0.5.1+ 修）让玩家看到"玩家放弃..."语义
      const histories = mapGet(chatHistories, id, [])
      const idx = histories.findIndex(
        (m) => m.role === 'assistant' && m.tool_calls?.some((tc) => tc.id === toolCallId),
      )
      if (idx >= 0) {
        const next = [...histories]
        const orig = next[idx]!
        const abandonMsg = '玩家放弃这批备选，等玩家打字。'
        // 改写 content + 保留 tool_calls 字段（UI 走"✓ 已答"tool-question bubble，LLM 看到 tool_call 上下文）
        // 不追加 tool message to chatHistories（避免 UI 重复）
        next[idx] = { ...orig, content: abandonMsg }
        mapSet(chatHistories, id, next)
        console.log(
          `[concept.cancelPendingToolCall] ${id} silently rewrote assistant message idx=${idx} (preserved tool_calls, content='${abandonMsg}'; tool result 临时拼给 LLM 不存)`,
        )
      } else {
        console.warn(
          `[concept.cancelPendingToolCall] ${id} silently: no assistant message found with tool_call_id=${toolCallId}`,
        )
      }
      // 不需要 addSilentlyAbandonedToolCall state：runChatRound 直接从 chatHistories
      // 检测 content === SILENTLY_ABANDONED_CONTENT 的 assistant message + 临时补 tool message 给 LLM
      removePendingToolCall(id, toolCallId)
      return
    }
    // 非 silently：走 sendToolResult 同款路径（add tool message + 触发 LLM round 2 + 内部 remove pending）
    await sendToolResult(toolCallId, finalReason)
  }

  /** 派生的 pendingToolCalls（当前 item）—— AiChatPanel 拿来 disable composer
   *  - 跟 askFreeTextPendingForItem 同款派生套路（当前 item 内层 Set）
   *  - 切步自动切派生
   *  - v0.4.4+ 1 round 1 tool_call：实际 0/1 entry，但保持 Set 接口稳（防御性兼容多次） */
  const pendingToolCallsForItem = computed(() => mapGetPendingToolCalls(currentItemKey()))

  /** 内部：发一轮 LLM（user 消息流 / tool result 流 共用）
   *  - 拼 system + 完整 messages（透传 tool_calls / tool_call_id）
   *  - 注入 enabled tools（resolveEnabledTools 过滤关闭的）
   *  - 失败抛错（外层 catch 负责 streaming=false） */
  async function runChatRound(opts: {
    id: string
    conn: Awaited<ReturnType<typeof resolveLlmConnection>>
  }): Promise<void> {
    const { id, conn } = opts
    const settings = useSettingsStore()
    if (!settings.loaded) await settings.init()
    const tools = resolveEnabledTools(settings.config)
    // 找当前 step 拼 system context
    const step = steps.value.find((s) => s.id === currentStepId.value)
    if (!step) throw new Error('未知步骤')
    const ctx = buildContext(steps.value, currentStepId.value)
    const systemContent =
      stepChatSystemPrompt(step) +
      (ctx ? '\n\n' + ctx : '') +
      (step.content.trim() ? `\n\n当前「${step.title}」已有的内容：\n${step.content.trim()}` : '')
    const runId = await rpcStartChat(
      [
        { role: 'system', content: systemContent },
        // 过滤 system（第一轮 system 已含 context）+ strip preset field（后端 ChatMessage 不带）
        // v0.4+ tool_calls / tool_call_id 必须透传给后端（跨 request 回放需要）
        // **v0.5+ silently 临时补 tool message**：遇到 content === SILENTLY_ABANDONED_CONTENT 的
        //   assistant message（玩家点"放弃"后 cancelPendingToolCall silently 改写 + 保留 tool_calls
        //   字段），在它后面**临时**插 1 条 tool message（OpenAI 协议层 tool_calls + tool_result 配对）。
        //   **不**改 chatHistories（避免 UI 重复显示），只在 LLM 端 messages 流补。
        //   - 玩家下次 sendStepChat 调 LLM 时 LLM 看到完整 tool_call 上下文 + "玩家放弃"信号
        ...buildMessagesWithSilentAbandonToolResult(id),
      ],
      { model: conn.model, effort: null, tools },
    )
    mapSet(chatRunIds, id, runId)
  }

  /** v0.5+ 拼 messages 给 LLM 时，临时为 silently 放弃的 assistant message 补 tool_result
   *  - chatHistories 里的 assistant message（content === SILENTLY_ABANDONED_CONTENT + tool_calls 仍存在）
   *    是 cancelPendingToolCall silently=true 改写的——玩家放弃但 chatHistories 没存 tool message（避免 UI 重复）
   *  - LLM 端 messages 流必须**临时**给这种 assistant message 补 1 条 tool message（tool_call_id 配对），
   *    否则 LLM 报 "No tool output found"
   *  - 不用维护 separate state（per item Set）——直接 string 匹配（content 固定 = SILENTLY_ABANDONED_CONTENT）
   *  - 永久性：chatHistories 存盘后 replay 仍能 detect（"玩家放弃"改写 + tool_calls 保留 2 个条件即可）
   *  - 用法：runChatRound 调；不修改 chatHistories（只读） */
  function buildMessagesWithSilentAbandonToolResult(itemId: string): Array<{
    role: ChatMessage['role']
    content: string
    partial?: boolean
    tool_calls?: ToolCallInfo[]
    tool_call_id?: string
  }> {
    const result: Array<{
      role: ChatMessage['role']
      content: string
      partial?: boolean
      tool_calls?: ToolCallInfo[]
      tool_call_id?: string
    }> = []
    const histories = mapGet(chatHistories, itemId, [])
    for (const m of histories) {
      if (m.role === 'system') continue
      result.push({
        role: m.role,
        content: m.content,
        partial: m.partial,
        tool_calls: m.tool_calls,
        tool_call_id: m.tool_call_id,
      })
      // silently 改写的 assistant message：临时补 tool message（不存 chatHistories）
      if (
        m.role === 'assistant' &&
        m.content === SILENTLY_ABANDONED_CONTENT &&
        m.tool_calls &&
        m.tool_calls.length > 0
      ) {
        for (const tc of m.tool_calls) {
          result.push({
            role: 'tool',
            content: SILENTLY_ABANDONED_CONTENT,
            tool_call_id: tc.id,
          })
        }
      }
    }
    return result
  }

  /** 清当前 step 的 chat 状态（UI「清空对话」按钮调）
   *  - 流式中的 run 不取消 —— runId 清掉后 listener 自动过滤掉后续 chunk
   *  - **v0.3+ 立即删文件**（不等 debounce），同时取消 pending save timer */
  function resetStepChat(): void {
    const id = currentItemKey()
    cancelPendingSave()
    mapSet(chatHistories, id, [])
    mapSet(chatTexts, id, '')
    mapSet(chatStreamings, id, false)
    mapSet(chatRunIds, id, null)
    mapSet(chatErrorKinds, id, null)
    mapSet(chatErrorRaws, id, null)
    mapSet(chatErrorDiags, id, null)
    // v0.4.4+ ask_free_text pending 也要清（玩家点清空对话 → 强制回复状态也作废）
    clearAskFreeTextForItem(id)
    // v0.4.4+ pendingToolCalls 也要清（避免上轮残留的待反应 tool_call 卡 composer）
    clearPendingToolCallsForItem(id)
    // 立即删 .chats/concept/<stepId>.json
    const project = useProjectStore()
    if (project.current) {
      void deleteChat(project.current.folder, id).catch((e) =>
        console.error('[concept.resetStepChat] delete chat failed:', e),
      )
    }
  }

  /** 清所有 step 的 chat 状态（切项目调；不同项目 step 内容同 id 语义不同，叠加会乱）
   *  - **v0.3+ 立即 deleteAll 全部 .chats/concept/*.json**（取消 pending save） */
  function clearAllStepChats(): void {
    cancelPendingSave()
    chatHistories.value = new Map()
    chatTexts.value = new Map()
    chatStreamings.value = new Map()
    chatRunIds.value = new Map()
    chatErrorKinds.value = new Map()
    chatErrorRaws.value = new Map()
    chatErrorDiags.value = new Map()
    // v0.4.4+ ask_free_text pending 也要清（切项目时新项目 pending 不能继承老项目）
    askFreeTextPending.value = new Map()
    triggerRef(askFreeTextPending)
    // v0.4.4+ pendingToolCalls 也要清（切项目时新项目 pending 不能继承老项目）
    pendingToolCalls.value = new Map()
    triggerRef(pendingToolCalls)
    const project = useProjectStore()
    if (project.current) {
      void deleteAllChats(project.current.folder).catch((e) =>
        console.error('[concept.clearAllStepChats] delete all chats failed:', e),
      )
    }
  }

  // === v0.3+ chat 落盘（debounce 1s + 显式 flushChats） ===

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const SAVE_DEBOUNCE_MS = 1000

  function cancelPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  /** 触发 debounce 落盘（chatHistories 每次变化都 schedule） */
  function scheduleChatSave() {
    cancelPendingSave()
    saveTimer = setTimeout(() => void flushChatsToCurrent(), SAVE_DEBOUNCE_MS)
  }

  /** 立即 flush chat 落盘到**当前**项目（不传 projectRoot；典型用途：切项目前先落盘老项目时传老 folder） */
  async function flushChatsToCurrent(): Promise<void> {
    cancelPendingSave()
    const project = useProjectStore()
    if (!project.current) return
    await flushChatsTo(project.current.folder)
  }

  /** 显式 flush chat 落盘到指定项目（view 切项目时调：先把内存里的旧项目 chats 写到旧 folder） */
  async function flushChatsTo(projectRoot: string): Promise<void> {
    cancelPendingSave()
    const snapshot = new Map(chatHistories.value)
    for (const [itemKey, messages] of snapshot) {
      if (messages.length === 0) continue // 空 messages → 不写盘（reset/clearAll 已 delete 文件）
      const lastUser = [...messages].reverse().find((m) => m.role === 'user') ?? null
      const payload: ChatFile = {
        version: 1,
        messages,
        last_user_message: lastUser,
        updated_at: new Date().toISOString(),
      }
      try {
        await saveChat(projectRoot, itemKey, payload)
      } catch (e) {
        console.error('[concept.flushChatsTo] save chat failed:', itemKey, e)
      }
    }
  }

  // chatHistories 变化 → debounce 落盘
  watch(chatHistories, () => {
    scheduleChatSave()
  })

  // === v0.5+ 设计循环：staleFlags + L6 5min cooldown ===
  //
  // 改任何 step → markStaleAfterSave 标记上下游 stale
  //  - L1 改 → L2-L6 全 stale
  //  - L2-L5 改 → 自己 + 上游 + L6 stale
  //  - L6 改 → L1-L5 全 stale
  // 玩家点黄点（或跑完校准 preset）→ clearStale
  // 5min cooldown for L6 频繁改动（避免 toast 刷屏）

  const staleFlags = shallowRef(new Map<ConceptStepId, boolean>())

  /** 改完一步后标记 stale（设计循环核心）
   *  - L1 改 → L2-L6 all stale
   *  - L2-L5 改 → 自己 + 上游 + L6 stale
   *  - L6 改 → L1-L5 all stale
   *  - 5min cooldown for L6 频繁改（避免 toast 刷屏） */
  function markStaleAfterSave(changedId: ConceptStepId): void {
    const idx = STEP_IDS.indexOf(changedId)
    if (idx === -1) return
    const next = new Map(staleFlags.value)
    if (changedId === 'core-gameplay') {
      // L6 改 → L1-L5 全 stale（5min cooldown）
      const now = Date.now()
      const lastL6Stale = (window as unknown as { __lastL6Stale?: number }).__lastL6Stale ?? 0
      if (now - lastL6Stale < 5 * 60 * 1000) {
        // cooldown 内 → 不重复 toast（但不阻止 mark stale —— 黄点还是亮）
        // 黄点本身已经是 stale，再触发一次没有副作用；这里只跳过 toast 逻辑（toast 在 view 层）
      } else {
        ;(window as unknown as { __lastL6Stale?: number }).__lastL6Stale = now
      }
      for (let i = 0; i < 5; i++) {
        next.set(STEP_IDS[i], true)
      }
    } else if (changedId === 'seed') {
      // L1 改 → L2-L6 all stale
      for (let i = 1; i < STEP_IDS.length; i++) {
        next.set(STEP_IDS[i], true)
      }
    } else {
      // L2-L5 改 → 自己 + 上游 + L6 stale
      // 上游：idx 之前的；自己：idx；L6：core-gameplay
      for (let i = 0; i <= idx; i++) {
        next.set(STEP_IDS[i], true)
      }
      next.set('core-gameplay', true)
    }
    staleFlags.value = next
  }

  /** 玩家手动清除某 step 的 stale 标记（点黄点 X / 跑完校准 preset 后调） */
  function clearStale(stepId: ConceptStepId): void {
    if (staleFlags.value.get(stepId)) {
      const next = new Map(staleFlags.value)
      next.delete(stepId)
      staleFlags.value = next
    }
  }

  /** 切项目时清空 stale flags（不同项目 stale 状态不继承） */
  function clearAllStaleFlags(): void {
    staleFlags.value = new Map()
  }

  /** v0.5+ sync：世界 doc 改了 → 标 concept 哪些 step stale（被 world store 调）
   *  - overview / history / magic-system / factions 改 → L3 world-rules stale
   *  - geography 改 → L4 locations stale
   *  - 复用现有 staleFlags map（不新建）—— 黄点 UI 跟设计循环共用一套
   *  - 清除：玩家点 ConceptView 黄点 X → clearStale(stepId)（已有） */
  function markStaleFromWorld(docId: string): void {
    let affected: ConceptStepId[] = []
    if (
      docId === 'overview' ||
      docId === 'history' ||
      docId === 'magic-system' ||
      docId === 'factions'
    ) {
      affected = ['world-rules']
    } else if (docId === 'geography') {
      affected = ['locations']
    } else {
      return
    }
    const next = new Map(staleFlags.value)
    for (const stepId of affected) {
      next.set(stepId, true)
    }
    staleFlags.value = next
  }

  /** 通用 AiChatPanel 用的 step chat 状态包（types/ai.ts StepChatState）
   *  markRaw 必须：store 实例是 reactive 代理，普通对象会被深度 reactive 化、
   *  嵌套的 ref/computed 被自动解包（组件期望 Ref/ComputedRef 却拿到裸值 → .value 崩）*/
  const stepChat: StepChatState = markRaw({
    messages,
    text,
    streaming,
    errorKind,
    errorRaw,
    errorDiag,
    send: sendStepChat,
    /** v0.4+ tool result 喂回 LLM（玩家点 AltCard / 确认 update_doc_item 后调） */
    sendToolResult,
    reset: resetStepChat,
    // === v0.4.4.1+ ask_free_text 强制回复（UX 整合到 composer，1 round 1 ask_free_text 单问题版） ===
    askFreeTextPending: askFreeTextPendingForItem,
    sendAllAskFreeTextAnswers,
    // === v0.4.4+ 全 tool 通用 pending（ask_choose_option / ask_user_question / update_doc_item 通用） ===
    // - 锁 composer 用（避免玩家绕开 AltCard 用 composer 输入破坏协议）
    // - 玩家点"放弃备选"按钮走 cancelPendingToolCall
    pendingToolCalls: pendingToolCallsForItem,
    cancelPendingToolCall,
  })

  return {
    steps,
    loading,
    error,
    currentStepId,
    load,
    save,
    init,
    // markRaw 防 Pinia 深度 reactive 化 ref/computed；as unknown as StepChatState 强制 cast
    // （Pinia 类型在 build 模式严格，暴露 ref/computed 时被解包；runtime 通过 markRaw 保证不丢响应性）
    stepChat: markRaw(stepChat) as unknown as StepChatState,
    resetStepChat,
    clearAllStepChats,
    flushChatsTo, // 暴露给 view：切项目前调，把内存 chats 写到指定 folder
    // v0.5+ 设计循环
    staleFlags,
    clearStale,
    clearAllStaleFlags,
    // v0.5+ sync：被 world store 调
    markStaleFromWorld,
  }
})
