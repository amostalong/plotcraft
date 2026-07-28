use std::collections::HashMap;
use std::sync::Arc;

use mimalloc::MiMalloc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

mod commands;
mod error;
mod llm;

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

/// Chat run 状态：run_id → CancellationToken
///
/// 存 Tauri state，前端 cancel_chat 通过 run_id 找到对应 token 触发取消
type RunMap = Arc<Mutex<HashMap<String, CancellationToken>>>;

/// PlotCraft 版本号
#[tauri::command]
fn plotcraft_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// PlotCraft 启动入口
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let run_map: RunMap = Arc::new(Mutex::new(HashMap::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(run_map)
        .invoke_handler(tauri::generate_handler![
            plotcraft_version,
            commands::llm::start_chat,
            commands::llm::cancel_chat,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
