//! The page's commands. The list is in `build.rs` and the grants in `capabilities/default.json`.

// `#[tauri::command]` generates code beside each function that names `unreachable!`, which the
// crate denies for code written by hand.
#![allow(clippy::unreachable)]

use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::procs;
use crate::tick::{self, TickReport, Ticker};

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

/// How long a window change gets to take effect before its state is read: window systems answer asynchronously.
const WINDOW_SETTLE: Duration = Duration::from_millis(200);
/// The longest a window may be held hidden: input is hostile even from the benchmark's own page.
const MAX_HOLD_MS: u64 = 10 * 60 * 1000;

/// What the window system says the window is.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub visible: bool,
    pub minimized: bool,
}

/// Row B8's window hold, with offsets in milliseconds from the start of the command.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hold {
    pub mode: String,
    /// When the request to hide (or minimise) had returned.
    pub hidden_from_ms: f64,
    /// When the request to show (or restore) was made.
    pub shown_at_ms: f64,
    /// The window `WINDOW_SETTLE` after the first request, and after the second: a system without a
    /// window manager may accept a request and do nothing, and the record must say so.
    pub after_hide: WindowState,
    pub after_show: WindowState,
}

fn window_state(window: &tauri::WebviewWindow) -> Result<WindowState, String> {
    let visible = window.is_visible().map_err(|e| format!("window state: {e}"))?;
    let minimized = window.is_minimized().map_err(|e| format!("window state: {e}"))?;
    Ok(WindowState { visible, minimized })
}

/// One window request of the hold: take the window away (`away`) or bring it back.
fn change_window(window: &tauri::WebviewWindow, mode: &str, away: bool) -> Result<(), String> {
    let done = match (mode, away) {
        ("hide", true) => window.hide(),
        ("hide", false) => window.show(),
        ("minimize", true) => window.minimize(),
        ("minimize", false) => window.unminimize(),
        _ => return Err(format!("no such window mode {mode:?} (hide, minimize)")),
    };
    done.map_err(|e| format!("window {mode}{}: {e}", if away { "" } else { " (back)" }))
}

/// Hides (`hide`) or minimises (`minimize`) the window, keeps it so for `hold_ms`, and brings it
/// back, all in Rust: a hidden page may run its own timers late or not at all, so it cannot be the
/// one to show the window again. Answers when the window is back.
#[tauri::command]
pub async fn bench_window_hold(window: tauri::WebviewWindow, mode: String, hold_ms: u64) -> Result<Hold, String> {
    if hold_ms > MAX_HOLD_MS {
        return Err(format!("a hold is at most {MAX_HOLD_MS} ms"));
    }
    let start = Instant::now();
    change_window(&window, &mode, true)?;
    let hidden_from = start.elapsed();
    tokio::time::sleep(WINDOW_SETTLE).await;
    let after_hide = window_state(&window);
    tokio::time::sleep(Duration::from_millis(hold_ms).saturating_sub(start.elapsed() - hidden_from)).await;
    let shown_at = start.elapsed();
    // The window comes back whatever went wrong above.
    let restored = change_window(&window, &mode, false);
    tokio::time::sleep(WINDOW_SETTLE).await;
    let after_show = window_state(&window);
    restored?;
    Ok(Hold {
        mode,
        hidden_from_ms: hidden_from.as_secs_f64() * 1000.0,
        shown_at_ms: shown_at.as_secs_f64() * 1000.0,
        after_hide: after_hide?,
        after_show: after_show?,
    })
}

/// Starts the 2-second tick (`tick.rs`).
#[tauri::command]
pub async fn bench_tick_start(ticker: State<'_, Ticker>) -> Result<(), String> {
    ticker.start(tick::INTERVAL);
    Ok(())
}

/// Stops the tick; answers its gaps.
#[tauri::command]
pub async fn bench_tick_stop(ticker: State<'_, Ticker>) -> Result<TickReport, String> {
    Ok(ticker.stop(tick::INTERVAL))
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
