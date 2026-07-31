// concept pinia store —— 7 层派生模型 + 设计循环 + LLM 辅助（v0.5+）
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
// 设计循环（v0.5+）：
// - 改任何 step → markStale 上游 / 下游（黄点 ? 提示）
// - L1 改 → L2-L7 全标 stale（最重）
// - L2-L6 改 → 自己 + 上游 + L7 标 stale
// - L7 改 → L1-L6 全标 stale
// - 黄点消失条件：玩家手动 clearStale(id) 或跑 preset 校准后
// - 5min cooldown for L7 频繁改动（避免 toast 刷屏）—— store 内部防抖
//
// v0.5.1 mtime hash 对比上线（修 v0.5+ "改一下全黄"问题）：
// - save() 内 oldContent / newContent 字符串对比，oldMaturity / newMaturity 对比
// - **只有 content 或 maturity 真有变化才 markStale**——避免 debounce 重复触发、纯 markConfirmed
//   重复保存、maturity 没变但 content 没变等场景
// - maturity 单独变化也算改（L2 草稿→定型需要重新校准下游）
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
import { STEP_IDS, type ConceptStep, type ConceptStepId, type StepMaturity } from '@/types/concept'
import { useProjectStore } from './project'
import { useSettingsStore } from './settings'

// === 7 层静态定义（hint = 写作引导语，编辑区显示 + 拼 LLM prompt 的说明部分） ===

export const STEP_HINTS: Record<ConceptStepId, string> = {
  // L1 立意
  seed: '立意 = 故事要讨论的东西。',
  // L2 抽象规则
  pillars: '3-5 条硬约束 / 否决性原则。每条都是「任何方案违反 X 就打回」。这些规则不会一次写完——会在写世界/人物/故事过程中反复回来修改。成熟度：empty / 草稿 v1 / 演进 v2+ / 定型。',
  // L3 世界
  'world-rules': '宏观设定——时代 / 物理 / 魔法 / 政治 / 经济。每条 = 是什么 + 造成什么冲突。注意：硬约束（「不能违反」）属于 L2 抽象规则——这里只写普通规则。',
  // L4 地点（可选）
  locations: '具体空间——地理 / 氛围 / 物理特征 / 跟立意/世界的连接。这是可选的——密室 / 单场景剧可以跳过。不写 NPC（那是 L5 人物）。',
  // L5 人物
  'character-functions': '角色功能——每个人 = 想要什么 + 为什么得不到。人物欲望应追溯到 L3 世界 + L4 地点——不是凭空生成。人物被世界的波浪推到某个位置，他们想要的是对世界压力的回应。',
  // L6 故事
  'three-act': '冲突加压序列——每一幕压力比上一幕大，直到终幕爆发。派生 L1-L5——每幕转折点都应服务 L1 立意 + 满足 L2 pillars + 反映 L3 世界 + L4 地点 + L5 人物。',
  // L7 核心体验
  'core-fantasy': '玩家视角的 1 句话体验——「你扮演 X，在 Y 处境，做 Z」。所有层设计完才能精准定——可以先写粗版（方向感），其他层定下来再回来精化。',
}

// === 设计循环校准 prompt（v0.5+ 新增） ===
// 4 个校准 prompt + 1 个 L1 立意专用，5 个校准 chip 在 STEP_PRESETS 通用区
// 完整设计见 docs/CONCEPT_REDESIGN_PLAN.md §3.3

const RECALIBRATE_DOWNSTREAM_PROMPT =
  '上游刚刚改过。' +
  '当前 step 内容可能与新上游不一致。' +
  '逐条检查：' +
  '1. 当前 step 的关键论断是否还被新上游支持？' +
  '2. 哪些句子需要重写、哪些保留？' +
  '3. 指出具体段落 + 建议方向（不替玩家写完整版）。'

const RECALIBRATE_UPSTREAM_PROMPT =
  '当前 step 刚刚改过（或上游有变化）。' +
  '它可能跟上游 L1 立意 + L2 pillars 不一致。' +
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

/** L1 立意校准 prompt（基于 RECALIBRATE_DOWNSTREAM 模板 + 立意特殊性扩展） */
const L1_RECALIBRATE_PROMPT =
  RECALIBRATE_DOWNSTREAM_PROMPT +
  '\n\n立意特殊性 —— 立意是整个设计的哲学根：' +
  '问 3 个尖锐问题帮 ta 确认：' +
  '1. 这次改立意是要「大改方向」还是「精化措辞」？' +
  '2. 如果是大改方向 —— 玩家准备好 L2-L7 全部重看吗？' +
  '3. 玩家希望先看 L1 新立意 vs 旧下游的不一致点，还是先继续写 L2+？' +
  '根据玩家回答决定下一步（不替玩家做决定）。'

// === Preset 共享片段 ===

/** v0.3+ preset 都拼这段尾巴 —— v0.4+ 改走 tool calling 后的兜底
 *  - v0.4+ 主路径：LLM 收到 tools schema（`ask_user_question` / `update_doc_item`）→
 *    schema 强制 LLM 调 tool 返结构化数据（AltCard / 确认按钮）
 *  - 本段 prompt 是**兜底**：万一 LLM 不调 tool，prompt 仍约束 content 字段返
 *    "JSON 数组"形态（前端 v0.3+ parseAlternatives 已删，v0.4+ 直接当 markdown bubble
 *    显示，但 LLM 至少返稳定形态而非自由发挥）
 *  - v0.3+ 强化: **第一个字符必须是 `[`, 最后一个必须是 `]`** —— 之前 LLM 会加
 *    "让我分析一下" / 思考过程 / 多版本混排 等, 前端 fallback 按 \n\n 切段造假 cards
 *  - v0.3+ 防御：流式开始那一刻 system prompt 固定，过程中玩家改编辑器 chat 不会重发，
 *    显式告诉 LLM "以最新内容为准"（虽然 system 已注入"当前「X」已有内容"，这是双保险） */
const JSON_TAIL =
  '**优先用 ask_user_question tool 提问**：每项 option 是 1 个备选，label 10 字内，preview 是完整内容。\n' +
  '**如果 LLM 不调 tool，content 字段严格 JSON 数组**（第一个 `[`、最后一个 `]`，3-5 项）。\n' +
  '**禁止**输出任何额外文字、preamble、思考过程、解释、markdown 代码围栏。\n' +
  '**禁止**说"好的"、"让我分析一下"、"以下是"、"方案 1"等任何人类语言前缀。\n' +
  '基于当前步骤最新内容回答。'

/** 反思/追问类 preset 通用尾巴（v0.4+ 走 ask_free_text tool，prompt 兜底走 markdown）
 *  - 玩家主导：只给追问，玩家自己答，绝不替玩家做决定 */
const REFLECT_TAIL =
  '玩家主导：你只给备选/追问，玩家挑+改，绝不替玩家做决定。' +
  '基于当前步骤最新内容回答。'

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

// === 7 层 × 5 presets 静态配置（chip + 完整 prompt） ===
// v0.5+ 每层加 1 个校准 chip（设计循环）：4 基础（generate/reflect/polish/expand）+ 1 校准
// - L1 立意：校准 chip = "🎯 立意校准"（问 3 尖锐问题）
// - L2 pillars：校准 chip = "🔄 反向检验"（用 L3-L6 反推）
// - L3-L6：校准 chip = "⬆️ 上游校准"（改本层后回看 L1+L2）
// - L7 核心体验：校准 chip = "🌀 全链路整合"（汇总裁决）

const STANDARD_PRESETS: PresetAction[] = [
  {
    label: '✨ 润色这一步',
    prompt: POLISH_INSTRUCTION + JSON_TAIL,
    action: 'polish',
  },
  {
    label: '🌱 扩展这一步',
    prompt: EXPAND_INSTRUCTION + JSON_TAIL,
    action: 'expand',
  },
]

export const STEP_PRESETS: Record<ConceptStepId, PresetAction[]> = {
  // L1 立意
  seed: [
    {
      label: '💡 给 3-5 个立意方向',
      prompt:
        '根据玩家给的素材，给出 3-5 个不同方向的 1 句话立意版本（不同核心矛盾 / 不同主题走向）。' +
        '格式：「主角在 X 处境下，想要 Y，但 Z 不可越」。' +
        JSON_TAIL,
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
      prompt: L1_RECALIBRATE_PROMPT + JSON_TAIL,
      action: 'calibrate',
    },
  ],
  // L2 抽象规则
  pillars: [
    {
      label: '💡 从立意拆支柱',
      prompt: '从 L1 立意拆 3-5 条抽象规则（pillars），每条必须有否决权 —— 能用来否决具体方案。' + JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 打回我的废话支柱',
      prompt:
        '「丰富剧情」「画面精美」这种无法否决任何方案的废话支柱要打回，明确指出并给出可否决的写法。' +
        REFLECT_TAIL,
      action: 'reflect',
    },
    ...STANDARD_PRESETS,
    {
      label: '🔄 反向检验',
      prompt: PILLAR_REVERSE_CHECK_PROMPT + JSON_TAIL,
      action: 'calibrate',
    },
  ],
  // L3 世界
  'world-rules': [
    {
      label: '💡 从立意 + 规则推世界',
      prompt: '从 L1 立意 + L2 pillars 推 3-5 条世界规则，每条 = 是什么 + 造成什么冲突。' + JSON_TAIL,
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
      prompt: RECALIBRATE_UPSTREAM_PROMPT + JSON_TAIL,
      action: 'calibrate',
    },
  ],
  // L4 地点（可选）
  locations: [
    {
      label: '💡 从世界显形地点',
      prompt: '从 L3 世界规则在哪些具体空间显形 —— 给出 3-5 个地点（地理 + 氛围 + 立意连接）。' + JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 地点有没有显形 L3',
      prompt: '检查玩家写的地点是不是真的显形 L3 世界的某条规则（显不出来的就是装饰）。' + REFLECT_TAIL,
      action: 'reflect',
    },
    ...STANDARD_PRESETS,
    {
      label: '⬆️ 上游校准',
      prompt: RECALIBRATE_UPSTREAM_PROMPT + JSON_TAIL,
      action: 'calibrate',
    },
  ],
  // L5 人物
  'character-functions': [
    {
      label: '💡 人物从世界长出来',
      prompt:
        '按 L3 世界 + L4 地点生成人物候选：' +
        '每个角色写清「想要什么 + 为什么得不到」+ 追溯到 L3+L4 哪条。' +
        '模式：对手 = 支柱反面人格化；镜子 = 主角另一种可能；推手 = 推进情节。' +
        JSON_TAIL,
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
      prompt: RECALIBRATE_UPSTREAM_PROMPT + JSON_TAIL,
      action: 'calibrate',
    },
  ],
  // L6 故事
  'three-act': [
    {
      label: '💡 给 3-5 种加压走法',
      prompt: '派生 L1-L5 给出 3-5 种三幕加压走法，每种写清三幕各自的加压点（一幕比一幕紧）。' + JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 检验压力有没有递增',
      prompt: '帮玩家检验三幕骨架的压力有没有递增（第二幕比第一幕紧、第三幕不能塌）。' + REFLECT_TAIL,
      action: 'reflect',
    },
    ...STANDARD_PRESETS,
    {
      label: '⬆️ 上游校准',
      prompt: RECALIBRATE_UPSTREAM_PROMPT + JSON_TAIL,
      action: 'calibrate',
    },
  ],
  // L7 核心体验
  'core-fantasy': [
    {
      label: '💡 给 3-5 个整合版',
      prompt:
        '整合 L1-L6 给出 3-5 个核心体验 1 句话版本。' +
        '格式：「你扮演 X，在 Y 处境，做 Z」。' +
        '必须反映整链路：立意 + 规则 + 世界 + 地点 + 人物 + 故事。' +
        JSON_TAIL,
      action: 'generate',
    },
    {
      label: '🔍 核心体验有没有反映整链路',
      prompt: '检查玩家写的核心体验是不是真的反映 L1-L6 整链路（对不上的就是凭空写）。' + REFLECT_TAIL,
      action: 'reflect',
    },
    ...STANDARD_PRESETS,
    {
      label: '🌀 全链路整合',
      prompt: RECALIBRATE_FULL_CHAIN_PROMPT + JSON_TAIL,
      action: 'calibrate',
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
 *    反思/提问/解释类输出**不要**用 update_doc_item, 用 ask_user_question / ask_free_text */
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
    `反思 / 提问 / 解释 → 用 ask_user_question / ask_free_text，不要用 update_doc_item。`
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
   *  v0.5+ maturity：仅 L2 pillars 写（其他步骤传 undefined 不写盘）
   *  v0.5+ 设计循环：成功 → markStale(stepId) 触发下游/上游黄点
   *  v0.5.1 mtime hash 对比：保存前拿 oldContent / oldMaturity，后端返回 newContent / newMaturity，
   *    真有变化才 markStale——避免 debounce 重复触发、纯 markConfirmed 重复保存等场景下"改一下全黄"
   *  成功用后端返回的 step 替换本地项（shallowRef → 整个数组换新引用）；
   *  失败抛错让 UI 提示 */
  async function save(
    stepId: ConceptStepId,
    content: string,
    markConfirmed: boolean,
    maturity?: StepMaturity,
  ): Promise<void> {
    const project = useProjectStore()
    if (!project.current) throw new Error('没有打开的项目')
    // v0.5.1 拿旧 content / maturity（save 前可能没加载过 steps，oldStep 可能 undefined → 视为变化）
    const oldStep = steps.value.find((s) => s.id === stepId)
    const oldContent = oldStep?.content ?? ''
    const oldMaturity = oldStep?.maturity ?? 'empty'
    const updated = await saveConceptStep(
      project.current.folder,
      stepId,
      content,
      markConfirmed,
      maturity,
    )
    steps.value = steps.value.map((s) => (s.id === stepId ? updated : s))
    // v0.5.1 mtime hash 对比：content / maturity 真有变化才 markStale
    // - 字符串比较（O(n) 但 content 不大，不引入 hash 库）
    // - maturity 变化时即使 content 没变也要 markStale（L2 成熟度从草稿→定型影响下游判断）
    // - oldStep undefined（极少见：load 失败但还能 save）→ 视为变化触发 markStale，行为保守
    const contentChanged = oldContent !== updated.content
    const maturityChanged = maturity !== undefined && oldMaturity !== updated.maturity
    if (contentChanged || maturityChanged) {
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
          console.warn(`[concept.onChatDone] ${id} run=${payload.run_id} empty content (LLM returned 0 chars?)`)
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
      // LLM 收到 schema 强制调 ask_user_question / update_doc_item 返结构化数据
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
   *    - 调 ask_user_question tool → 又一个 AltCard 循环
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
        ...mapGet(chatHistories, id, [])
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role,
            content: m.content,
            partial: m.partial,
            tool_calls: m.tool_calls,
            tool_call_id: m.tool_call_id,
          })),
      ],
      { model: conn.model, effort: null, tools },
    )
    mapSet(chatRunIds, id, runId)
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

  // === v0.5+ 设计循环：staleFlags + L7 5min cooldown ===
  //
  // 改任何 step → markStaleAfterSave 标记上下游 stale
  //  - L1 改 → L2-L7 全 stale
  //  - L2-L6 改 → 自己 + 上游 + L7 stale
  //  - L7 改 → L1-L6 全 stale
  // 玩家点黄点（或跑完校准 preset）→ clearStale
  // 5min cooldown for L7 频繁改动（避免 toast 刷屏）

  const staleFlags = shallowRef(new Map<ConceptStepId, boolean>())

  /** 改完一步后标记 stale（设计循环核心）
   *  - L1 改 → L2-L7 all stale
   *  - L2-L6 改 → 自己 + 上游 + L7 stale
   *  - L7 改 → L1-L6 all stale
   *  - 5min cooldown for L7 频繁改（避免 toast 刷屏） */
  function markStaleAfterSave(changedId: ConceptStepId): void {
    const idx = STEP_IDS.indexOf(changedId)
    if (idx === -1) return
    const next = new Map(staleFlags.value)
    if (changedId === 'core-fantasy') {
      // L7 改 → L1-L6 全 stale（5min cooldown）
      const now = Date.now()
      const lastL7Stale = (window as unknown as { __lastL7Stale?: number }).__lastL7Stale ?? 0
      if (now - lastL7Stale < 5 * 60 * 1000) {
        // cooldown 内 → 不重复 toast（但不阻止 mark stale —— 黄点还是亮）
        // 黄点本身已经是 stale，再触发一次没有副作用；这里只跳过 toast 逻辑（toast 在 view 层）
      } else {
        ;(window as unknown as { __lastL7Stale?: number }).__lastL7Stale = now
      }
      for (let i = 0; i < 6; i++) {
        next.set(STEP_IDS[i], true)
      }
    } else if (changedId === 'seed') {
      // L1 改 → L2-L7 all stale
      for (let i = 1; i < STEP_IDS.length; i++) {
        next.set(STEP_IDS[i], true)
      }
    } else {
      // L2-L6 改 → 自己 + 上游 + L7 stale
      // 上游：idx 之前的；自己：idx；L7：core-fantasy
      for (let i = 0; i <= idx; i++) {
        next.set(STEP_IDS[i], true)
      }
      next.set('core-fantasy', true)
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
