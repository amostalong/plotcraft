use serde::{Serialize, Serializer};
use thiserror::Error;

/// PlotCraft 全局错误类型
///
/// Tauri command 错误返回 `AppError`（已实现 Serialize，自动转字符串给前端）。
/// 前端 `lib/error.ts` 的 `handleError` 统一入口处理。
#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Config error: {0}")]
    Config(String),

    #[error("LLM error: {0}")]
    Llm(String),

    #[error("LLM HTTP error ({status}): {body}")]
    LlmHttp { status: u16, body: String },

    #[error("LLM stream error: {0}")]
    #[allow(dead_code)] // commit 5/6 onboarding + settings 会用
    LlmStream(String),

    #[error("Cancelled by user")]
    Cancelled,
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
