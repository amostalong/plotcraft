use mimalloc::MiMalloc;

// mimalloc 全局 allocator（Windows 多线程小对象分配性能显著优于系统堆）
#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

/// PlotCraft 版本号
#[tauri::command]
fn plotcraft_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// PlotCraft 启动入口
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![plotcraft_version])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
