fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "diagnostics",
            "connection",
            "connection_profiles",
            "desktop_storage",
            "global_storage_stats",
            "set_storage_quota",
            "credential_cleanup",
            "connection_recovery",
            "save_connection_profile",
            "delete_connection_profile",
            "activate_connection_profile",
            "appearance",
            "task_snapshots",
            "save_connection",
            "open_session_diagnostics",
            "reset_diagnostic_key",
            "restart_engine",
            "open_logs",
            "quit_app",
        ]),
    ))
    .expect("Tauri build metadata failed");
}
