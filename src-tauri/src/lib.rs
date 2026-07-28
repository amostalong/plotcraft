use std::collections::HashMap;
use std::sync::Arc;

use mimalloc::MiMalloc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

mod commands;
mod error;
mod llm;
mod project;

#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

/// Chat run 状态：run_id → CancellationToken
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
            commands::llm::test_provider,
            commands::project::create_project,
            commands::project::list_projects,
            commands::settings::load_config,
            commands::settings::save_config,
            commands::locus_import::import_from_locus,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
