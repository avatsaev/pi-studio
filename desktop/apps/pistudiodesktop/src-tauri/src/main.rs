//! Pi Studio desktop app: a Tauri window whose webview runs the workbench.
//!
//! Usage: `pistudiodesktop [options]`; `pistudiodesktop --help` lists the options.
//!
//! The app keeps its settings and the workbench's stored keys in its configuration directory:
//! the platform's per-user directory for the app identifier, or `--config-dir <DIR>` (or
//! `PISTUDIODESKTOP_CONFIG_DIR`), which tests and live checks use to stay out of it.
//!
//! `--control <port>` (or `PISTUDIODESKTOP_CONTROL_PORT`) starts a loopback JSON-lines control server:
//! the first line authenticates, then each request line gets one reply line. The methods are
//! in `pistudiodesktop_shell::control`.

// Release builds on Windows are GUI-subsystem apps: no console window from the Start menu.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

mod bridge;
mod commands;
mod control_server;
mod crash_guard;
mod logging;
mod preview_scheme;
mod services;
mod transfers;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::channel;

use clap::Parser;
use pistudiodesktop_shell::AppInfo;
use pistudiodesktop_shell::navigation;
use pistudiodesktop_shell::owner::FLUSH_DELAY;
use pistudiodesktop_shell::preview::{self, Previews};
use pistudiodesktop_shell::saves::Saves;
use tauri::Manager as _;

#[derive(Parser)]
#[command(name = "pistudiodesktop", version, about = "Pi Studio")]
struct Args {
    /// Serve the JSON control protocol on 127.0.0.1:<PORT> (0 = any free port).
    #[arg(long, env = "PISTUDIODESKTOP_CONTROL_PORT", value_name = "PORT")]
    control: Option<u16>,
    /// File holding the control token (64 hex characters); created with a fresh token when missing.
    #[arg(long, env = "PISTUDIODESKTOP_CONTROL_TOKEN_FILE", value_name = "FILE")]
    control_token_file: Option<PathBuf>,
    /// Directory for the settings and the workbench's stored keys. Default: the platform's per-user
    /// configuration directory for the app (`com.avatsaev.pi-studio`).
    #[arg(long, env = "PISTUDIODESKTOP_CONFIG_DIR", value_name = "DIR")]
    config_dir: Option<PathBuf>,
}

/// A startup error: say what, and leave.
fn fail(code: i32, message: impl std::fmt::Display) -> ! {
    eprintln!("pistudiodesktop: {message}");
    std::process::exit(code)
}

/// Refuse any navigation of a webview to a URL outside the app's own origin
/// ([`pistudiodesktop_shell::navigation`]). The dev server's origin counts only in a dev build.
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            let dev = if tauri::is_dev() { webview.app_handle().config().build.dev_url.as_ref() } else { None };
            let allowed = navigation::allows(url.as_str(), dev.map(|u| u.as_str()));
            if !allowed {
                log::warn!("navigation refused: {}", navigation::describe(url.as_str()));
            }
            allowed
        })
        .build()
}

fn main() {
    let args = Args::parse();
    logging::init();
    crash_guard::install_hook();
    // Bind before the window opens: a port in use is a startup error, not a silent no-op.
    let control = match args.control.map(|port| control_server::bind(port, args.control_token_file.as_deref())) {
        Some(Ok(bound)) => Some(bound),
        Some(Err(e)) => fail(2, e),
        None => None,
    };
    // Every request, from the webview and from the control socket, crosses this channel to the
    // one thread that owns the session.
    let (requests, inbox) = channel();
    if let Some((listener, token)) = control {
        control_server::start(listener, token, requests.clone());
    }
    // The single-instance plug-in goes first, as its documentation says. Closing the one window
    // quits the app: Tauri exits when its last window closes, and nothing here changes that.
    let app = match tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| services::bring_forward(app)))
        .plugin(navigation_guard())
        .plugin(tauri_plugin_dialog::init())
        .plugin(services::opener_plugin())
        .manage(bridge::Bridge::new(requests))
        .manage(transfers::Transfers::default())
        // The preview origin: documents the page mounts are served from this scheme, and the
        // navigation rule admits it. Its window policy is `frame-src` in `tauri.conf.json`.
        .manage(Previews::default())
        .register_uri_scheme_protocol(preview::SCHEME, preview_scheme::handle)
        .on_window_event(transfers::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::boot,
            commands::storage_set,
            commands::dialog_confirm,
            commands::dialog_alert,
            commands::open_external,
            commands::save_begin,
            commands::save_write,
            commands::save_finish,
            commands::save_discard,
            commands::transfers_set,
            commands::preview_mount,
            commands::preview_release
        ])
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(e) => fail(1, e),
    };
    let config_dir = match args.config_dir.map_or_else(|| app.path().app_config_dir(), Ok) {
        Ok(dir) => dir,
        Err(e) => fail(2, format!("cannot find the configuration directory ({e}); pass --config-dir <DIR>")),
    };
    let package = app.package_info();
    let title = app.config().product_name.clone().unwrap_or_else(|| package.name.clone());
    // The page's dialog and link commands take their hooks from the managed state; the owner
    // thread holds the same ones.
    let services = services::native(app.handle(), title.clone());
    app.manage(services.clone());
    // Opening the saves removes the temporary files a run that ended mid-save left behind. The
    // dialog starts in the user's Downloads folder until a save has been made.
    app.manage(Arc::new(Saves::open(&config_dir, app.path().download_dir().ok())));
    bridge::spawn_owner(AppInfo { title, version: package.version.to_string() }, config_dir, services, inbox, FLUSH_DELAY);
    // The owner thread writes stored keys a second after they change; `on_run_event` writes the
    // rest on the way out.
    app.run(|handle, event| bridge::on_run_event(handle, &event));
}
