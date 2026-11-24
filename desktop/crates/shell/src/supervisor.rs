//! The local daemon supervisor: makes sure the pinned `pi-studio` binary is installed, carries out what
//! the engine queued with it, and answers "what do I dial for the current entry".
//!
//! The engine never starts a process ([`pistudiodesktop_engine::Session::take_local_requests`]); this
//! module does, through the hooks of [`Services`]. Nothing here touches the session while the binary
//! runs or a download goes on: [`Supervisor::carry_out`] takes plain values and returns the state
//! reached, and the session is only reached through [`LocalAccess`] for the instant of taking a batch,
//! storing a state the request passes through (`downloading`, `installing`) or applying an outcome.
//! Binary calls never overlap: one at a time, in the order asked.
//!
//! Every request first makes sure the pinned binary is installed (`ensure_binary`, S7 of
//! `swe/features/single-binary-daemon.md`): `$PI_STUDIO_HOME/bin/current/pi-studio` is run when its
//! version is the pin's or newer (P11: a newer one is never replaced); otherwise the pin is installed
//! through the [`Installer`] hook. Without that hook (the headless CLI, tests) the binary that is in
//! place is run as it is, and none in place is `failed(spawn_failed)`.
//!
//! Nothing secret is logged: a log line names the command and the code of its outcome. A
//! `pairingUrl` never leaves [`crate::cli_answers`], and no address of a download is known here.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use pistudiodesktop_engine::{CliToolHost, Dial, LocalRequest, Session};
use pistudiodesktop_model::pin::this_target;
use pistudiodesktop_model::{CliToolState, FailReason, LocalState};
use serde_json::Value;

use crate::cli_answers::{self, Answer, Command, Failure, Version};
use crate::cli_tool::{self, Files, StdFiles};
use crate::daemons::{self, Batch};
use crate::services::{InstallFailure, InstallProgress, RunFailure, RunSpec, Services};
use crate::shell_env::{self, ShellEnv};

/// How often [`Supervisor::resolve_current`] looks again while the local daemon is changing state.
const SETTLE_POLL: Duration = Duration::from_millis(20);
/// The most often a download's progress is stored in the session: the page redraws on every change.
const PROGRESS_EVERY: Duration = Duration::from_millis(250);
/// The binary's file name in a version folder.
const BINARY: &str = "pi-studio";

/// The time limit of every binary call. The defaults are the constants of [`crate::cli_answers`];
/// tests shorten them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub version: Duration,
    pub status: Duration,
    pub start: Duration,
    pub restart: Duration,
    pub stop: Duration,
    /// Slack on top of the longest action in [`Supervisor::resolve_current`]'s wait, which counts from the
    /// last sign of life (a download's piece, a request's start): the shell environment may be read first.
    pub slack: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            version: cli_answers::VERSION_TIMEOUT,
            status: cli_answers::STATUS_TIMEOUT,
            start: cli_answers::START_TIMEOUT,
            restart: cli_answers::RESTART_TIMEOUT,
            stop: cli_answers::STOP_TIMEOUT,
            slack: Duration::from_secs(10),
        }
    }
}

impl Limits {
    /// The longest a request may go without a sign of life once started: the version of the binary in
    /// place, an Update's stop, its start, and the status of a daemon.
    fn longest(&self) -> Duration {
        self.start.max(self.restart) + self.stop + self.version + self.status
    }
}

/// The short moments the supervisor needs the session. Implemented for `Mutex<Session>`; the app
/// implements it over its owner thread.
pub trait LocalAccess {
    /// The queued requests and the settings they need.
    fn take(&self) -> Batch;
    /// Store a state a request passes through (`downloading`, `installing`): the session stays busy.
    fn progress(&self, state: LocalState);
    /// Store the state a request reached.
    fn apply(&self, state: LocalState);
    /// What to dial for the current entry, for the page: [`Session::plan_dial`] with the dial
    /// address of [`cli_answers::dial_address`], then [`pistudiodesktop_engine::DialPlan::finish`],
    /// which reads the store (and may block) for a relay entry's pairing link only.
    fn resolve(&self) -> Result<Dial, &'static str>;
    /// Run the engine command `id` (`daemon.local.start` and the like); `Err` is its error text.
    fn request(&self, id: &str) -> Result<(), String>;
}

fn lock(session: &Mutex<Session>) -> std::sync::MutexGuard<'_, Session> {
    session.lock().unwrap_or_else(|e| e.into_inner())
}

impl LocalAccess for Mutex<Session> {
    fn take(&self) -> Batch {
        daemons::take_batch(&mut lock(self))
    }

    fn progress(&self, state: LocalState) {
        lock(self).apply_local_progress(state);
    }

    fn apply(&self, state: LocalState) {
        lock(self).apply_local_outcome(state);
    }

    fn resolve(&self) -> Result<Dial, &'static str> {
        // Plan under the lock, read the store outside it: a read may block, and the lock is the
        // one every other caller of this session waits on.
        let (plan, store) = {
            let session = lock(self);
            (session.plan_dial(cli_answers::dial_address)?, session.secret_store())
        };
        plan.finish(&*store)
    }

    fn request(&self, id: &str) -> Result<(), String> {
        lock(self).execute(id, Value::Null).map(|_| ()).map_err(|e| e.to_string())
    }
}

/// Installs and runs the daemon's binary for the local entry.
pub struct Supervisor {
    services: Services,
    env: ShellEnv,
    limits: Limits,
    /// Held for the whole of a request: calls never overlap.
    gate: Mutex<()>,
    /// The last sign of life of a request (its start, a downloaded piece): what
    /// [`Self::resolve_current`]'s patience counts from, so a download is waited for however long it takes.
    activity: Mutex<Instant>,
    /// The file system the command-line tool's link is looked at and made in.
    files: Arc<dyn Files>,
}

fn failed(reason: FailReason) -> LocalState {
    LocalState::Failed { reason, output: None }
}

fn install_failed(output: &str) -> LocalState {
    LocalState::Failed { reason: FailReason::InstallFailed, output: Some(output.to_owned()) }
}

/// What one request works with: the folders of the binary, its environment and where progress goes.
struct Work<'a> {
    bin_dir: PathBuf,
    /// `<bin_dir>/current/pi-studio`.
    program: PathBuf,
    env: &'a [(String, String)],
    report: &'a dyn Fn(LocalState),
}

impl Supervisor {
    /// A supervisor that reads the shell environment on first use.
    pub fn new(services: Services, limits: Limits) -> Self {
        Self { services, env: ShellEnv::default(), limits, gate: Mutex::new(()), activity: Mutex::new(Instant::now()), files: Arc::new(StdFiles) }
    }

    /// A supervisor that runs the binary in `env` without asking the shell for one.
    pub fn with_env(services: Services, limits: Limits, env: Vec<(String, String)>) -> Self {
        Self { services, env: ShellEnv::preset(env), limits, gate: Mutex::new(()), activity: Mutex::new(Instant::now()), files: Arc::new(StdFiles) }
    }

    /// The same supervisor looking at `files` for the command-line tool (tests).
    pub fn with_files(mut self, files: Arc<dyn Files>) -> Self {
        self.files = files;
        self
    }

    /// Carry out one request and say what state it reached. Blocks until the binary answers, its
    /// limit passes or the install ends (a download has no total limit); whoever calls it must not be
    /// the thread that owns the session.
    pub fn carry_out(&self, request: LocalRequest, refresh_env: bool) -> LocalState {
        self.carry_out_reporting(request, refresh_env, &|_| {})
    }

    /// [`Self::carry_out`], telling `report` the states the request passes through: `downloading`
    /// (at most every 250 ms), `installing`, and the state the request itself is in again once an
    /// install is over.
    pub fn carry_out_reporting(&self, request: LocalRequest, refresh_env: bool, report: &dyn Fn(LocalState)) -> LocalState {
        let _one_at_a_time = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        self.touch();
        let env = if refresh_env { self.env.refresh(&self.services) } else { self.env.get(&self.services) };
        let state = self.carry_out_in(request, &env, report);
        log::info!("local daemon: {request:?} gave {}", state_name(&state));
        state
    }

    fn touch(&self) {
        *self.activity.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
    }

    fn last_activity(&self) -> Instant {
        *self.activity.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn carry_out_in(&self, request: LocalRequest, env: &[(String, String)], report: &dyn Fn(LocalState)) -> LocalState {
        // No binary is published for this system (Windows, musl, 32 bits): the engine does not queue a request there.
        if this_target().is_none() {
            return LocalState::Unsupported;
        }
        let home = self.services.home_dir.as_ref().and_then(|home| home());
        let Some(home) = shell_env::pi_studio_home(env, home) else {
            return install_failed("There is no folder for the daemon: PI_STUDIO_HOME is not an absolute path and no home directory is known.");
        };
        let bin_dir = shell_env::bin_dir(&home);
        let work = Work { program: bin_dir.join("current").join(BINARY), bin_dir, env, report };
        match request {
            LocalRequest::Update => self.update(&work),
            request => self.run_request(request, &work),
        }
    }

    /// Probe, Start, Restart and Stop: the binary first, then the daemon command.
    fn run_request(&self, request: LocalRequest, work: &Work) -> LocalState {
        let (back, command) = match request {
            LocalRequest::Probe => (LocalState::Checking, Command::Status),
            LocalRequest::Start => (LocalState::Starting, Command::Start),
            LocalRequest::Update => (LocalState::Updating, Command::Start),
            LocalRequest::Restart => (LocalState::Starting, Command::Restart),
            LocalRequest::Stop => (LocalState::Stopping, Command::Stop),
        };
        if let Err(state) = self.ensure_binary(work, &back) {
            return state;
        }
        let state = match self.daemon_command(work, command) {
            Ok(answer) => self.state_of(answer),
            Err(state) => state,
        };
        // Only a start that reached `running` makes the old versions removable: until the daemon of the current one
        // answers, the previous one is the way back.
        if command != Command::Status
            && command != Command::Stop
            && matches!(state, LocalState::Running { .. })
            && let Some(installer) = self.services.installer.as_ref()
        {
            installer.tidy(&work.bin_dir);
        }
        state
    }

    /// Update: stop a daemon that is older than `minDaemonVersion`, install the pin when the binary in place is older,
    /// start the daemon. Refused (the state is what is there: nothing is stopped, installed or started) when the binary in
    /// place is the pin's or newer and the daemon is not outdated: an app never downgrades, and a newer binary moves
    /// itself forward (P11).
    fn update(&self, work: &Work) -> LocalState {
        let Some(installer) = self.services.installer.as_ref() else {
            return install_failed("This app does not install the daemon.");
        };
        let Some(pin) = cli_answers::parse_version(installer.version()) else {
            return install_failed("The pinned daemon version is not a version.");
        };
        if let Some(current) = self.installed_version(work) {
            let status = self.daemon_command(work, Command::Status);
            let running = matches!(&status, Ok(Answer::Running { .. }));
            let outdated = matches!(&status, Ok(Answer::Running { host, port }) if self.outdated_version(host, *port).is_some());
            if current >= pin && !outdated {
                return match status {
                    Ok(answer) => self.state_of(answer),
                    Err(state) => state,
                };
            }
            // `daemon stop` finds a daemon the npm CLI started too: the PID file is shared.
            if running && let Err(state) = self.daemon_command(work, Command::Stop) {
                return state;
            }
        }
        self.run_request(LocalRequest::Update, work)
    }

    /// Make sure `current/pi-studio` is the pin's version or newer, installing the pin when it is not (S7). `back` is the
    /// state to show again once an install is over. `Err` is the state the request ends in.
    fn ensure_binary(&self, work: &Work, back: &LocalState) -> Result<(), LocalState> {
        let current = self.installed_version(work);
        let Some(installer) = self.services.installer.as_ref() else {
            return current.map(|_| ()).ok_or_else(|| failed(FailReason::SpawnFailed));
        };
        let Some(pin) = cli_answers::parse_version(installer.version()) else {
            return Err(install_failed("The pinned daemon version is not a version."));
        };
        // P11: a binary at or above the pin is used as it is.
        if current.is_some_and(|current| current >= pin) {
            return Ok(());
        }
        // The pinned version is in `versions/` already (an older one was current): no download (P10).
        if installer.adopt_installed(&work.bin_dir) {
            return Ok(());
        }
        let mut last_reported: Option<Instant> = None;
        let mut on_progress = |progress: InstallProgress| {
            self.touch();
            match progress {
                InstallProgress::Downloading { received, total } => {
                    if last_reported.is_none_or(|at| at.elapsed() >= PROGRESS_EVERY) {
                        last_reported = Some(Instant::now());
                        (work.report)(LocalState::Downloading { received, total });
                    }
                }
                InstallProgress::Installing => (work.report)(LocalState::Installing),
            }
        };
        installer.install(&work.bin_dir, &mut on_progress).map_err(|failure| match failure {
            InstallFailure::Download => failed(FailReason::DownloadFailed),
            InstallFailure::Checksum => failed(FailReason::ChecksumMismatch),
            InstallFailure::Install { output } => {
                LocalState::Failed { reason: FailReason::InstallFailed, output: output.map(|o| cli_answers::output_tail(&o)) }
            }
        })?;
        (work.report)(back.clone());
        Ok(())
    }

    /// The version `current/pi-studio` answers; `None` when there is none, it cannot be run or it answers no version.
    fn installed_version(&self, work: &Work) -> Option<Version> {
        let out = self.run_cli(work, &["--version"], self.limits.version).ok()?;
        cli_answers::parse_version(&out)
    }

    /// Run `daemon <command>` and read its answer; `Err` is the state a binary that could not be run ends in.
    fn daemon_command(&self, work: &Work, command: Command) -> Result<Answer, LocalState> {
        let (verb, limit) = match command {
            Command::Status => ("status", self.limits.status),
            Command::Start => ("start", self.limits.start),
            Command::Restart => ("restart", self.limits.restart),
            Command::Stop => ("stop", self.limits.stop),
        };
        let out = self.run_cli(work, &["--json", "daemon", verb], limit).map_err(|failure| failed(fail_of(failure)))?;
        Ok(cli_answers::parse_answer(command, &out))
    }

    /// The state an answer is: a running daemon older than `minDaemonVersion` is `outdated`.
    fn state_of(&self, answer: Answer) -> LocalState {
        match answer {
            Answer::Running { host, port } => match self.outdated_version(&host, port) {
                Some(version) => LocalState::Outdated { version },
                None => LocalState::Running { host, port },
            },
            Answer::Stopped => LocalState::Stopped,
            Answer::Failed(Failure::NotHealthy) => failed(FailReason::NotHealthy),
            Answer::Failed(Failure::BadOutput) => failed(FailReason::BadOutput),
        }
    }

    /// The version of the daemon at `host:port` when it is older than `minDaemonVersion`. `None` when it is not, and when
    /// its version cannot be read (no hook, no answer): a daemon is not turned away for what is not known.
    fn outdated_version(&self, host: &str, port: u16) -> Option<String> {
        let read = self.services.daemon_version.as_ref()?;
        let version = cli_answers::parse_version(&read(cli_answers::connect_host(host), port)?)?;
        (version < cli_answers::MIN_CLI_VERSION).then(|| version.to_string())
    }

    fn run_cli(&self, work: &Work, args: &[&str], limit: Duration) -> Result<String, RunFailure> {
        let run = self.services.run.as_ref().ok_or(RunFailure::CouldNotStart)?;
        run(&RunSpec { program: work.program.clone(), args: args.iter().map(|a| (*a).to_owned()).collect(), env: work.env.to_vec(), limit })
    }

    /// Carry out every queued request, one after the other, and apply each outcome, until nothing
    /// is queued. Returns how many were carried out. The app calls this from its background
    /// runner; the session is only touched through `access` between requests.
    pub fn pump(&self, access: &dyn LocalAccess) -> usize {
        let mut done = 0;
        loop {
            let batch = access.take();
            if batch.requests.is_empty() {
                return done;
            }
            for request in batch.requests {
                let state = self.carry_out_reporting(request, batch.refresh_env, &|passing| access.progress(passing));
                access.apply(state);
                done += 1;
            }
        }
    }

    /// Ask for a probe now: at launch, when the Daemons screen opens, and when a connection to the
    /// local entry drops. This is `daemon.local.refresh`; the answer arrives as a state change
    /// through [`Self::pump`]. `Err` is the engine's refusal (`unsupported`, or `busy`).
    pub fn probe_now(access: &dyn LocalAccess) -> Result<(), String> {
        access.request("daemon.local.refresh")
    }

    /// What to dial for the current entry. While the local daemon is changing state this waits for
    /// the outcome (at most the longest action's limit plus the slack after the last sign of life: a download that goes
    /// on is waited for); when it is stopped and auto-start is on, it queues a start, waits for it, and answers with the
    /// intent or the failure. Requests it finds queued are carried out here, so it needs no other pump; a concurrent
    /// pump is fine.
    pub fn resolve_current(&self, access: &dyn LocalAccess) -> Result<Dial, String> {
        let began = Instant::now();
        let patience = self.limits.longest() + self.limits.slack;
        let mut started = false;
        loop {
            self.pump(access);
            match access.resolve() {
                Ok(Dial::Wait) => {}
                Ok(Dial::StartNeeded) if !started => {
                    started = true;
                    match access.request("daemon.local.start") {
                        Ok(()) => {}
                        // Another action is in flight: wait for it, then ask again.
                        Err(e) if e == "busy" => {}
                        Err(e) => return Err(e),
                    }
                    continue;
                }
                // A second start did not leave it running: do not loop on it.
                Ok(Dial::StartNeeded) => return Err("local_stopped".to_owned()),
                Ok(dial) => return Ok(dial),
                Err(code) => return Err(code.to_owned()),
            }
            if Instant::now() >= self.last_activity().max(began) + patience {
                return Err(FailReason::Timeout.code().to_owned());
            }
            std::thread::sleep(SETTLE_POLL);
        }
    }
}

/// The command-line tool, over the login shell's environment this supervisor holds. Both methods block: the install
/// asks the shell for its environment again, so the page runs them off the thread that owns the session.
impl CliToolHost for Supervisor {
    fn state(&self) -> CliToolState {
        let env = self.env.get(&self.services);
        let state = cli_tool::state(&*self.files, &env, self.home_dir());
        log::info!("command-line tool: {}", cli_tool::state_name(&state));
        state
    }

    fn install(&self) -> Result<CliToolState, String> {
        let env = self.env.get(&self.services);
        // The shell's environment is read again once the link is there: `~/.local/bin` is on a login shell's
        // `PATH` only when the folder exists when it starts (the usual `~/.profile`).
        let answer = cli_tool::install(&*self.files, &env, self.home_dir(), &|| self.env.refresh(&self.services));
        match &answer {
            Ok(state) => log::info!("command-line tool: install gave {}", cli_tool::state_name(state)),
            Err(refusal) => log::warn!("command-line tool: install refused ({refusal:?})"),
        }
        answer.map_err(|refusal| refusal.to_string())
    }
}

impl Supervisor {
    fn home_dir(&self) -> Option<PathBuf> {
        self.services.home_dir.as_ref().and_then(|home| home())
    }
}

fn fail_of(failure: RunFailure) -> FailReason {
    match failure {
        RunFailure::CouldNotStart => FailReason::SpawnFailed,
        RunFailure::TimedOut => FailReason::Timeout,
    }
}

/// The state's name for a log line: never its host or port.
fn state_name(state: &LocalState) -> &'static str {
    match state {
        LocalState::Unsupported => "unsupported",
        LocalState::Outdated { .. } => "outdated",
        LocalState::Downloading { .. } => "downloading",
        LocalState::Installing => "installing",
        LocalState::Checking => "checking",
        LocalState::Stopped => "stopped",
        LocalState::Starting => "starting",
        LocalState::Stopping => "stopping",
        LocalState::Updating => "updating",
        LocalState::Running { .. } => "running",
        LocalState::Failed { reason, .. } => reason.code(),
    }
}

#[cfg(all(test, unix))]
mod tests;
