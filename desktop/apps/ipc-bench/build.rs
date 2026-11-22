fn main() {
    // The benchmark's commands, listed, as in the shipped app: from the page a command can be
    // invoked only when it is named here AND granted by `allow-<command>` in
    // `capabilities/default.json`.
    let manifest = tauri_build::AppManifest::new().commands(&[
        "bench_config",
        "bench_rss",
        "bench_progress",
        "bench_finish",
        "bench_window_hold",
        "bench_tick_start",
        "bench_tick_stop",
        "bridge_open",
        "bridge_send_text",
        "bridge_send_binary",
        "bridge_send_batch",
        "bridge_ack",
        "bridge_close",
        "bridge_stats",
        "proxy_open",
        "proxy_stats",
    ]);
    if let Err(e) = tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)) {
        eprintln!("ipc-bench: build script failed: {e:#}");
        std::process::exit(1);
    }
}
