use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    System,
    User,
    Assistant,
}

/// v0.2+ ChatMessage —— 加 `partial` 字段保留"流到一半挂"的 assistant 回复
///
/// - `partial: Some(true)` → 渲染时 UI 加 "(回复中断)" marker
/// - `partial: None` (序列化时省略) / `Some(false)` → 完整回复
/// - `#[serde(default, skip_serializing_if = "Option::is_none")]` 让 v0.1 老 session
///   (没 partial 字段) 也能反序列化，且新 session 不写冗余字段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partial: Option<bool>,
}
