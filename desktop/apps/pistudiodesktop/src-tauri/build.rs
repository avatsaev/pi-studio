fn main() {
    // The app's commands, listed. Listing them turns on Tauri's permission check for them: from
    // the page, a command can be invoked only when it is named here AND granted by
    // `allow-<command>` in `capabilities/default.json`. Without this list every command the
    // handler registers is callable from the page.
    let manifest = tauri_build::AppManifest::new().commands(&[
        "boot",
        "engine_command",
        "daemon_resolve_current",
        "daemon_switch",
        "storage_set",
        "dialog_confirm",
        "dialog_alert",
        "open_external",
        "save_begin",
        "save_write",
        "save_finish",
        "save_discard",
        "upload_pick",
        "transfer_upload",
        "transfer_save",
        "transfer_cancel",
        "transfers_set",
        "preview_mount",
        "preview_release",
        "transport_open",
        "ssh_config_hosts",
    ]);
    if let Err(e) = tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)) {
        eprintln!("pistudiodesktop: build script failed: {e:#}");
        std::process::exit(1);
    }
}
