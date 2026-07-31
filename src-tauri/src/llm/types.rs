use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
    /// v0.4+ tool 角色 —— tool result 消息（玩家回答 ask_user_question /
    /// ask_free_text，或 LLM 调 tool 的回执）。跨 OpenAI / Anthropic 协议都支持。
    Tool,
}

/// v0.2+ ChatMessage —— 加 `partial` 字段保留"流到一半挂"的 assistant 回复
///
/// - `partial: Some(true)` → 渲染时 UI 加 "(回复中断)" marker
/// - `partial: None` (序列化时省略) / `Some(false)` → 完整回复
/// - `#[serde(default, skip_serializing_if = "Option::is_none")]` 让 v0.1 老 session
///   (没 partial 字段) 也能反序列化，且新 session 不写冗余字段
///
/// v0.4+ tool calling 加 2 字段：
/// - `tool_calls`: assistant 消息的 tool calls 列表（LLM 决定调哪个 tool + 参数）
/// - `tool_call_id`: tool 消息（role=tool）关联到对应 tool_call 的 id
///   （OpenAI 协议要求；Anthropic 协议等价字段也是 `tool_use_id` 但跨 boundary 统一为 `tool_call_id`）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partial: Option<bool>,
    /// v0.4+ assistant 消息的 tool_calls
    /// - 流式累积：start 时 name 已知, arguments 后到；done 时 arguments 是完整 JSON
    /// - 跨 request 回放：必须保留（OpenAI tool_calls 字段必填，否则 LLM 不知道 tool_use 上下文）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallInfo>>,
    /// v0.4+ tool 消息的 tool_call_id（关联到 assistant 消息的 tool_calls[].id）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

/// v0.4+ tool definition (OpenAI / Anthropic 协议级 tool 注入)
///
/// 注入到 LLM request 的 `tools` 字段。**关闭的 tool 不传 → LLM 完全不知道存在**。
/// Anthropic 协议等价：top-level `tools: [{name, description, input_schema}]`，
/// PlotCraft 统一用 OpenAI `{type: function, function: {name, description, parameters}}` 形式，
/// 协议层 build body 时按 api_format 转。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    /// 永远 "function"（OpenAI 协议）
    #[serde(rename = "type")]
    pub r#type: String,
    pub function: ToolFunctionDef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolFunctionDef {
    pub name: String,
    pub description: String,
    /// JSON Schema (OpenAI parameters 字段格式)
    pub parameters: serde_json::Value,
}

/// v0.4+ 单个 tool call（LLM 返的"我要调这个 tool + 参数是这些"）
///
/// 流式累积：start 时 id + name 已知，arguments 为空；
/// done 时 arguments 是完整 JSON 字符串（前端再 parse 成 Value）。
///
/// 跟 Locus `ToolCallInfo` 差异（v0.4+ 简化）：
/// - 没有 server_tool_output / outcome / recorded_output / nested_tool_calls
///   ——PlotCraft 玩家主导，没有 server-side tool（web_search）和 nested tool
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallInfo {
    /// OpenAI / Anthropic 协议级 id —— tool result 消息的 tool_call_id 关联到这里
    pub id: String,
    /// 调的工具名（ask_user_question / update_doc_item / ask_free_text）
    pub name: String,
    /// 参数的 JSON 字符串（流式累积；done 时是合法 JSON；前端按 name 分发解析）
    pub arguments: String,
}
