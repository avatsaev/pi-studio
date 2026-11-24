//! The local daemon supervisor: carries out what the engine queued with the real `pi-studio` CLI,
//! and answers "what do I dial for the current entry".
//!
//! The engine never starts a process ([`pistudiodesktop_engine::Session::take_local_requests`]); this
//! module does, through the hooks of [`Services`]. Nothing here touches the session while the CLI
//! runs: [`Supervisor::carry_out`] takes plain values and returns the state reached, and the
//! session is only reached through [`LocalAccess`] for the instant of taking a batch or applying an
//! outcome. CLI calls never overlap: one at a time, in the order asked.
//!
//! Nothing secret is logged: a log line names the command and the code of its outcome. A
//! `pairingUrl` never leaves [`crate::cli_answers`].

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use pistudiodesktop_engine::{Dial, LocalRequest, Session};
use pistudiodesktop_model::{FailReason, LocalState};
use serde_json::Value;

use crate::cli_answers::{self, Answer, Command, Failure, VersionCheck};
use crate::cli_find;
use crate::daemons::{self, Batch};
use crate::services::{RunFailure, RunSpec, Services};
use crate::shell_env::ShellEnv;

/// How often [`Supervisor::resolve_current`] looks again while the local daemon is changing state.
const SETTLE_POLL: Duration = Duration::from_millis(20);
/// Slack on top of the longest action: the shell environment may be read first.
const SETTLE_SLACK: Duration = Duration::from_secs(10);

/// The time limit of every CLI call. The defaults are the constants of [`crate::cli_answers`];
/// tests shorten them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub version: Duration,
    pub status: Duration,
    pub start: Duration,
    pub restart: Duration,
    pub stop: Duration,
    pub update: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            version: cli_answers::VERSION_TIMEOUT,
            status: cli_answers::STATUS_TIMEOUT,
            start: cli_answers::START_TIMEOUT,
            restart: cli_answers::RESTART_TIMEOUT,
            stop: cli_answers::STOP_TIMEOUT,
            update: cli_answers::UPDATE_TIMEOUT,
        }
    }
}

impl Limits {
    /// The longest a request may take once started.
    fn longest(&self) -> Duration {
        self.update.max(self.start).max(self.restart).max(self.stop) + self.version + self.status
    }
}

/// The short moments the supervisor needs the session. Implemented for `Mutex<Session>`; the app
/// implements it over its owner thread.
pub trait LocalAccess {
    /// The queued requests and the settings they need.
    fn take(&self) -> Batch;
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

/// Runs the CLI for the local daemon.
pub struct Supervisor {
    services: Services,
    env: ShellEnv,
    limits: Limits,
    /// Held for the whole of a request: calls never overlap.
    gate: Mutex<()>,
}

fn failed(reason: FailReason) -> LocalState {
    LocalState::Failed { reason, output: None }
}

impl Supervisor {
    /// A supervisor that reads the shell environment on first use.
    pub fn new(services: Services, limits: Limits) -> Self {
        Self { services, env: ShellEnv::default(), limits, gate: Mutex::new(()) }
    }

    /// A supervisor that runs the CLI in `env` without asking the shell for one.
    pub fn with_env(services: Services, limits: Limits, env: Vec<(String, String)>) -> Self {
        Self { services, env: ShellEnv::preset(env), limits, gate: Mutex::new(()) }
    }

    /// Carry out one request and say what state it reached. Blocks until the CLI answers or its
    /// limit passes; whoever calls it must not be the thread that owns the session.
    pub fn carry_out(&self, request: LocalRequest, refresh_env: bool) -> LocalState {
        let _one_at_a_time = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        let env = if refresh_env { self.env.refresh(&self.services) } else { self.env.get(&self.services) };
        let state = self.carry_out_in(request, &env);
        log::info!("local daemon: {request:?} gave {}", state_name(&state));
        state
    }

    fn carry_out_in(&self, request: LocalRequest, env: &[(String, String)]) -> LocalState {
        // The CLI is found the way a terminal finds it. Until the supervisor installs the pinned
        // binary itself, one that is not there is a daemon that cannot be run.
        let program = match cli_find::find(&self.services, env) {
            Ok(program) => program,
            Err(cli_find::CliMissing) => return failed(FailReason::SpawnFailed),
        };
        if request == LocalRequest::Update
            && let Some(state) = self.run_update(&program, env)
        {
            return state;
        }
        match self.run_cli(&program, &["--version"], env, self.limits.version) {
            Err(failure) => return failed(fail_of(failure)),
            Ok(out) => match cli_answers::check_version(&out) {
                VersionCheck::Ok => {}
                VersionCheck::Outdated { version } => return LocalState::Outdated { version },
                VersionCheck::BadOutput => return failed(FailReason::BadOutput),
            },
        }
        let (command, limit) = match request {
            LocalRequest::Probe => (Command::Status, self.limits.status),
            // After an update the daemon is started as Start does: the CLI restarted a running one.
            LocalRequest::Start | LocalRequest::Update => (Command::Start, self.limits.start),
            LocalRequest::Restart => (Command::Restart, self.limits.restart),
            LocalRequest::Stop => (Command::Stop, self.limits.stop),
        };
        let verb = match command {
            Command::Status => "status",
            Command::Start => "start",
            Command::Restart => "restart",
            Command::Stop => "stop",
        };
        let out = match self.run_cli(&program, &["--json", "daemon", verb], env, limit) {
            Ok(out) => out,
            Err(failure) => return failed(fail_of(failure)),
        };
        match cli_answers::parse_answer(command, &out) {
            Answer::Running { host, port } => LocalState::Running { host, port },
            Answer::Stopped => LocalState::Stopped,
            Answer::Failed(Failure::NotHealthy) => failed(FailReason::NotHealthy),
            Answer::Failed(Failure::BadOutput) => failed(FailReason::BadOutput),
        }
    }

    /// Run `pi-studio update`. `None` when it succeeded; otherwise the state reached. Its output is
    /// not parsed (an outdated CLI's format is unknown): a failure keeps its last lines for the
    /// screen, which are not expected to hold a secret.
    fn run_update(&self, program: &Path, env: &[(String, String)]) -> Option<LocalState> {
        let update_failed = |output: &str| LocalState::Failed { reason: FailReason::InstallFailed, output: Some(output.to_owned()) };
        let Some(run) = self.services.run_checked.as_ref() else {
            return Some(update_failed("`pi-studio update` could not be run"));
        };
        let spec = RunSpec { program: program.to_path_buf(), args: vec!["update".to_owned()], env: env.to_vec(), limit: self.limits.update };
        match run(&spec) {
            Ok(out) if out.success => None,
            Ok(out) => Some(update_failed(&cli_answers::output_tail(&out.output))),
            Err(RunFailure::CouldNotStart) => Some(update_failed("`pi-studio update` could not be run")),
            Err(RunFailure::TimedOut) => Some(update_failed("`pi-studio update` took too long and was stopped")),
        }
    }

    fn run_cli(&self, program: &Path, args: &[&str], env: &[(String, String)], limit: Duration) -> Result<String, RunFailure> {
        let run = self.services.run.as_ref().ok_or(RunFailure::CouldNotStart)?;
        run(&RunSpec { program: program.to_path_buf(), args: args.iter().map(|a| (*a).to_owned()).collect(), env: env.to_vec(), limit })
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
                let state = self.carry_out(request, batch.refresh_env);
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
    /// the outcome (at most the longest action's limit); when it is stopped and auto-start is on,
    /// it queues a start, waits for it, and answers with the intent or the failure. Requests it
    /// finds queued are carried out here, so it needs no other pump; a concurrent pump is fine.
    pub fn resolve_current(&self, access: &dyn LocalAccess) -> Result<Dial, String> {
        let deadline = Instant::now() + self.limits.longest() + SETTLE_SLACK;
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
            if Instant::now() >= deadline {
                return Err(FailReason::Timeout.code().to_owned());
            }
            std::thread::sleep(SETTLE_POLL);
        }
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
