// Windows release: 禁止额外 console 窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    plotcraft_lib::run()
}
