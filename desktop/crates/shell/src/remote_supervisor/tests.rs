//! The remote supervisor against a scripted hook: no SSH, no clock.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use pistudiodesktop_engine::{RemoteAction, RemoteRequest};
use pistudiodesktop_model::{EntryId, RemoteFailReason, RemoteState};

use super::{RemoteAccess, RemoteJob, RemoteLimits, RemoteSupervisor};
use crate::services::{RemoteOutput, RemoteRunFailure, RemoteRunHook, Services};

type Reply = Result<RemoteOutput, RemoteRunFailure>;
type Calls = Arc<Mutex<Vec<(String, Duration)>>>;

const ENTRY: &str = "123e4567-e89b-12d3-a456-426614174000";
const PORT: u16 = 7878;

fn out(status: i32, stdout: &str) -> Reply {
    Ok(RemoteOutput { status, stdout: stdout.to_owned() })
}

/// A supervisor whose hook answers with `replies` in order and records every call.
fn scripted(replies: Vec<Reply>) -> (RemoteSupervisor, Calls) {
    let calls: Calls = Arc::default();
    let queue = Arc::new(Mutex::new(VecDeque::from(replies)));
    let seen = Arc::clone(&calls);
    let hook: RemoteRunHook = Arc::new(move |command, limit| {
        seen.lock().unwrap().push((command.to_owned(), limit));
        queue.lock().unwrap().pop_front().unwrap_or(Err(RemoteRunFailure::ExecFailed))
    });
    let services = Services { remote_run: Some(hook), ..Services::default() };
    (RemoteSupervisor::new(services, RemoteLimits::default()), calls)
}

fn commands(calls: &Calls) -> Vec<String> {
    calls.lock().unwrap().iter().map(|(c, _)| c.clone()).collect()
}

fn failed(reason: RemoteFailReason) -> RemoteState {
    RemoteState::Failed { reason, output: None }
}

const UP: &str = r#"{"up":true,"host":"127.0.0.1","port":7878}"#;

#[test]
fn probe_reports_running_or_stopped_by_what_the_open_saw() {
    let (s, calls) = scripted(vec![out(0, "0.0.130\n"), out(0, "v0.0.127")]);
    assert_eq!(s.carry_out(RemoteAction::Probe, PORT, true), RemoteState::Running);
    assert_eq!(s.carry_out(RemoteAction::Probe, PORT, false), RemoteState::Stopped);
    assert_eq!(commands(&calls), ["pi-studio --version", "pi-studio --version"]);
    assert_eq!(calls.lock().unwrap()[0].1, Duration::from_secs(15));
}

#[test]
fn probe_not_installed_outdated_and_bad_output() {
    let (s, _) = scripted(vec![out(127, "pi-studio: command not found"), out(0, "0.0.126"), out(0, "banana"), out(1, "")]);
    assert_eq!(s.carry_out(RemoteAction::Probe, PORT, true), RemoteState::NotInstalled);
    assert_eq!(s.carry_out(RemoteAction::Probe, PORT, true), RemoteState::CliOutdated { version: "0.0.126".into() });
    assert_eq!(s.carry_out(RemoteAction::Probe, PORT, true), failed(RemoteFailReason::BadOutput));
    assert_eq!(s.carry_out(RemoteAction::Probe, PORT, true), failed(RemoteFailReason::BadOutput));
}

#[test]
fn start_checks_the_version_then_starts_on_the_entry_port_with_90_seconds() {
    let (s, calls) = scripted(vec![out(0, "0.0.130"), out(0, &format!("log line\n{UP}\n"))]);
    assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), RemoteState::Running);
    assert_eq!(commands(&calls), ["pi-studio --version", "pi-studio --json -H 127.0.0.1:7878 daemon start"]);
    assert_eq!(calls.lock().unwrap()[1].1, Duration::from_secs(90));
}

#[test]
fn start_reads_the_answer_whatever_the_exit_status() {
    let (s, _) = scripted(vec![out(0, "0.0.130"), out(1, r#"{"up":true,"host":"h","port":1,"error":"no_keypair"}"#)]);
    assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), RemoteState::Running);
}

#[test]
fn start_failures() {
    let (s, _) =
        scripted(vec![out(0, "0.0.130"), out(1, r#"{"up":false}"#), out(0, "0.0.130"), out(0, "garbage"), out(0, "0.0.130"), out(0, r#"{"stopped":true}"#)]);
    assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), failed(RemoteFailReason::NotHealthy));
    assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), failed(RemoteFailReason::BadOutput));
    assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), failed(RemoteFailReason::BadOutput));
}

#[test]
fn start_stops_at_a_missing_or_old_cli() {
    let (s, calls) = scripted(vec![out(127, ""), out(0, "0.0.1")]);
    assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), RemoteState::NotInstalled);
    assert_eq!(s.carry_out(RemoteAction::Start, PORT, false), RemoteState::CliOutdated { version: "0.0.1".into() });
    assert_eq!(commands(&calls).len(), 2, "no start was sent");
}

#[test]
fn hook_failures_map_to_reasons() {
    for (failure, reason) in [
        (RemoteRunFailure::NoShell, RemoteFailReason::NoShell),
        (RemoteRunFailure::ExecFailed, RemoteFailReason::ExecFailed),
        (RemoteRunFailure::TimedOut, RemoteFailReason::Timeout),
    ] {
        let (s, _) = scripted(vec![Err(failure)]);
        assert_eq!(s.carry_out(RemoteAction::Probe, PORT, true), failed(reason));
        let (s, _) = scripted(vec![out(0, "0.0.130"), Err(failure)]);
        assert_eq!(s.carry_out(RemoteAction::Start, PORT, true), failed(reason));
    }
}

#[test]
fn the_start_limit_is_the_ninety_second_one() {
    assert_eq!(RemoteLimits::default().start, Duration::from_secs(90));
    assert_eq!(RemoteLimits::default().version, Duration::from_secs(15));
}

#[test]
fn without_a_hook_everything_is_exec_failed() {
    let s = RemoteSupervisor::new(Services::default(), RemoteLimits::default());
    assert_eq!(s.carry_out(RemoteAction::Probe, PORT, true), failed(RemoteFailReason::ExecFailed));
}

#[test]
fn a_pairing_url_is_not_kept_or_shown() {
    let secret = "pi://SECRET-TOKEN-123";
    let answer = format!(r#"{{"up":true,"host":"h","port":3,"pairingUrl":"{secret}"}}"#);
    let (s, _) = scripted(vec![out(0, "0.0.130"), out(0, &answer)]);
    let state = s.carry_out(RemoteAction::Start, PORT, false);
    assert_eq!(state, RemoteState::Running);
    assert!(!format!("{state:?}").contains("SECRET"));
    assert!(!format!("{:?}", RemoteOutput { status: 0, stdout: answer }).contains("SECRET"));
}

struct Access {
    batches: Mutex<VecDeque<Vec<RemoteJob>>>,
    applied: Mutex<Vec<(EntryId, RemoteState)>>,
}

impl RemoteAccess for Access {
    fn take(&self) -> Vec<RemoteJob> {
        self.batches.lock().unwrap().pop_front().unwrap_or_default()
    }

    fn apply(&self, entry: &EntryId, state: RemoteState) {
        self.applied.lock().unwrap().push((entry.clone(), state));
    }
}

#[test]
fn pump_runs_batches_in_order_and_applies_each_outcome() {
    let entry = EntryId::parse(ENTRY).unwrap();
    let job = |action, seen_up| RemoteJob { request: RemoteRequest { entry: entry.clone(), action }, daemon_port: PORT, seen_up };
    let access = Access {
        batches: Mutex::new(VecDeque::from(vec![vec![job(RemoteAction::Probe, true)], vec![job(RemoteAction::Start, false)]])),
        applied: Mutex::default(),
    };
    let (s, _) = scripted(vec![out(0, "0.0.130"), out(0, "0.0.130"), out(0, UP)]);
    assert_eq!(s.pump(&access), 2);
    assert_eq!(*access.applied.lock().unwrap(), [(entry.clone(), RemoteState::Running), (entry, RemoteState::Running)]);
    assert_eq!(s.pump(&access), 0);
}

fn update_failed(output: &str) -> RemoteState {
    RemoteState::Failed { reason: RemoteFailReason::UpdateFailed, output: Some(output.to_owned()) }
}

#[test]
fn update_runs_the_update_then_the_version_then_the_start() {
    let (s, calls) = scripted(vec![out(0, "updated\n"), out(0, "0.0.130"), out(0, UP)]);
    assert_eq!(s.carry_out(RemoteAction::Update, PORT, false), RemoteState::Running);
    assert_eq!(commands(&calls), ["pi-studio -H 127.0.0.1:7878 update 2>&1", "pi-studio --version", "pi-studio --json -H 127.0.0.1:7878 daemon start"]);
    let limits: Vec<Duration> = calls.lock().unwrap().iter().map(|(_, l)| *l).collect();
    assert_eq!(limits, [Duration::from_secs(300), Duration::from_secs(15), Duration::from_secs(90)]);
}

#[test]
fn a_failed_update_keeps_the_last_lines_of_its_output() {
    let many: String = (0..30).map(|n| format!("line {n}\n")).collect();
    let (s, calls) = scripted(vec![out(1, &many), out(243, "")]);
    let state = s.carry_out(RemoteAction::Update, PORT, false);
    let RemoteState::Failed { reason: RemoteFailReason::UpdateFailed, output: Some(output) } = state else { panic!("{state:?}") };
    assert_eq!(output.lines().count(), 20);
    assert!(output.starts_with("line 10") && output.ends_with("line 29"));
    assert_eq!(commands(&calls).len(), 1, "no version check or start after a failed update");
    assert_eq!(s.carry_out(RemoteAction::Update, PORT, false), update_failed(""));
}

#[test]
fn an_update_that_leaves_the_cli_outdated_or_missing_stops_there() {
    let (s, calls) = scripted(vec![out(0, ""), out(0, "0.0.126"), out(0, ""), out(127, "")]);
    assert_eq!(s.carry_out(RemoteAction::Update, PORT, false), RemoteState::CliOutdated { version: "0.0.126".into() });
    assert_eq!(s.carry_out(RemoteAction::Update, PORT, false), RemoteState::NotInstalled);
    assert_eq!(commands(&calls).iter().filter(|c| c.contains("daemon start")).count(), 0);
}

#[test]
fn an_update_that_times_out_or_cannot_run() {
    let (s, calls) = scripted(vec![Err(RemoteRunFailure::TimedOut), Err(RemoteRunFailure::NoShell), Err(RemoteRunFailure::ExecFailed)]);
    assert_eq!(s.carry_out(RemoteAction::Update, PORT, false), update_failed("`pi-studio update` took too long and was stopped"));
    assert_eq!(s.carry_out(RemoteAction::Update, PORT, false), failed(RemoteFailReason::NoShell));
    assert_eq!(s.carry_out(RemoteAction::Update, PORT, false), failed(RemoteFailReason::ExecFailed));
    assert_eq!(commands(&calls).len(), 3);
}

#[test]
fn a_start_failure_after_an_update_is_reported_as_start_failures_are() {
    let (s, _) = scripted(vec![out(0, ""), out(0, "0.0.130"), out(1, r#"{"up":false}"#)]);
    assert_eq!(s.carry_out(RemoteAction::Update, PORT, false), failed(RemoteFailReason::NotHealthy));
}

#[test]
fn the_update_limit_is_five_minutes() {
    assert_eq!(RemoteLimits::default().update, Duration::from_secs(300));
}
