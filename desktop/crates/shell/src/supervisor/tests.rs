//! The supervisor against a fake CLI (`tests/fixtures/fake-pi-studio.sh`) and a real session.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::os::unix::fs::PermissionsExt as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use pistudiodesktop_engine::{Dial, LocalRequest, Session};
use pistudiodesktop_model::{FailReason, LocalState};
use serde_json::json;

use super::{Batch, Limits, LocalAccess, Supervisor};
use crate::process;

const SCRIPT: &str = include_str!("../../tests/fixtures/fake-pi-studio.sh");

struct Fixture {
    dir: tempfile::TempDir,
    cli: PathBuf,
}

/// The script is written once, before any test starts a process: a process forked while a script
/// is still open for writing cannot run it (`ETXTBSY`).
fn script() -> &'static Path {
    static SCRIPT_FILE: OnceLock<(tempfile::TempDir, PathBuf)> = OnceLock::new();
    let (_, path) = SCRIPT_FILE.get_or_init(|| {
        let dir = tempfile::tempdir().unwrap();
        let cli = dir.path().join("pi-studio");
        std::fs::write(&cli, SCRIPT).unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
        (dir, cli)
    });
    path
}

fn fixture() -> Fixture {
    Fixture { dir: tempfile::tempdir().unwrap(), cli: script().to_path_buf() }
}

impl Fixture {
    fn supervisor(&self, mode: &str, version: &str, limits: Limits) -> Supervisor {
        let env = vec![
            ("PATH".to_owned(), "/usr/bin:/bin".to_owned()),
            ("FAKE_PI_DIR".to_owned(), self.dir.path().display().to_string()),
            ("FAKE_PI_MODE".to_owned(), mode.to_owned()),
            ("FAKE_PI_VERSION".to_owned(), version.to_owned()),
        ];
        Supervisor::with_env(process::native_services(), limits, env)
    }

    fn ok(&self) -> Supervisor {
        self.supervisor("", "0.0.130", Limits::default())
    }

    fn cli(&self) -> Option<&str> {
        self.cli.to_str()
    }

    fn log(&self, name: &str) -> Vec<String> {
        std::fs::read_to_string(self.dir.path().join(name)).unwrap_or_default().lines().map(str::to_owned).collect()
    }

    fn session(&self, auto_start: bool) -> Mutex<Session> {
        let mut s = Session::new();
        s.set_local_supported(true);
        s.execute("settings.set", json!({"key": "cliPath", "value": self.cli})).unwrap();
        s.execute("settings.set", json!({"key": "autoStartLocalDaemon", "value": auto_start})).unwrap();
        Mutex::new(s)
    }
}

fn running() -> LocalState {
    LocalState::Running { host: "127.0.0.1".into(), port: 6767 }
}

fn short() -> Limits {
    Limits { start: Duration::from_millis(500), ..Limits::default() }
}

fn alive(pid: &str) -> bool {
    std::process::Command::new("kill").args(["-0", pid]).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

#[test]
fn probe_start_adopt_and_stop() {
    let f = fixture();
    let sup = f.ok();
    assert_eq!(sup.carry_out(LocalRequest::Probe, f.cli(), false), LocalState::Stopped);
    assert_eq!(sup.carry_out(LocalRequest::Start, f.cli(), false), running());
    assert_eq!(sup.carry_out(LocalRequest::Probe, f.cli(), false), running());
    // A second start adopts the running daemon: the script records no second start.
    assert_eq!(sup.carry_out(LocalRequest::Start, f.cli(), false), running());
    assert_eq!(f.log("starts"), ["start"]);
    assert_eq!(sup.carry_out(LocalRequest::Restart, f.cli(), false), running());
    assert_eq!(f.log("starts"), ["start", "restart"]);
    assert_eq!(sup.carry_out(LocalRequest::Stop, f.cli(), false), LocalState::Stopped);
    assert_eq!(sup.carry_out(LocalRequest::Probe, f.cli(), false), LocalState::Stopped);
}

#[test]
fn start_failures_carry_their_reason() {
    let f = fixture();
    let state = |mode: &str, limits| f.supervisor(mode, "0.0.130", limits).carry_out(LocalRequest::Start, f.cli(), false);
    assert_eq!(state("not_healthy", Limits::default()), LocalState::Failed { reason: FailReason::NotHealthy });
    assert_eq!(state("garbage", Limits::default()), LocalState::Failed { reason: FailReason::BadOutput });
    let began = Instant::now();
    assert_eq!(state("sleep", short()), LocalState::Failed { reason: FailReason::Timeout });
    assert!(began.elapsed() < Duration::from_secs(5));
    std::thread::sleep(Duration::from_millis(200));
    let pid = f.log("pid");
    assert!(!alive(&pid[0]), "the script is gone");
}

#[test]
fn a_stop_that_times_out_is_failed() {
    let f = fixture();
    let limits = Limits { stop: Duration::from_millis(300), ..Limits::default() };
    assert_eq!(f.supervisor("sleep", "0.0.130", limits).carry_out(LocalRequest::Stop, f.cli(), false), LocalState::Failed { reason: FailReason::Timeout });
}

#[test]
fn a_cli_that_cannot_be_found_or_started() {
    let f = fixture();
    let sup = f.ok();
    assert_eq!(
        sup.carry_out(LocalRequest::Probe, Some("/nonexistent/pi-studio"), false),
        LocalState::CliMissing { path: Some("/nonexistent/pi-studio".into()) }
    );
    let broken = f.dir.path().join("broken");
    std::fs::write(&broken, "#!/nonexistent/interpreter\n").unwrap();
    std::fs::set_permissions(&broken, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(sup.carry_out(LocalRequest::Probe, broken.to_str(), false), LocalState::Failed { reason: FailReason::SpawnFailed });
}

#[test]
fn an_old_cli_is_outdated_and_no_daemon_command_runs() {
    let f = fixture();
    let sup = f.supervisor("", "0.0.118", Limits::default());
    for request in [LocalRequest::Probe, LocalRequest::Start, LocalRequest::Restart, LocalRequest::Stop] {
        assert_eq!(sup.carry_out(request, f.cli(), false), LocalState::CliOutdated { version: "0.0.118".into() });
    }
    assert!(f.log("calls").is_empty());
}

#[test]
fn requests_asked_at_once_run_one_after_the_other() {
    let f = fixture();
    let sup = Arc::new(f.supervisor("slow", "0.0.130", Limits::default()));
    let cli = f.cli.display().to_string();
    let threads: Vec<_> = [LocalRequest::Probe, LocalRequest::Start, LocalRequest::Stop]
        .into_iter()
        .map(|request| {
            let (sup, cli) = (Arc::clone(&sup), cli.clone());
            std::thread::spawn(move || sup.carry_out(request, Some(&cli), false))
        })
        .collect();
    for t in threads {
        t.join().unwrap();
    }
    let calls = f.log("calls");
    assert_eq!(calls.len(), 6);
    for pair in calls.chunks(2) {
        assert!(pair[0].starts_with("begin ") && pair[1].starts_with("end "), "overlap: {calls:?}");
    }
}

#[test]
fn pump_applies_each_outcome_to_the_session() {
    let f = fixture();
    let sup = f.ok();
    let session = f.session(true);
    assert_eq!(sup.pump(&session), 0);
    Supervisor::probe_now(&session).unwrap();
    assert_eq!(sup.pump(&session), 1);
    assert_eq!(*session.lock().unwrap().local_state(), LocalState::Stopped);
    session.request("daemon.local.start").unwrap();
    assert_eq!(*session.lock().unwrap().local_state(), LocalState::Starting);
    assert_eq!(sup.pump(&session), 1);
    assert_eq!(*session.lock().unwrap().local_state(), running());
    // Busy cleared: another action is accepted.
    session.request("daemon.local.stop").unwrap();
    assert_eq!(sup.pump(&session), 1);
    assert_eq!(*session.lock().unwrap().local_state(), LocalState::Stopped);
}

#[test]
fn a_retry_after_cli_missing_reads_the_environment_again() {
    let f = fixture();
    let session = f.session(true);
    session.lock().unwrap().apply_local_outcome(LocalState::CliMissing { path: None });
    assert_eq!(session.take(), Batch { requests: vec![], cli_path: f.cli().map(str::to_owned), refresh_env: true });
}

#[test]
fn resolve_starts_a_stopped_daemon_when_auto_start_is_on() {
    let f = fixture();
    let sup = f.ok();
    let session = f.session(true);
    session.lock().unwrap().execute("daemon.update", json!({"id": "local", "password": "pw"})).unwrap();
    Supervisor::probe_now(&session).unwrap();
    sup.pump(&session);
    let dial = sup.resolve_current(&session).unwrap();
    // The local entry has a stored password; the page is told the address alone.
    assert_eq!(dial, Dial::Connect { url: "ws://127.0.0.1:6767".into() });
    assert_eq!(f.log("starts"), ["start"]);
}

#[test]
fn resolve_with_auto_start_off_stays_stopped() {
    let f = fixture();
    let sup = f.ok();
    let session = f.session(false);
    Supervisor::probe_now(&session).unwrap();
    sup.pump(&session);
    assert_eq!(sup.resolve_current(&session).unwrap_err(), "local_stopped");
    assert!(f.log("starts").is_empty());
}

#[test]
fn resolve_reports_a_failed_start() {
    let f = fixture();
    let sup = f.supervisor("not_healthy", "0.0.130", Limits::default());
    let session = f.session(true);
    Supervisor::probe_now(&session).unwrap();
    sup.pump(&session);
    assert_eq!(sup.resolve_current(&session).unwrap_err(), "not_healthy");
}

#[test]
fn resolve_waits_for_a_start_another_pump_is_running() {
    let f = fixture();
    let sup = Arc::new(f.supervisor("slow", "0.0.130", Limits::default()));
    let session = Arc::new(f.session(true));
    session.lock().unwrap().apply_local_outcome(LocalState::Stopped);
    session.request("daemon.local.start").unwrap();
    let runner = {
        let (sup, session) = (Arc::clone(&sup), Arc::clone(&session));
        std::thread::spawn(move || sup.pump(&*session))
    };
    assert!(matches!(sup.resolve_current(&*session), Ok(Dial::Connect { .. })));
    runner.join().unwrap();
    assert_eq!(f.log("starts"), ["start"]);
}

#[test]
fn resolve_on_a_direct_entry_never_runs_the_cli() {
    let f = fixture();
    let sup = f.ok();
    let session = f.session(true);
    {
        let mut s = session.lock().unwrap();
        let added = s.execute("daemon.add", json!({"kind": "direct", "name": "box", "address": "ws://10.0.0.2:9000"})).unwrap();
        s.execute("daemon.switch", json!({"id": added["id"]})).unwrap();
    }
    match sup.resolve_current(&session).unwrap() {
        Dial::Connect { url, .. } => assert_eq!(url, "ws://10.0.0.2:9000"),
        other => panic!("{other:?}"),
    }
    assert!(f.log("calls").is_empty());
}

#[test]
fn without_a_run_hook_everything_is_spawn_failed() {
    let f = fixture();
    let sup = Supervisor::with_env(crate::Services { is_executable: Some(Arc::new(|_: &Path| true)), ..Default::default() }, Limits::default(), vec![]);
    assert_eq!(sup.carry_out(LocalRequest::Probe, f.cli(), false), LocalState::Failed { reason: FailReason::SpawnFailed });
}
