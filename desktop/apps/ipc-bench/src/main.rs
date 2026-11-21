//! The IPC benchmark: the measuring instrument of the desktop transport bridge's gate.
//!
//! A Tauri window whose page (`page/`) runs the workloads of `swe/features/desktop-transport-bridge.md`
//! § 1 against a WebSocket server in this process (`server`), and hands the numbers to
//! [`bench_finish`], which writes `results.json` and exits: 0 when every run completed and the
//! integrity check (B6) found nothing, 1 otherwise. It runs unattended. It is never bundled or
//! released, and the shipped app (`apps/pistudiodesktop`) has nothing of it.
//!
//! Usage: `ipc-bench [--out FILE] [--runs N] [--only ROWS] [--scale FRACTION] [--corrupt FRAME]
//! [--swap FRAME] [--timeout SECONDS]`; `ipc-bench --help` lists them.

// Release builds on Windows are GUI-subsystem apps: no console window.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

mod bridge;
mod bridge_commands;
mod commands;
mod frame;
mod procs;
mod server;

use std::path::PathBuf;
use std::time::Duration;

use clap::Parser;
use commands::{Config, Shared};

/// The workload rows this build has. `--only` takes a comma-separated subset. `window` is the
/// no-acknowledgement test of the bridge candidates (the baseline has no window).
const ROWS: &[&str] = &["b1", "b2", "b3", "b4", "b5", "window"];

#[derive(Parser, Debug)]
#[command(name = "ipc-bench", version, about = "Pi Studio desktop: the IPC benchmark")]
struct Args {
    /// Where to write the results.
    #[arg(long, value_name = "FILE", default_value = "results.json")]
    out: PathBuf,
    /// How many times each workload runs.
    #[arg(long, value_name = "N", default_value_t = 3, value_parser = clap::value_parser!(u32).range(1..=50))]
    runs: u32,
    /// Only these rows, comma-separated (b1, b2, b3, b4, b5, window). Default: all.
    #[arg(long, value_name = "ROWS", value_delimiter = ',', value_parser = parse_row)]
    only: Vec<String>,
    /// Shrink the byte and frame counts to this fraction (above 0, at most 1), for a quick run.
    #[arg(long, value_name = "FRACTION", default_value_t = 1.0, value_parser = parse_scale)]
    scale: f64,
    /// Change one byte of the frame with this counter, in every stream the server sends (and in
    /// what it receives): the run must exit 1 and name the workload and the frame.
    #[arg(long, value_name = "FRAME")]
    corrupt: Option<u32>,
    /// Send the frame with this counter after the next one (the server's streams).
    #[arg(long, value_name = "FRAME")]
    swap: Option<u32>,
    /// Give up, exit 1, when the run is not over after this many seconds.
    #[arg(long, value_name = "SECONDS", default_value_t = 3600)]
    timeout: u64,
}

fn parse_row(s: &str) -> Result<String, String> {
    let row = s.trim().to_ascii_lowercase();
    if ROWS.contains(&row.as_str()) { Ok(row) } else { Err(format!("{s:?} is not a row of this build (rows: {})", ROWS.join(", "))) }
}

fn parse_scale(s: &str) -> Result<f64, String> {
    match s.parse::<f64>() {
        Ok(f) if f > 0.0 && f <= 1.0 => Ok(f),
        _ => Err(format!("{s:?} is not a fraction above 0 and at most 1")),
    }
}

/// A startup error: say what, and leave.
fn fail(code: i32, message: impl std::fmt::Display) -> ! {
    eprintln!("ipc-bench: {message}");
    std::process::exit(code)
}

fn main() {
    let args = Args::parse();
    let only: Vec<String> = if args.only.is_empty() { ROWS.iter().map(|r| (*r).to_string()).collect() } else { args.only };
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap_or_else(|e| fail(1, format!("cannot listen on 127.0.0.1: {e}")));
    let port = listener.local_addr().map(|a| a.port()).unwrap_or_else(|e| fail(1, format!("no port: {e}")));
    let switches = server::Switches { corrupt: args.corrupt, swap: args.swap };
    let shared = Shared {
        config: Config {
            port,
            runs: args.runs,
            only,
            scale: args.scale,
            corrupt: args.corrupt,
            swap: args.swap,
            tauri_version: tauri::VERSION,
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
            pid: std::process::id(),
        },
        out: args.out,
    };
    let timeout = Duration::from_secs(args.timeout);
    std::thread::spawn(move || {
        std::thread::sleep(timeout);
        fail(1, format!("the run was not over after {} s", timeout.as_secs()))
    });
    eprintln!(
        "ipc-bench: server on 127.0.0.1:{port}, rows {}, {} run(s) each, scale {}",
        shared.config.only.join(","),
        shared.config.runs,
        shared.config.scale
    );

    let fed = server::Fed::default();
    let bridge = bridge::Bridge::new(port, fed.clone());
    let built = tauri::Builder::default()
        .manage(shared)
        .manage(bridge)
        .setup(move |_| {
            tauri::async_runtime::spawn(async move {
                if let Err(e) = server::serve(listener, switches, fed).await {
                    fail(1, format!("server: {e}"));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bench_config,
            commands::bench_rss,
            commands::bench_progress,
            commands::bench_finish,
            bridge_commands::bridge_open,
            bridge_commands::bridge_send_text,
            bridge_commands::bridge_send_binary,
            bridge_commands::bridge_send_batch,
            bridge_commands::bridge_ack,
            bridge_commands::bridge_close,
            bridge_commands::bridge_stats
        ])
        .run(tauri::generate_context!());
    if let Err(e) = built {
        fail(1, format!("the window failed: {e}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_are_checked() {
        assert!(Args::try_parse_from(["ipc-bench"]).is_ok());
        let a = Args::try_parse_from(["ipc-bench", "--only", "B1,b3", "--scale", "0.1", "--runs", "2", "--corrupt", "5"]).unwrap();
        assert_eq!((a.only, a.scale, a.runs, a.corrupt), (vec!["b1".to_string(), "b3".to_string()], 0.1, 2, Some(5)));
        for bad in [["--only", "b9"], ["--scale", "0"], ["--scale", "1.5"], ["--runs", "0"], ["--swap", "x"]] {
            assert!(Args::try_parse_from(["ipc-bench", bad[0], bad[1]]).is_err(), "{bad:?}");
        }
    }
}
