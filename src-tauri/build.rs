fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "diagnostics",
            "connection",
            "save_connection",
            "restart_engine",
            "open_logs",
            "quit_app",
        ]),
    ))
    .expect("Tauri build metadata failed");
}
