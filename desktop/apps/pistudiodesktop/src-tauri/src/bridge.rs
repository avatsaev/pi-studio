//! Between the webview and the shell.
//!
//! One thread owns the [`AppShell`] (and so the session), opens it on the configuration directory
//! and runs [`pistudiodesktop_shell::owner::serve`]. The webview's commands (`commands.rs`)
//! and the control socket only forward requests to it over a channel, so a stored key and an
//! automation request can never race.

use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender};
use std::time::Duration;

use pistudiodesktop_engine::Session;
use pistudiodesktop_shell::owner;
use pistudiodesktop_shell::{AppInfo, AppShell, Envelope, Request, Services};
use serde_json::Value;
use tauri::{AppHandle, Manager as _, RunEvent, Runtime};

const REPLY_DEADLINE: Duration = Duration::from_secs(60);
/// The longest the app waits, on its way out, for the stored keys to reach the disk.
const EXIT_FLUSH_DEADLINE: Duration = Duration::from_secs(5);

/// The webview's way to the owner thread. Managed by Tauri.
pub struct Bridge {
    requests: Sender<Envelope>,
}

impl Bridge {
    pub fn new(requests: Sender<Envelope>) -> Self {
        Self { requests }
    }

    /// Send a request and wait for its answer.
    pub async fn ask(&self, request: Request) -> Result<Value, String> {
        let (envelope, reply) = Envelope::new(request);
        self.requests.send(envelope).map_err(|_| "the app is shutting down".to_string())?;
        // Waiting blocks, so it happens off the async runtime's worker threads.
        let waited = tauri::async_runtime::spawn_blocking(move || reply.recv_timeout(REPLY_DEADLINE)).await;
        match waited {
            Ok(Ok(reply)) => Ok(reply),
            Ok(Err(_)) => Err("timeout: no reply in 60s".to_string()),
            Err(e) => Err(format!("internal error: {e}")),
        }
    }

    /// Queue a request and return at once; its answer is not read. A call that never blocks keeps
    /// the order of the page's calls: it can run on the thread that receives them.
    pub fn post(&self, request: Request) -> Result<(), String> {
        let (envelope, _unread) = Envelope::new(request);
        self.requests.send(envelope).map_err(|_| "the app is shutting down".to_string())
    }

    /// Have every unwritten stored key written, for the app's exit. Waits at most
    /// [`EXIT_FLUSH_DEADLINE`]; the app quits either way.
    fn flush_on_exit(&self) {
        let (envelope, reply) = Envelope::new(Request::Flush);
        if self.requests.send(envelope).is_err() {
            return;
        }
        match reply.recv_timeout(EXIT_FLUSH_DEADLINE) {
            Ok(answer) if answer["ok"] == false => log::warn!("the stored keys were not all written on exit: {}", answer["error"]),
            Ok(_) => log::debug!("exit: the stored keys are written"),
            Err(_) => log::warn!("the stored keys were not written within {} s; quitting anyway", EXIT_FLUSH_DEADLINE.as_secs()),
        }
    }
}

/// The callback of `App::run`. `Exit` comes after the last window has closed, whatever asked
/// for the quit: the stored keys that are still unwritten are written before the process ends.
pub fn on_run_event<R: Runtime>(handle: &AppHandle<R>, event: &RunEvent) {
    if matches!(event, RunEvent::Exit)
        && let Some(bridge) = handle.try_state::<Bridge>()
    {
        bridge.flush_on_exit();
    }
}

/// Start the thread that owns the shell. It opens the session on `config_dir`, answers requests
/// until every sender is gone, and writes the stored keys as [`owner::serve`] decides (`flush_delay`
/// after the first unwritten change; the app passes `owner::FLUSH_DELAY`). `services` are the
/// platform hooks the shell holds; the page's dialog and link commands call their own copy of them
/// on other threads, never this one.
pub fn spawn_owner(info: AppInfo, config_dir: PathBuf, services: Services, inbox: Receiver<Envelope>, flush_delay: Duration) {
    std::thread::spawn(move || {
        log::info!("configuration directory: {}", config_dir.display());
        let (session, notices) = Session::with_config_dir(config_dir);
        for notice in &notices {
            log::warn!("{}", notice.to_json());
        }
        let mut app = AppShell::new(session, services);
        app.info = info;
        app.notices = notices;
        owner::serve(&mut app, &inbox, flush_delay);
    });
}
