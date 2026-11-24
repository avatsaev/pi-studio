//! The supervisor against a fake binary (`tests/fixtures/fake-pi-studio.sh`), a fake installer and a real session.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::os::unix::fs::{PermissionsExt as _, symlink};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use pistudiodesktop_engine::{Dial, LocalRequest, Session};
use pistudiodesktop_model::{FailReason, LocalState};
use serde_json::json;

use super::{Batch, Limits, LocalAccess, Supervisor};
use crate::services::{InstallFailure, InstallProgress, Installer};
use crate::{Services, process};

const SCRIPT: &str = include_str!("../../tests/fixtures/fake-pi-studio.sh");

/// The version the fake installer's archive holds, and the pin it states.
const PIN: &str = "0.0.131";

struct Fixture {
    dir: tempfile::TempDir,
}

/// The script is written once, before any test starts a process: a process forked while a script
/// is still open for writing cannot run it (`ETXTBSY`). Every fake binary is a link to it.
fn script() -> &'static Path {
    static SCRIPT_FILE: LazyLock<(tempfile::TempDir, PathBuf)> = LazyLock::new(|| {
        let dir = tempfile::tempdir().unwrap();
        let cli = dir.path().join("pi-studio");
        std::fs::write(&cli, SCRIPT).unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
        (dir, cli)
    });
    &SCRIPT_FILE.1
}

/// Puts the fake binary where the supervisor looks: `<dir>/bin/current/pi-studio`, a link into `versions/fake`.
fn place(dir: &Path) {
    let bin = dir.join("bin");
    let version = bin.join("versions").join("fake");
    std::fs::create_dir_all(&version).unwrap();
    let program = version.join("pi-studio");
    let _ = std::fs::remove_file(&program);
    symlink(script(), &program).unwrap();
    let staging = bin.join("current.new");
    let _ = std::fs::remove_file(&staging);
    symlink("versions/fake", &staging).unwrap();
    std::fs::rename(&staging, bin.join("current")).unwrap();
}

/// What `--version` of the fake prints from now on, whatever `FAKE_PI_VERSION` says.
fn print_version(dir: &Path, version: &str) {
    std::fs::write(dir.join("version"), version).unwrap();
}

/// A stand-in for the installer hook: records its calls, reports the chunks it is given, and either fails as told or
/// puts the fake binary in place printing [`PIN`].
#[derive(Default)]
struct FakeInstaller {
    dir: PathBuf,
    /// `versions/<pin>` is already there: `adopt_installed` switches to it.
    present: bool,
    /// What `install` fails with, after its chunks.
    failure: Option<InstallFailure>,
    /// (received, total, milliseconds to wait before reporting it).
    chunks: Vec<(u64, u64, u64)>,
    calls: Mutex<Vec<&'static str>>,
}

impl FakeInstaller {
    fn put(&self) {
        place(&self.dir);
        print_version(&self.dir, PIN);
    }

    fn calls(&self) -> Vec<&'static str> {
        self.calls.lock().unwrap().clone()
    }
}

impl Installer for FakeInstaller {
    fn version(&self) -> &str {
        PIN
    }

    fn adopt_installed(&self, _bin_dir: &Path) -> bool {
        self.calls.lock().unwrap().push("adopt");
        if self.present {
            self.put();
        }
        self.present
    }

    fn install(&self, _bin_dir: &Path, progress: &mut dyn FnMut(InstallProgress)) -> Result<(), InstallFailure> {
        self.calls.lock().unwrap().push("install");
        for (received, total, wait) in &self.chunks {
            std::thread::sleep(Duration::from_millis(*wait));
            progress(InstallProgress::Downloading { received: *received, total: *total });
        }
        if let Some(failure) = &self.failure {
            return Err(failure.clone());
        }
        progress(InstallProgress::Installing);
        self.put();
        Ok(())
    }

    fn tidy(&self, _bin_dir: &Path) {
        self.calls.lock().unwrap().push("tidy");
    }
}

fn fixture() -> Fixture {
    Fixture { dir: tempfile::tempdir().unwrap() }
}

impl Fixture {
    /// The environment of the binary: the fake's folder and the daemon's home are this fixture's directory.
    fn env(&self, mode: &str, version: &str, extra: &[(&str, &str)]) -> Vec<(String, String)> {
        let mut env = vec![
            ("PATH".to_owned(), "/usr/bin:/bin".to_owned()),
            ("PI_STUDIO_HOME".to_owned(), self.dir.path().display().to_string()),
            ("FAKE_PI_DIR".to_owned(), self.dir.path().display().to_string()),
            ("FAKE_PI_MODE".to_owned(), mode.to_owned()),
            ("FAKE_PI_VERSION".to_owned(), version.to_owned()),
        ];
        env.extend(extra.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())));
        env
    }

    /// A supervisor over a binary that is in place, with no installer.
    fn supervisor(&self, mode: &str, version: &str, limits: Limits) -> Supervisor {
        place(self.dir.path());
        Supervisor::with_env(process::native_services(), limits, self.env(mode, version, &[]))
    }

    fn ok(&self) -> Supervisor {
        self.supervisor("", "0.0.130", Limits::default())
    }

    /// A supervisor with `installer` and nothing in place (the caller places a binary or lets the installer).
    fn with_installer(&self, installer: &Arc<FakeInstaller>, version: &str) -> Supervisor {
        let services = Services { installer: Some(installer.clone()), ..process::native_services() };
        Supervisor::with_env(services, Limits::default(), self.env("", version, &[]))
    }

    fn installer(&self) -> FakeInstaller {
        FakeInstaller { dir: self.dir.path().to_path_buf(), ..FakeInstaller::default() }
    }

    fn log(&self, name: &str) -> Vec<String> {
        std::fs::read_to_string(self.dir.path().join(name)).unwrap_or_default().lines().map(str::to_owned).collect()
    }

    /// A daemon is already up, as an npm daemon is: the fake's state file says so.
    fn daemon_is_up(&self) {
        std::fs::write(self.dir.path().join("running"), "").unwrap();
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

fn failed(reason: FailReason) -> LocalState {
    LocalState::Failed { reason, output: None }
}

fn short() -> Limits {
    Limits { start: Duration::from_millis(500), ..Limits::default() }
}

fn alive(pid: &str) -> bool {
    std::process::Command::new("kill").args(["-0", pid]).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

/// Carry out `request` and the states it passed through.
fn carry(sup: &Supervisor, request: LocalRequest) -> (LocalState, Vec<LocalState>) {
    let seen = Mutex::new(Vec::new());
    let state = sup.carry_out_reporting(request, false, &|passing| seen.lock().unwrap().push(passing));
    (state, seen.into_inner().unwrap())
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
fn a_binary_that_is_not_there_or_cannot_be_run_is_spawn_failed() {
    let f = fixture();
    // Nothing in place and no installer.
    let nothing = Supervisor::with_env(process::native_services(), Limits::default(), f.env("", "0.0.130", &[]));
    assert_eq!(nothing.carry_out(LocalRequest::Probe, false), failed(FailReason::SpawnFailed));
    // No run hook at all.
    place(f.dir.path());
    let no_hook = Supervisor::with_env(Services::default(), Limits::default(), f.env("", "0.0.130", &[]));
    assert_eq!(no_hook.carry_out(LocalRequest::Probe, false), failed(FailReason::SpawnFailed));
    // A file in place that cannot be run: treated as not installed.
    let other = fixture();
    let version = other.dir.path().join("bin").join("versions").join("broken");
    std::fs::create_dir_all(&version).unwrap();
    let broken = version.join("pi-studio");
    std::fs::write(&broken, "#!/nonexistent/interpreter\n").unwrap();
    std::fs::set_permissions(&broken, std::fs::Permissions::from_mode(0o755)).unwrap();
    symlink("versions/broken", other.dir.path().join("bin").join("current")).unwrap();
    let sup = Supervisor::with_env(process::native_services(), Limits::default(), other.env("", "0.0.130", &[]));
    assert_eq!(sup.carry_out(LocalRequest::Probe, false), failed(FailReason::SpawnFailed));
}

#[test]
fn a_home_that_is_not_a_folder_is_install_failed_and_nothing_runs() {
    let f = fixture();
    let sup = Supervisor::with_env(process::native_services(), Limits::default(), vec![("PI_STUDIO_HOME".into(), "relative/home".into())]);
    let state = sup.carry_out(LocalRequest::Probe, false);
    assert!(matches!(state, LocalState::Failed { reason: FailReason::InstallFailed, output: Some(_) }), "{state:?}");
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
fn a_retry_after_a_binary_that_could_not_be_run_or_installed_reads_the_environment_again() {
    let f = fixture();
    for reason in [FailReason::SpawnFailed, FailReason::InstallFailed] {
        let session = f.session(true);
        session.lock().unwrap().apply_local_outcome(failed(reason));
        assert_eq!(session.take(), Batch { requests: vec![], refresh_env: true }, "{reason:?}");
    }
    let session = f.session(true);
    session.lock().unwrap().apply_local_outcome(failed(FailReason::DownloadFailed));
    assert_eq!(session.take(), Batch { requests: vec![], refresh_env: false });
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
fn resolve_on_a_direct_entry_never_runs_the_binary() {
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
fn resolve_waits_for_a_download_longer_than_its_patience() {
    let f = fixture();
    // 50 pieces, 60 ms apart: 3 s, past the 2.5 s of patience (four limits of 600 ms and 100 ms of slack), but never
    // silent for as long as that.
    let installer = Arc::new(FakeInstaller { chunks: (1..=50).map(|n| (n, 50, 60)).collect(), ..f.installer() });
    let limit = Duration::from_millis(600);
    let limits = Limits { version: limit, status: limit, start: limit, restart: limit, stop: limit, slack: Duration::from_millis(100) };
    let services = Services { installer: Some(installer.clone()), ..process::native_services() };
    let sup = Arc::new(Supervisor::with_env(services, limits, f.env("", "0.0.130", &[])));
    let session = Arc::new(f.session(true));
    Supervisor::probe_now(&*session).unwrap();
    let runner = {
        let (sup, session) = (Arc::clone(&sup), Arc::clone(&session));
        std::thread::spawn(move || sup.pump(&*session))
    };
    // The runner has taken the probe and is downloading.
    std::thread::sleep(Duration::from_millis(150));
    assert!(matches!(*session.lock().unwrap().local_state(), LocalState::Downloading { .. }), "{:?}", session.lock().unwrap().local_state());
    assert!(matches!(sup.resolve_current(&*session), Ok(Dial::Connect { .. })));
    runner.join().unwrap();
    assert_eq!(installer.calls(), ["adopt", "install", "tidy"]);
}

// The binary that is installed, kept or replaced (S7, P11).

#[test]
fn first_use_downloads_then_starts() {
    let f = fixture();
    // The second piece comes within 250 ms of the first: the page sees the first only.
    let installer = Arc::new(FakeInstaller { chunks: vec![(10, 100, 0), (100, 100, 0)], ..f.installer() });
    let sup = f.with_installer(&installer, "0.0.130");
    let (state, seen) = carry(&sup, LocalRequest::Start);
    assert_eq!(state, running());
    assert_eq!(seen, [LocalState::Downloading { received: 10, total: 100 }, LocalState::Installing, LocalState::Starting]);
    assert_eq!(installer.calls(), ["adopt", "install", "tidy"]);
    assert_eq!(f.log("starts"), ["start"]);
    // The binary is in place now: the next request installs nothing.
    assert_eq!(sup.carry_out(LocalRequest::Probe, false), running());
    assert_eq!(installer.calls(), ["adopt", "install", "tidy"]);
}

#[test]
fn download_progress_is_stored_at_most_every_250_ms() {
    let f = fixture();
    let installer = Arc::new(FakeInstaller { chunks: vec![(1, 10, 0), (2, 10, 0), (3, 10, 300), (4, 10, 0)], ..f.installer() });
    let (_, seen) = carry(&f.with_installer(&installer, "0.0.130"), LocalRequest::Probe);
    assert_eq!(
        seen,
        [LocalState::Downloading { received: 1, total: 10 }, LocalState::Downloading { received: 3, total: 10 }, LocalState::Installing, LocalState::Checking]
    );
}

#[test]
fn a_present_pin_starts_without_a_download() {
    let f = fixture();
    let installer = Arc::new(FakeInstaller { present: true, ..f.installer() });
    let (state, seen) = carry(&f.with_installer(&installer, "0.0.130"), LocalRequest::Start);
    assert_eq!(state, running());
    assert!(seen.is_empty(), "{seen:?}");
    assert_eq!(installer.calls(), ["adopt", "tidy"]);
    assert_eq!(f.log("starts"), ["start"]);
}

#[test]
fn a_newer_binary_is_kept() {
    let f = fixture();
    place(f.dir.path());
    let installer = Arc::new(f.installer());
    let sup = f.with_installer(&installer, "0.0.140");
    assert_eq!(sup.carry_out(LocalRequest::Start, false), running());
    // Neither the folder nor a download was asked about: only the tidy after the start that reached running.
    assert_eq!(installer.calls(), ["tidy"]);
    assert_eq!(f.log("starts"), ["start"]);
    // The pin's own version is used as it is too.
    assert_eq!(f.with_installer(&installer, PIN).carry_out(LocalRequest::Probe, false), running());
    assert_eq!(installer.calls(), ["tidy"]);
}

#[test]
fn an_older_binary_is_replaced_by_the_pin() {
    let f = fixture();
    place(f.dir.path());
    let installer = Arc::new(f.installer());
    let state = f.with_installer(&installer, "0.0.118").carry_out(LocalRequest::Start, false);
    assert_eq!(state, running());
    assert_eq!(installer.calls(), ["adopt", "install", "tidy"]);
}

#[test]
fn a_checksum_failure_is_failed_and_nothing_is_run() {
    let f = fixture();
    let installer = Arc::new(FakeInstaller { chunks: vec![(5, 10, 0)], failure: Some(InstallFailure::Checksum), ..f.installer() });
    let (state, seen) = carry(&f.with_installer(&installer, "0.0.130"), LocalRequest::Start);
    assert_eq!(state, failed(FailReason::ChecksumMismatch));
    assert_eq!(seen, [LocalState::Downloading { received: 5, total: 10 }]);
    assert_eq!(installer.calls(), ["adopt", "install"], "no tidy after a failure");
    assert!(!f.dir.path().join("bin").join("current").exists(), "no binary was put in place");
    assert!(f.log("calls").is_empty() && f.log("starts").is_empty(), "nothing was run");
}

#[test]
fn a_failed_download_and_a_failed_install_carry_their_reasons() {
    let f = fixture();
    let download = Arc::new(FakeInstaller { failure: Some(InstallFailure::Download), ..f.installer() });
    assert_eq!(f.with_installer(&download, "0.0.130").carry_out(LocalRequest::Probe, false), failed(FailReason::DownloadFailed));
    let install =
        Arc::new(FakeInstaller { failure: Some(InstallFailure::Install { output: Some("line one\n\n\u{1b}GLIBC_2.99 not found\n".into()) }), ..f.installer() });
    assert_eq!(
        f.with_installer(&install, "0.0.130").carry_out(LocalRequest::Probe, false),
        LocalState::Failed { reason: FailReason::InstallFailed, output: Some("line one\nGLIBC_2.99 not found".into()) }
    );
    assert!(f.log("calls").is_empty());
}

#[test]
fn every_request_makes_sure_of_the_binary_first() {
    let f = fixture();
    for request in [LocalRequest::Probe, LocalRequest::Start, LocalRequest::Restart, LocalRequest::Stop] {
        let installer = Arc::new(FakeInstaller { failure: Some(InstallFailure::Download), ..f.installer() });
        let state = f.with_installer(&installer, "0.0.130").carry_out(request, false);
        assert_eq!(state, failed(FailReason::DownloadFailed), "{request:?}");
        assert_eq!(installer.calls(), ["adopt", "install"], "{request:?}");
    }
    assert!(f.log("calls").is_empty());
}

// An npm daemon that is running, and one that is too old.

#[test]
fn an_npm_daemon_that_is_running_is_running_through_the_binarys_status() {
    let f = fixture();
    f.daemon_is_up();
    let installer = Arc::new(f.installer());
    let (state, _) = carry(&f.with_installer(&installer, "0.0.130"), LocalRequest::Probe);
    assert_eq!(state, running());
    // The binary was installed first, then asked; nothing was started.
    assert_eq!(installer.calls(), ["adopt", "install"]);
    assert_eq!(f.log("calls"), ["begin status", "end status"]);
    assert!(f.log("starts").is_empty());
}

fn services_reporting(daemon_version: &'static str) -> Services {
    Services { daemon_version: Some(Arc::new(move |_: &str, _: u16| Some(daemon_version.to_owned()))), ..process::native_services() }
}

#[test]
fn a_running_daemon_below_the_minimum_is_outdated() {
    let f = fixture();
    place(f.dir.path());
    f.daemon_is_up();
    let sup = |reported: &'static str| Supervisor::with_env(services_reporting(reported), Limits::default(), f.env("", "0.0.140", &[]));
    assert_eq!(sup("0.0.126").carry_out(LocalRequest::Probe, false), LocalState::Outdated { version: "0.0.126".into() });
    assert_eq!(sup("0.0.126").carry_out(LocalRequest::Start, false), LocalState::Outdated { version: "0.0.126".into() });
    assert_eq!(sup("0.0.127").carry_out(LocalRequest::Probe, false), running());
    assert_eq!(sup("not a version").carry_out(LocalRequest::Probe, false), running());
    // No hook, no answer: not turned away.
    assert_eq!(f.ok().carry_out(LocalRequest::Probe, false), running());
    let unreadable = Services { daemon_version: Some(Arc::new(|_: &str, _: u16| None)), ..process::native_services() };
    assert_eq!(Supervisor::with_env(unreadable, Limits::default(), f.env("", "0.0.140", &[])).carry_out(LocalRequest::Probe, false), running());
}

/// An outdated daemon until it has been started again: the hook reads what the fake daemon's start log says.
fn daemon_version_by_starts(dir: &Path) -> Services {
    let starts = dir.join("starts");
    Services {
        daemon_version: Some(Arc::new(move |_: &str, _: u16| Some(if starts.exists() { PIN.to_owned() } else { "0.0.118".to_owned() }))),
        ..process::native_services()
    }
}

#[test]
fn update_stops_an_outdated_daemon_and_starts_the_binary_without_installing_it_again() {
    let f = fixture();
    place(f.dir.path());
    f.daemon_is_up();
    let installer = Arc::new(f.installer());
    let services = Services { installer: Some(installer.clone()), ..daemon_version_by_starts(f.dir.path()) };
    let sup = Supervisor::with_env(services, Limits::default(), f.env("", PIN, &[]));
    assert_eq!(sup.carry_out(LocalRequest::Probe, false), LocalState::Outdated { version: "0.0.118".into() });
    assert_eq!(sup.carry_out(LocalRequest::Update, false), running());
    assert_eq!(f.log("calls"), ["begin status", "end status", "begin status", "end status", "begin stop", "end stop", "begin start", "end start"]);
    assert_eq!(f.log("starts"), ["start"]);
    // The binary in place was the pin's: nothing was installed; the tidy came after the start.
    assert_eq!(installer.calls(), ["tidy"]);
}

#[test]
fn update_installs_the_pin_over_an_older_binary_and_starts() {
    let f = fixture();
    place(f.dir.path());
    let installer = Arc::new(FakeInstaller { chunks: vec![(1, 2, 0)], ..f.installer() });
    let (state, seen) = carry(&f.with_installer(&installer, "0.0.118"), LocalRequest::Update);
    assert_eq!(state, running());
    assert_eq!(seen, [LocalState::Downloading { received: 1, total: 2 }, LocalState::Installing, LocalState::Updating]);
    assert_eq!(installer.calls(), ["adopt", "install", "tidy"]);
    assert_eq!(f.log("starts"), ["start"]);
}

#[test]
fn update_after_a_failed_download_installs_and_starts() {
    let f = fixture();
    let installer = Arc::new(f.installer());
    assert_eq!(f.with_installer(&installer, "0.0.130").carry_out(LocalRequest::Update, false), running());
    assert_eq!(installer.calls(), ["adopt", "install", "tidy"]);
    assert_eq!(f.log("starts"), ["start"]);
}

#[test]
fn update_is_refused_for_a_binary_at_or_above_the_pin_and_a_daemon_that_is_not_outdated() {
    let f = fixture();
    place(f.dir.path());
    let installer = Arc::new(f.installer());
    // Newer than the pin, daemon stopped: the state is what is there; nothing is installed or started.
    assert_eq!(f.with_installer(&installer, "0.0.140").carry_out(LocalRequest::Update, false), LocalState::Stopped);
    // The pin's own version, daemon running and not outdated: not stopped either.
    f.daemon_is_up();
    assert_eq!(f.with_installer(&installer, PIN).carry_out(LocalRequest::Update, false), running());
    assert!(installer.calls().is_empty(), "{:?}", installer.calls());
    assert!(f.log("starts").is_empty());
    assert_eq!(f.log("calls"), ["begin status", "end status", "begin status", "end status"], "only ever asked, never stopped or started");
}

#[test]
fn update_without_an_installer_fails() {
    let f = fixture();
    let state = f.ok().carry_out(LocalRequest::Update, false);
    assert!(matches!(state, LocalState::Failed { reason: FailReason::InstallFailed, output: Some(_) }), "{state:?}");
    assert!(f.log("calls").is_empty());
}

#[test]
fn tidy_follows_only_a_start_that_reached_running() {
    let f = fixture();
    place(f.dir.path());
    let installer = Arc::new(f.installer());
    let sup = |mode: &str| {
        let services = Services { installer: Some(installer.clone()), ..process::native_services() };
        Supervisor::with_env(services, Limits::default(), f.env(mode, "0.0.140", &[]))
    };
    assert_eq!(sup("not_healthy").carry_out(LocalRequest::Start, false), failed(FailReason::NotHealthy));
    assert_eq!(sup("").carry_out(LocalRequest::Probe, false), LocalState::Stopped);
    assert_eq!(sup("").carry_out(LocalRequest::Stop, false), LocalState::Stopped);
    assert!(installer.calls().is_empty(), "{:?}", installer.calls());
    assert_eq!(sup("").carry_out(LocalRequest::Restart, false), running());
    assert_eq!(installer.calls(), ["tidy"]);
}

#[test]
fn the_command_runs_through_the_pump_with_the_progress_stored_on_the_way() {
    let f = fixture();
    let installer = Arc::new(FakeInstaller { chunks: vec![(1, 2, 0)], ..f.installer() });
    let sup = f.with_installer(&installer, "0.0.130");
    let session = f.session(true);
    session.lock().unwrap().apply_local_outcome(failed(FailReason::DownloadFailed));
    session.request("daemon.local.update").unwrap();
    assert_eq!(*session.lock().unwrap().local_state(), LocalState::Updating);
    assert_eq!(sup.pump(&session), 1);
    assert_eq!(*session.lock().unwrap().local_state(), running());
    assert!(session.request("daemon.local.update").unwrap_err().contains("update_not_offered"));
}
