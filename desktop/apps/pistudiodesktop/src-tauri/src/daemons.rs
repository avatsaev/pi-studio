//! The daemon registry in the running app: the background runner that carries out what the
//! session queued for the local daemon and for the current SSH entry's daemon, and what the owner
//! thread tells the page.
//!
//! The runner is a thread of its own. The supervisors take and apply each request through
//! [`OwnerAccess`], a short message to the owner thread, and run the CLI (up to 90 s for a start,
//! on this machine or over the SSH session) on the runner's thread, so storage writes, the control
//! socket and dialogs go on meanwhile.

use std::collections::HashSet;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex, PoisonError};

use pistudiodesktop_engine::{RemoteAction, UpdateAction};
use pistudiodesktop_model::{EntryId, RemoteState};
use pistudiodesktop_secrets::SecretStore;
use pistudiodesktop_shell::Envelope;
use pistudiodesktop_shell::Services;
use pistudiodesktop_shell::daemons::CHANGED_EVENT;
use pistudiodesktop_shell::owner::Notify;
use pistudiodesktop_shell::owner_access::OwnerAccess;
use pistudiodesktop_shell::remote_supervisor::{RemoteAccess, RemoteJob, RemoteSupervisor};
use pistudiodesktop_shell::supervisor::Supervisor;
use pistudiodesktop_shell::switch::{self, Switched};
use serde_json::Value;
use tauri::{AppHandle, Emitter as _, Manager as _, Runtime, WebviewWindow};

use crate::bridge::Bridge;
use crate::ssh_session::SshSessions;
use crate::transfers::{TransferEngine, Transfers};
use crate::transport::Transport;
use crate::update::Runner;

/// Whether this platform can run a local daemon: the daemon is POSIX-only, so Windows has none.
pub const LOCAL_SUPPORTED: bool = cfg!(not(windows));

/// What the owner thread tells the outside: a change to the registry view goes to `emit`, waiting
/// local or remote work wakes the runner, an edited SSH entry ends its session, and an accepted
/// `update.*` command goes to the update's runner.
pub struct Events {
    emit: Box<dyn FnMut(&Value) + Send>,
    wake: Sender<()>,
    /// Told which SSH entry was edited or removed; does not wait (this runs on the owner thread).
    ssh_closed: Box<dyn FnMut(&EntryId) + Send>,
    /// Told which update action was accepted; begins it and returns (this runs on the owner thread).
    update: Box<dyn FnMut(UpdateAction) + Send>,
}

impl Events {
    pub fn new(emit: impl FnMut(&Value) + Send + 'static, wake: Sender<()>) -> Self {
        Self { emit: Box::new(emit), wake, ssh_closed: Box::new(|_| {}), update: Box::new(|_| {}) }
    }

    /// The same, closing `ssh`'s session of an entry that was edited or removed.
    #[must_use]
    pub fn closing(mut self, ssh: SshSessions) -> Self {
        self.ssh_closed = Box::new(move |entry| ssh.close_entry_in_background(entry));
        self
    }

    /// The same, handing each accepted `update.*` action to `runner`.
    #[must_use]
    pub fn updating(mut self, runner: Arc<Runner>) -> Self {
        self.update = Box::new(move |action| runner.handle(action));
        self
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

    fn ssh_closed(&mut self, entry: &EntryId) {
        (self.ssh_closed)(entry);
    }

    fn update(&mut self, action: UpdateAction) {
        (self.update)(action);
    }
}

/// Switch `window` to the entry `id` ([`switch::switch_to`]): the one path of the page's
/// `daemon_switch` and the native menu. `Some("cancelled")` when the user declined the question
/// about running transfers. Blocks on the confirm: call it off the session's thread and the event loop.
pub fn switch_window<R: Runtime>(handle: &AppHandle<R>, window: &WebviewWindow<R>, id: &str) -> Result<Option<&'static str>, String> {
    let (Some(bridge), Some(transfers), Some(services), Some(transport), Some(engine), Some(ssh)) = (
        handle.try_state::<Bridge>(),
        handle.try_state::<Transfers>(),
        handle.try_state::<Services>(),
        handle.try_state::<Transport>(),
        handle.try_state::<TransferEngine>(),
        handle.try_state::<SshSessions>(),
    ) else {
        return Err("the app is not ready".into());
    };
    // The old page's connections and file transfers go first, before the registry changes: every daemon
    // is told 1001, and no transfer that waits to reconnect can find the new entry's daemon. The SSH
    // session they ran over ends with them.
    let leave = || crate::transfers::close_all_blocking(&engine, &transport, &ssh);
    let reload = || window.reload().map_err(|e| format!("could not reload the page: {e}"));
    match switch::switch_to(&services, &bridge.access(), transfers.get(), id, leave, reload)? {
        Switched::Done => Ok(None),
        Switched::Cancelled => Ok(Some("cancelled")),
    }
}

/// The remote supervisor's way to the session: the requests the engine queued, with the daemon's
/// port and whether the app saw it up, the stages an install passes through, and where the outcome
/// goes. A Start, an Install or an Update that leaves the daemon running tells the page to connect again.
pub struct RemoteOwner {
    access: OwnerAccess,
    ssh: SshSessions,
    /// The entries whose Start is being carried out, to tell a Start's outcome from a probe's.
    starting: Mutex<HashSet<EntryId>>,
    /// Called when a Start left the daemon running.
    started: Box<dyn Fn() + Send + Sync>,
}

impl RemoteOwner {
    pub fn new(access: OwnerAccess, ssh: SshSessions, started: impl Fn() + Send + Sync + 'static) -> Self {
        Self { access, ssh, starting: Mutex::new(HashSet::new()), started: Box::new(started) }
    }
}

impl RemoteAccess for RemoteOwner {
    fn take(&self) -> Vec<RemoteJob> {
        let requests = self.access.remote_requests();
        if requests.is_empty() {
            return Vec::new();
        }
        // A request is for the entry that was current when it was asked; the engine drops the queue when the entry changes.
        let Ok(plan) = self.access.ssh_plan() else { return Vec::new() };
        let mut starting = self.starting.lock().unwrap_or_else(PoisonError::into_inner);
        requests
            .into_iter()
            .filter(|request| request.entry == plan.entry)
            .map(|request| {
                if matches!(request.action, RemoteAction::Start | RemoteAction::Install | RemoteAction::Update) {
                    starting.insert(request.entry.clone());
                }
                RemoteJob { daemon_port: plan.fields.daemon_port, seen_up: self.ssh.seen_up(&request.entry), request }
            })
            .collect()
    }

    fn progress(&self, entry: &EntryId, state: RemoteState) {
        // Only a view of the Daemons screen: an install that moves on does not wait for it, and the entry may be gone.
        self.access.set_remote(entry, state);
    }

    fn apply(&self, entry: &EntryId, state: RemoteState) {
        let was_start = self.starting.lock().unwrap_or_else(PoisonError::into_inner).remove(entry);
        let running = state == RemoteState::Running;
        if !self.access.apply_remote(entry, state) {
            return;
        }
        if was_start && running {
            (self.started)();
        }
    }
}

/// Start the runner: each wake-up drains the session's queues through the supervisors, off the
/// session's thread. Returns the sender that wakes it.
pub fn start_runner(
    requests: Sender<Envelope>,
    store: Arc<dyn SecretStore>,
    supervisor: Arc<Supervisor>,
    remote: RemoteSupervisor,
    owner: RemoteOwner,
) -> Sender<()> {
    let (wake, woken) = channel();
    std::thread::spawn(move || run(&OwnerAccess::new(requests, store), &supervisor, &remote, &owner, &woken));
    wake
}

fn run(access: &OwnerAccess, supervisor: &Supervisor, remote: &RemoteSupervisor, owner: &RemoteOwner, woken: &Receiver<()>) {
    while woken.recv().is_ok() {
        // Wake-ups that came while working are one: each pump drains everything queued.
        while woken.try_recv().is_ok() {}
        supervisor.pump(access);
        remote.pump(owner);
    }
}
