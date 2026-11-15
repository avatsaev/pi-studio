//! Run every command with params nobody asked for. A command must answer with `Ok` or `Err`,
//! never panic or hang. Each call runs on its own thread with a deadline, and a process-wide
//! hook counts panics, because `Session::execute` contains a command's panic and returns an
//! ordinary `Err`. Opt-in locally, always run by the gate:
//! `cargo test -p pistudiodesktop-engine --test panic_hunt -- --ignored`.
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use pistudiodesktop_engine::{Session, command_specs};
use serde_json::{Value, json};

const DEADLINE: Duration = Duration::from_secs(10);
static PANICS: AtomicUsize = AtomicUsize::new(0);

fn fresh() -> Session {
    let mut s = Session::new();
    s.execute("file.new", json!({"title": "hunt"})).unwrap();
    s.execute("item.add", json!({"text": "one"})).unwrap();
    s.execute("item.setDone", json!({"id": 1, "done": true})).unwrap();
    s
}

/// `None` on a hang, else whether the call finished without any panic in the process.
fn run_watched(id: &'static str, params: Value) -> Option<bool> {
    let before = PANICS.load(Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let finished = catch_unwind(AssertUnwindSafe(|| {
            let mut s = fresh();
            let _ = s.execute(id, params);
        }));
        let _ = tx.send(finished.is_ok());
    });
    rx.recv_timeout(DEADLINE).ok().map(|ok| ok && PANICS.load(Ordering::SeqCst) == before)
}

#[test]
#[ignore = "full-registry fuzz; run with --ignored"]
fn no_command_panics_or_hangs_on_adversarial_params() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        PANICS.fetch_add(1, Ordering::SeqCst);
        default_hook(info);
    }));
    let mut failures = Vec::new();
    for spec in command_specs() {
        for params in pistudiodesktop_testkit::adversarial_params() {
            let shown: String = params.to_string().chars().take(120).collect();
            match run_watched(spec.id, params) {
                Some(true) => {}
                Some(false) => failures.push(format!("{} panicked on {shown}", spec.id)),
                None => failures.push(format!("{} hung on {shown}", spec.id)),
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
