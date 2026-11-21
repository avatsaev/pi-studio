fn main() {
    // The benchmark's commands, listed, as in the shipped app: from the page a command can be
    // invoked only when it is named here AND granted by `allow-<command>` in
    // `capabilities/default.json`.
    let manifest = tauri_build::AppManifest::new().commands(&["bench_config", "bench_rss", "bench_progress", "bench_finish"]);
    if let Err(e) = tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)) {
        eprintln!("ipc-bench: build script failed: {e:#}");
        std::process::exit(1);
    }
}
