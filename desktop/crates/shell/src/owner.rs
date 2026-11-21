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
    /// A local daemon request is waiting: the background runner should take it.
    fn local_work(&mut self);
}

/// Tells nobody.
pub struct Quiet;

impl Notify for Quiet {
    fn changed(&mut self, _: &serde_json::Value) {}
    fn local_work(&mut self) {}
}

/// [`serve_notifying`] that tells nobody.
pub fn serve(app: &mut AppShell, inbox: &Receiver<Envelope>, delay: Duration) {
    serve_notifying(app, inbox, delay, &mut Quiet);
}

/// Answer requests from `inbox` in order until every sender is gone, writing the stored keys
/// [`FlushTimer`] says are due, and once more at the end. A write that fails is logged by the
/// session and retried one `delay` later. After each request, `notify` hears of a change to the
/// registry view and of local work waiting.
pub fn serve_notifying(app: &mut AppShell, inbox: &Receiver<Envelope>, delay: Duration, notify: &mut dyn Notify) {
    let mut timer = FlushTimer::new(delay);
    loop {
        let received = match timer.wait(Instant::now()) {
            Some(wait) => inbox.recv_timeout(wait),
            None => inbox.recv().map_err(|_| RecvTimeoutError::Disconnected),
        };
        match received {
            Ok(envelope) => {
                let reply = app.answer(&envelope.request);
                // The asker may have gone away (the page does not wait for a stored key).
                let _ = envelope.reply.send(reply);
                if let Some(view) = daemons::take_change(app) {
                    notify.changed(&view);
                }
                if app.session.has_local_requests() {
                    notify.local_work();
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
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
        }

        impl Notify for Tell {
            fn changed(&mut self, view: &Value) {
                self.views.push(view.clone());
            }
            fn local_work(&mut self) {
                self.work += 1;
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
    }
}
