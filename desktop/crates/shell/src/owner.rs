//! The loop of the thread that owns the shell: it answers requests one at a time and decides when
//! the workbench's stored keys are written to disk.
//!
//! The page sends a key on every change, many times a second. Writing a file for each would be
//! wasteful, so the first unwritten change starts a countdown of [`FLUSH_DELAY`]; every change
//! made meanwhile is written with it, in one file write per changed scope. The decision is
//! [`FlushTimer`], pure and driven by the instants it is given, so tests need no clock. [`serve`]
//! is the loop that applies it.

use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use crate::{AppShell, Envelope, daemons};

/// How long a stored key may stay unwritten after the first unwritten change.
pub const FLUSH_DELAY: Duration = Duration::from_secs(1);

/// When the stored keys are due to be written. See the module documentation.
#[derive(Clone, Copy, Debug)]
pub struct FlushTimer {
    delay: Duration,
    /// The instant the first unwritten change must be written by; `None` when nothing is unwritten.
    due: Option<Instant>,
}

impl FlushTimer {
    pub fn new(delay: Duration) -> Self {
        Self { delay, due: None }
    }

    /// Report, as of `now`, whether the session has unwritten changes. The countdown starts at
    /// the first report of unwritten changes and keeps running over later ones, so a steady
    /// stream of changes cannot postpone the write; it stops when nothing is unwritten.
    pub fn observe(&mut self, unwritten: bool, now: Instant) {
        // An instant too far ahead to represent counts as due now: never panic on the clock.
        self.due = if unwritten { self.due.or(Some(now.checked_add(self.delay).unwrap_or(now))) } else { None };
    }

    /// How long to wait for the next request before the write is due: zero when it is overdue,
    /// `None` when nothing is waiting to be written (wait for as long as it takes).
    pub fn wait(&self, now: Instant) -> Option<Duration> {
        self.due.map(|due| due.saturating_duration_since(now))
    }

    /// `true` once the write is due as of `now`, and the countdown is over. The caller writes,
    /// then reports again: a write that failed leaves changes unwritten, which starts a new
    /// countdown (a retry one delay later, not a busy loop).
    pub fn take_due(&mut self, now: Instant) -> bool {
        match self.due {
            Some(due) if due <= now => {
                self.due = None;
                true
            }
            _ => false,
        }
    }
}

/// What the loop tells its host about.
pub trait Notify {
    /// The registry, the local state or a setting changed: `view` is what the page now sees
    /// ([`crate::daemons::view`]). Called after the request that changed it was answered.
    fn changed(&mut self, view: &serde_json::Value);
    /// A local or remote daemon request is waiting: the background runner should take it.
    fn local_work(&mut self);
    /// The current SSH entry was edited or removed: its SSH session, if one is open, must end. The
    /// default does nothing (a host with no SSH).
    fn ssh_closed(&mut self, _entry: &pistudiodesktop_model::EntryId) {}
    /// An `update.*` command was accepted: the app begins and runs `action` off the owner thread
    /// ([`crate::update::Updater`]'s `begin_*` / `run_*`). Called once per action, in the order the
    /// commands were accepted, after the request that queued it was answered. The default drops it.
    fn update(&mut self, _action: pistudiodesktop_engine::UpdateAction) {}
}

/// Tells nobody.
pub struct Quiet;

impl Notify for Quiet {
    fn changed(&mut self, _: &serde_json::Value) {}
    fn local_work(&mut self) {}
}

/// How often the loop looks for a finished secret-store step while one is outstanding.
#[cfg(not(target_arch = "wasm32"))]
const STORE_POLL: Duration = crate::deferred::POLL;
#[cfg(target_arch = "wasm32")]
const STORE_POLL: Duration = Duration::from_millis(20);

/// See [`crate::deferred::defer`]. The browser build has no threads: every command runs in place.
#[cfg(not(target_arch = "wasm32"))]
fn defer(app: &mut AppShell, envelope: &Envelope) -> bool {
    crate::deferred::defer(app, envelope)
}
#[cfg(target_arch = "wasm32")]
fn defer(_: &mut AppShell, _: &Envelope) -> bool {
    false
}

#[cfg(not(target_arch = "wasm32"))]
fn settle(app: &mut AppShell) {
    crate::deferred::settle(app);
}
#[cfg(target_arch = "wasm32")]
fn settle(_: &mut AppShell) {}

#[cfg(not(target_arch = "wasm32"))]
fn store_step_outstanding(app: &AppShell) -> bool {
    app.deferred.waiting()
}
#[cfg(target_arch = "wasm32")]
fn store_step_outstanding(_: &AppShell) -> bool {
    false
}

/// Wait for the secret-store steps still outstanding once every sender is gone.
#[cfg(not(target_arch = "wasm32"))]
fn drain(app: &mut AppShell) {
    crate::deferred::drain(app, crate::deferred::DRAIN);
}
#[cfg(target_arch = "wasm32")]
fn drain(_: &mut AppShell) {}

/// [`serve_notifying`] that tells nobody.
pub fn serve(app: &mut AppShell, inbox: &Receiver<Envelope>, delay: Duration) {
    serve_notifying(app, inbox, delay, &mut Quiet);
}

/// Answer requests from `inbox` in order until every sender is gone, writing the stored keys
/// [`FlushTimer`] says are due, and once more at the end. A write that fails is logged by the
/// session and retried one `delay` later. After each request, `notify` hears of a change to the
/// registry view, of local work waiting and of each `update.*` action accepted.
pub fn serve_notifying(app: &mut AppShell, inbox: &Receiver<Envelope>, delay: Duration, notify: &mut dyn Notify) {
    let mut timer = FlushTimer::new(delay);
    let mut closed = false;
    loop {
        let wait = match (timer.wait(Instant::now()), store_step_outstanding(app)) {
            (Some(wait), true) => Some(wait.min(STORE_POLL)),
            (None, true) => Some(STORE_POLL),
            (wait, false) => wait,
        };
        let received = match wait {
            Some(wait) => inbox.recv_timeout(wait),
            None => inbox.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        let mut answered = false;
        match received {
            Ok(envelope) => {
                answered = true;
                // `daemon.add/update/remove` are answered later, by their own worker threads.
                if !defer(app, &envelope) {
                    let reply = app.answer(&envelope.request);
                    // The asker may have gone away (the page does not wait for a stored key).
                    let _ = envelope.reply.send(reply);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                // An `add` still waiting for its store step is committed before the loop ends.
                drain(app);
                closed = true;
            }
        }
        settle(app);
        if let Some(view) = daemons::take_change(app) {
            notify.changed(&view);
        }
        if answered && (app.session.has_local_requests() || app.session.has_remote_requests()) {
            notify.local_work();
        }
        for action in app.session.take_update_requests() {
            notify.update(action);
        }
        if let Some(entry) = app.session.take_ssh_closed() {
            notify.ssh_closed(&entry);
        }
        if closed {
            break;
        }
        timer.observe(app.session.storage_unwritten(), Instant::now());
        if timer.take_due(Instant::now()) {
            // The error is already logged, with the file's name and no value.
            let _ = app.session.storage_flush();
            timer.observe(app.session.storage_unwritten(), Instant::now());
        }
    }
    let _ = app.session.storage_flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    const DELAY: Duration = Duration::from_secs(1);

    fn at(base: Instant, millis: u64) -> Instant {
        base + Duration::from_millis(millis)
    }

    #[test]
    fn nothing_unwritten_means_no_wait_and_nothing_due() {
        let (base, mut timer) = (Instant::now(), FlushTimer::new(DELAY));
        timer.observe(false, base);
        assert_eq!(timer.wait(base), None);
        assert!(!timer.take_due(at(base, 10_000)));
    }

    #[test]
    fn the_first_unwritten_change_is_written_one_delay_later() {
        let (base, mut timer) = (Instant::now(), FlushTimer::new(DELAY));
        timer.observe(true, base);
        assert_eq!(timer.wait(base), Some(DELAY));
        assert_eq!(timer.wait(at(base, 400)), Some(Duration::from_millis(600)));
        assert!(!timer.take_due(at(base, 999)));
        assert!(timer.take_due(at(base, 1000)));
    }

    #[test]
    fn twenty_changes_inside_the_delay_are_one_write_and_do_not_postpone_it() {
        let (base, mut timer) = (Instant::now(), FlushTimer::new(DELAY));
        let mut writes = 0;
        // A change every 40 ms, the first at 0 ms and the last at 760 ms; then quiet.
        for step in 0..20 {
            let now = at(base, step * 40);
            timer.observe(true, now);
            writes += u32::from(timer.take_due(now));
        }
        assert_eq!(writes, 0, "nothing is written while the changes keep coming");
        assert_eq!(timer.wait(at(base, 760)), Some(Duration::from_millis(240)), "the countdown still runs from the first change");
        assert!(timer.take_due(at(base, 1000)));
        timer.observe(false, at(base, 1000));
        assert!(!timer.take_due(at(base, 5000)));
        assert_eq!(timer.wait(at(base, 5000)), None);
    }

    #[test]
    fn a_steady_stream_cannot_postpone_the_write_forever() {
        let (base, mut timer) = (Instant::now(), FlushTimer::new(DELAY));
        let mut first_write = None;
        for step in 0..100u64 {
            let now = at(base, step * 100);
            timer.observe(true, now);
            if timer.take_due(now) {
                first_write = Some(step * 100);
                break;
            }
        }
        assert_eq!(first_write, Some(1000));
    }

    #[test]
    fn a_change_after_a_write_starts_a_new_countdown() {
        let (base, mut timer) = (Instant::now(), FlushTimer::new(DELAY));
        timer.observe(true, base);
        assert!(timer.take_due(at(base, 1000)));
        timer.observe(false, at(base, 1000));
        timer.observe(true, at(base, 3000));
        assert_eq!(timer.wait(at(base, 3000)), Some(DELAY));
        assert!(!timer.take_due(at(base, 3999)));
        assert!(timer.take_due(at(base, 4000)));
    }

    #[test]
    fn a_failed_write_is_retried_one_delay_later_not_at_once() {
        let (base, mut timer) = (Instant::now(), FlushTimer::new(DELAY));
        timer.observe(true, base);
        assert!(timer.take_due(at(base, 1000)));
        // The write failed: the session still reports unwritten changes.
        timer.observe(true, at(base, 1000));
        assert!(!timer.take_due(at(base, 1000)));
        assert_eq!(timer.wait(at(base, 1000)), Some(DELAY));
        assert!(timer.take_due(at(base, 2000)));
    }

    #[test]
    fn an_overdue_write_waits_zero() {
        let (base, mut timer) = (Instant::now(), FlushTimer::new(DELAY));
        timer.observe(true, base);
        assert_eq!(timer.wait(at(base, 5000)), Some(Duration::ZERO));
    }

    #[cfg(not(target_arch = "wasm32"))]
    mod serving {
        use std::sync::mpsc::channel;

        use pistudiodesktop_engine::Session;
        use serde_json::{Value, json};

        use super::*;
        use crate::{Request, Services};
        fn memory_store() -> std::sync::Arc<dyn pistudiodesktop_secrets::SecretStore> {
            std::sync::Arc::new(pistudiodesktop_secrets::MemoryStore::new())
        }

        fn app_on(dir: &std::path::Path) -> AppShell {
            let (session, notices) = Session::with_config_dir(dir, memory_store());
            let mut app = AppShell::new(session, Services::default());
            app.notices = notices;
            app
        }

        fn set(key: &str, value: &str) -> (Envelope, Receiver<Value>) {
            Envelope::new(Request::StorageSet { key: key.into(), value: value.into() })
        }

        fn layout_file(dir: &std::path::Path) -> std::path::PathBuf {
            dir.join("daemon-state").join("local.json")
        }

        #[test]
        fn a_change_reaches_the_file_within_the_delay_while_the_loop_runs() {
            let dir = tempfile::tempdir().unwrap();
            let mut app = app_on(dir.path());
            let (tx, rx) = channel();
            let worker = std::thread::spawn(move || serve(&mut app, &rx, Duration::from_millis(30)));
            for n in 0..20 {
                let (envelope, _) = set("pi-studio-pane-layout", &format!("v{n}"));
                tx.send(envelope).unwrap();
            }
            let started = Instant::now();
            while !layout_file(dir.path()).is_file() {
                assert!(started.elapsed() < Duration::from_secs(10), "no file within 10 s");
                std::thread::sleep(Duration::from_millis(5));
            }
            drop(tx);
            worker.join().unwrap();
            let on_disk: Value = serde_json::from_slice(&std::fs::read(layout_file(dir.path())).unwrap()).unwrap();
            assert_eq!(on_disk["keys"], json!({"pi-studio-pane-layout": "v19"}));
        }

        #[test]
        fn a_flush_request_writes_at_once_whatever_the_delay() {
            let dir = tempfile::tempdir().unwrap();
            let mut app = app_on(dir.path());
            let (tx, rx) = channel();
            let worker = std::thread::spawn(move || serve(&mut app, &rx, Duration::from_secs(3600)));
            let (envelope, _) = set("pi-studio-appearance", "dark");
            tx.send(envelope).unwrap();
            let (flush, reply) = Envelope::new(Request::Flush);
            tx.send(flush).unwrap();
            assert_eq!(reply.recv_timeout(Duration::from_secs(10)).unwrap(), json!({"ok": true, "result": null}));
            let on_disk: Value = serde_json::from_slice(&std::fs::read(dir.path().join("settings.json")).unwrap()).unwrap();
            assert_eq!(on_disk["workbench"], json!({"pi-studio-appearance": "dark"}));
            drop(tx);
            worker.join().unwrap();
        }

        #[test]
        fn what_is_unwritten_is_written_when_every_sender_is_gone() {
            let dir = tempfile::tempdir().unwrap();
            let mut app = app_on(dir.path());
            let (tx, rx) = channel();
            let (envelope, _) = set("pi-studio-pane-layout", "last");
            tx.send(envelope).unwrap();
            drop(tx);
            serve(&mut app, &rx, Duration::from_secs(3600));
            assert!(layout_file(dir.path()).is_file());
            let (again, _) = Session::with_config_dir(dir.path(), memory_store());
            assert_eq!(again.storage_snapshot().get("pi-studio-pane-layout").map(String::as_str), Some("last"));
        }

        #[derive(Default)]
        struct Tell {
            views: Vec<Value>,
            work: usize,
            closed: Vec<String>,
            updates: Vec<pistudiodesktop_engine::UpdateAction>,
        }

        impl Notify for Tell {
            fn changed(&mut self, view: &Value) {
                self.views.push(view.clone());
            }
            fn local_work(&mut self) {
                self.work += 1;
            }
            fn ssh_closed(&mut self, entry: &pistudiodesktop_model::EntryId) {
                self.closed.push(entry.as_str().to_owned());
            }
            fn update(&mut self, action: pistudiodesktop_engine::UpdateAction) {
                self.updates.push(action);
            }
        }

        fn control(command: &str, params: Value) -> Envelope {
            Envelope::new(Request::Control { method: "engine.execute".into(), params: json!({"command": command, "params": params}) }).0
        }

        #[test]
        fn one_change_is_one_event_a_stored_key_is_none_and_queued_local_work_is_announced() {
            let mut app = AppShell::new(Session::new(), Services::default());
            app.session.take_registry_changed();
            let (tx, rx) = channel();
            tx.send(set("pi-studio-appearance", "dark").0).unwrap();
            tx.send(control("daemon.list", Value::Null)).unwrap();
            tx.send(control("daemon.add", json!({"kind": "direct", "name": "B", "address": "h:1", "password": "hunter2"}))).unwrap();
            tx.send(control("daemon.local.refresh", Value::Null)).unwrap();
            drop(tx);
            let mut tell = Tell::default();
            serve_notifying(&mut app, &rx, Duration::from_secs(3600), &mut tell);
            assert_eq!(tell.views.len(), 1, "{:?}", tell.views);
            assert_eq!(tell.views[0]["entries"].as_array().map(Vec::len), Some(2));
            assert!(!tell.views[0].to_string().contains("hunter2"));
            assert_eq!(tell.work, 1);
        }

        #[test]
        fn queued_remote_work_is_announced_and_editing_the_current_ssh_entry_says_its_session_must_end() {
            let mut session = Session::new();
            let added = session.execute("daemon.add", json!({"kind": "ssh", "name": "S", "host": "h", "sshPassword": "hunter2"})).unwrap();
            let id = added["id"].as_str().unwrap().to_owned();
            session.execute("daemon.switch", json!({"id": id})).unwrap();
            let mut app = AppShell::new(session, Services::default());
            let (tx, rx) = channel();
            tx.send(control("daemon.remote.start", Value::Null)).unwrap();
            tx.send(control("daemon.list", Value::Null)).unwrap();
            drop(tx);
            let mut tell = Tell::default();
            serve_notifying(&mut app, &rx, Duration::from_secs(3600), &mut tell);
            assert_eq!((tell.work, tell.closed.len()), (2, 0), "work stays announced until the host takes it");
            assert!(app.session.has_remote_requests());

            let (tx, rx) = channel();
            tx.send(control("daemon.update", json!({"id": id, "name": "Renamed"}))).unwrap();
            tx.send(control("daemon.list", Value::Null)).unwrap();
            drop(tx);
            let mut tell = Tell::default();
            serve_notifying(&mut app, &rx, Duration::from_secs(3600), &mut tell);
            assert_eq!(tell.closed, vec![id.clone()], "told once");
            let (tx, rx) = channel();
            tx.send(control("daemon.list", Value::Null)).unwrap();
            drop(tx);
            let mut tell = Tell::default();
            serve_notifying(&mut app, &rx, Duration::from_secs(3600), &mut tell);
            assert!(tell.closed.is_empty());
        }

        /// An updater that is there and does nothing: enough to make the update commands available.
        struct Idle;

        impl crate::update::UpdaterHook for Idle {
            fn check(&self, _: &crate::update::Manifest) -> Result<crate::update::CheckOutcome, crate::update::UpdateCode> {
                Ok(crate::update::CheckOutcome::UpToDate)
            }
            fn install_kind(&self) -> crate::update::InstallKind {
                crate::update::InstallKind::Unknown
            }
            fn cannot_install(&self, _: crate::update::InstallKind, _: &str) -> Option<crate::update::Reason> {
                None
            }
            fn download(&self, _: crate::update::Progress<'_>) -> Result<(), crate::update::UpdateCode> {
                Ok(())
            }
            fn install(&self) -> Result<(), crate::update::UpdateCode> {
                Ok(())
            }
            fn restart(&self) {}
        }

        #[test]
        fn an_accepted_update_command_is_handed_to_the_app_and_a_refused_one_is_not() {
            use pistudiodesktop_engine::UpdateAction;

            let mut app = AppShell::new(Session::new(), Services::default());
            let (tx, rx) = channel();
            let (refused, reply) = Envelope::new(Request::Control { method: "engine.execute".into(), params: json!({"command": "update.check"}) });
            tx.send(refused).unwrap();
            drop(tx);
            let mut tell = Tell::default();
            serve_notifying(&mut app, &rx, Duration::from_secs(3600), &mut tell);
            assert!(tell.updates.is_empty(), "no updater in this app: the command is refused");
            assert_eq!(reply.recv().unwrap()["ok"], false);

            let mut app = AppShell::new(Session::new(), Services { updater: Some(std::sync::Arc::new(Idle)), ..Services::default() });
            let (tx, rx) = channel();
            let (check, reply) = Envelope::new(Request::Control { method: "engine.execute".into(), params: json!({"command": "update.check"}) });
            tx.send(check).unwrap();
            tx.send(control("update.restart", Value::Null)).unwrap();
            drop(tx);
            let mut tell = Tell::default();
            serve_notifying(&mut app, &rx, Duration::from_secs(3600), &mut tell);
            assert_eq!(reply.recv().unwrap(), json!({"ok": true, "result": {"accepted": true}}));
            assert_eq!(tell.updates, [UpdateAction::Check], "handed over once; `update.restart` is refused in `idle`");
            assert!(!app.session.has_update_requests());
        }
    }
}
