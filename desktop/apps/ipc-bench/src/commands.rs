//! The page's commands. The list is in `build.rs` and the grants in `capabilities/default.json`.

// `#[tauri::command]` generates code beside each function that names `unreachable!`, which the
// crate denies for code written by hand.
#![allow(clippy::unreachable)]

use std::path::PathBuf;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::procs;

/// What the page asks for at start.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub port: u16,
    pub runs: u32,
    pub only: Vec<String>,
    pub scale: f64,
    pub corrupt: Option<u32>,
    pub swap: Option<u32>,
    pub tauri_version: &'static str,
    pub os: &'static str,
    pub arch: &'static str,
    pub pid: u32,
}

/// Managed by Tauri: the run's settings and where `results.json` goes.
pub struct Shared {
    pub config: Config,
    pub out: PathBuf,
}

/// The run's settings and the port of the server.
#[tauri::command]
pub async fn bench_config(shared: State<'_, Shared>) -> Result<Config, String> {
    Ok(shared.config.clone())
}

/// The resident memory of the app's processes now.
#[tauri::command]
pub async fn bench_rss() -> Result<procs::Rss, String> {
    tauri::async_runtime::spawn_blocking(procs::sample).await.map_err(|e| format!("memory sample: {e}"))?
}

/// A progress line, to the standard error stream.
#[tauri::command]
pub async fn bench_progress(line: String) -> Result<(), String> {
    eprintln!("{line}");
    Ok(())
}

/// The page is done: write `results.json` and leave. `results.ok` false, or no `ok`, is exit 1;
/// each of `results.problems` (strings) is printed.
#[tauri::command]
pub async fn bench_finish(shared: State<'_, Shared>, results: Value) -> Result<(), String> {
    let ok = results.get("ok").and_then(Value::as_bool) == Some(true);
    for problem in results.get("problems").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
        eprintln!("ipc-bench: PROBLEM {problem}");
    }
    let written =
        serde_json::to_vec_pretty(&results).map_err(|e| e.to_string()).and_then(|bytes| std::fs::write(&shared.out, bytes).map_err(|e| e.to_string()));
    match written {
        Ok(()) => eprintln!("ipc-bench: wrote {}", shared.out.display()),
        Err(e) => crate::fail(1, format!("cannot write {}: {e}", shared.out.display())),
    }
    eprintln!("ipc-bench: {}", if ok { "done, every run completed and no frame was damaged" } else { "FAILED" });
    std::process::exit(if ok { 0 } else { 1 })
}
