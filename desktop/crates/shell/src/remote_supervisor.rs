//! The remote daemon's supervisor: carries out what the engine queued for the current SSH entry
//! (`pistudiodesktop_engine::RemoteRequest`) on the host, through the hooks the app fills
//! ([`Services::remote_run`], [`Services::remote_send`], [`Services::archives`],
//! [`Services::remote_daemon_version`]). The shell holds no socket.
//! (`swe/features/desktop-ssh-daemon-install.md`.)
//!
//! Like the local [`crate::supervisor`], nothing here touches the session while a command runs:
//! [`RemoteSupervisor::carry_out_reporting`] takes plain values and returns the state reached, and the session is
//! reached through [`RemoteAccess`] for the instant of taking a batch, storing a state a request passes through
//! (the install's stages) or applying an outcome. Commands never overlap: one at a time, in the order asked (R9).
//!
//! What runs on the host is the binary the app installed, by its absolute path (R6): `<folder>/bin/current/pi-studio`,
//! where the folder is `$PI_STUDIO_HOME` or `~/.pi-studio` as the host's login shell sees them, read by one facts
//! script ([`scripts`]). A host with only the npm CLI is `not_installed` once its daemon stops (D15). An install
//! happens only for an Install or an Update, which only a click begins (D10).
//!
//! Nothing the host prints is logged or kept but, for `install_failed` and `send_failed`, its last lines in the
//! state: a log line names the action and the code of its outcome. A `pairingUrl` never leaves [`crate::cli_answers`].

use std::sync::Mutex;
use std::time::{Duration, Instant};

use pistudiodesktop_engine::{RemoteAction, RemoteRequest};
use pistudiodesktop_model::{EntryId, RemoteFailReason, RemoteInstallStage, RemoteState};

use crate::cli_answers::{self, Answer, Command, Failure};
use crate::services::{ArchiveSource, FetchFailure, RemoteOutput, RemoteRunFailure, RemoteSendFailure, Services};

mod scripts;

/// Time limit of the facts script on the host (a login shell may be slow to start).
pub const REMOTE_FACTS_TIMEOUT: Duration = Duration::from_secs(15);
/// Time limit of the short steps on the host: making the folder, removing a file, pruning.
pub const REMOTE_STEP_TIMEOUT: Duration = Duration::from_secs(30);
/// Time limit of the check of the sent file (a SHA-256 of a file of tens of megabytes on a slow host).
pub const REMOTE_CHECK_TIMEOUT: Duration = Duration::from_secs(60);
/// Time limit of the unpack script (R5).
pub const REMOTE_UNPACK_TIMEOUT: Duration = Duration::from_secs(120);
/// Time limit of `daemon start` and `daemon restart` on the host.
pub const REMOTE_START_TIMEOUT: Duration = cli_answers::START_TIMEOUT;
/// How long the send may go without the host taking a byte (R3); there is no total limit.
pub const REMOTE_SEND_STALL: Duration = Duration::from_secs(60);
/// The most often progress is stored in the session: the page redraws on every change.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);
/// How many files of failed attempts the supervisor remembers to remove at the next install.
const MAX_LEFTOVERS: usize = 16;

/// The time limit of every remote command. The defaults are the constants above; tests shorten them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RemoteLimits {
    pub facts: Duration,
    pub step: Duration,
    pub check: Duration,
    pub unpack: Duration,
    pub start: Duration,
    pub stall: Duration,
}

impl Default for RemoteLimits {
    fn default() -> Self {
        Self {
            facts: REMOTE_FACTS_TIMEOUT,
            step: REMOTE_STEP_TIMEOUT,
            check: REMOTE_CHECK_TIMEOUT,
            unpack: REMOTE_UNPACK_TIMEOUT,
            start: REMOTE_START_TIMEOUT,
            stall: REMOTE_SEND_STALL,
        }
    }
}

/// One queued request with what the host needs to carry it out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteJob {
    pub request: RemoteRequest,
    /// The daemon's port on the host (`SshFields::daemon_port`), given to `daemon start` as `-H`.
    pub daemon_port: u16,
    /// Whether the app's last open of the daemon connected, which a probe reports as `running` (a failed open
    /// with `daemon_not_running` reports `stopped`), and which an Install takes as a daemon to leave alone.
    pub seen_up: bool,
}

/// The short moments the supervisor needs the session; the app implements it over its owner thread.
pub trait RemoteAccess {
    /// The requests queued since the last call.
    fn take(&self) -> Vec<RemoteJob>;
    /// Store a state a request passes through (the stages of an install): the session stays busy.
    fn progress(&self, entry: &EntryId, state: RemoteState);
    /// Store the state a request reached for `entry`.
    fn apply(&self, entry: &EntryId, state: RemoteState);
}

/// Installs and runs the daemon's binary on the SSH host.
pub struct RemoteSupervisor {
    services: Services,
    limits: RemoteLimits,
    /// Held for the whole of a request: commands never overlap.
    gate: Mutex<()>,
    /// Bases (`scripts::temp_base`) of the files of attempts whose removal could not be asked of the host (the
    /// connection was gone): the next install removes them first.
    leftovers: Mutex<Vec<String>>,
}

fn failed(reason: RemoteFailReason) -> RemoteState {
    RemoteState::Failed { reason, output: None }
}

/// A failure with the last lines the host printed, when it printed any.
fn failed_with(reason: RemoteFailReason, host_output: &str) -> RemoteState {
    let output = cli_answers::output_tail(host_output);
    RemoteState::Failed { reason, output: (!output.is_empty()).then_some(output) }
}

fn install_failed(words: &str) -> RemoteState {
    failed_with(RemoteFailReason::InstallFailed, words)
}

fn installing(stage: RemoteInstallStage, done: Option<u64>, total: Option<u64>) -> RemoteState {
    RemoteState::Installing { stage, done, total }
}

fn fail_of(failure: RemoteRunFailure) -> RemoteFailReason {
    match failure {
        RemoteRunFailure::ExecFailed => RemoteFailReason::ExecFailed,
        RemoteRunFailure::NoShell => RemoteFailReason::NoShell,
        RemoteRunFailure::TimedOut => RemoteFailReason::Timeout,
    }
}

/// Lets a progress report through at most every [`PROGRESS_EVERY`].
struct Throttle(Option<Instant>);

impl Throttle {
    fn due(&mut self) -> bool {
        let due = self.0.is_none_or(|at| at.elapsed() >= PROGRESS_EVERY);
        if due {
            self.0 = Some(Instant::now());
        }
        due
    }
}

impl RemoteSupervisor {
    pub fn new(services: Services, limits: RemoteLimits) -> Self {
        Self { services, limits, gate: Mutex::new(()), leftovers: Mutex::new(Vec::new()) }
    }

    /// Carry out one request and say what state it reached. Blocks until the host answers, a limit passes or the
    /// install ends (a download and a send have no total limit); whoever calls it must not be the thread that owns
    /// the session.
    pub fn carry_out(&self, action: RemoteAction, daemon_port: u16, seen_up: bool) -> RemoteState {
        self.carry_out_reporting(action, daemon_port, seen_up, &|_| {})
    }

    /// [`Self::carry_out`], telling `report` the states an install passes through: `installing` with its stage
    /// (the download's and the send's counts at most every 250 ms).
    pub fn carry_out_reporting(&self, action: RemoteAction, daemon_port: u16, seen_up: bool, report: &dyn Fn(RemoteState)) -> RemoteState {
        let _one_at_a_time = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        let state = match action {
            RemoteAction::Probe => self.probe(seen_up),
            RemoteAction::Start => self.start_action(daemon_port),
            RemoteAction::Install | RemoteAction::Update => self.install_action(action, daemon_port, seen_up, report),
        };
        log::info!("remote daemon: {action:?} gave {}", state_name(&state));
        state
    }

    /// What the host's folder holds, or the state that says why that could not be read.
    fn facts(&self) -> Result<scripts::Facts, RemoteState> {
        let out = self.run(&scripts::facts_command(), self.limits.facts).map_err(|failure| failed(fail_of(failure)))?;
        scripts::parse_facts(&out.stdout).ok_or_else(|| failed(RemoteFailReason::BadOutput))
    }

    /// The facts of a host a binary can be installed on: `Err` is the state of any other (`unsupported`).
    fn supported_facts(&self) -> Result<(scripts::Facts, &'static str), RemoteState> {
        let facts = self.facts()?;
        match facts.target.clone() {
            Ok(target) => Ok((facts, target)),
            Err(system) => Err(RemoteState::Unsupported { system }),
        }
    }

    /// The state of a daemon the app reached: `running`, or `outdated` when it is older than `minDaemonVersion`. Its
    /// version is not known without the hook, and a daemon is not turned away for what is not known.
    fn running_state(&self) -> RemoteState {
        let version = self.services.remote_daemon_version.as_ref().and_then(|read| read()).and_then(|text| cli_answers::parse_version(&text));
        match version {
            Some(version) if version < cli_answers::MIN_CLI_VERSION => RemoteState::Outdated { version: version.to_string() },
            _ => RemoteState::Running,
        }
    }

    /// D15: a daemon the app reached is used as it is, whatever started it. Otherwise the host's folder says whether
    /// a binary is there; a system no binary exists for is `unsupported`.
    fn probe(&self, seen_up: bool) -> RemoteState {
        if seen_up {
            return self.running_state();
        }
        match self.supported_facts() {
            Err(state) => state,
            Ok((facts, _)) if facts.version.is_none() => RemoteState::NotInstalled,
            Ok(_) => RemoteState::Stopped,
        }
    }

    /// Start the binary the app installed; there is none to start on a host without it.
    fn start_action(&self, daemon_port: u16) -> RemoteState {
        match self.supported_facts() {
            Err(state) => state,
            Ok((facts, _)) if facts.version.is_none() => RemoteState::NotInstalled,
            Ok((facts, _)) => self.daemon_command(&facts.folder, daemon_port, "start"),
        }
    }

    /// Install: make sure the pinned binary (or a newer one) is on the host, then start the daemon from it; Update does
    /// the same and restarts, which replaces a daemon that runs from an older binary. A daemon the app can reach is not
    /// touched by an Install (D15), and a binary at or above the pin is never replaced (P11).
    fn install_action(&self, action: RemoteAction, daemon_port: u16, seen_up: bool, report: &dyn Fn(RemoteState)) -> RemoteState {
        if action == RemoteAction::Install && seen_up {
            return self.running_state();
        }
        let (facts, target) = match self.supported_facts() {
            Ok(found) => found,
            Err(state) => return state,
        };
        if let Err(state) = self.ensure_binary(&facts, target, report) {
            return state;
        }
        report(installing(RemoteInstallStage::Starting, None, None));
        let verb = if action == RemoteAction::Update { "restart" } else { "start" };
        let state = self.daemon_command(&facts.folder, daemon_port, verb);
        // Only a start that reached `running` makes the old versions removable: until the daemon of the current one
        // answers, the previous one is the way back.
        if state == RemoteState::Running {
            let _ = self.run(&scripts::prune_command(&facts.folder), self.limits.step);
        }
        state
    }

    /// Make sure `<folder>/bin/current/pi-studio` is the pin's version or newer: fetch the pinned archive for `target`,
    /// send it, check it and unpack it. `Err` is the state the request ends in; a file the attempt made is removed.
    fn ensure_binary(&self, facts: &scripts::Facts, target: &str, report: &dyn Fn(RemoteState)) -> Result<(), RemoteState> {
        let Some(archives) = self.services.archives.as_ref() else {
            return Err(install_failed("This app does not install the daemon."));
        };
        let Some(pin) = cli_answers::parse_version(archives.version()) else {
            return Err(install_failed("The pinned daemon version is not a version."));
        };
        // P11: a binary at or above the pin is used as it is.
        if facts.version.is_some_and(|found| found >= pin) {
            return Ok(());
        }
        let archive = self.fetch(&**archives, target, report)?;
        let Some(name) = random_name() else {
            return Err(install_failed("The app has no random numbers to name a file with."));
        };
        let base = scripts::temp_base(&facts.folder, &name);
        self.prepare(&facts.folder)?;
        self.send(&base, &archive, report)?;
        self.check(&base, &archive)?;
        report(installing(RemoteInstallStage::Unpacking, None, None));
        match self.run(&scripts::unpack_command(&facts.folder, &base, archives.version()), self.limits.unpack) {
            Ok(out) if out.status == 0 => Ok(()),
            Ok(out) => {
                self.remove(&base);
                Err(failed_with(RemoteFailReason::InstallFailed, &out.stdout))
            }
            Err(failure) => {
                self.remove(&base);
                Err(failed(fail_of(failure)))
            }
        }
    }

    /// The pinned archive on the app's disk, downloaded when the cache has none (`downloading`).
    fn fetch(&self, archives: &dyn ArchiveSource, target: &str, report: &dyn Fn(RemoteState)) -> Result<crate::services::Archive, RemoteState> {
        report(installing(RemoteInstallStage::Downloading, None, None));
        let mut throttle = Throttle(None);
        archives
            .fetch(target, &mut |received, total| {
                if throttle.due() {
                    report(installing(RemoteInstallStage::Downloading, Some(received), Some(total)));
                }
            })
            .map_err(|failure| match failure {
                FetchFailure::Download => failed(RemoteFailReason::DownloadFailed),
                FetchFailure::Checksum => failed(RemoteFailReason::ChecksumMismatch),
            })
    }

    /// Make `bin/tmp` on the host and clear what earlier attempts left in it. A host that cannot is a send that fails.
    fn prepare(&self, folder: &str) -> Result<(), RemoteState> {
        let leftovers = self.leftovers.lock().unwrap_or_else(|e| e.into_inner()).clone();
        match self.run(&scripts::prepare_command(folder, &leftovers), self.limits.step) {
            Ok(out) if out.status == 0 => {
                self.leftovers.lock().unwrap_or_else(|e| e.into_inner()).clear();
                Ok(())
            }
            Ok(out) => Err(failed_with(RemoteFailReason::SendFailed, &out.stdout)),
            Err(failure) => Err(failed(fail_of(failure))),
        }
    }

    /// Send the archive to `<base>.tar.gz` (`sending`). A send that failed leaves no file on the host when the host can
    /// still be asked to remove it; the host's own words are kept when its command failed.
    fn send(&self, base: &str, archive: &crate::services::Archive, report: &dyn Fn(RemoteState)) -> Result<(), RemoteState> {
        let Some(send) = self.services.remote_send.as_ref() else {
            return Err(failed(RemoteFailReason::SendFailed));
        };
        report(installing(RemoteInstallStage::Sending, Some(0), Some(archive.size)));
        // The announcement above is the first report: the next one is a quarter of a second away.
        let mut throttle = Throttle(Some(Instant::now()));
        let sent = send(&format!("{base}.tar.gz"), &archive.path, archive.size, self.limits.stall, &mut |sent| {
            if throttle.due() {
                report(installing(RemoteInstallStage::Sending, Some(sent), Some(archive.size)));
            }
        });
        match sent {
            Ok(()) => Ok(()),
            Err(RemoteSendFailure::Rejected) => {
                let said = self.run(&scripts::diagnose_command(base), self.limits.step).map(|out| out.stdout).unwrap_or_default();
                self.remove(base);
                Err(failed_with(RemoteFailReason::SendFailed, &said))
            }
            Err(RemoteSendFailure::Failed) => {
                self.remove(base);
                Err(failed(RemoteFailReason::SendFailed))
            }
        }
    }

    /// R4: the file on the host is the size and, when the host can hash, the checksum of the pin.
    fn check(&self, base: &str, archive: &crate::services::Archive) -> Result<(), RemoteState> {
        match self.run(&scripts::check_command(base, archive.size, &archive.sha256), self.limits.check) {
            Ok(out) if out.status == 0 => Ok(()),
            // The script deleted the file.
            Ok(out) if out.status == scripts::CHECK_MISMATCH => Err(failed(RemoteFailReason::ChecksumMismatch)),
            Ok(out) => {
                self.remove(base);
                Err(failed_with(RemoteFailReason::SendFailed, &out.stdout))
            }
            Err(failure) => {
                self.remove(base);
                Err(failed(fail_of(failure)))
            }
        }
    }

    /// Ask the host to remove what an attempt made; when it cannot be asked, the next install does it.
    fn remove(&self, base: &str) {
        if self.run(&scripts::remove_command(base), self.limits.step).is_err() {
            let mut leftovers = self.leftovers.lock().unwrap_or_else(|e| e.into_inner());
            if leftovers.len() < MAX_LEFTOVERS {
                leftovers.push(base.to_owned());
            }
        }
    }

    /// `daemon <verb>` with the binary the app installed. The answer is read whatever the exit status (`daemon start`
    /// exits non-zero while healthy).
    fn daemon_command(&self, folder: &str, daemon_port: u16, verb: &str) -> RemoteState {
        let out = match self.run(&scripts::daemon_command(folder, daemon_port, verb), self.limits.start) {
            Ok(out) => out,
            Err(failure) => return failed(fail_of(failure)),
        };
        match cli_answers::parse_answer(Command::Start, &out.stdout) {
            Answer::Running { .. } => RemoteState::Running,
            Answer::Stopped | Answer::Failed(Failure::BadOutput) => failed(RemoteFailReason::BadOutput),
            Answer::Failed(Failure::NotHealthy) => failed(RemoteFailReason::NotHealthy),
            Answer::Failed(Failure::UnprotectedBind) => failed(RemoteFailReason::UnprotectedBind),
            Answer::Failed(Failure::ConfigUnreadable) => failed_with(RemoteFailReason::ConfigUnreadable, &scripts::config_file(folder)),
        }
    }

    fn run(&self, command: &str, limit: Duration) -> Result<RemoteOutput, RemoteRunFailure> {
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
                let entry = &job.request.entry;
                let state = self.carry_out_reporting(job.request.action, job.daemon_port, job.seen_up, &|passing| access.progress(entry, passing));
                access.apply(entry, state);
                done += 1;
            }
        }
    }
}

/// A random name for the files of one install: 16 hexadecimal digits.
fn random_name() -> Option<String> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).ok()?;
    Some(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// The state's name for a log line: never what the host said.
fn state_name(state: &RemoteState) -> &'static str {
    match state {
        RemoteState::Unknown => "unknown",
        RemoteState::Checking => "checking",
        RemoteState::Running => "running",
        RemoteState::Stopped => "stopped",
        RemoteState::NotInstalled => "not_installed",
        RemoteState::Starting => "starting",
        RemoteState::Outdated { .. } => "outdated",
        RemoteState::Unsupported { .. } => "unsupported",
        RemoteState::Installing { .. } => "installing",
        RemoteState::Failed { reason, .. } => reason.code(),
    }
}

#[cfg(test)]
mod tests;
