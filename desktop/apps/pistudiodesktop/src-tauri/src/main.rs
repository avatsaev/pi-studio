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
mod daemon_health;
mod daemon_install;
mod daemon_pin;
mod daemons;
mod logging;
mod menu;
mod network;
mod preview_scheme;
mod resume;
mod services;
mod ssh_session;
mod transfers;
mod transport;
mod update;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc::channel;

use clap::Parser;
use pistudiodesktop_secrets::SecretStore;
use pistudiodesktop_shell::AppInfo;
use pistudiodesktop_shell::navigation;
use pistudiodesktop_shell::owner::FLUSH_DELAY;
use pistudiodesktop_shell::owner_access::OwnerAccess;
use pistudiodesktop_shell::picked::Picked;
use pistudiodesktop_shell::preview::{self, Previews};
use pistudiodesktop_shell::remote_supervisor::{RemoteLimits, RemoteSupervisor};
use pistudiodesktop_shell::resume::{Reason, ResumeSignals};
use pistudiodesktop_shell::saves::Saves;
use pistudiodesktop_shell::secret_choice;
use pistudiodesktop_shell::supervisor::{Limits, Supervisor};
use pistudiodesktop_shell::transfer_mode::TransfersMode;
use pistudiodesktop_shell::update::Updater;
use tauri::Manager as _;

use crate::ssh_session::{SshEnv, SshSessions};

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
    /// Where the daemon passwords and pairing links are kept: `keychain` (the operating system's) or
    /// `file` (`secrets.json` in the configuration directory, readable by this user only). Default:
    /// the keychain when it answers within 2 s and takes a test item, else the file. Automated and
    /// live runs pass `file`, so that they never write to a person's keychain.
    #[arg(long, value_name = "keychain|file")]
    secret_store: Option<secret_choice::Preference>,
    /// Which path file transfers take: `engine` (the app's own transfer engine) or `page` (the
    /// page's own path). Default: `engine`.
    #[arg(long, value_name = "engine|page", default_value = "engine")]
    transfers: TransfersMode,
    /// The address of the update manifest for this launch, in place of the one the app was built
    /// with. It must be `https` (the updater refuses anything else, except in a test build); the
    /// updater still checks every file's signature against the key built into the app and never
    /// installs a build that is not newer.
    #[arg(long, value_name = "URL")]
    update_manifest: Option<tauri::Url>,
    /// A file in place of the daemon pin the app was built with (`desktop/daemon-pin.json`: the one
    /// `pi-studio` binary version the app installs, with the address, SHA-256 and size of its archive for
    /// each system), for a check that installs a binary of its own. An unreadable or invalid file
    /// fails the launch with a message that names the option; the log holds the pin's version and
    /// where it came from, never an address.
    #[arg(long, value_name = "FILE")]
    daemon_pin: Option<PathBuf>,
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
    // The daemon pin of this launch: an invalid file is a startup error, as a bad `--control` port is.
    let (pin, pin_source) = match daemon_pin::load(args.daemon_pin.as_deref()) {
        Ok(loaded) => loaded,
        Err(e) => fail(2, e),
    };
    log::info!("daemon pin: {} ({})", pin.version, pin_source.name());
    // Bind before the window opens: a port in use is a startup error, not a silent no-op.
    let control = match args.control.map(|port| control_server::bind(port, args.control_token_file.as_deref())) {
        Some(Ok(bound)) => Some(bound),
        Some(Err(e)) => fail(2, e),
        None => None,
    };
    // Every request, from the webview and from the control socket, crosses this channel to the
    // one thread that owns the session.
    let (requests, inbox) = channel();
    let runner_requests = requests.clone();
    // The secret store is chosen once per launch (keychain, else file; `--secret-store` forces one).
    // The keychain check runs on a thread of its own from here, while the window is built: the
    // keychain's scope depends on the arguments only, the file store's directory on the builder.
    let secret_check = secret_choice::start(args.secret_store, secret_choice::scope_for(args.config_dir.as_deref()));
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
        // Configured by `plugins.updater` in `tauri.conf.json`; Rust alone talks to it (no page permission).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(transfers::Transfers::default())
        // The launch's `--transfers`, for the commands that refuse to run under `page`.
        .manage(args.transfers)
        .manage(Arc::new(Picked::default()))
        // The preview origin: documents the page mounts are served from this scheme, and the
        // navigation rule admits it. Its window policy is `frame-src` in `tauri.conf.json`.
        .manage(Previews::default())
        .register_uri_scheme_protocol(preview::SCHEME, preview_scheme::handle)
        .manage(transport::Transport::new())
        .on_window_event(|window, event| {
            transfers::on_window_event(window, event);
            transfers::on_destroyed(window, event);
            transport::on_window_event(window, event);
        })
        .on_menu_event(menu::on_event)
        .invoke_handler(tauri::generate_handler![
            commands::boot,
            commands::engine_command,
            commands::daemon_resolve_current,
            commands::daemon_switch,
            commands::storage_set,
            commands::dialog_confirm,
            commands::dialog_alert,
            commands::open_external,
            commands::save_begin,
            commands::save_write,
            commands::save_finish,
            commands::save_discard,
            commands::upload_pick,
            commands::transfers_set,
            commands::preview_mount,
            commands::preview_release,
            commands::transport_open,
            commands::ssh_config_hosts,
            commands::transfer_upload,
            commands::transfer_save,
            commands::transfer_cancel
        ])
        .build(tauri::generate_context!())
    {
        Ok(app) => app,
        Err(e) => fail(1, e),
    };
    let config_dir = match args.config_dir.clone().map_or_else(|| app.path().app_config_dir(), Ok) {
        Ok(dir) => dir,
        Err(e) => fail(2, format!("cannot find the configuration directory ({e}); pass --config-dir <DIR>")),
    };
    // The keychain check began before the window was built; this waits for what is left of its 2 s
    // and opens `secrets.json` when the keychain is not used. Nothing opens a real directory with
    // the session before this: a version 1 `daemons.json` is migrated into the chosen store.
    let chosen = match secret_check.finish(&config_dir) {
        Ok(chosen) => chosen,
        Err(e) => fail(2, e),
    };
    let store: Arc<dyn SecretStore> = chosen.store;
    let package = app.package_info();
    let title = app.config().product_name.clone().unwrap_or_else(|| package.name.clone());
    // The page's dialog and link commands take their hooks from the managed state; the owner
    // thread holds the same ones.
    let dialogs = services::Native::new(app.handle(), title.clone());
    let mut services = services::native(&dialogs);
    // The daemon's binary: the launch's pin, and the archives kept in the app's data folder (S9; in the folder
    // `--config-dir` names when one is given, so that a scripted run leaves the real folders alone).
    let data_dir = match args.config_dir.clone().map_or_else(|| app.path().app_data_dir(), Ok) {
        Ok(dir) => dir,
        Err(e) => fail(2, format!("cannot find the data directory ({e}); pass --config-dir <DIR>")),
    };
    // The same object installs the local entry's binary and hands an SSH install the archive of the host's target.
    let installer = Arc::new(daemon_install::LocalInstaller::new(pin.clone(), data_dir.join(daemon_install::ARCHIVE_DIR)));
    services.installer = Some(installer.clone());
    services.archives = Some(installer);
    // The self-update: the plug-in behind the shell's hook, the shell's state over it (it reads `--update-manifest`),
    // and the runner that begins what the `update.*` commands accept and carries out the schedule.
    services.updater = Some(Arc::new(update::PluginUpdater::new(app.handle().clone(), update::Env::detect())));
    let updater = Arc::new(Updater::new(services.updater.clone(), update::manifest(args.update_manifest.as_ref())));
    updater.set_notify(update::notify_page(app.handle().clone()));
    let update_runner = Arc::new(update::Runner::new(
        Arc::clone(&updater),
        dialogs,
        Arc::new(OwnerAccess::new(requests.clone(), Arc::clone(&store))),
        package.version.to_string(),
        // The close question's count (P10): the page's count of running transfers.
        {
            let handle = app.handle().clone();
            Arc::new(move || handle.try_state::<transfers::Transfers>().map_or(0, |transfers| transfers.get()))
        },
    ));
    // A package file a crashed install left in the cache directory is removed (U7).
    update::remove_leftover(app.handle());
    app.manage(Arc::clone(&update_runner));
    // The resume signals' rate limit and counts: the ticker emits, the owner thread reports.
    let resume_signals = Arc::new(ResumeSignals::new());
    // What makes the page connect again: after a Start left the remote daemon running, and after a host key was
    // trusted. It is the signal of a network change.
    let resumed: Arc<dyn Fn() + Send + Sync> = {
        let (handle, signals) = (app.handle().clone(), Arc::clone(&resume_signals));
        Arc::new(move || {
            resume::emit(&handle, &signals, Reason::Network, resume::steady_ms());
        })
    };
    // The current SSH entry's one connection, shared by the page, the transfer engine and the remote
    // commands; the supervisor runs those through the hook. Its known hosts and the login shell's
    // environment (the agent's socket) are read when it first connects; an unknown host key is asked about
    // through the confirmation hook, and trusting it tells the page to connect again. Its copy of the
    // services is taken before the hooks that read it are set.
    let ssh = SshSessions::new(SshEnv::native(&services, &config_dir).on_trusted(Arc::clone(&resumed)));
    // `ui.inspect` reads the proxied connections, the SSH session and the last connection error through this.
    services.transports = Some(app.state::<transport::Transport>().inspector(&ssh));
    services.remote_run = Some(ssh.remote_run_hook(OwnerAccess::new(requests.clone(), Arc::clone(&store))));
    // The daemon's archive goes to an SSH host over this session, and a running remote daemon's version is read over it.
    services.remote_send = Some(ssh.remote_send_hook(OwnerAccess::new(requests.clone(), Arc::clone(&store))));
    services.remote_daemon_version = Some(ssh.remote_daemon_version_hook(OwnerAccess::new(requests.clone(), Arc::clone(&store))));
    app.manage(ssh.clone());
    // The file transfer engine takes the current entry from the owner thread and the password from
    // the store, as `transport_open` does; `ui.inspect` reads its snapshot through the hook.
    let engine = match transfers::TransferEngine::new(
        app.handle().clone(),
        OwnerAccess::new(requests.clone(), Arc::clone(&store)),
        ssh.clone(),
        &package.version.to_string(),
    ) {
        Ok(engine) => engine,
        Err(e) => fail(2, format!("no random source for the transfer engine's client id: {e}")),
    };
    services.transfers = Some(engine.inspector());
    app.manage(engine);
    app.manage(services.clone());
    // Opening the saves removes the temporary files a run that ended mid-save left behind. The
    // dialog starts in the user's Downloads folder until a save has been made.
    app.manage(Arc::new(Saves::open(&config_dir, app.path().download_dir().ok())));
    // The background runner carries out what the session queues for the local daemon and for the
    // current SSH entry's daemon, off the session's thread; the page's `daemon_resolve_current` uses
    // the same local supervisor.
    let supervisor = Arc::new(Supervisor::new(services.clone(), Limits::default()));
    app.manage(Arc::clone(&supervisor));
    // `cli_tool.state` and `cli_tool.install` (the control socket's and the CLI's copies) run on the same supervisor, which
    // holds the login shell's environment; the page runs them off the owner thread through `engine_command`.
    services.cli_tool = Some(supervisor.clone());
    // The launch's daemon pin (the compiled-in one or `--daemon-pin`), held in the app's state.
    app.manage(Arc::new(pin));
    // After a Start left the remote daemon running the page connects again.
    let started = move || resumed();
    let remote = RemoteSupervisor::new(services.clone(), RemoteLimits::default());
    let owner = daemons::RemoteOwner::new(OwnerAccess::new(requests.clone(), Arc::clone(&store)), ssh.clone(), started);
    // The store reaches the page's dial (`Bridge`), the runner and the owner thread; it is only now
    // known, because the file backend needs the configuration directory.
    app.manage(bridge::Bridge::new(requests, Arc::clone(&store)));
    let wake = daemons::start_runner(runner_requests, Arc::clone(&store), supervisor, remote, owner);
    let launch = bridge::Launch {
        notify: Box::new(daemons::Events::to_page(app.handle().clone(), wake).closing(ssh).updating(Arc::clone(&update_runner))),
        local_supported: daemons::LOCAL_SUPPORTED,
        notices: chosen.notices,
        resume: Arc::clone(&resume_signals),
        transfers: args.transfers,
        update: updater,
    };
    bridge::spawn_owner(AppInfo { title, version: package.version.to_string() }, config_dir, services, store, inbox, FLUSH_DELAY, launch);
    // The ticker tells the page after a sleep (`connection_resume`); it ends with the app.
    app.manage(resume::start(app.handle().clone(), Arc::clone(&resume_signals)));
    // The update ticker checks at launch and every hour (P16); a wake does too (`resume.rs`).
    app.manage(update::start(update_runner));
    // The network watcher tells the page when the machine's addresses change; it ends with the app.
    app.manage(network::start(app.handle().clone(), resume_signals));
    menu::install(app.handle().clone());
    // The owner thread writes stored keys a second after they change; `on_run_event` writes the
    // rest on the way out.
    app.run(|handle, event| {
        bridge::on_run_event(handle, &event);
        resume::on_run_event(handle, &event);
        update::on_run_event(handle, &event);
        network::on_run_event(handle, &event);
        // The engine's transfers and the proxied connections are closed together: this one waits for both.
        transfers::on_run_event(handle, &event);
        transport::on_run_event(handle, &event);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfers_defaults_to_the_engine_and_takes_page() {
        assert_eq!(Args::try_parse_from(["pistudiodesktop"]).unwrap().transfers, TransfersMode::Engine);
        assert_eq!(Args::try_parse_from(["pistudiodesktop", "--transfers", "page"]).unwrap().transfers, TransfersMode::Page);
    }

    #[test]
    fn an_unknown_transfers_mode_names_the_option() {
        let message = Args::try_parse_from(["pistudiodesktop", "--transfers", "fast"]).err().map(|e| e.to_string()).unwrap_or_default();
        assert!(message.contains("--transfers"), "{message}");
    }

    #[test]
    fn update_manifest_is_taken_as_an_address_and_the_update_state_says_override() {
        let none = Args::try_parse_from(["pistudiodesktop"]).unwrap();
        assert!(none.update_manifest.is_none());
        assert_eq!(Updater::new(None, update::manifest(none.update_manifest.as_ref())).inspect("0.3.0", true)["manifest"], "default");
        let given = Args::try_parse_from(["pistudiodesktop", "--update-manifest", "https://updates.example/latest.json"]).unwrap();
        assert_eq!(given.update_manifest.as_ref().map(tauri::Url::as_str), Some("https://updates.example/latest.json"));
        assert_eq!(Updater::new(None, update::manifest(given.update_manifest.as_ref())).inspect("0.3.0", true)["manifest"], "override");
    }

    #[test]
    fn an_update_manifest_that_is_not_an_address_names_the_option() {
        let message = Args::try_parse_from(["pistudiodesktop", "--update-manifest", "not a url"]).err().map(|e| e.to_string()).unwrap_or_default();
        assert!(message.contains("--update-manifest"), "{message}");
    }

    #[test]
    fn daemon_pin_is_a_file_and_defaults_to_none() {
        assert!(Args::try_parse_from(["pistudiodesktop"]).unwrap().daemon_pin.is_none());
        let given = Args::try_parse_from(["pistudiodesktop", "--daemon-pin", "/tmp/pin.json"]).unwrap();
        assert_eq!(given.daemon_pin.as_deref(), Some(std::path::Path::new("/tmp/pin.json")));
        assert!(Args::try_parse_from(["pistudiodesktop", "--daemon-pin"]).is_err());
    }
}
