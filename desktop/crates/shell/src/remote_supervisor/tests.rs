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
    RemoteState::Failed { reason }
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
