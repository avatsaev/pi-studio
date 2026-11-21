//! The daemon registry in the running app: the background runner that carries out what the
//! session queued for the local daemon, and what the owner thread tells the page.
//!
//! The runner is a thread of its own. The supervisor takes and applies each request through
//! [`OwnerAccess`], a short message to the owner thread, and runs the CLI (up to 90 s for a start)
//! on the runner's thread, so storage writes, the control socket and dialogs go on meanwhile.

use std::sync::Arc;
use std::sync::mpsc::{Receiver, Sender, channel};

use pistudiodesktop_secrets::SecretStore;
use pistudiodesktop_shell::Envelope;
use pistudiodesktop_shell::Services;
use pistudiodesktop_shell::daemons::CHANGED_EVENT;
use pistudiodesktop_shell::owner::Notify;
use pistudiodesktop_shell::owner_access::OwnerAccess;
use pistudiodesktop_shell::supervisor::Supervisor;
use pistudiodesktop_shell::switch::{self, Switched};
use serde_json::Value;
use tauri::{AppHandle, Emitter as _, Manager as _, Runtime, WebviewWindow};

use crate::bridge::Bridge;
use crate::transfers::Transfers;

/// Whether this platform can run a local daemon: the daemon is POSIX-only, so Windows has none.
pub const LOCAL_SUPPORTED: bool = cfg!(not(windows));

/// What the owner thread tells the outside: a change to the registry view goes to `emit`, and
/// waiting local work wakes the runner.
pub struct Events {
    emit: Box<dyn FnMut(&Value) + Send>,
    wake: Sender<()>,
}

impl Events {
    pub fn new(emit: impl FnMut(&Value) + Send + 'static, wake: Sender<()>) -> Self {
        Self { emit: Box::new(emit), wake }
    }

    /// The app's events: the page hears [`CHANGED_EVENT`] with the view, and the native menu is redrawn.
    pub fn to_page<R: Runtime>(handle: AppHandle<R>, wake: Sender<()>) -> Self {
        Self::new(
            move |view| {
                if let Err(e) = handle.emit(CHANGED_EVENT, view) {
                    log::warn!("the page could not be told of a change to the daemons: {e}");
                }
                crate::menu::rebuild(&handle, view);
            },
            wake,
        )
    }
}

impl Notify for Events {
    fn changed(&mut self, view: &Value) {
        (self.emit)(view);
    }

    fn local_work(&mut self) {
        // The runner is gone only when the app is quitting.
        let _ = self.wake.send(());
    }
}

/// Start the runner: each wake-up drains the session's queue through the supervisor, off the
/// session's thread. Returns the sender that wakes it.
/// Switch `window` to the entry `id` ([`switch::switch_to`]): the one path of the page's
/// `daemon_switch` and the native menu. `Some("cancelled")` when the user declined the question
/// about running transfers. Blocks on the confirm: call it off the session's thread and the event loop.
pub fn switch_window<R: Runtime>(handle: &AppHandle<R>, window: &WebviewWindow<R>, id: &str) -> Result<Option<&'static str>, String> {
    let (Some(bridge), Some(transfers), Some(services)) = (handle.try_state::<Bridge>(), handle.try_state::<Transfers>(), handle.try_state::<Services>())
    else {
        return Err("the app is not ready".into());
    };
    match switch::switch_to(&services, &bridge.access(), transfers.get(), id, || window.reload().map_err(|e| format!("could not reload the page: {e}")))? {
        Switched::Done => Ok(None),
        Switched::Cancelled => Ok(Some("cancelled")),
    }
}

pub fn start_runner(requests: Sender<Envelope>, store: Arc<dyn SecretStore>, supervisor: Arc<Supervisor>) -> Sender<()> {
    let (wake, woken) = channel();
    std::thread::spawn(move || run(&OwnerAccess::new(requests, store), &supervisor, &woken));
    wake
}

fn run(access: &OwnerAccess, supervisor: &Supervisor, woken: &Receiver<()>) {
    while woken.recv().is_ok() {
        // Wake-ups that came while working are one: the pump drains everything queued.
        while woken.try_recv().is_ok() {}
        supervisor.pump(access);
    }
}
