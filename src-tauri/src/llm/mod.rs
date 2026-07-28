//! LLM 集成模块
//!
//! 反 Locus 卡顿核心实现（见 [CHAT_LLM_DESIGN.md §3 反制 1]）：
//! - SSE 解析丢 `tokio::task::spawn_blocking`（CPU 密集不占 tokio runtime）
//! - parse / emit 走 `mpsc::channel` 解耦
//! - emit 按 16ms rAF 节流 + 256 char batch 上限

pub mod config;
pub mod streaming;
pub mod streaming_anthropic;
pub mod types;
