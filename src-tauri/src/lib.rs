use std::collections::HashMap;
use std::sync::Arc;

use mimalloc::MiMalloc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

mod art;
mod chats;
mod commands;
mod concept;
mod console;
mod docs;
mod error;
mod llm;
mod model_catalog;
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
        .manage(console::ConsoleState::new())
        .setup(|app| {
            // 启动后 5s 在后台拉一次 model catalog（cache 超 24h 才真拉）——
            // 失败不致命，fallback freshest local data
            model_catalog::spawn_background_refresh(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            plotcraft_version,
            commands::llm::start_chat,
            commands::llm::cancel_chat,
            commands::llm::test_provider,
            commands::llm::generate,
            commands::project::create_project,
            commands::project::list_projects,
            commands::project::open_project,
            commands::art::list_art,
            commands::art::create_art_entry,
            commands::art::save_art_prompt,
            commands::art::delete_art_entry,
            commands::art::read_art_image,
            commands::concept::list_concept_steps,
            commands::concept::save_concept_step,
            commands::concept::get_concept_summary,
            commands::docs::list_docs,
            commands::docs::save_doc,
            commands::docs::get_docs_summary,
            commands::settings::load_config,
            commands::settings::save_config,
            commands::locus_import::import_from_locus,
            commands::session::list_sessions,
            commands::session::create_session,
            commands::session::delete_session,
            commands::session::rename_session,
            commands::session::load_session,
            commands::session::save_session,
            commands::chats::load_chats,
            commands::chats::save_chat,
            commands::chats::delete_chat,
            commands::chats::delete_all_chats,
            model_catalog::get_model_catalog,
            model_catalog::refresh_model_catalog,
            console::get_console_entries,
            console::clear_console,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
