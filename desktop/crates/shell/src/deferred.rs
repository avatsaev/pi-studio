//! `daemon.add`, `daemon.update` and `daemon.remove` on the thread that owns the session: the
//! store calls of a command (a keychain call may wait for the user to answer a system prompt) run
//! on a thread of their own, and the owner loop keeps answering meanwhile.
//!
//! The owner loop hands every request to [`defer`] first. A request that is one of the three
//! commands is planned here ([`pistudiodesktop_engine::Session::plan_secret_command`]; nothing is
//! stored or written), its store step runs on a worker thread, the worker hands the job back through
//! a channel the shell holds ([`Deferred`]), the loop commits it ([`settle`]: planned again against
//! the registry as it is then, then written), and a second worker makes the store calls that come
//! after the write (a removed entry's items) and sends the answer. The asker waits for its reply as
//! it always did, so the page, the control socket and [`crate::owner_access::OwnerAccess`] need no
//! change. The browser build has no threads and no store: the commands run in place and a secret is
//! refused there.
//!
//! The loop wakes every [`POLL`] while a job is waiting for its store step (there is no sender to
//! the loop's own inbox to wake it with), and not otherwise. When every sender is gone the loop
//! waits up to [`DRAIN`] for such jobs ([`drain`]) before it ends.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::{Duration, Instant};

use pistudiodesktop_engine::{EngineError, SecretJob};
use serde_json::Value;

use crate::{AppShell, Envelope, Request, control, daemons};

/// How often the owner loop looks for a finished store step while one is outstanding.
pub const POLL: Duration = Duration::from_millis(20);

/// How long the loop waits for outstanding store steps once every sender is gone: long enough for a
/// prompt the user is answering, short enough that a stuck store cannot hold the app open.
pub const DRAIN: Duration = Duration::from_secs(30);

/// A job whose store step has run.
struct Stored {
    job: SecretJob,
    stored: Result<(), EngineError>,
    reply: Sender<Value>,
}

/// The jobs whose store step is outstanding, and the channel they come back on.
pub struct Deferred {
    tx: Sender<Stored>,
    rx: Receiver<Stored>,
    pending: usize,
}

impl Default for Deferred {
    fn default() -> Self {
        let (tx, rx) = channel();
        Self { tx, rx, pending: 0 }
    }
}

impl Deferred {
    /// Whether a store step is outstanding: the owner loop must look again soon.
    pub fn waiting(&self) -> bool {
        self.pending > 0
    }
}

fn failed_store() -> EngineError {
    EngineError::Other("secret_store_failed".to_owned())
}

/// Answer `reply` with `result` and show its error in the status bar, as [`AppShell::run`] does.
fn answer(app: &mut AppShell, reply: &Sender<Value>, result: Result<Value, String>) {
    app.ui.status = result.as_ref().err().cloned().unwrap_or_default();
    // The asker may have gone away.
    let _ = reply.send(control::reply(result));
}

/// Take `envelope` if it is `daemon.add`, `daemon.update` or `daemon.remove` (from the control
/// socket or the page): plan it and start its store step. `false` means it is any other request,
/// which the caller answers itself; `true` means it has been, or will be, answered on its reply.
pub fn defer(app: &mut AppShell, envelope: &Envelope) -> bool {
    let (id, params) = match &envelope.request {
        Request::Control { method, params } if method == "engine.execute" => match params.get("command").and_then(Value::as_str) {
            Some(id) => (id, params.get("params").cloned().unwrap_or(Value::Null)),
            None => return false,
        },
        Request::Engine { id, params } if daemons::page_may_run(id) => (id.as_str(), params.clone()),
        _ => return false,
    };
    match app.session.plan_secret_command(id, &params) {
        None => false,
        Some(Err(e)) => {
            answer(app, &envelope.reply, Err(e.to_string()));
            true
        }
        Some(Ok(job)) if !job.has_store_step() => {
            commit(app, job, envelope.reply.clone());
            true
        }
        Some(Ok(job)) => {
            store(app, job, envelope.reply.clone());
            true
        }
    }
}

/// Run the store step of `job` on a worker thread; it comes back through [`settle`].
fn store(app: &mut AppShell, job: SecretJob, reply: Sender<Value>) {
    let tx = app.deferred.tx.clone();
    let spawned = std::thread::Builder::new().name("secret-store".into()).spawn(move || {
        // Last-resort guard: whatever the store does, the job comes back and the loop stops waiting.
        let stored = catch_unwind(AssertUnwindSafe(|| job.store())).unwrap_or_else(|_| Err(failed_store()));
        let _ = tx.send(Stored { job, stored, reply });
    });
    match spawned {
        Ok(_) => app.deferred.pending += 1,
        Err(e) => log::error!("no thread for a secret store call: {e}"),
    }
}

/// Commit the jobs whose store step is done and send what remains to a worker. Call after every
/// request and every [`POLL`].
pub fn settle(app: &mut AppShell) {
    while let Ok(done) = app.deferred.rx.try_recv() {
        stored(app, done);
    }
}

/// [`settle`] for the end of the loop (every sender is gone): wait up to `within` for the jobs
/// whose store step is outstanding, so an `add` the app was asked for is not dropped at quit.
pub fn drain(app: &mut AppShell, within: Duration) {
    let end = Instant::now() + within;
    while app.deferred.waiting() {
        match app.deferred.rx.recv_timeout(end.saturating_duration_since(Instant::now())) {
            Ok(done) => stored(app, done),
            Err(_) => break,
        }
    }
}

fn stored(app: &mut AppShell, done: Stored) {
    app.deferred.pending = app.deferred.pending.saturating_sub(1);
    match done.stored {
        Ok(()) => commit(app, done.job, done.reply),
        Err(e) => answer(app, &done.reply, Err(e.to_string())),
    }
}

/// Write the registry for `job` and answer; the store calls after the write run on a worker.
fn commit(app: &mut AppShell, mut job: SecretJob, reply: Sender<Value>) {
    let committed = app.session.commit_secret_job(&mut job);
    app.ui.status = committed.as_ref().err().map(|e| (*e).to_owned()).unwrap_or_default();
    if !job.has_finish_step(&committed) {
        let result = job.finish(committed).map_err(|e| e.to_string());
        let _ = reply.send(control::reply(result));
        return;
    }
    let spawned = std::thread::Builder::new().name("secret-store".into()).spawn(move || {
        let result = catch_unwind(AssertUnwindSafe(|| job.finish(committed))).unwrap_or_else(|_| Err(failed_store()));
        let _ = reply.send(control::reply(result.map_err(|e| e.to_string())));
    });
    if let Err(e) = spawned {
        log::error!("no thread for a secret store call: {e}");
    }
}
