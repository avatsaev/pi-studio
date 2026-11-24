//! The page's transfer commands through Tauri's own IPC path with the app's real permissions,
//! against the engine's stand-in daemon (a WebSocket server in this process) and real files.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use pistudiodesktop_secrets::{MemoryStore, SecretStore};
use pistudiodesktop_shell::owner::Quiet;
use pistudiodesktop_shell::resume::{Reason, ResumeSignals};
use pistudiodesktop_shell::transfer_mode::TransfersMode;
use pistudiodesktop_shell::{Request, Services};
use pistudiodesktop_transfer::testing::{After, Config, Direction, Fault, StandInDaemon};
use serde_json::{Value, json};
use tauri::test::MockRuntime;
use tauri::{App, Listener as _, Manager as _, WebviewWindow, WebviewWindowBuilder};

use super::transport_tests::{capture_logs, closed_port, logged, wait_until};
use super::{built_app_stored, invoke};
use crate::bridge::{Bridge, Launch, idle_update};

/// The password of every entry here, and of the stand-in daemon: it must appear nowhere but in the
/// daemon's upgrade.
const PASSWORD: &str = "MARKER-pw-7d41c9e0";
/// Part of the name of the folder every local file is in: it must appear only in log lines.
const LOCAL_MARKER: &str = "MARKER-path-2e8b5f13";

/// `len` bytes that are not all alike, the same for the same `seed`.
fn bytes(len: usize, seed: u8) -> Vec<u8> {
    (0..len).map(|n| u8::try_from((n * 31 + n / 251 + usize::from(seed)) % 256).unwrap_or(0)).collect()
}

fn code_of(answer: &Result<Value, Value>) -> String {
    answer.as_ref().err().and_then(|e| e["code"].as_str()).unwrap_or("(ok)").to_owned()
}

struct Fixture {
    _config: tempfile::TempDir,
    work: tempfile::TempDir,
    app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    daemon: StandInDaemon,
    /// The direct entry the app is on.
    entry: String,
    /// Every `transfer_progress` the page heard.
    events: Arc<Mutex<Vec<Value>>>,
    /// What the open dialog answers next, and the save dialog's answers (the last first).
    picks: Arc<Mutex<Vec<PathBuf>>>,
    destinations: Arc<Mutex<Vec<PathBuf>>>,
}

impl Fixture {
    fn new(daemon: Config) -> Fixture {
        Self::build(daemon, TransfersMode::Engine, false)
    }

    /// An app whose entry points at a port nobody listens on, until [`Self::retarget`].
    fn unreachable() -> Fixture {
        Self::build(Config::default(), TransfersMode::Engine, true)
    }

    fn build(daemon: Config, mode: TransfersMode, dead_address: bool) -> Fixture {
        capture_logs();
        let (config, work) = (tempfile::tempdir().unwrap(), tempfile::Builder::new().prefix(LOCAL_MARKER).tempdir().unwrap());
        let (picks, destinations) = (Arc::new(Mutex::new(Vec::new())), Arc::new(Mutex::new(Vec::new())));
        let (for_picks, for_destinations) = (Arc::clone(&picks), Arc::clone(&destinations));
        let services = Services {
            pick_files: Some(Arc::new(move |_| std::mem::take(&mut *for_picks.lock().unwrap()))),
            pick_save_path: Some(Arc::new(move |_, _| for_destinations.lock().unwrap().pop())),
            ..Services::default()
        };
        let launch =
            Launch { notify: Box::new(Quiet), local_supported: false, notices: Vec::new(), resume: Arc::default(), transfers: mode, update: idle_update() };
        let store: Arc<dyn SecretStore> = Arc::new(MemoryStore::new());
        let app = built_app_stored(config.path(), services, launch, store);
        let window = WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default()).build().unwrap();
        let daemon = tauri::async_runtime::block_on(StandInDaemon::start_with(Config { password: Some(PASSWORD.to_owned()), ..daemon })).unwrap();
        let address = if dead_address { format!("127.0.0.1:{}", closed_port()) } else { format!("127.0.0.1:{}", daemon.port()) };
        let added =
            invoke(&window, "engine_command", json!({"id": "daemon.add", "params": {"kind": "direct", "name": "D", "address": address, "password": PASSWORD}}))
                .unwrap();
        let entry = added["id"].as_str().unwrap().to_owned();
        let events = Arc::new(Mutex::new(Vec::new()));
        let heard = Arc::clone(&events);
        app.listen("transfer_progress", move |event| heard.lock().unwrap().push(serde_json::from_str(event.payload()).unwrap()));
        let fixture = Fixture { _config: config, work, app, window, daemon, entry: entry.clone(), events, picks, destinations };
        fixture.make_current(&entry);
        fixture
    }

    /// What the control socket does: switch without the page's confirm.
    fn make_current(&self, id: &str) {
        let switch = Request::Control { method: "engine.execute".into(), params: json!({"command": "daemon.switch", "params": {"id": id}}) };
        assert_eq!(tauri::async_runtime::block_on(self.app.state::<Bridge>().ask(switch)).unwrap()["ok"], true);
    }

    /// The entry's address becomes the stand-in daemon's.
    fn retarget(&self) {
        let params = json!({"id": self.entry, "address": format!("127.0.0.1:{}", self.daemon.port())});
        invoke(&self.window, "engine_command", json!({"id": "daemon.update", "params": params})).unwrap();
    }

    fn call(&self, command: &str, body: Value) -> Result<Value, Value> {
        invoke(&self.window, command, body)
    }

    /// A command on a thread of its own, for one that stays running.
    fn spawn(&self, command: &'static str, body: Value) -> JoinHandle<Result<Value, Value>> {
        let window = self.window.clone();
        std::thread::spawn(move || invoke(&window, command, body))
    }

    fn file(&self, name: &str, content: &[u8]) -> PathBuf {
        let path = self.work.path().join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    /// A file of `len` zero bytes that takes no disk.
    fn sparse(&self, name: &str, len: u64) -> PathBuf {
        let path = self.work.path().join(name);
        std::fs::File::create(&path).unwrap().set_len(len).unwrap();
        path
    }

    /// The handles the open dialog gives for `paths`.
    fn pick(&self, paths: &[PathBuf]) -> Vec<String> {
        *self.picks.lock().unwrap() = paths.to_vec();
        let picked = self.call("upload_pick", json!({})).unwrap();
        picked.as_array().unwrap().iter().map(|file| file["handle"].as_str().unwrap().to_owned()).collect()
    }

    /// The handle of a save into `destination`.
    fn begin(&self, destination: &Path) -> String {
        self.destinations.lock().unwrap().push(destination.to_path_buf());
        self.call("save_begin", json!({"suggestedName": "x"})).unwrap()["handle"].as_str().unwrap().to_owned()
    }

    fn upload(&self, id: &str, handle: &str, path: &str) -> Result<Value, Value> {
        self.call("transfer_upload", json!({"id": id, "handle": handle, "path": path}))
    }

    fn save(&self, id: &str, handle: &str, path: &str) -> Result<Value, Value> {
        self.call("transfer_save", json!({"id": id, "handle": handle, "path": path}))
    }

    fn temp_files(&self) -> Vec<String> {
        let names = std::fs::read_dir(self.work.path()).unwrap().map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned());
        names.filter(|name| name.starts_with(".pistudio-save-")).collect()
    }

    fn progress(&self, id: &str) -> Vec<Value> {
        self.events.lock().unwrap().iter().filter(|event| event["id"] == id).cloned().collect()
    }

    /// `ui.inspect`'s `transfers`.
    fn inspect(&self) -> Value {
        let inspect = Request::Control { method: "ui.inspect".into(), params: Value::Null };
        tauri::async_runtime::block_on(self.app.state::<Bridge>().ask(inspect)).unwrap()["result"]["transfers"].clone()
    }

    fn wait_running(&self, id: &str) {
        wait_until(&format!("{id} runs"), || {
            self.inspect()["active"].as_array().is_some_and(|active| active.iter().any(|t| t["id"] == id && t["state"] == "running"))
        });
    }

    /// A save of a 2 MiB file that takes more than a second, running; its destination.
    fn start_slow_save(&self, id: &str, name: &str) -> (JoinHandle<Result<Value, Value>>, PathBuf) {
        self.daemon.put_file("/srv/slow.bin", bytes(2 * 1024 * 1024, 5));
        let destination = self.work.path().join(name);
        let handle = self.begin(&destination);
        let running = self.spawn("transfer_save", json!({"id": id, "handle": handle, "path": "/srv/slow.bin"}));
        self.wait_running(id);
        assert_eq!(self.temp_files().len(), 1, "the save is being written to its temporary file");
        (running, destination)
    }

    /// An upload of 64 MiB to a daemon that stops reading after the `Begin`, running.
    fn start_stuck_upload(&self, id: &str) -> JoinHandle<Result<Value, Value>> {
        self.daemon.script(Fault::StopReading { after: After::Frames(Direction::FromClient, 1) });
        let local = self.sparse("big.bin", 64 * 1024 * 1024);
        let handle = self.pick(&[local]).remove(0);
        let running = self.spawn("transfer_upload", json!({"id": id, "handle": handle, "path": "/srv/big.bin"}));
        self.wait_running(id);
        running
    }

    /// What a transfer that was cancelled leaves: nothing, and the daemon saw the connection go.
    fn assert_stopped(&self, answer: &Result<Value, Value>) {
        assert_eq!(code_of(answer), "cancelled", "{answer:?}");
        assert!(self.temp_files().is_empty(), "the temporary file is gone");
        wait_until("the daemon saw the connection close", || self.daemon.open_connections() == 0);
        assert!(self.daemon.client_closes().contains(&Some(1001)), "{:?}", self.daemon.client_closes());
        assert_eq!(self.daemon.streams_in_use(), 0);
    }
}

// ---- acceptance

#[test]
fn an_upload_of_a_picked_file_and_a_save_into_a_claimed_save_complete_with_the_right_bytes_and_progress_events() {
    let f = Fixture::new(Config::default());
    let data = bytes(300 * 1024 + 17, 1);
    let handle = f.pick(&[f.file("a.bin", &data)]).remove(0);
    assert_eq!(f.upload("up-1", &handle, "/srv/a.bin"), Ok(json!({"bytes": data.len()})));
    assert_eq!(f.daemon.file("/srv/a.bin"), Some(data.clone()));
    let events = f.progress("up-1");
    assert!(events.iter().any(|event| event["state"] == "running"), "{events:?}");
    assert!(events.iter().all(|event| event["total"] == json!(data.len()) && event["done"].as_u64() <= Some(data.len() as u64)), "{events:?}");

    let saved = bytes(700 * 1024 + 3, 2);
    f.daemon.put_file("/srv/b.bin", saved.clone());
    let destination = f.work.path().join("b-saved.bin");
    let handle = f.begin(&destination);
    assert_eq!(f.save("sv-1", &handle, "/srv/b.bin"), Ok(json!({"bytes": saved.len()})));
    assert_eq!(std::fs::read(&destination).unwrap(), saved);
    assert!(f.temp_files().is_empty());
    let events = f.progress("sv-1");
    assert!(events.iter().any(|event| event["state"] == "running"), "{events:?}");

    // One session, as the spec's table says: a browser client of the desktop platform that takes no agent stream.
    let hellos = f.daemon.hellos();
    assert_eq!(hellos.len(), 1, "one connection served both");
    assert_eq!(
        (hellos[0]["clientType"].as_str(), hellos[0]["platform"].as_str(), hellos[0]["agentStreams"].as_str()),
        (Some("browser"), Some("desktop"), Some("none"))
    );
    assert_eq!(hellos[0]["appVersion"], "pistudiodesktop/9.9.9");
}

#[test]
fn an_empty_file_goes_up_and_an_empty_file_comes_down() {
    let f = Fixture::new(Config::default());
    let handle = f.pick(&[f.file("empty", b"")]).remove(0);
    assert_eq!(f.upload("up-e", &handle, "/srv/empty"), Ok(json!({"bytes": 0})));
    assert_eq!(f.daemon.file("/srv/empty"), Some(Vec::new()));
    let destination = f.work.path().join("empty-saved");
    let handle = f.begin(&destination);
    assert_eq!(f.save("sv-e", &handle, "/srv/empty"), Ok(json!({"bytes": 0})));
    assert_eq!(std::fs::metadata(&destination).unwrap().len(), 0);
}

#[test]
fn a_handle_rust_did_not_issue_a_used_one_a_bad_id_and_a_running_id_are_refused_with_their_codes() {
    let f = Fixture::new(Config { chunk_delay: Duration::from_millis(20), ..Config::default() });
    let made_up = "0123456789abcdef0123456789abcdef";
    assert_eq!(code_of(&f.upload("t-1", made_up, "/srv/a")), "unknown_handle");
    assert_eq!(code_of(&f.save("t-2", made_up, "/srv/a")), "unknown_handle");

    // A used handle.
    let handle = f.pick(&[f.file("small", b"hello")]).remove(0);
    assert!(f.upload("t-3", &handle, "/srv/small").is_ok());
    assert_eq!(code_of(&f.upload("t-4", &handle, "/srv/small")), "unknown_handle");
    f.daemon.put_file("/srv/s.bin", bytes(10, 1));
    let handle = f.begin(&f.work.path().join("s.bin"));
    assert!(f.save("t-5", &handle, "/srv/s.bin").is_ok());
    assert_eq!(code_of(&f.save("t-6", &handle, "/srv/s.bin")), "unknown_handle");

    // A bad id or path is refused before the handle is spent: the same handle works afterwards.
    let handle = f.pick(&[f.file("again", b"again")]).remove(0);
    for (id, path) in [("", "/srv/a"), ("a b", "/srv/a"), ("a/b", "/srv/a"), (&"x".repeat(65), "/srv/a"), ("ok", ""), ("ok", &"p".repeat(4097))] {
        let refused = f.upload(id, &handle, path);
        assert_eq!(code_of(&refused), "invalid_request", "{id:?} {}", path.len());
        let message = refused.unwrap_err()["message"].as_str().unwrap().to_owned();
        assert!(!message.contains(&handle) && !message.contains(LOCAL_MARKER), "{message}");
    }
    assert_eq!(f.upload("t-7", &handle, "/srv/again"), Ok(json!({"bytes": 5})));

    // A second transfer with a running id: refused, and its save is discarded.
    let (running, _) = f.start_slow_save("dup-1", "slow-1.bin");
    let handle = f.begin(&f.work.path().join("slow-2.bin"));
    assert_eq!(f.temp_files().len(), 2);
    assert_eq!(code_of(&f.save("dup-1", &handle, "/srv/slow.bin")), "duplicate_id");
    assert_eq!(f.temp_files().len(), 1, "the refused save left no temporary file");
    assert_eq!(f.call("transfer_cancel", json!({"id": "dup-1"})), Ok(json!({"cancelled": true})));
    assert_eq!(code_of(&running.join().unwrap()), "cancelled");
    assert!(f.temp_files().is_empty());
}

#[test]
fn a_cancel_of_an_id_that_runs_nowhere_answers_false_and_a_cancelled_upload_leaves_nothing_on_the_daemon() {
    let f = Fixture::new(Config::default());
    assert_eq!(f.call("transfer_cancel", json!({"id": "nobody"})), Ok(json!({"cancelled": false})));
    let running = f.start_stuck_upload("up-c");
    assert_eq!(f.call("transfer_cancel", json!({"id": "up-c"})), Ok(json!({"cancelled": true})));
    assert_eq!(code_of(&running.join().unwrap()), "cancelled");
    assert_eq!(f.daemon.file("/srv/big.bin"), None);
    assert!(f.inspect()["totals"]["cancelled"].as_u64() >= Some(1));
}

#[test]
fn a_cancel_that_arrives_before_its_transfer_settles_the_transfer_as_cancelled() {
    let f = Fixture::new(Config::default());
    // The page's two calls reach Rust out of order: the cancel first.
    assert_eq!(f.call("transfer_cancel", json!({"id": "early-1"})), Ok(json!({"cancelled": false})));
    let handle = f.pick(&[f.file("e.bin", b"never sent")]).remove(0);
    let upload = f.upload("early-1", &handle, "/srv/e.bin");
    assert_eq!(code_of(&upload), "cancelled", "{upload:?}");
    assert_eq!(f.daemon.file("/srv/e.bin"), None);

    assert_eq!(f.call("transfer_cancel", json!({"id": "early-2"})), Ok(json!({"cancelled": false})));
    f.daemon.put_file("/srv/e2.bin", bytes(100, 3));
    let destination = f.work.path().join("e2-saved");
    let handle = f.begin(&destination);
    assert_eq!(code_of(&f.save("early-2", &handle, "/srv/e2.bin")), "cancelled");
    assert!(!destination.exists() && f.temp_files().is_empty(), "the save was discarded");

    // It is used once: the same id runs when it is started again.
    let handle = f.pick(&[f.file("e3.bin", b"sent")]).remove(0);
    assert_eq!(f.upload("early-1", &handle, "/srv/e3.bin"), Ok(json!({"bytes": 4})));
    // A cancel of another id does not touch it.
    assert_eq!(f.call("transfer_cancel", json!({"id": "other"})), Ok(json!({"cancelled": false})));
    let handle = f.pick(&[f.file("e4.bin", b"also sent")]).remove(0);
    assert!(f.upload("early-3", &handle, "/srv/e4.bin").is_ok());
}

#[test]
fn boot_cancels_a_running_save_and_an_upload_closes_the_connection_and_removes_the_temporary_file() {
    let f = Fixture::new(Config { chunk_delay: Duration::from_millis(20), ..Config::default() });
    let (running, destination) = f.start_slow_save("boot-1", "boot-save.bin");
    wait_until("the total is known", || f.progress("boot-1").iter().any(|event| event["total"] == json!(2 * 1024 * 1024)));
    f.call("boot", json!({})).unwrap();
    f.assert_stopped(&running.join().unwrap());
    assert!(!destination.exists());
    // The engine is usable again on the new page.
    let handle = f.pick(&[f.file("after", b"after")]).remove(0);
    assert_eq!(f.upload("boot-2", &handle, "/srv/after"), Ok(json!({"bytes": 5})));

    let running = f.start_stuck_upload("boot-3");
    f.call("boot", json!({})).unwrap();
    assert_eq!(code_of(&running.join().unwrap()), "cancelled");
    assert_eq!(f.daemon.file("/srv/big.bin"), None);
    assert_eq!(f.inspect()["connection"]["state"], "closed", "the engine closed its side; the stuck daemon is not reading, so it cannot say it saw it");
}

#[test]
fn a_boot_drops_the_picked_files_so_an_old_handle_is_unknown() {
    let f = Fixture::new(Config::default());
    let handle = f.pick(&[f.file("old", b"old")]).remove(0);
    f.call("boot", json!({})).unwrap();
    assert_eq!(code_of(&f.upload("old-1", &handle, "/srv/old")), "unknown_handle");
}

#[test]
fn a_switch_cancels_a_running_transfer_before_the_registry_changes() {
    let f = Fixture::new(Config { chunk_delay: Duration::from_millis(20), ..Config::default() });
    let other = invoke(
        &f.window,
        "engine_command",
        json!({"id": "daemon.add", "params": {"kind": "direct", "name": "O", "address": "127.0.0.1:1", "password": PASSWORD}}),
    )
    .unwrap();
    let (running, destination) = f.start_slow_save("switch-1", "switch-save.bin");
    // The page's count is above zero: the question is asked, and the test's window has no dialog, which declines.
    f.call("transfers_set", json!({"count": 1})).unwrap();
    assert_eq!(f.call("daemon_switch", json!({"id": other["id"]})), Ok(json!("cancelled")));
    assert!(f.temp_files().len() == 1 && f.inspect()["active"].as_array().is_some_and(|active| active.len() == 1), "a declined switch stops nothing");
    f.call("transfers_set", json!({"count": 0})).unwrap();
    assert_eq!(f.call("daemon_switch", json!({"id": other["id"]})), Ok(Value::Null));
    f.assert_stopped(&running.join().unwrap());
    assert!(!destination.exists());
    let current = f.call("engine_command", json!({"id": "daemon.list"})).unwrap();
    assert_eq!(current["currentId"], other["id"]);
}

/// The mock runtime does not deliver a window's own `Destroyed` event, so the hook is called as it would be.
#[test]
fn dropping_the_window_cancels_a_running_transfer() {
    let f = Fixture::new(Config { chunk_delay: Duration::from_millis(20), ..Config::default() });
    let (running, destination) = f.start_slow_save("close-1", "close-save.bin");
    crate::transfers::on_destroyed(&f.window.as_ref().window(), &tauri::WindowEvent::Destroyed);
    f.assert_stopped(&running.join().unwrap());
    assert!(!destination.exists());
}

#[test]
fn exit_cancels_a_running_transfer_and_waits_for_it_with_the_proxied_connections() {
    let f = Fixture::new(Config { chunk_delay: Duration::from_millis(20), ..Config::default() });
    let (running, destination) = f.start_slow_save("exit-1", "exit-save.bin");
    let left = Instant::now();
    crate::transfers::on_run_event(f.app.handle(), &tauri::RunEvent::Exit);
    assert!(left.elapsed() < Duration::from_secs(5), "{:?}", left.elapsed());
    // The call returned after the transfer had settled and the daemon had been told.
    assert!(f.temp_files().is_empty() && !destination.exists());
    assert!(f.daemon.client_closes().contains(&Some(1001)), "{:?}", f.daemon.client_closes());
    assert_eq!(code_of(&running.join().unwrap()), "cancelled");
}

#[test]
fn under_transfers_page_the_three_commands_answer_engine_off_and_spend_nothing() {
    let f = Fixture::build(Config::default(), TransfersMode::Page, false);
    let handle = f.begin(&f.work.path().join("page-save"));
    assert_eq!(code_of(&f.upload("p-1", "0123456789abcdef0123456789abcdef", "/srv/a")), "engine_off");
    assert_eq!(code_of(&f.save("p-2", &handle, "/srv/a")), "engine_off");
    assert_eq!(code_of(&f.call("transfer_cancel", json!({"id": "p-1"}))), "engine_off");
    assert_eq!(f.daemon.accepted_connections(), 0);
    // The save's handle is still the page's: it can finish it itself.
    assert!(f.call("save_discard", json!({"handle": handle})).is_ok());
}

#[test]
fn a_daemon_that_refuses_and_a_file_that_vanished_fail_with_their_codes_and_leave_nothing() {
    let f = Fixture::new(Config::default());
    let destination = f.work.path().join("missing-saved");
    let handle = f.begin(&destination);
    let refused = f.save("r-1", &handle, "/srv/does-not-exist");
    assert_eq!(code_of(&refused), "daemon_refused", "{refused:?}");
    assert!(!destination.exists() && f.temp_files().is_empty());

    let local = f.file("vanishing", b"gone soon");
    let handle = f.pick(std::slice::from_ref(&local)).remove(0);
    std::fs::remove_file(&local).unwrap();
    let failed = f.upload("r-2", &handle, "/srv/vanishing");
    assert_eq!(code_of(&failed), "source_unreadable", "{failed:?}");
    let message = failed.unwrap_err()["message"].as_str().unwrap().to_owned();
    assert!(!message.contains(LOCAL_MARKER) && !message.contains("vanishing"), "{message}");

    // A directory is not a file to upload.
    let handle = f.pick(&[f.work.path().to_path_buf()]).remove(0);
    assert_eq!(code_of(&f.upload("r-3", &handle, "/srv/dir")), "source_unreadable");
}

#[test]
fn a_destination_another_save_is_writing_is_busy_and_that_save_is_discarded() {
    let f = Fixture::new(Config { chunk_delay: Duration::from_millis(20), ..Config::default() });
    let (running, destination) = f.start_slow_save("busy-1", "busy.bin");
    let handle = f.begin(&destination);
    assert_eq!(code_of(&f.save("busy-2", &handle, "/srv/slow.bin")), "destination_busy");
    assert_eq!(f.temp_files().len(), 1, "only the first save's temporary file is left");
    assert_eq!(f.call("transfer_cancel", json!({"id": "busy-1"})), Ok(json!({"cancelled": true})));
    assert_eq!(code_of(&running.join().unwrap()), "cancelled");
}

// ---- recovery

/// Run `wake` once the engine waits to try again, and answer how long the transfer took after it.
fn finish_after(f: &Fixture, wake: impl FnOnce(&Fixture)) -> Duration {
    let data = bytes(50_000, 9);
    f.daemon.put_file("/srv/w.bin", data.clone());
    let destination = f.work.path().join("w-saved");
    let handle = f.begin(&destination);
    let running = f.spawn("transfer_save", json!({"id": "wake-1", "handle": handle, "path": "/srv/w.bin"}));
    wait_until("the engine waits to try again", || f.inspect()["connection"]["state"] == "waiting");
    assert_eq!(f.inspect()["active"][0]["state"], "waiting");
    assert_eq!(f.daemon.accepted_connections(), 0);
    f.retarget();
    let woken = Instant::now();
    wake(f);
    assert_eq!(running.join().unwrap(), Ok(json!({"bytes": data.len()})));
    assert_eq!(std::fs::read(&destination).unwrap(), data);
    woken.elapsed()
}

#[test]
fn a_machine_that_woke_ends_the_engines_wait_before_its_next_attempt() {
    let f = Fixture::unreachable();
    let took = finish_after(&f, |f| {
        let signals = ResumeSignals::new();
        assert!(crate::resume::emit(f.app.handle(), &signals, Reason::Wake, 1_000_000));
    });
    // The wait was one second (the first of the backoff), of which the test used a little.
    assert!(took < Duration::from_millis(500), "{took:?}");
}

#[test]
fn a_proxied_connection_that_opened_ends_the_engines_wait_before_its_next_attempt() {
    let f = Fixture::unreachable();
    let took = finish_after(&f, |f| {
        let url = format!("ws://127.0.0.1:{}", f.daemon.port());
        assert!(f.call("transport_open", json!({"url": url})).is_ok());
    });
    assert!(took < Duration::from_millis(500), "{took:?}");
}

// ---- what is seen

#[test]
fn ui_inspect_shows_the_engine_and_no_path_no_handle_and_no_password() {
    let f = Fixture::new(Config::default());
    let before = f.inspect();
    assert_eq!(
        (before["mode"].as_str(), before["connection"]["state"].as_str(), before["connection"]["entryId"].clone()),
        (Some("engine"), Some("closed"), Value::Null)
    );
    let handle = f.pick(&[f.file("seen.bin", &bytes(1000, 4))]).remove(0);
    f.upload("seen-1", &handle, "/srv/seen.bin").unwrap();
    let after = f.inspect();
    assert_eq!(after["connection"], json!({"state": "open", "entryId": f.entry, "opens": 1}), "the connection is kept for the idle time");
    assert_eq!(after["totals"], json!({"done": 1, "failed": 0, "cancelled": 0}));
    assert_eq!((after["active"].clone(), after["queued"].clone()), (json!([]), json!(0)));
    let text = after.to_string();
    assert!(!text.contains(LOCAL_MARKER) && !text.contains(PASSWORD) && !text.contains(&handle) && !text.contains("/srv/"), "{text}");
}

#[test]
fn a_local_path_is_only_in_log_lines_and_a_password_and_a_handle_are_nowhere() {
    let f = Fixture::new(Config::default());
    let mut seen = Vec::new();
    let mut handles = Vec::new();
    let mut note = |what: &Result<Value, Value>| seen.push(format!("{what:?}"));

    let data = bytes(40_000, 6);
    let up = f.pick(&[f.file("marker-up.bin", &data)]).remove(0);
    note(&f.upload("m-up", &up, "/srv/marker-up.bin"));
    f.daemon.put_file("/srv/marker-down.bin", data);
    let down = f.begin(&f.work.path().join("marker-down.bin"));
    note(&f.save("m-down", &down, "/srv/marker-down.bin"));
    let refused = f.begin(&f.work.path().join("marker-refused.bin"));
    note(&f.save("m-refused", &refused, "/srv/not-there"));
    let gone = f.file("marker-gone.bin", b"x");
    let vanished = f.pick(std::slice::from_ref(&gone)).remove(0);
    std::fs::remove_file(&gone).unwrap();
    note(&f.upload("m-gone", &vanished, "/srv/marker-gone.bin"));
    let cancelled = f.pick(&[f.file("marker-cancelled.bin", b"y")]).remove(0);
    note(&f.call("transfer_cancel", json!({"id": "m-cancelled"})));
    note(&f.upload("m-cancelled", &cancelled, "/srv/marker-cancelled.bin"));
    let used = f.pick(&[f.file("marker-used.bin", b"z")]).remove(0);
    note(&f.upload("m-used", &used, "/srv/marker-used.bin"));
    note(&f.upload("m-used-again", &used, "/srv/marker-used.bin"));
    note(&f.call("upload_pick", json!({})));
    handles.extend([up, down, refused, vanished, cancelled, used]);
    seen.push(f.events.lock().unwrap().iter().map(Value::to_string).collect::<String>());
    seen.push(f.inspect().to_string());
    seen.push(f.call("boot", json!({})).unwrap().to_string());

    for what in &seen {
        assert!(!what.contains(LOCAL_MARKER), "a local path reached the page: {what}");
        assert!(!what.contains(PASSWORD), "a password reached the page: {what}");
        for handle in &handles {
            assert!(!what.contains(handle.as_str()), "a handle came back to the page: {what}");
        }
    }
    let log = logged();
    assert!(!log.contains(PASSWORD), "a password was logged");
    for handle in &handles {
        assert!(!log.contains(handle.as_str()), "a handle was logged");
    }
    assert!(log.contains(LOCAL_MARKER), "the local path is in the log");
    let line = |needle: &str| log.lines().find(|line| line.contains(needle)).unwrap_or_default().to_owned();
    let (started, done) = (line("transfer m-up: upload started"), line("transfer m-up: upload done"));
    assert!(started.contains("/srv/marker-up.bin") && started.contains(LOCAL_MARKER), "{started}");
    assert!(done.contains("40000 bytes") && done.contains(" ms") && done.contains("/srv/marker-up.bin") && done.contains(LOCAL_MARKER), "{done}");
    assert!(line("transfer m-down: save done").contains("40000 bytes"));
    assert!(line("transfer m-refused: save failed with daemon_refused").contains("/srv/not-there"));
    assert!(line("transfer m-gone: upload failed with source_unreadable").contains("marker-gone.bin"));
    assert!(line("transfer m-cancelled: upload failed with cancelled").contains("/srv/marker-cancelled.bin"));
    // Every started transfer has an ending line.
    for id in ["m-up", "m-down", "m-refused", "m-gone", "m-cancelled", "m-used"] {
        assert!(log.lines().any(|l| l.contains(&format!("transfer {id}: ")) && l.contains("started")), "{id} started");
        assert!(log.lines().any(|l| l.contains(&format!("transfer {id}: ")) && (l.contains(" done,") || l.contains(" failed with "))), "{id} ended");
    }
}
