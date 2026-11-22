//! The remote daemon's supervisor: carries out what the engine queued for the current SSH entry
//! (`pistudiodesktop_engine::RemoteRequest`) with `pi-studio` on the host, through the
//! [`Services::remote_run`] hook the app fills. The shell holds no socket.
//!
//! Like the local [`crate::supervisor`], nothing here touches the session while a command runs:
//! [`RemoteSupervisor::carry_out`] takes plain values and returns the state reached, and the session
//! is reached through [`RemoteAccess`] for the instant of taking a batch or applying an outcome.
//! Commands never overlap: one at a time, in the order asked.
//!
//! Nothing the host prints is logged or kept: a log line names the action and the code of its
//! outcome. A `pairingUrl` never leaves [`crate::cli_answers`].

use std::sync::Mutex;
use std::time::Duration;

use pistudiodesktop_engine::{RemoteAction, RemoteRequest};
use pistudiodesktop_model::{EntryId, RemoteFailReason, RemoteState};

use crate::cli_answers::{self, Answer, Command, Failure, VersionCheck};
use crate::services::{RemoteRunFailure, Services};

/// Time limit of the version command on the host (a login shell may be slow to start).
pub const REMOTE_VERSION_TIMEOUT: Duration = Duration::from_secs(15);
/// Time limit of `daemon start` on the host.
pub const REMOTE_START_TIMEOUT: Duration = cli_answers::START_TIMEOUT;
/// The shell's exit status for a command it did not find.
const COMMAND_NOT_FOUND: i32 = 127;
/// The version command, as typed on the host.
const VERSION_COMMAND: &str = "pi-studio --version";

/// The time limit of every remote command. The defaults are the constants above; tests shorten them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RemoteLimits {
    pub version: Duration,
    pub start: Duration,
}

impl Default for RemoteLimits {
    fn default() -> Self {
        Self { version: REMOTE_VERSION_TIMEOUT, start: REMOTE_START_TIMEOUT }
    }
}

/// One queued request with what the host needs to carry it out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteJob {
    pub request: RemoteRequest,
    /// The daemon's port on the host (`SshFields::daemon_port`), given to `daemon start` as `-H`.
    pub daemon_port: u16,
    /// Whether the app's last open of the daemon connected, which a probe reports as `running`
    /// (a failed open with `daemon_not_running` reports `stopped`).
    pub seen_up: bool,
}

/// The short moments the supervisor needs the session; the app implements it over its owner thread.
pub trait RemoteAccess {
    /// The requests queued since the last call.
    fn take(&self) -> Vec<RemoteJob>;
    /// Store the state a request reached for `entry`.
    fn apply(&self, entry: &EntryId, state: RemoteState);
}

/// Runs the CLI on the SSH host.
pub struct RemoteSupervisor {
    services: Services,
    limits: RemoteLimits,
    /// Held for the whole of a request: commands never overlap.
    gate: Mutex<()>,
}

fn failed(reason: RemoteFailReason) -> RemoteState {
    RemoteState::Failed { reason }
}

fn fail_of(failure: RemoteRunFailure) -> RemoteFailReason {
    match failure {
        RemoteRunFailure::ExecFailed => RemoteFailReason::ExecFailed,
        RemoteRunFailure::NoShell => RemoteFailReason::NoShell,
        RemoteRunFailure::TimedOut => RemoteFailReason::Timeout,
    }
}

fn start_command(daemon_port: u16) -> String {
    format!("pi-studio --json -H 127.0.0.1:{daemon_port} daemon start")
}

impl RemoteSupervisor {
    pub fn new(services: Services, limits: RemoteLimits) -> Self {
        Self { services, limits, gate: Mutex::new(()) }
    }

    /// Carry out one request and say what state it reached. Blocks until the host answers or the
    /// limit passes; whoever calls it must not be the thread that owns the session.
    pub fn carry_out(&self, action: RemoteAction, daemon_port: u16, seen_up: bool) -> RemoteState {
        let _one_at_a_time = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        let state = self.carry_out_in(action, daemon_port, seen_up);
        log::info!("remote daemon: {action:?} gave {}", state_name(&state));
        state
    }

    fn carry_out_in(&self, action: RemoteAction, daemon_port: u16, seen_up: bool) -> RemoteState {
        // Both actions begin with the version command: a probe's answer, and Start's check.
        if let Some(state) = self.check_cli() {
            return state;
        }
        match action {
            RemoteAction::Probe => {
                if seen_up {
                    RemoteState::Running
                } else {
                    RemoteState::Stopped
                }
            }
            RemoteAction::Start => self.start(daemon_port),
        }
    }

    /// `None` when the CLI is installed and recent enough; otherwise the state that says why not.
    fn check_cli(&self) -> Option<RemoteState> {
        let out = match self.run(VERSION_COMMAND, self.limits.version) {
            Ok(out) => out,
            Err(failure) => return Some(failed(fail_of(failure))),
        };
        if out.status == COMMAND_NOT_FOUND {
            return Some(RemoteState::NotInstalled);
        }
        match cli_answers::check_version(&out.stdout) {
            VersionCheck::Ok => None,
            VersionCheck::Outdated { version } => Some(RemoteState::CliOutdated { version }),
            VersionCheck::BadOutput => Some(failed(RemoteFailReason::BadOutput)),
        }
    }

    /// The answer is read whatever the exit status (`daemon start` exits non-zero while healthy).
    fn start(&self, daemon_port: u16) -> RemoteState {
        let out = match self.run(&start_command(daemon_port), self.limits.start) {
            Ok(out) => out,
            Err(failure) => return failed(fail_of(failure)),
        };
        match cli_answers::parse_answer(Command::Start, &out.stdout) {
            Answer::Running { .. } => RemoteState::Running,
            Answer::Stopped | Answer::Failed(Failure::BadOutput) => failed(RemoteFailReason::BadOutput),
            Answer::Failed(Failure::NotHealthy) => failed(RemoteFailReason::NotHealthy),
        }
    }

    fn run(&self, command: &str, limit: Duration) -> Result<crate::services::RemoteOutput, RemoteRunFailure> {
        let run = self.services.remote_run.as_ref().ok_or(RemoteRunFailure::ExecFailed)?;
        run(command, limit)
    }

    /// Carry out every queued request, one after the other, and apply each outcome, until nothing
    /// is queued. Returns how many were carried out.
    pub fn pump(&self, access: &dyn RemoteAccess) -> usize {
        let mut done = 0;
        loop {
            let jobs = access.take();
            if jobs.is_empty() {
                return done;
            }
            for job in jobs {
                let state = self.carry_out(job.request.action, job.daemon_port, job.seen_up);
                access.apply(&job.request.entry, state);
                done += 1;
            }
        }
    }
}

/// The state's name for a log line.
fn state_name(state: &RemoteState) -> &'static str {
    match state {
        RemoteState::Unknown => "unknown",
        RemoteState::Checking => "checking",
        RemoteState::Running => "running",
        RemoteState::Stopped => "stopped",
        RemoteState::NotInstalled => "not_installed",
        RemoteState::CliOutdated { .. } => "cli_outdated",
        RemoteState::Starting => "starting",
        RemoteState::Failed { reason } => reason.code(),
    }
}

#[cfg(test)]
mod tests;
