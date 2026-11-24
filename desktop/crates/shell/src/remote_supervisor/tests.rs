//! The remote supervisor against a fake host: scripted answers for the state each step reaches, and, on Unix, a
//! sandbox where the host's commands are really run by `/bin/sh` in a scratch folder.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use pistudiodesktop_engine::{RemoteAction, RemoteRequest};
use pistudiodesktop_model::{EntryId, RemoteFailReason, RemoteInstallStage, RemoteState};

use super::{RemoteAccess, RemoteJob, RemoteLimits, RemoteSupervisor};
use crate::services::{
    Archive, ArchiveSource, FetchFailure, RemoteDaemonVersionHook, RemoteOutput, RemoteRunFailure, RemoteRunHook, RemoteSendFailure, RemoteSendHook, Services,
};

type Reply = Result<RemoteOutput, RemoteRunFailure>;
type SendResult = Result<(), RemoteSendFailure>;

const ENTRY: &str = "123e4567-e89b-12d3-a456-426614174000";
const PORT: u16 = 7878;
const FOLDER: &str = "/home/me/.pi-studio";
const PIN: &str = "0.0.200";
const SIZE: u64 = 40_000_000;
const SHA: &str = "ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34ab12cd34";
const UP: &str = r#"{"up":true,"host":"127.0.0.1","port":7878}"#;

/// What the supervisor asked of the host and the app, in order.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Event {
    Run(String, Duration),
    Send { path: String, size: u64, stall: Duration },
    Fetch(String),
}

type Log = Arc<Mutex<Vec<Event>>>;

fn out(status: i32, stdout: &str) -> Reply {
    Ok(RemoteOutput { status, stdout: stdout.to_owned() })
}

/// What the facts script prints on a host.
fn facts_text(os: &str, cpu: &str, musl: bool, dir: &str, version: &str) -> String {
    format!(
        "pi-studio-fact:os={os}\npi-studio-fact:cpu={cpu}\npi-studio-fact:musl={}\npi-studio-fact:dir={dir}\npi-studio-fact:ver={version}\n",
        u8::from(musl)
    )
}

/// A Linux x86_64 host whose installed binary is `version` (none when empty).
fn linux(version: &str) -> Reply {
    out(0, &facts_text("Linux", "x86_64", false, FOLDER, version))
}

fn failed(reason: RemoteFailReason) -> RemoteState {
    RemoteState::Failed { reason, output: None }
}

fn failed_with(reason: RemoteFailReason, output: &str) -> RemoteState {
    RemoteState::Failed { reason, output: Some(output.to_owned()) }
}

struct FakeArchives {
    fetched: Result<(), FetchFailure>,
    pieces: Vec<(u64, u64)>,
    path: PathBuf,
    size: u64,
    log: Log,
}

impl ArchiveSource for FakeArchives {
    fn version(&self) -> &str {
        PIN
    }

    fn fetch(&self, target: &str, progress: &mut dyn FnMut(u64, u64)) -> Result<Archive, FetchFailure> {
        self.log.lock().unwrap().push(Event::Fetch(target.to_owned()));
        for (got, total) in &self.pieces {
            progress(*got, *total);
        }
        self.fetched.map(|()| Archive { path: self.path.clone(), size: self.size, sha256: SHA.to_owned() })
    }
}

/// What a test sets up: the host's answers in order, and what the app's hooks do.
struct Rig {
    replies: Vec<Reply>,
    send: Option<SendResult>,
    /// `None`: no archive source in the services.
    archives: Option<Result<(), FetchFailure>>,
    pieces: Vec<(u64, u64)>,
    daemon_version: Option<Option<&'static str>>,
}

impl Rig {
    fn new(replies: Vec<Reply>) -> Self {
        Self { replies, send: Some(Ok(())), archives: Some(Ok(())), pieces: Vec::new(), daemon_version: None }
    }

    fn build(self) -> (RemoteSupervisor, Log) {
        let log: Log = Arc::default();
        let queue = Arc::new(Mutex::new(VecDeque::from(self.replies)));
        let (seen, replies) = (Arc::clone(&log), Arc::clone(&queue));
        let run: RemoteRunHook = Arc::new(move |command, limit| {
            seen.lock().unwrap().push(Event::Run(command.to_owned(), limit));
            replies.lock().unwrap().pop_front().unwrap_or(Err(RemoteRunFailure::ExecFailed))
        });
        let mut services = Services { remote_run: Some(run), ..Services::default() };
        if let Some(result) = self.send {
            let seen = Arc::clone(&log);
            let hook: RemoteSendHook = Arc::new(move |path, _source, size, stall, progress| {
                seen.lock().unwrap().push(Event::Send { path: path.to_owned(), size, stall });
                progress(size / 2);
                progress(size);
                result
            });
            services.remote_send = Some(hook);
        }
        if let Some(fetched) = self.archives {
            let archives = FakeArchives {
                fetched,
                pieces: self.pieces,
                path: PathBuf::from("/app/data/daemon-archives/0.0.200/linux-x64.tar.gz"),
                size: SIZE,
                log: Arc::clone(&log),
            };
            services.archives = Some(Arc::new(archives));
        }
        if let Some(version) = self.daemon_version {
            let hook: RemoteDaemonVersionHook = Arc::new(move || version.map(str::to_owned));
            services.remote_daemon_version = Some(hook);
        }
        (RemoteSupervisor::new(services, RemoteLimits::default()), log)
    }
}

fn supervisor(replies: Vec<Reply>) -> (RemoteSupervisor, Log) {
    Rig::new(replies).build()
}

/// The kind of each thing the supervisor did, by what its text holds.
fn kinds(log: &Log) -> Vec<&'static str> {
    log.lock()
        .unwrap()
        .iter()
        .map(|event| match event {
            Event::Fetch(_) => "fetch",
            Event::Send { .. } => "send",
            Event::Run(command, _) if command.contains("pi-studio-fact:os") => "facts",
            Event::Run(command, _) if command.contains("-mmin") => "prepare",
            Event::Run(command, _) if command.contains("df -Pk") => "diagnose",
            Event::Run(command, _) if command.contains("wc -c") => "check",
            Event::Run(command, _) if command.contains("tar -xzf") => "unpack",
            Event::Run(command, _) if command.contains("readlink") => "prune",
            Event::Run(command, _) if command.starts_with("/bin/sh -c 'rm -rf") => "remove",
            Event::Run(command, _) if command.ends_with("daemon start") => "start",
            Event::Run(command, _) if command.ends_with("daemon restart") => "restart",
            Event::Run(..) => "other",
        })
        .collect()
}

fn run_commands(log: &Log) -> Vec<String> {
    log.lock().unwrap().iter().filter_map(|event| if let Event::Run(command, _) = event { Some(command.clone()) } else { None }).collect()
}

/// The states an install reported, one after another.
fn carry_out_install(s: &RemoteSupervisor, action: RemoteAction, seen_up: bool) -> (RemoteState, Vec<RemoteState>) {
    let seen = Mutex::new(Vec::new());
    let state = s.carry_out_reporting(action, PORT, seen_up, &|passing| seen.lock().unwrap().push(passing));
    (state, seen.into_inner().unwrap())
}

fn installing(stage: RemoteInstallStage) -> RemoteState {
    RemoteState::Installing { stage, done: None, total: None }
}

// --- Probe -------------------------------------------------------------------------------------------------------

#[test]
fn a_daemon_the_app_reached_is_running_and_the_host_is_not_asked() {
    let (s, log) = supervisor(vec![]);
    assert_eq!(s.carry_out(RemoteAction::Probe, PORT, true), RemoteState::Running);
    assert!(log.lock().unwrap().is_empty(), "no command ran");
}

#[test]
fn a_running_daemon_older_than_the_minimum_is_outdated_and_one_that_says_nothing_is_running() {
    for (said, expected) in [
        (Some("0.0.126"), RemoteState::Outdated { version: "0.0.126".into() }),
        (Some("0.0.127"), RemoteState::Running),
        (Some("v0.0.131"), RemoteState::Running),
        (Some("banana"), RemoteState::Running),
        (None, RemoteState::Running),
    ] {
        let mut rig = Rig::new(vec![]);
        rig.daemon_version = Some(said);
        assert_eq!(rig.build().0.carry_out(RemoteAction::Probe, PORT, true), expected, "{said:?}");
    }
}

#[test]
fn a_host_with_a_binary_is_stopped_and_one_without_is_not_installed() {
    let (s, log) = supervisor(vec![linux("0.0.131"), linux("")]);
    assert_eq!(s.carry_out(RemoteAction::Probe, PORT, false), RemoteState::Stopped);
    assert_eq!(s.carry_out(RemoteAction::Probe, PORT, false), RemoteState::NotInstalled);
    assert_eq!(kinds(&log), ["facts", "facts"]);
    let Event::Run(_, limit) = log.lock().unwrap()[0].clone() else { panic!() };
    assert_eq!(limit, Duration::from_secs(15));
}

#[test]
fn every_system_maps_to_its_target_and_the_others_are_unsupported_with_their_name() {
    for (os, cpu, target) in
        [("Linux", "x86_64", "linux-x64"), ("Linux", "aarch64", "linux-arm64"), ("Darwin", "arm64", "darwin-arm64"), ("Darwin", "x86_64", "darwin-x64")]
    {
        // The target is what an install asks the archive source for.
        let facts = out(0, &facts_text(os, cpu, false, FOLDER, ""));
        let (s, log) = supervisor(vec![facts, out(0, ""), out(0, ""), out(0, ""), out(0, UP), out(0, "")]);
        assert_eq!(carry_out_install(&s, RemoteAction::Install, false).0, RemoteState::Running, "{os} {cpu}");
        assert!(log.lock().unwrap().contains(&Event::Fetch(target.to_owned())), "{os} {cpu}");
    }
    for (os, cpu, musl, system) in [
        ("Linux", "x86_64", true, "Linux x86_64 (musl)"),
        ("Linux", "aarch64", true, "Linux aarch64 (musl)"),
        ("Linux", "armv7l", false, "Linux armv7l"),
        ("FreeBSD", "amd64", false, "FreeBSD amd64"),
        ("MINGW64_NT-10.0", "x86_64", false, "Windows"),
        ("", "", false, "unknown"),
    ] {
        let (s, log) = supervisor(vec![
            out(0, &facts_text(os, cpu, musl, FOLDER, "")),
            out(0, &facts_text(os, cpu, musl, FOLDER, "")),
            out(0, &facts_text(os, cpu, musl, FOLDER, "")),
        ]);
        let unsupported = RemoteState::Unsupported { system: system.to_owned() };
        assert_eq!(s.carry_out(RemoteAction::Probe, PORT, false), unsupported, "{system}");
        assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), unsupported, "{system}");
        assert_eq!(carry_out_install(&s, RemoteAction::Install, false), (unsupported, vec![]), "{system}");
        assert_eq!(kinds(&log), ["facts", "facts", "facts"], "{system}: nothing is fetched, sent or started");
    }
}

#[test]
fn a_host_with_no_uname_that_prints_nothing_is_unsupported_as_unknown() {
    let (s, _) = supervisor(vec![out(127, "")]);
    assert_eq!(s.carry_out(RemoteAction::Probe, PORT, false), RemoteState::Unsupported { system: "unknown".into() });
}

#[test]
fn a_folder_that_is_not_absolute_and_hook_failures_are_not_a_state_of_the_daemon() {
    let (s, _) = supervisor(vec![out(0, &facts_text("Linux", "x86_64", false, "", ""))]);
    assert_eq!(s.carry_out(RemoteAction::Probe, PORT, false), failed(RemoteFailReason::BadOutput));
    for (failure, reason) in [
        (RemoteRunFailure::NoShell, RemoteFailReason::NoShell),
        (RemoteRunFailure::ExecFailed, RemoteFailReason::ExecFailed),
        (RemoteRunFailure::TimedOut, RemoteFailReason::Timeout),
    ] {
        for action in [RemoteAction::Probe, RemoteAction::Start, RemoteAction::Install, RemoteAction::Update] {
            let (s, _) = supervisor(vec![Err(failure)]);
            assert_eq!(s.carry_out(action, PORT, false), failed(reason), "{action:?}");
        }
    }
}

#[test]
fn without_a_hook_everything_is_exec_failed() {
    let s = RemoteSupervisor::new(Services::default(), RemoteLimits::default());
    assert_eq!(s.carry_out(RemoteAction::Probe, PORT, false), failed(RemoteFailReason::ExecFailed));
}

// --- Start -------------------------------------------------------------------------------------------------------

#[test]
fn start_runs_the_installed_binary_by_its_absolute_path_on_the_entry_port_with_90_seconds() {
    let (s, log) = supervisor(vec![linux("0.0.131"), out(0, &format!("log line\n{UP}\n"))]);
    assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), RemoteState::Running);
    assert_eq!(run_commands(&log)[1], "'/home/me/.pi-studio/bin/current/pi-studio' --json -H 127.0.0.1:7878 daemon start");
    let Event::Run(_, limit) = log.lock().unwrap()[1].clone() else { panic!() };
    assert_eq!(limit, Duration::from_secs(90));
    assert_eq!(RemoteLimits::default().start, Duration::from_secs(90));
}

#[test]
fn start_reads_the_answer_whatever_the_exit_status() {
    let (s, _) = supervisor(vec![linux("0.0.131"), out(1, r#"{"up":true,"host":"h","port":1,"error":"no_keypair"}"#)]);
    assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), RemoteState::Running);
}

#[test]
fn start_failures() {
    let (s, _) = supervisor(vec![
        linux("0.0.131"),
        out(1, r#"{"up":false}"#),
        linux("0.0.131"),
        out(0, "garbage"),
        linux("0.0.131"),
        out(0, r#"{"stopped":true}"#),
        linux("0.0.131"),
        Err(RemoteRunFailure::TimedOut),
    ]);
    assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), failed(RemoteFailReason::NotHealthy));
    assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), failed(RemoteFailReason::BadOutput));
    assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), failed(RemoteFailReason::BadOutput));
    assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), failed(RemoteFailReason::Timeout));
}

#[test]
fn start_with_no_binary_starts_nothing() {
    let (s, log) = supervisor(vec![linux("")]);
    assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), RemoteState::NotInstalled);
    assert_eq!(kinds(&log), ["facts"]);
}

#[test]
fn a_pairing_url_is_not_kept_or_shown() {
    let secret = "pi://SECRET-TOKEN-123";
    let answer = format!(r#"{{"up":true,"host":"h","port":3,"pairingUrl":"{secret}"}}"#);
    let (s, _) = supervisor(vec![linux("0.0.131"), out(0, &answer)]);
    let state = s.carry_out(RemoteAction::Start, PORT, false);
    assert_eq!(state, RemoteState::Running);
    assert!(!format!("{state:?}").contains("SECRET"));
    assert!(!format!("{:?}", RemoteOutput { status: 0, stdout: answer }).contains("SECRET"));
}

// --- Install -----------------------------------------------------------------------------------------------------

/// The replies of an install that goes through on a host with no binary: facts, prepare, check, unpack, start, prune.
fn happy_replies() -> Vec<Reply> {
    vec![linux(""), out(0, ""), out(0, ""), out(0, ""), out(0, UP), out(0, "")]
}

#[test]
fn an_install_downloads_sends_checks_unpacks_starts_and_prunes_in_that_order() {
    let mut rig = Rig::new(happy_replies());
    rig.pieces = vec![(1_000, SIZE)];
    let (s, log) = rig.build();
    let (state, passed) = carry_out_install(&s, RemoteAction::Install, false);
    assert_eq!(state, RemoteState::Running);
    assert_eq!(kinds(&log), ["facts", "fetch", "prepare", "send", "check", "unpack", "start", "prune"]);
    // The stages, with the counts the download and the send reported (the first of each; the rest came within 250 ms).
    assert_eq!(
        passed,
        [
            installing(RemoteInstallStage::Downloading),
            RemoteState::Installing { stage: RemoteInstallStage::Downloading, done: Some(1_000), total: Some(SIZE) },
            RemoteState::Installing { stage: RemoteInstallStage::Sending, done: Some(0), total: Some(SIZE) },
            installing(RemoteInstallStage::Unpacking),
            installing(RemoteInstallStage::Starting),
        ]
    );
    let events = log.lock().unwrap().clone();
    // The file goes to `bin/tmp/<random>.tar.gz` under the host's folder, with the archive's size and the 60 s stall.
    let Some(Event::Send { path, size, stall }) = events.iter().find(|e| matches!(e, Event::Send { .. })).cloned() else { panic!() };
    let name = path.strip_prefix("/home/me/.pi-studio/bin/tmp/").and_then(|rest| rest.strip_suffix(".tar.gz")).unwrap();
    assert!(name.len() == 16 && name.bytes().all(|b| b.is_ascii_hexdigit()), "{name}");
    assert_eq!((size, stall), (SIZE, Duration::from_secs(60)));
    // The commands name that file; the unpack the pinned version; the start the binary by its absolute path.
    let commands = run_commands(&log);
    assert!(
        commands[2].contains("wc -c") && commands[2].contains(&path) && commands[2].contains(SHA) && commands[2].contains(&SIZE.to_string()),
        "{}",
        commands[2]
    );
    assert!(commands[3].contains(name) && commands[3].contains("0.0.200") && commands[3].contains("/home/me/.pi-studio/bin"), "{}", commands[3]);
    assert_eq!(commands[4], "'/home/me/.pi-studio/bin/current/pi-studio' --json -H 127.0.0.1:7878 daemon start");
    let limits: Vec<Duration> = events.iter().filter_map(|e| if let Event::Run(_, l) = e { Some(*l) } else { None }).collect();
    assert_eq!(limits, [15, 30, 60, 120, 90, 30].map(Duration::from_secs));
}

#[test]
fn an_install_with_the_archive_cached_goes_straight_to_sending() {
    let (s, log) = supervisor(happy_replies());
    let (_, passed) = carry_out_install(&s, RemoteAction::Install, false);
    assert_eq!(passed[0], installing(RemoteInstallStage::Downloading), "the fetch is announced even when it is a cache hit");
    assert!(passed.iter().filter(|state| matches!(state, RemoteState::Installing { stage: RemoteInstallStage::Downloading, done: Some(_), .. })).count() == 0);
    assert_eq!(kinds(&log)[1], "fetch");
}

#[test]
fn a_failed_download_is_download_failed_and_a_wrong_one_checksum_mismatch_and_nothing_is_sent() {
    for (fetch, reason) in [(FetchFailure::Download, RemoteFailReason::DownloadFailed), (FetchFailure::Checksum, RemoteFailReason::ChecksumMismatch)] {
        let mut rig = Rig::new(vec![linux("")]);
        rig.archives = Some(Err(fetch));
        let (s, log) = rig.build();
        assert_eq!(carry_out_install(&s, RemoteAction::Install, false).0, failed(reason));
        assert_eq!(kinds(&log), ["facts", "fetch"]);
    }
}

#[test]
fn an_app_with_no_archives_refuses_to_install_and_a_missing_send_is_send_failed() {
    let mut rig = Rig::new(vec![linux("")]);
    rig.archives = None;
    let (s, log) = rig.build();
    assert_eq!(carry_out_install(&s, RemoteAction::Install, false).0, failed_with(RemoteFailReason::InstallFailed, "This app does not install the daemon."));
    assert_eq!(kinds(&log), ["facts"]);

    let mut rig = Rig::new(vec![linux(""), out(0, ""), out(0, "")]);
    rig.send = None;
    let (s, log) = rig.build();
    assert_eq!(carry_out_install(&s, RemoteAction::Install, false).0, failed(RemoteFailReason::SendFailed));
    assert_eq!(kinds(&log), ["facts", "fetch", "prepare"]);
}

#[test]
fn a_host_that_cannot_make_its_folder_fails_the_send_with_its_own_words() {
    let (s, log) = supervisor(vec![linux(""), out(1, "mkdir: cannot create directory '/home/me/.pi-studio/bin/tmp': Permission denied\n")]);
    assert_eq!(
        carry_out_install(&s, RemoteAction::Install, false).0,
        failed_with(RemoteFailReason::SendFailed, "mkdir: cannot create directory '/home/me/.pi-studio/bin/tmp': Permission denied")
    );
    assert_eq!(kinds(&log), ["facts", "fetch", "prepare"]);
}

#[test]
fn a_send_the_host_refused_keeps_what_it_says_and_leaves_no_file() {
    let mut rig = Rig::new(vec![linux(""), out(0, ""), out(0, "bash: ... No space left\n/dev/sda1 100000 100000 0 100% /home\n"), out(0, "")]);
    rig.send = Some(Err(RemoteSendFailure::Rejected));
    let (s, log) = rig.build();
    let (state, passed) = carry_out_install(&s, RemoteAction::Install, false);
    assert_eq!(state, failed_with(RemoteFailReason::SendFailed, "bash: ... No space left\n/dev/sda1 100000 100000 0 100% /home"));
    assert_eq!(kinds(&log), ["facts", "fetch", "prepare", "send", "diagnose", "remove"]);
    assert_eq!(passed.last(), Some(&RemoteState::Installing { stage: RemoteInstallStage::Sending, done: Some(0), total: Some(SIZE) }));
}

#[test]
fn a_send_that_ended_with_the_connection_is_send_failed_and_the_file_is_asked_to_be_removed() {
    let mut rig = Rig::new(vec![linux(""), out(0, ""), out(0, "")]);
    rig.send = Some(Err(RemoteSendFailure::Failed));
    let (s, log) = rig.build();
    assert_eq!(carry_out_install(&s, RemoteAction::Install, false).0, failed(RemoteFailReason::SendFailed));
    assert_eq!(kinds(&log), ["facts", "fetch", "prepare", "send", "remove"]);
}

#[test]
fn a_file_that_could_not_be_removed_is_removed_by_the_next_install() {
    let mut rig = Rig::new(vec![linux(""), out(0, ""), Err(RemoteRunFailure::ExecFailed), linux(""), out(0, ""), out(0, "")]);
    rig.send = Some(Err(RemoteSendFailure::Failed));
    let (s, log) = rig.build();
    assert_eq!(carry_out_install(&s, RemoteAction::Install, false).0, failed(RemoteFailReason::SendFailed));
    let Some(Event::Send { path, .. }) = log.lock().unwrap().iter().find(|e| matches!(e, Event::Send { .. })).cloned() else { panic!() };
    let base = path.strip_suffix(".tar.gz").unwrap().to_owned();
    // The connection came back: the next install's first host step removes what is left.
    assert_eq!(carry_out_install(&s, RemoteAction::Install, false).0, failed(RemoteFailReason::SendFailed));
    let prepares: Vec<String> = run_commands(&log).into_iter().filter(|c| c.contains("-mmin")).collect();
    assert_eq!(prepares.len(), 2);
    assert!(!prepares[0].contains(".tar.gz"), "nothing was left before");
    assert!(prepares[1].contains(&base) && prepares[1].contains(&format!("{base}.tar.gz")) && prepares[1].contains(&format!("{base}.err")), "{}", prepares[1]);
}

#[test]
fn a_file_of_the_wrong_size_or_checksum_is_checksum_mismatch() {
    let (s, log) = supervisor(vec![linux(""), out(0, ""), out(3, "the file on the host has another checksum\n")]);
    assert_eq!(carry_out_install(&s, RemoteAction::Install, false).0, failed(RemoteFailReason::ChecksumMismatch));
    // The check script deleted the file itself: nothing more is asked.
    assert_eq!(kinds(&log), ["facts", "fetch", "prepare", "send", "check"]);
}

#[test]
fn a_check_that_finds_no_file_or_cannot_run_is_a_send_failure_and_removes_the_file() {
    let (s, log) = supervisor(vec![linux(""), out(0, ""), out(2, "the file is not on the host\n"), out(0, "")]);
    assert_eq!(carry_out_install(&s, RemoteAction::Install, false).0, failed_with(RemoteFailReason::SendFailed, "the file is not on the host"));
    assert_eq!(kinds(&log), ["facts", "fetch", "prepare", "send", "check", "remove"]);
    let (s, log) = supervisor(vec![linux(""), out(0, ""), Err(RemoteRunFailure::TimedOut), out(0, "")]);
    assert_eq!(carry_out_install(&s, RemoteAction::Install, false).0, failed(RemoteFailReason::Timeout));
    assert_eq!(kinds(&log).last(), Some(&"remove"));
}

#[test]
fn an_unpack_that_fails_is_install_failed_with_the_last_lines_and_the_file_is_removed() {
    let many: String = (0..30).map(|n| format!("line {n}\n")).collect();
    let (s, log) = supervisor(vec![linux(""), out(0, ""), out(0, ""), out(1, &many), out(0, "")]);
    let (state, passed) = carry_out_install(&s, RemoteAction::Install, false);
    let RemoteState::Failed { reason: RemoteFailReason::InstallFailed, output: Some(output) } = state else { panic!("{state:?}") };
    assert_eq!(output.lines().count(), 20);
    assert!(output.starts_with("line 10") && output.ends_with("line 29"));
    assert_eq!(kinds(&log), ["facts", "fetch", "prepare", "send", "check", "unpack", "remove"]);
    assert_eq!(passed.last(), Some(&installing(RemoteInstallStage::Unpacking)));
    // A host that printed nothing: no output, not an empty one.
    let (s, _) = supervisor(vec![linux(""), out(0, ""), out(0, ""), out(1, ""), out(0, "")]);
    assert_eq!(carry_out_install(&s, RemoteAction::Install, false).0, failed(RemoteFailReason::InstallFailed));
}

#[test]
fn an_unpack_that_times_out_or_loses_the_connection_keeps_that_reason_and_removes_the_file() {
    for (failure, reason) in [(RemoteRunFailure::TimedOut, RemoteFailReason::Timeout), (RemoteRunFailure::ExecFailed, RemoteFailReason::ExecFailed)] {
        let (s, log) = supervisor(vec![linux(""), out(0, ""), out(0, ""), Err(failure), out(0, "")]);
        assert_eq!(carry_out_install(&s, RemoteAction::Install, false).0, failed(reason));
        assert_eq!(kinds(&log).last(), Some(&"remove"));
    }
}

#[test]
fn a_daemon_that_does_not_start_after_the_install_is_not_healthy_and_the_binary_stays() {
    let (s, log) = supervisor(vec![linux(""), out(0, ""), out(0, ""), out(0, ""), out(1, r#"{"up":false}"#)]);
    assert_eq!(carry_out_install(&s, RemoteAction::Install, false).0, failed(RemoteFailReason::NotHealthy));
    // No prune: the previous version is the way back until a daemon runs from the new one; nothing is removed.
    assert_eq!(kinds(&log), ["facts", "fetch", "prepare", "send", "check", "unpack", "start"]);
}

#[test]
fn a_binary_at_or_above_the_pin_is_started_never_replaced() {
    for version in ["0.0.200", "0.0.201", "1.0.0"] {
        let (s, log) = supervisor(vec![linux(version), out(0, UP), out(0, "")]);
        let (state, passed) = carry_out_install(&s, RemoteAction::Install, false);
        assert_eq!(state, RemoteState::Running, "{version}");
        assert_eq!(kinds(&log), ["facts", "start", "prune"], "{version}: nothing fetched, sent or unpacked");
        assert_eq!(passed, [installing(RemoteInstallStage::Starting)]);
    }
}

#[test]
fn a_binary_older_than_the_pin_is_replaced() {
    let (s, log) = supervisor(vec![linux("0.0.199"), out(0, ""), out(0, ""), out(0, ""), out(0, UP), out(0, "")]);
    assert_eq!(carry_out_install(&s, RemoteAction::Install, false).0, RemoteState::Running);
    assert_eq!(kinds(&log), ["facts", "fetch", "prepare", "send", "check", "unpack", "start", "prune"]);
}

#[test]
fn a_daemon_the_app_reached_gets_no_install() {
    let (s, log) = supervisor(vec![]);
    assert_eq!(carry_out_install(&s, RemoteAction::Install, true), (RemoteState::Running, vec![]));
    assert!(log.lock().unwrap().is_empty(), "no command, no fetch, no send");
    // An outdated one is reported as it is: Update is what replaces it.
    let mut rig = Rig::new(vec![]);
    rig.daemon_version = Some(Some("0.0.100"));
    assert_eq!(carry_out_install(&rig.build().0, RemoteAction::Install, true).0, RemoteState::Outdated { version: "0.0.100".into() });
}

// --- Update ------------------------------------------------------------------------------------------------------

#[test]
fn an_update_installs_the_pin_then_restarts_the_daemon_on_it() {
    let (s, log) = supervisor(vec![linux("0.0.100"), out(0, ""), out(0, ""), out(0, ""), out(0, UP), out(0, "")]);
    let (state, passed) = carry_out_install(&s, RemoteAction::Update, true);
    assert_eq!(state, RemoteState::Running);
    assert_eq!(kinds(&log), ["facts", "fetch", "prepare", "send", "check", "unpack", "restart", "prune"]);
    assert_eq!(passed.last(), Some(&installing(RemoteInstallStage::Starting)));
    assert_eq!(run_commands(&log)[4], "'/home/me/.pi-studio/bin/current/pi-studio' --json -H 127.0.0.1:7878 daemon restart");
}

#[test]
fn an_update_of_a_binary_at_or_above_the_pin_only_restarts() {
    let (s, log) = supervisor(vec![linux("0.0.201"), out(0, UP), out(0, "")]);
    assert_eq!(carry_out_install(&s, RemoteAction::Update, true).0, RemoteState::Running);
    assert_eq!(kinds(&log), ["facts", "restart", "prune"]);
}

#[test]
fn an_update_failure_is_reported_as_an_installs_is() {
    let (s, _) = supervisor(vec![linux("0.0.100"), out(0, ""), out(0, ""), out(1, "tar: not found\n"), out(0, "")]);
    assert_eq!(carry_out_install(&s, RemoteAction::Update, true).0, failed_with(RemoteFailReason::InstallFailed, "tar: not found"));
    let (s, _) = supervisor(vec![linux("0.0.100"), out(0, ""), out(0, ""), out(0, ""), out(1, r#"{"up":false}"#)]);
    assert_eq!(carry_out_install(&s, RemoteAction::Update, true).0, failed(RemoteFailReason::NotHealthy));
}

// --- Pump and logs ------------------------------------------------------------------------------------------------

struct Access {
    batches: Mutex<VecDeque<Vec<RemoteJob>>>,
    progress: Mutex<Vec<(EntryId, RemoteState)>>,
    applied: Mutex<Vec<(EntryId, RemoteState)>>,
}

impl RemoteAccess for Access {
    fn take(&self) -> Vec<RemoteJob> {
        self.batches.lock().unwrap().pop_front().unwrap_or_default()
    }

    fn progress(&self, entry: &EntryId, state: RemoteState) {
        self.progress.lock().unwrap().push((entry.clone(), state));
    }

    fn apply(&self, entry: &EntryId, state: RemoteState) {
        self.applied.lock().unwrap().push((entry.clone(), state));
    }
}

#[test]
fn pump_runs_batches_in_order_reports_the_stages_and_applies_each_outcome() {
    let entry = EntryId::parse(ENTRY).unwrap();
    let job = |action, seen_up| RemoteJob { request: RemoteRequest { entry: entry.clone(), action }, daemon_port: PORT, seen_up };
    let access = Access {
        batches: Mutex::new(VecDeque::from(vec![vec![job(RemoteAction::Probe, true)], vec![job(RemoteAction::Install, false)]])),
        progress: Mutex::default(),
        applied: Mutex::default(),
    };
    let (s, _) = supervisor(happy_replies());
    assert_eq!(s.pump(&access), 2);
    assert_eq!(*access.applied.lock().unwrap(), [(entry.clone(), RemoteState::Running), (entry.clone(), RemoteState::Running)]);
    let stages: Vec<RemoteState> = access
        .progress
        .lock()
        .unwrap()
        .iter()
        .map(|(e, state)| {
            assert_eq!(e, &entry);
            state.clone()
        })
        .collect();
    assert_eq!(stages.first(), Some(&installing(RemoteInstallStage::Downloading)));
    assert_eq!(stages.last(), Some(&installing(RemoteInstallStage::Starting)));
    assert_eq!(s.pump(&access), 0);
}

#[test]
fn the_limits_are_the_specified_ones() {
    let limits = RemoteLimits::default();
    assert_eq!(limits.facts, Duration::from_secs(15));
    assert_eq!(limits.unpack, Duration::from_secs(120));
    assert_eq!(limits.stall, Duration::from_secs(60));
    assert_eq!(limits.start, Duration::from_secs(90));
}

#[test]
fn what_the_host_printed_reaches_no_log_line() {
    use std::sync::atomic::{AtomicBool, Ordering};

    // A logger that fails the test when a record holds the marker the host printed.
    struct Watch(AtomicBool);
    impl log::Log for Watch {
        fn enabled(&self, _: &log::Metadata) -> bool {
            true
        }

        fn log(&self, record: &log::Record) {
            if format!("{}", record.args()).contains("HOST-SECRET") {
                self.0.store(true, Ordering::SeqCst);
            }
        }

        fn flush(&self) {}
    }
    static WATCH: Watch = Watch(AtomicBool::new(false));
    // Another test may have set a logger; then the watch below sees nothing and the test still checks the state.
    let _ = log::set_logger(&WATCH);
    log::set_max_level(log::LevelFilter::Trace);
    let (s, _) = supervisor(vec![linux(""), out(0, ""), out(0, ""), out(1, "HOST-SECRET in the unpack output\n"), out(0, "")]);
    let state = s.carry_out(RemoteAction::Install, PORT, false);
    assert!(matches!(&state, RemoteState::Failed { output: Some(text), .. } if text.contains("HOST-SECRET")), "the screen gets the words");
    assert!(!WATCH.0.load(Ordering::SeqCst), "the log does not");
}

// --- A sandbox host, really run by `/bin/sh` ---------------------------------------------------------------------------

#[cfg(unix)]
mod sandbox {
    use std::fs;
    use std::os::unix::fs::PermissionsExt as _;
    use std::process::Command;

    use super::*;

    /// A program that answers `version` to `--version` and a healthy answer to `daemon start` and `daemon restart`.
    fn program_text(version: &str) -> String {
        format!("#!/bin/sh\ncase \"$*\" in\n  *--version*) echo {version};;\n  *\"daemon start\"*|*\"daemon restart\"*) echo '{UP}';;\nesac\n")
    }

    fn write_program(dir: &Path, text: &str) {
        fs::create_dir_all(dir).unwrap();
        let path = dir.join("pi-studio");
        fs::write(&path, text).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    /// A pinned archive holding `text` as the program, at `<dir>/linux-x64.tar.gz`.
    fn make_archive(dir: &Path, text: &str) -> PathBuf {
        let stage = tempfile::tempdir().unwrap();
        write_program(&stage.path().join("pi-studio-0.0.200-linux-x64"), text);
        let archive = dir.join("linux-x64.tar.gz");
        fs::create_dir_all(dir).unwrap();
        assert!(Command::new("tar").arg("-czf").arg(&archive).arg("-C").arg(stage.path()).arg(".").status().unwrap().success());
        archive
    }

    struct Sandbox {
        dir: tempfile::TempDir,
        /// Whether the next send breaks after half the file.
        break_send: Arc<Mutex<bool>>,
        /// Whether the connection is gone: every run fails.
        cut: Arc<Mutex<bool>>,
        log: Log,
        supervisor: RemoteSupervisor,
    }

    impl Sandbox {
        fn new(program: &str) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let archive = make_archive(&dir.path().join("archives"), program);
            // A `uname` and an `ldd` that say Linux x86_64 with glibc, whatever machine this runs on.
            let tools = dir.path().join("tools");
            fs::create_dir_all(&tools).unwrap();
            for (name, text) in
                [("uname", "#!/bin/sh\ncase \"$1\" in -s) echo Linux;; -m) echo x86_64;; esac\n"), ("ldd", "#!/bin/sh\necho 'ldd (GNU libc) 2.39'\n")]
            {
                let path = tools.join(name);
                fs::write(&path, text).unwrap();
                fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
            }
            let home = dir.path().join("host home/.pi-studio");
            let (log, break_send, cut): (Log, Arc<Mutex<bool>>, Arc<Mutex<bool>>) = (Arc::default(), Arc::default(), Arc::default());
            let run: RemoteRunHook = {
                let (log, cut, home, path) =
                    (Arc::clone(&log), Arc::clone(&cut), home.clone(), format!("{}:{}", tools.display(), std::env::var("PATH").unwrap_or_default()));
                Arc::new(move |command, limit| {
                    log.lock().unwrap().push(Event::Run(command.to_owned(), limit));
                    if *cut.lock().unwrap() {
                        return Err(RemoteRunFailure::ExecFailed);
                    }
                    let output = Command::new("/bin/sh")
                        .arg("-c")
                        .arg(command)
                        .env("PI_STUDIO_HOME", &home)
                        .env("PATH", &path)
                        .output()
                        .map_err(|_| RemoteRunFailure::ExecFailed)?;
                    Ok(RemoteOutput { status: output.status.code().unwrap_or(-1), stdout: String::from_utf8_lossy(&output.stdout).into_owned() })
                })
            };
            let send: RemoteSendHook = {
                let (log, break_send) = (Arc::clone(&log), Arc::clone(&break_send));
                Arc::new(move |path, source, size, stall, progress| {
                    log.lock().unwrap().push(Event::Send { path: path.to_owned(), size, stall });
                    let bytes = fs::read(source).map_err(|_| RemoteSendFailure::Failed)?;
                    if std::mem::take(&mut *break_send.lock().unwrap()) {
                        fs::write(path, &bytes[..bytes.len() / 2]).map_err(|_| RemoteSendFailure::Failed)?;
                        return Err(RemoteSendFailure::Failed);
                    }
                    fs::write(path, &bytes).map_err(|_| RemoteSendFailure::Rejected)?;
                    progress(size);
                    Ok(())
                })
            };
            let size = fs::metadata(&archive).unwrap().len();
            let archives = FakeArchives { fetched: Ok(()), pieces: vec![], path: archive.clone(), size, log: Arc::clone(&log) };
            let archives = SandboxArchives { inner: archives, sha256: sha256_of(&archive) };
            let services = Services { remote_run: Some(run), remote_send: Some(send), archives: Some(Arc::new(archives)), ..Services::default() };
            Sandbox { dir, break_send, cut, log, supervisor: RemoteSupervisor::new(services, RemoteLimits::default()) }
        }

        fn bin(&self) -> PathBuf {
            self.dir.path().join("host home/.pi-studio/bin")
        }

        fn names(&self, of: &str) -> Vec<String> {
            let mut names: Vec<String> =
                fs::read_dir(self.bin().join(of)).map(|d| d.map(|e| e.unwrap().file_name().into_string().unwrap()).collect()).unwrap_or_default();
            names.sort();
            names
        }

        fn current(&self) -> Option<String> {
            let out = Command::new(self.bin().join("current/pi-studio")).arg("--version").output().ok()?;
            Some(String::from_utf8_lossy(&out.stdout).trim().to_owned())
        }
    }

    fn sha256_of(path: &Path) -> String {
        let out = Command::new("sha256sum").arg(path).output().or_else(|_| Command::new("shasum").args(["-a", "256"]).arg(path).output()).unwrap();
        String::from_utf8_lossy(&out.stdout).split_whitespace().next().unwrap().to_owned()
    }

    /// The fake archive source with the real file's hash.
    struct SandboxArchives {
        inner: FakeArchives,
        sha256: String,
    }

    impl ArchiveSource for SandboxArchives {
        fn version(&self) -> &str {
            PIN
        }

        fn fetch(&self, target: &str, progress: &mut dyn FnMut(u64, u64)) -> Result<Archive, FetchFailure> {
            self.inner.fetch(target, progress).map(|archive| Archive { sha256: self.sha256.clone(), ..archive })
        }
    }

    #[test]
    fn a_host_with_nothing_installed_gets_the_binary_and_a_running_daemon() {
        let sandbox = Sandbox::new(&program_text(PIN));
        assert_eq!(sandbox.supervisor.carry_out(RemoteAction::Probe, PORT, false), RemoteState::NotInstalled);
        let (state, passed) = carry_out_install(&sandbox.supervisor, RemoteAction::Install, false);
        assert_eq!(state, RemoteState::Running);
        assert_eq!(sandbox.current().as_deref(), Some(PIN));
        assert_eq!(sandbox.names("versions"), [PIN]);
        assert_eq!(sandbox.names("tmp"), Vec::<String>::new(), "no temporary file is left");
        let stages: Vec<RemoteInstallStage> =
            passed.iter().filter_map(|state| if let RemoteState::Installing { stage, .. } = state { Some(*stage) } else { None }).collect();
        assert_eq!(stages.first(), Some(&RemoteInstallStage::Downloading));
        assert_eq!(stages.last(), Some(&RemoteInstallStage::Starting));
        assert!(stages.contains(&RemoteInstallStage::Sending) && stages.contains(&RemoteInstallStage::Unpacking));
        // The binary is there now: a probe finds it, and Start runs it by its path.
        assert_eq!(sandbox.supervisor.carry_out(RemoteAction::Probe, PORT, false), RemoteState::Stopped);
        assert_eq!(sandbox.supervisor.carry_out(RemoteAction::Start, PORT, false), RemoteState::Running);
        // Asked again: a binary at the pin is started, not sent again.
        let sends = || sandbox.log.lock().unwrap().iter().filter(|e| matches!(e, Event::Send { .. })).count();
        assert_eq!(sends(), 1);
        assert_eq!(carry_out_install(&sandbox.supervisor, RemoteAction::Install, false).0, RemoteState::Running);
        assert_eq!(sends(), 1);
    }

    #[test]
    fn a_version_that_is_present_only_switches_the_link() {
        let sandbox = Sandbox::new(&program_text(PIN));
        // The pin is in `versions/` already and an older one is current.
        write_program(&sandbox.bin().join("versions").join(PIN), &program_text(PIN));
        fs::write(sandbox.bin().join("versions").join(PIN).join("marker"), "mine").unwrap();
        write_program(&sandbox.bin().join("versions/0.0.100"), &program_text("0.0.100"));
        std::os::unix::fs::symlink("versions/0.0.100", sandbox.bin().join("current")).unwrap();
        assert_eq!(carry_out_install(&sandbox.supervisor, RemoteAction::Install, false).0, RemoteState::Running);
        assert_eq!(sandbox.current().as_deref(), Some(PIN));
        assert!(sandbox.bin().join("versions").join(PIN).join("marker").exists(), "the folder was not replaced");
        assert_eq!(sandbox.names("tmp"), Vec::<String>::new());
        // The old one is the way back; anything older would be pruned.
        assert_eq!(sandbox.names("versions"), ["0.0.100", PIN]);
    }

    #[test]
    fn a_newer_binary_is_started_and_not_replaced() {
        let sandbox = Sandbox::new(&program_text(PIN));
        write_program(&sandbox.bin().join("versions/0.0.250"), &program_text("0.0.250"));
        std::os::unix::fs::symlink("versions/0.0.250", sandbox.bin().join("current")).unwrap();
        assert_eq!(carry_out_install(&sandbox.supervisor, RemoteAction::Install, false).0, RemoteState::Running);
        assert_eq!(sandbox.current().as_deref(), Some("0.0.250"));
        assert_eq!(sandbox.names("versions"), ["0.0.250"]);
        assert!(!sandbox.log.lock().unwrap().iter().any(|e| matches!(e, Event::Send { .. } | Event::Fetch(_))));
    }

    #[test]
    fn a_program_that_does_not_run_on_the_host_leaves_nothing_and_says_why() {
        let sandbox = Sandbox::new("#!/bin/sh\necho 'GLIBC_2.99 not found' >&2\nexit 1\n");
        let (state, _) = carry_out_install(&sandbox.supervisor, RemoteAction::Install, false);
        let RemoteState::Failed { reason: RemoteFailReason::InstallFailed, output: Some(output) } = state else { panic!("{state:?}") };
        assert!(output.contains("GLIBC_2.99 not found"), "{output}");
        assert_eq!(sandbox.names("tmp"), Vec::<String>::new());
        assert_eq!(sandbox.names("versions"), Vec::<String>::new());
        assert!(!sandbox.bin().join("current").exists());
        assert_eq!(sandbox.supervisor.carry_out(RemoteAction::Probe, PORT, false), RemoteState::NotInstalled);
    }

    #[test]
    fn a_connection_cut_during_the_send_is_send_failed_and_the_retry_leaves_no_temporary_file() {
        let sandbox = Sandbox::new(&program_text(PIN));
        *sandbox.break_send.lock().unwrap() = true;
        // The send breaks after half the file, and the connection is gone, so the file cannot be removed.
        let broken = Arc::clone(&sandbox.cut);
        let cutting: RemoteSendHook = {
            let inner = sandbox.supervisor.services.remote_send.clone().unwrap();
            Arc::new(move |path, source, size, stall, progress| {
                let result = inner(path, source, size, stall, progress);
                if result.is_err() {
                    *broken.lock().unwrap() = true;
                }
                result
            })
        };
        let supervisor = RemoteSupervisor::new(Services { remote_send: Some(cutting), ..sandbox.supervisor.services.clone() }, RemoteLimits::default());
        assert_eq!(carry_out_install(&supervisor, RemoteAction::Install, false).0, failed(RemoteFailReason::SendFailed));
        let partial = sandbox.names("tmp");
        assert_eq!(partial.len(), 1, "half a file is left: {partial:?}");
        // The connection is back: Retry installs and the partial file is gone.
        *sandbox.cut.lock().unwrap() = false;
        assert_eq!(carry_out_install(&supervisor, RemoteAction::Install, false).0, RemoteState::Running);
        assert_eq!(sandbox.names("tmp"), Vec::<String>::new(), "no temporary file is left");
        assert_eq!(sandbox.current().as_deref(), Some(PIN));
    }

    #[test]
    fn an_update_replaces_an_older_binary_and_restarts_on_the_new_one() {
        let sandbox = Sandbox::new(&program_text(PIN));
        write_program(&sandbox.bin().join("versions/0.0.100"), &program_text("0.0.100"));
        std::os::unix::fs::symlink("versions/0.0.100", sandbox.bin().join("current")).unwrap();
        assert_eq!(carry_out_install(&sandbox.supervisor, RemoteAction::Update, true).0, RemoteState::Running);
        assert_eq!(sandbox.current().as_deref(), Some(PIN));
        assert!(run_commands(&sandbox.log).iter().any(|c| c.ends_with("daemon restart")));
        assert_eq!(kinds(&sandbox.log).last(), Some(&"prune"));
    }
}
