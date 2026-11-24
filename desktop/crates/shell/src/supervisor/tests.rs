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
    Fixture { dir: tempfile::tempdir().unwrap() }
}

impl Fixture {
    fn supervisor(&self, mode: &str, version: &str, limits: Limits) -> Supervisor {
        self.supervisor_with(mode, version, &[], limits)
    }

    /// `extra` is more of the fake CLI's environment (`FAKE_PI_UPDATE`, `FAKE_PI_UPDATED_VERSION`).
    fn supervisor_with(&self, mode: &str, version: &str, extra: &[(&str, &str)], limits: Limits) -> Supervisor {
        let mut env = vec![
            // The fake CLI is found the way a terminal finds it: on the PATH of the environment.
            ("PATH".to_owned(), format!("{}:/usr/bin:/bin", script().parent().map(|d| d.display().to_string()).unwrap_or_default())),
            ("FAKE_PI_DIR".to_owned(), self.dir.path().display().to_string()),
            ("FAKE_PI_MODE".to_owned(), mode.to_owned()),
            ("FAKE_PI_VERSION".to_owned(), version.to_owned()),
        ];
        env.extend(extra.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())));
        Supervisor::with_env(process::native_services(), limits, env)
    }

    fn ok(&self) -> Supervisor {
        self.supervisor("", "0.0.130", Limits::default())
    }

    fn log(&self, name: &str) -> Vec<String> {
        std::fs::read_to_string(self.dir.path().join(name)).unwrap_or_default().lines().map(str::to_owned).collect()
    }

    fn session(&self, auto_start: bool) -> Mutex<Session> {
        let mut s = Session::new();
        s.set_local_supported(true);
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
    assert_eq!(sup.carry_out(LocalRequest::Probe, false), LocalState::Stopped);
    assert_eq!(sup.carry_out(LocalRequest::Start, false), running());
    assert_eq!(sup.carry_out(LocalRequest::Probe, false), running());
    // A second start adopts the running daemon: the script records no second start.
    assert_eq!(sup.carry_out(LocalRequest::Start, false), running());
    assert_eq!(f.log("starts"), ["start"]);
    assert_eq!(sup.carry_out(LocalRequest::Restart, false), running());
    assert_eq!(f.log("starts"), ["start", "restart"]);
    assert_eq!(sup.carry_out(LocalRequest::Stop, false), LocalState::Stopped);
    assert_eq!(sup.carry_out(LocalRequest::Probe, false), LocalState::Stopped);
}

#[test]
fn start_failures_carry_their_reason() {
    let f = fixture();
    let state = |mode: &str, limits| f.supervisor(mode, "0.0.130", limits).carry_out(LocalRequest::Start, false);
    assert_eq!(state("not_healthy", Limits::default()), failed(FailReason::NotHealthy));
    assert_eq!(state("garbage", Limits::default()), failed(FailReason::BadOutput));
    let began = Instant::now();
    assert_eq!(state("sleep", short()), failed(FailReason::Timeout));
    assert!(began.elapsed() < Duration::from_secs(5));
    std::thread::sleep(Duration::from_millis(200));
    let pid = f.log("pid");
    assert!(!alive(&pid[0]), "the script is gone");
}

#[test]
fn a_stop_that_times_out_is_failed() {
    let f = fixture();
    let limits = Limits { stop: Duration::from_millis(300), ..Limits::default() };
    assert_eq!(f.supervisor("sleep", "0.0.130", limits).carry_out(LocalRequest::Stop, false), failed(FailReason::Timeout));
}

#[test]
fn a_cli_that_cannot_be_found_or_started_is_spawn_failed() {
    let f = fixture();
    // No hook to look for a file with: nothing is found.
    let nothing = Supervisor::with_env(crate::Services::default(), Limits::default(), vec![]);
    assert_eq!(nothing.carry_out(LocalRequest::Probe, false), failed(FailReason::SpawnFailed));
    // A file that is found on the PATH and cannot be run.
    let bin = f.dir.path().join("broken");
    std::fs::create_dir(&bin).unwrap();
    let broken = bin.join("pi-studio");
    std::fs::write(&broken, "#!/nonexistent/interpreter\n").unwrap();
    std::fs::set_permissions(&broken, std::fs::Permissions::from_mode(0o755)).unwrap();
    let env = vec![("PATH".to_owned(), bin.display().to_string())];
    let sup = Supervisor::with_env(process::native_services(), Limits::default(), env);
    assert_eq!(sup.carry_out(LocalRequest::Probe, false), failed(FailReason::SpawnFailed));
}

#[test]
fn an_old_cli_is_outdated_and_no_daemon_command_runs() {
    let f = fixture();
    let sup = f.supervisor("", "0.0.118", Limits::default());
    for request in [LocalRequest::Probe, LocalRequest::Start, LocalRequest::Restart, LocalRequest::Stop] {
        assert_eq!(sup.carry_out(request, false), LocalState::Outdated { version: "0.0.118".into() });
    }
    assert!(f.log("calls").is_empty());
}

#[test]
fn requests_asked_at_once_run_one_after_the_other() {
    let f = fixture();
    let sup = Arc::new(f.supervisor("slow", "0.0.130", Limits::default()));
    let threads: Vec<_> = [LocalRequest::Probe, LocalRequest::Start, LocalRequest::Stop]
        .into_iter()
        .map(|request| {
            let sup = Arc::clone(&sup);
            std::thread::spawn(move || sup.carry_out(request, false))
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
fn a_retry_after_a_cli_that_could_not_be_run_reads_the_environment_again() {
    let f = fixture();
    let session = f.session(true);
    session.lock().unwrap().apply_local_outcome(failed(FailReason::SpawnFailed));
    assert_eq!(session.take(), Batch { requests: vec![], refresh_env: true });
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
    let sup = Supervisor::with_env(crate::Services { is_executable: Some(Arc::new(|_: &Path| true)), ..Default::default() }, Limits::default(), vec![]);
    assert_eq!(sup.carry_out(LocalRequest::Probe, false), failed(FailReason::SpawnFailed));
}

fn failed(reason: FailReason) -> LocalState {
    LocalState::Failed { reason, output: None }
}

fn updated(f: &Fixture, mode: &str, version: &str, extra: &[(&str, &str)]) -> (Supervisor, LocalState) {
    let sup = f.supervisor_with(mode, version, extra, Limits::default());
    let state = sup.carry_out(LocalRequest::Update, false);
    (sup, state)
}

#[test]
fn update_runs_the_cli_reads_the_version_and_starts() {
    let f = fixture();
    let (sup, state) = updated(&f, "", "0.0.118", &[("FAKE_PI_UPDATED_VERSION", "0.0.131")]);
    assert_eq!(state, running());
    assert_eq!(f.log("updates"), ["update"]);
    assert_eq!(f.log("starts"), ["start"]);
    assert_eq!(f.log("calls"), ["begin start", "end start"]);
    // The version now read is the new one: a probe goes through.
    assert_eq!(sup.carry_out(LocalRequest::Probe, false), running());
}

#[test]
fn update_of_a_current_cli_with_a_stopped_daemon_starts_it() {
    let f = fixture();
    let (_, state) = updated(&f, "", "0.0.130", &[]);
    assert_eq!((state, f.log("updates"), f.log("starts")), (running(), vec!["update".to_owned()], vec!["start".to_owned()]));
}

#[test]
fn a_failed_update_keeps_the_last_lines_and_runs_nothing_else() {
    let f = fixture();
    let (_, state) = updated(&f, "", "0.0.118", &[("FAKE_PI_UPDATE", "fail")]);
    let output = Some("npm ERR! first line\nnpm ERR! EACCES: permission denied".to_owned());
    assert_eq!(state, LocalState::Failed { reason: FailReason::InstallFailed, output });
    assert!(f.log("calls").is_empty() && f.log("starts").is_empty());
}

#[test]
fn an_update_that_leaves_the_cli_old_is_still_outdated() {
    let f = fixture();
    let (_, state) = updated(&f, "", "0.0.118", &[("FAKE_PI_UPDATE", "noop")]);
    assert_eq!(state, LocalState::Outdated { version: "0.0.118".into() });
    assert_eq!(f.log("updates"), ["update"]);
    assert!(f.log("calls").is_empty());
}

#[test]
fn a_start_that_fails_after_the_update_is_a_start_failure() {
    let f = fixture();
    let (_, state) = updated(&f, "not_healthy", "0.0.118", &[("FAKE_PI_UPDATED_VERSION", "0.0.131")]);
    assert_eq!(state, failed(FailReason::NotHealthy));
    assert_eq!(f.log("updates"), ["update"]);
}

#[test]
fn an_update_past_its_limit_is_killed_and_failed() {
    let f = fixture();
    let limits = Limits { update: Duration::from_millis(300), ..Limits::default() };
    let began = Instant::now();
    let state = f.supervisor_with("", "0.0.118", &[("FAKE_PI_UPDATE", "sleep")], limits).carry_out(LocalRequest::Update, false);
    assert!(matches!(state, LocalState::Failed { reason: FailReason::InstallFailed, output: Some(_) }), "{state:?}");
    assert!(began.elapsed() < Duration::from_secs(5));
    assert!(f.log("calls").is_empty());
}

#[test]
fn without_a_checked_run_hook_an_update_fails() {
    let sup = Supervisor::with_env(crate::Services { is_executable: Some(Arc::new(|_: &Path| true)), ..Default::default() }, Limits::default(), vec![]);
    let state = sup.carry_out(LocalRequest::Update, false);
    assert!(matches!(state, LocalState::Failed { reason: FailReason::InstallFailed, output: Some(_) }), "{state:?}");
}

#[test]
fn the_update_command_runs_through_the_pump() {
    let f = fixture();
    let sup = f.supervisor_with("", "0.0.118", &[("FAKE_PI_UPDATED_VERSION", "0.0.131")], Limits::default());
    let session = f.session(true);
    session.lock().unwrap().apply_local_outcome(LocalState::Outdated { version: "0.0.118".into() });
    session.request("daemon.local.update").unwrap();
    assert_eq!(*session.lock().unwrap().local_state(), LocalState::Updating);
    assert_eq!(sup.pump(&session), 1);
    assert_eq!(*session.lock().unwrap().local_state(), running());
    assert!(session.request("daemon.local.update").unwrap_err().contains("update_not_offered"));
}
