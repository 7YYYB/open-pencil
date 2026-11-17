// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // This fork is distributed manually; upstream updates do not contain the board tools.
    std::env::set_var("OPENPENCIL_SELF_UPDATE", "0");
    open_pencil_lib::run()
}
