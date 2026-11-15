//! Between the webview and the shell.
//!
//! One thread owns the [`AppShell`] (and so the session). The webview's two commands
//! (`commands.rs`) and the control socket only forward requests to it over a channel, so a click and an automation
//! request can never race. After each request the owner sends the webview a `view` event when
//! what it should draw has changed.

use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender};
use std::time::Duration;

use pistudiodesktop_engine::Session;
use pistudiodesktop_shell::{AppShell, Envelope, Request, control};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};

use crate::{crash_guard, services};

/// The event that carries the view (what `ui.inspect` returns) to the webview.
pub const VIEW_EVENT: &str = "view";
const REPLY_DEADLINE: Duration = Duration::from_secs(60);

/// The webview's way to the owner thread. Managed by Tauri.
pub struct Bridge {
    requests: Sender<Envelope>,
}

impl Bridge {
    pub fn new(requests: Sender<Envelope>) -> Self {
        Self { requests }
    }

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
}

/// Start the thread that owns the shell. It opens `file` (or a new document), then answers
/// requests until every sender is gone.
pub fn spawn_owner(handle: AppHandle, inbox: Receiver<Envelope>, file: Option<PathBuf>) {
    std::thread::spawn(move || {
        let mut session = Session::new();
        let opened = match &file {
            Some(path) => crash_guard::guard("Open", || session.execute("file.open", json!({"path": path})).map(drop).map_err(|e| e.to_string())),
            None => session.execute("file.new", json!({})).map(drop).map_err(|e| e.to_string()),
        };
        let mut app = AppShell::new(session, services::native(handle.clone()));
        if let Err(e) = opened {
            log::warn!("{e}");
            app.ui.status = e;
        }
        let mut shown = Value::Null;
        for envelope in inbox {
            let reply = app.answer(&envelope.request);
            // The asker may have gone away; nothing to do about it.
            let _ = envelope.reply.send(reply);
            let view = control::view(&mut app);
            if view != shown {
                if let Err(e) = handle.emit(VIEW_EVENT, &view) {
                    log::warn!("cannot send the view to the window: {e}");
                }
                shown = view;
            }
        }
    });
}
