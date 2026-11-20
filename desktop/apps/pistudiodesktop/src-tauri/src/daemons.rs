//! The daemon registry in the running app: the background runner that carries out what the
//! session queued for the local daemon, and what the owner thread tells the page.
//!
//! The runner is a thread of its own. The supervisor takes and applies each request through
//! [`OwnerAccess`], a short message to the owner thread, and runs the CLI (up to 90 s for a start)
//! on the runner's thread, so storage writes, the control socket and dialogs go on meanwhile.

use std::sync::Arc;
use std::sync::mpsc::{Receiver, Sender, channel};

use pistudiodesktop_shell::Envelope;
use pistudiodesktop_shell::daemons::CHANGED_EVENT;
use pistudiodesktop_shell::owner::Notify;
use pistudiodesktop_shell::owner_access::OwnerAccess;
use pistudiodesktop_shell::supervisor::Supervisor;
use serde_json::Value;
use tauri::{AppHandle, Emitter as _, Runtime};

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

    /// The app's events: the page hears [`CHANGED_EVENT`] with the view.
    pub fn to_page<R: Runtime>(handle: AppHandle<R>, wake: Sender<()>) -> Self {
        Self::new(
            move |view| {
                if let Err(e) = handle.emit(CHANGED_EVENT, view) {
                    log::warn!("the page could not be told of a change to the daemons: {e}");
                }
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
pub fn start_runner(requests: Sender<Envelope>, supervisor: Arc<Supervisor>) -> Sender<()> {
    let (wake, woken) = channel();
    std::thread::spawn(move || run(&OwnerAccess::new(requests), &supervisor, &woken));
    wake
}

fn run(access: &OwnerAccess, supervisor: &Supervisor, woken: &Receiver<()>) {
    while woken.recv().is_ok() {
        // Wake-ups that came while working are one: the pump drains everything queued.
        while woken.try_recv().is_ok() {}
        supervisor.pump(access);
    }
}
