// PlotCraft v0.1 debug console —— 仿 Locus 同款，但实现从零
//
// 跟 Locus 差别（AGENTS.md 硬规则 #1：结构对齐，代码自写）：
// - Locus `DebugConsoleEntry` 有完整的 level (trace/debug/info/warn/error) ×
//   source (backend/frontend) × module × message + 可选 ctx
// - Locus `debugConsole` service 用 tracing-subscriber 自动收所有 log
// - PlotCraft v0.1 简化：
//   - level 3 种（info / warn / error）
//   - source 2 种（backend / frontend）
//   - 没 eprintln 自动收（不接 tracing）—— 关键错误点手动调 `console_log()`
//   - 没 export log file / reveal log file（v0.1 简化）
//   - 没 column resize / message expand（v0.1 简化）
//
// 数据流：
// - Rust 端：关键错误点调 `console_log(app, level, module, msg)` → push 到
//   in-memory Vec + emit `console:entry` 事件
// - Frontend：listen `console:entry` 增量收 + invoke `get_console_entries`
//   拉 snapshot（首次打开控制台时）
// - 命令：`get_console_entries` / `clear_console`
//
// 容量：默认 1000 条上限（最新在 [0]，FIFO 截断），不写盘（重启清空）
// 跟 Locus 行为一致 —— console 是 in-memory 的"看到什么是什么"

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// PlotCraft 控制台 entry —— 仿 Locus `DebugConsoleEntry` 简化版
#[derive(Debug, Clone, Serialize)]
pub struct ConsoleEntry {
    /// 唯一 id（生成时用 timestamp + counter 拼，足够 unique）
    pub id: String,
    /// 日志级别（v0.1 简化：info / warn / error 三种）
    pub level: String,
    /// 来源（v0.1 简化：backend / frontend 两种）
    pub source: String,
    /// 模块名（如 "llm" / "settings" / "project" / "model_catalog" / "app"）
    pub module: String,
    /// 消息文本
    pub message: String,
    /// 时间戳（毫秒，frontend 格式化用）
    pub timestamp_ms: i64,
}

/// Tauri-managed state：in-memory console buffer
pub struct ConsoleState {
    entries: Mutex<Vec<ConsoleEntry>>,
    max_entries: usize,
    counter: Mutex<u64>,
}

impl ConsoleState {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
            max_entries: 1000,
            counter: Mutex::new(0),
        }
    }

    /// 推一条 entry：插入到 [0]（最新在顶），FIFO 截断，emit 事件
    pub fn push(&self, app: &AppHandle, level: &str, module: &str, message: impl Into<String>) {
        let id = {
            let mut c = self.counter.lock().expect("console counter mutex poisoned");
            *c += 1;
            format!("console-{}-{}", chrono::Utc::now().timestamp_millis(), *c)
        };
        let entry = ConsoleEntry {
            id,
            level: level.to_string(),
            source: "backend".to_string(),
            module: module.to_string(),
            message: message.into(),
            timestamp_ms: chrono::Utc::now().timestamp_millis(),
        };
        {
            let mut entries = self.entries.lock().expect("console entries mutex poisoned");
            entries.insert(0, entry.clone());
            if entries.len() > self.max_entries {
                entries.truncate(self.max_entries);
            }
        }
        // 推送到前端（emit 失败不致命 —— Tauri runtime 可能还没起来）
        let _ = app.emit("console:entry", &entry);
    }

    /// 拉完整 snapshot（前端首次打开时用）
    pub fn snapshot(&self) -> Vec<ConsoleEntry> {
        self.entries
            .lock()
            .expect("console entries mutex poisoned")
            .clone()
    }

    /// 清空
    pub fn clear(&self) {
        self.entries
            .lock()
            .expect("console entries mutex poisoned")
            .clear();
    }
}

/// 给 Rust 端任意地方调用的 helper —— 从 `tauri::AppHandle` 拿 ConsoleState
/// 推一条 entry。
///
/// v0.1 调用点（v0.1.5+ 关键错误都加进来）：
/// - commands/llm.rs: start_chat 错误 / cancel_chat 错误 / test_provider 错误
/// - commands/settings.rs: save_config 错误 / load_config 错误
/// - commands/project.rs: create_project 错误 / list_projects 错误
/// - model_catalog.rs: 远端 refresh 错误 / cache drop 事件
///
/// 调用方式：
/// ```ignore
/// console::console_log(&app, "error", "llm", format!("start_chat failed: {e}"));
/// ```
pub fn console_log(app: &AppHandle, level: &str, module: &str, message: impl Into<String>) {
    let state = app.state::<ConsoleState>();
    state.push(app, level, module, message);
}

/// Tauri command: 拉完整 console snapshot（前端首次打开时用）
#[tauri::command]
pub fn get_console_entries(state: tauri::State<ConsoleState>) -> Vec<ConsoleEntry> {
    state.snapshot()
}

/// Tauri command: 清空 console
#[tauri::command]
pub fn clear_console(state: tauri::State<ConsoleState>) {
    state.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tauri 拿不到 AppHandle 不能直接测 push，但可以验证 clear / snapshot 行为
    #[test]
    fn snapshot_and_clear_empty() {
        let state = ConsoleState::new();
        assert_eq!(state.snapshot().len(), 0);
        state.clear();
        assert_eq!(state.snapshot().len(), 0);
    }

    /// 测试 max_entries 截断逻辑
    #[test]
    fn max_entries_truncation_logic() {
        // 直接测 Vec 截断行为（不能 push 因为要 AppHandle）
        let mut entries: Vec<ConsoleEntry> = (0..1500)
            .map(|i| ConsoleEntry {
                id: format!("e-{i}"),
                level: "info".to_string(),
                source: "backend".to_string(),
                module: "test".to_string(),
                message: format!("m-{i}"),
                timestamp_ms: i as i64,
            })
            .collect();
        entries.insert(0, ConsoleEntry {
            id: "new".to_string(),
            level: "info".to_string(),
            source: "backend".to_string(),
            module: "test".to_string(),
            message: "newest".to_string(),
            timestamp_ms: 9999,
        });
        if entries.len() > 1000 {
            entries.truncate(1000);
        }
        // 最新在 [0]，截断到 1000，旧的被砍
        assert_eq!(entries.len(), 1000);
        assert_eq!(entries[0].id, "new");
    }
}
