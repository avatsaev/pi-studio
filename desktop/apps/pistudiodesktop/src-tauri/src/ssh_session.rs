//! The SSH connection of the current SSH entry, shared by the page's channel, the transfer engine's
//! and the remote commands (`swe/features/desktop-relay-ssh.md` § 7, D15, S11).
//!
//! The app holds at most one [`pistudiodesktop_ssh::Session`], for the current entry. The first open
//! dials it (the stored secrets are read on the blocking pool, `~/.ssh/config` is resolved, the
//! login runs through the jump hosts); opens that come meanwhile wait for the same attempt instead
//! of dialling again. A channel on it (the daemon's WebSocket, a command) holds a [`Lease`]; the
//! session is closed 30 s after the last lease ended, when the window leaves the entry
//! ([`SshSessions::close`]), when the entry is edited or removed
//! ([`SshSessions::close_entry_in_background`]) and when russh's keepalive finds the connection dead.
//! The next open dials again.
//!
//! An unknown host key fails the connect with `host_key_unknown`; asking about it is not done here.
//! Trusting a key is [`pistudiodesktop_ssh::known_hosts::trust`] on [`SshEnv::app_known_hosts`].
//!
//! Nothing here logs or returns a secret, a host, a user, a key path, a fingerprint or what a remote
//! command printed: a log line says what happened and a code. A failure's message, which goes to the
//! person who owns the host, names the host.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::task::{Context, Poll};
use std::time::Duration;

use futures_util::future::BoxFuture;
use futures_util::{Sink, Stream};
use pistudiodesktop_engine::SshPlan;
use pistudiodesktop_model::{EntryId, RemoteState, Secret};
use pistudiodesktop_net::{DaemonSocket, Wire};
use pistudiodesktop_shell::owner_access::OwnerAccess;
use pistudiodesktop_shell::services::{RemoteOutput, RemoteRunFailure, RemoteRunHook};
use pistudiodesktop_shell::shell_env::{ShellEnv, process_env};
use pistudiodesktop_shell::transports::{SshState, SshView};
use pistudiodesktop_shell::{Services, dialogs};
use pistudiodesktop_ssh::config::{self, ConfigError, ConfigSource, Entry, HostSuggestion, Target};
use pistudiodesktop_ssh::{DaemonError, Environment, Error, Limits, RunError, Secrets, Session, connect, known_hosts};
use serde::Serialize;
use serde_json::json;
use tokio::sync::{OnceCell, RwLock, watch};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};

use crate::transport::{Failure, blocking};

/// How long a session with no channel is kept (D15).
pub const IDLE: Duration = Duration::from_secs(30);
/// The longest a blocking close waits for the session to say goodbye.
const CLOSE_WAIT: Duration = Duration::from_secs(5);
/// The variables that name the user of this machine, in the order they are tried.
const USER_VARIABLES: [&str; 3] = ["USER", "LOGNAME", "USERNAME"];
/// The engine command that asks for a fresh look at the host's daemon.
const REFRESH: &str = "daemon.remote.refresh";
/// Most refused host keys remembered until the page loads again.
const MAX_REFUSED_KEYS: usize = 64;
/// What an alert says when the key a person trusted could not be written.
const KEY_NOT_STORED: &str = "The host key could not be saved to Pi Studio's known_hosts file, so the connection stays closed.";

/// One host of `~/.ssh/config` as the page's form lists it: what choosing it would show as placeholders.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostView {
    pub alias: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jump: Option<String>,
}

impl From<HostSuggestion> for HostView {
    fn from(host: HostSuggestion) -> Self {
        Self { alias: host.alias, host_name: host.host_name, user: host.user, port: host.port, identity_file: host.identity_file, jump: host.jump }
    }
}

/// The answer of `ssh_config_hosts`.
#[derive(Debug, Serialize)]
pub struct HostList {
    pub hosts: Vec<HostView>,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // Nothing under these locks is left half-changed by a panic.
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Told that a host key was trusted: the page connects again.
pub type TrustedHook = Arc<dyn Fn() + Send + Sync>;

/// Where the SSH side reads from: the files and the environment of this machine.
pub struct SshEnv {
    services: Services,
    /// The home directory: `~` in the config and the entry, and the default key files.
    home: Option<PathBuf>,
    /// The app's own known-hosts file: the one trusting a key appends to.
    pub app_known_hosts: PathBuf,
    shell_env: ShellEnv,
    /// Called after a host key was stored, so that the page connects again.
    trusted: Option<TrustedHook>,
}

impl SshEnv {
    /// The environment of the running app: the home directory from the hook, the login shell's
    /// environment read on first use, `known_hosts` in the app's configuration directory.
    pub fn native(services: &Services, config_dir: &std::path::Path) -> Self {
        let home = services.home_dir.as_ref().and_then(|home| home());
        Self { services: services.clone(), home, app_known_hosts: config_dir.join("known_hosts"), shell_env: ShellEnv::default(), trusted: None }
    }

    /// The same, calling `hook` after the person trusted a host key and it was stored.
    #[must_use]
    pub fn on_trusted(mut self, hook: TrustedHook) -> Self {
        self.trusted = Some(hook);
        self
    }

    /// An environment that asks no shell: `login_env` is what the login shell would have printed.
    #[cfg(test)]
    pub fn fixed(home: PathBuf, app_known_hosts: PathBuf, login_env: Vec<(String, String)>) -> Self {
        Self { services: Services::default(), home: Some(home), app_known_hosts, shell_env: ShellEnv::preset(login_env), trusted: None }
    }

    /// The same, asking questions through `services` (its confirmation hook).
    #[cfg(test)]
    #[must_use]
    pub fn asking(mut self, services: Services) -> Self {
        self.services = services;
        self
    }

    /// `~/.ssh/config`.
    fn config_file(home: &std::path::Path) -> PathBuf {
        home.join(".ssh").join("config")
    }

    /// The known-hosts files, read in order: the user's, then the app's.
    fn known_hosts(&self, home: &std::path::Path) -> Vec<PathBuf> {
        vec![home.join(".ssh").join("known_hosts"), self.app_known_hosts.clone()]
    }
}

/// What the SSH side learned about the entry it serves: whether the daemon answered the last open,
/// and whether the refusal that followed was already looked into (one probe per outage).
#[derive(Default)]
struct Seen {
    up: Option<EntryId>,
    probed: Option<EntryId>,
}

/// A host key as the question about it names it: nothing is kept of the key but its fingerprint.
#[derive(Clone, PartialEq, Eq, Hash)]
struct AskedKey {
    host: String,
    port: u16,
    fingerprint: String,
}

/// The host-key questions: those being asked, and those answered No since the page loaded.
#[derive(Default)]
struct Asked {
    open: HashSet<AskedKey>,
    refused: HashSet<AskedKey>,
    /// Changes when the refusals are forgotten, so that an answer to a question of an earlier page is not remembered.
    generation: u64,
}

impl Asked {
    /// Start a question for `key`: the generation it belongs to, or `None` when it is open already, was refused, or
    /// [`MAX_REFUSED_KEYS`] are remembered (a server offering a new key every time cannot ask without end).
    fn begin(&mut self, key: &AskedKey) -> Option<u64> {
        if self.refused.contains(key) || self.refused.len() >= MAX_REFUSED_KEYS || !self.open.insert(key.clone()) {
            return None;
        }
        Some(self.generation)
    }

    /// The answer was No: remember it, unless the page that asked has been replaced.
    fn refuse(&mut self, key: AskedKey, generation: u64) {
        self.open.remove(&key);
        if generation == self.generation {
            self.refused.insert(key);
        }
    }

    /// The question is over and the key is not refused.
    fn finish(&mut self, key: &AskedKey) {
        self.open.remove(key);
    }

    fn forget_refused(&mut self) {
        self.refused.clear();
        self.generation = self.generation.wrapping_add(1);
    }
}

/// One connection attempt for an entry, shared by everyone who asks while it runs and after it.
type Attempt = OnceCell<Result<Arc<Live>, Failure>>;

struct Slot {
    entry: EntryId,
    attempt: Arc<Attempt>,
}

impl Slot {
    /// A failed attempt, or a session that has ended, is not shared: the next open dials again.
    fn usable(&self) -> bool {
        match self.attempt.get() {
            None => true,
            Some(Ok(live)) => !live.is_retired(),
            Some(Err(_)) => false,
        }
    }

    fn live(&self) -> Option<&Arc<Live>> {
        self.attempt.get().and_then(|result| result.as_ref().ok())
    }
}

struct Inner {
    env: SshEnv,
    idle: Duration,
    limits: Limits,
    slot: Mutex<Option<Slot>>,
    seen: Mutex<Seen>,
    asked: Mutex<Asked>,
}

/// The app's one SSH session, as the page's commands, the transfer engine and the remote runner
/// reach it. Cheap to clone; managed by Tauri.
#[derive(Clone)]
pub struct SshSessions {
    inner: Arc<Inner>,
}

impl SshSessions {
    pub fn new(env: SshEnv) -> Self {
        Self::with(env, IDLE, Limits::default())
    }

    /// Sessions that end after `idle` without a channel, and with `limits` for the connect.
    pub fn with(env: SshEnv, idle: Duration, limits: Limits) -> Self {
        Self { inner: Arc::new(Inner { env, idle, limits, slot: Mutex::new(None), seen: Mutex::new(Seen::default()), asked: Mutex::new(Asked::default()) }) }
    }

    /// Open the current entry's daemon over the shared session: a channel to the daemon's port on
    /// the host and the WebSocket upgrade over it, with `password` (the daemon's own) as the bearer
    /// subprotocol. The socket holds a lease on the session. A daemon that answered says so to the
    /// engine (`running`); a refused port asks for one look at the host (`daemon_not_running`).
    pub async fn open_daemon(
        &self,
        access: &OwnerAccess,
        plan: &SshPlan,
        password: Option<&Secret>,
        max_message_bytes: usize,
    ) -> Result<DaemonSocket, Failure> {
        let lease = self.lease(access, plan).await?;
        let names = lease.live.names.clone();
        let opened = {
            let guard = lease.live.session.read().await;
            let Some(session) = guard.as_ref() else { return Err(lost(&names)) };
            tokio::select! {
                opened = session.open_daemon(plan.fields.daemon_port, password.map(Secret::expose), max_message_bytes) => opened,
                () = lease.live.closing() => return Err(lost(&names)),
            }
        };
        match opened {
            Ok(socket) => {
                if self.inner.mark_up(&plan.entry) {
                    let (access, entry) = (access.clone(), plan.entry.clone());
                    // The state is only a view of the Daemons screen: a failure to store it costs nothing else.
                    let _ = blocking(move || access.set_remote(&entry, RemoteState::Running)).await;
                }
                Ok(DaemonSocket::from_wire(Leased { socket, _lease: lease }, max_message_bytes))
            }
            Err(error) => {
                let refused = matches!(error, DaemonError::Channel(Error::PortRefused { .. }));
                drop(lease);
                if refused {
                    self.daemon_refused(access, plan).await;
                }
                Err(daemon_failure(&error, &names, plan.fields.daemon_port))
            }
        }
    }

    /// The host refused the daemon's port: the app has not seen it up, and the host is looked at
    /// once (a probe), then not again until a daemon has answered.
    async fn daemon_refused(&self, access: &OwnerAccess, plan: &SshPlan) {
        if !self.inner.mark_refused(&plan.entry) {
            return;
        }
        let access = access.clone();
        // A refusal (`busy`, `not_installed`) is an answer already: the screen shows that state.
        let _ = blocking(move || access.execute(REFRESH, json!({}))).await;
    }

    /// Run `command` in the host's login shell over the shared session. Blocks until it is done or
    /// `limit` has passed: call it off the thread that owns the registry and off the async
    /// runtime's workers.
    pub fn run_blocking(&self, access: &OwnerAccess, command: &str, limit: Duration) -> Result<RemoteOutput, RemoteRunFailure> {
        tauri::async_runtime::block_on(self.run(access, command, limit))
    }

    async fn run(&self, access: &OwnerAccess, command: &str, limit: Duration) -> Result<RemoteOutput, RemoteRunFailure> {
        let plan = blocking({
            let access = access.clone();
            move || access.ssh_plan()
        })
        .await
        .ok()
        .and_then(Result::ok)
        .ok_or(RemoteRunFailure::ExecFailed)?;
        let lease = self.lease(access, &plan).await.map_err(|failure| {
            log::info!("remote command: no SSH session ({})", failure.code);
            RemoteRunFailure::ExecFailed
        })?;
        let guard = lease.live.session.read().await;
        let session = guard.as_ref().ok_or(RemoteRunFailure::ExecFailed)?;
        let ran = tokio::select! {
            ran = session.run(command, limit) => ran,
            () = lease.live.closing() => Err(RunError::ExecFailed),
        };
        match ran {
            Ok(output) => {
                Ok(RemoteOutput { status: i32::try_from(output.status).unwrap_or(i32::MAX), stdout: String::from_utf8_lossy(&output.stdout).into_owned() })
            }
            Err(RunError::Timeout) => Err(RemoteRunFailure::TimedOut),
            Err(RunError::NoShell) => Err(RemoteRunFailure::NoShell),
            Err(RunError::ExecFailed) => Err(RemoteRunFailure::ExecFailed),
        }
    }

    /// The hook the shell's remote supervisor runs commands through.
    pub fn remote_run_hook(&self, access: OwnerAccess) -> RemoteRunHook {
        let sessions = self.clone();
        Arc::new(move |command, limit| sessions.run_blocking(&access, command, limit))
    }

    /// A lease on the session of `plan`'s entry, dialling it when there is none. A session that
    /// retired between being picked and being leased is dialled again, once.
    async fn lease(&self, access: &OwnerAccess, plan: &SshPlan) -> Result<Lease, Failure> {
        for _ in 0..2 {
            let attempt = self.inner.attempt_for(&plan.entry);
            let shared = attempt.get_or_init(|| Arc::clone(&self.inner).connect(access.clone(), plan.clone())).await;
            let live = shared.clone()?;
            if let Some(lease) = live.acquire(&self.inner) {
                return Ok(lease);
            }
        }
        Err(Failure::new("ssh_lost", "The SSH connection ended while it was being opened."))
    }

    /// Whether the last open of the daemon of `entry` reached it (what a probe reports as running).
    pub fn seen_up(&self, entry: &EntryId) -> bool {
        locked(&self.inner.seen).up.as_ref() == Some(entry)
    }

    /// Whether a session is open or being opened.
    #[cfg(test)]
    pub fn is_open(&self) -> bool {
        locked(&self.inner.slot).as_ref().is_some_and(Slot::usable)
    }

    /// How many refused host keys are remembered.
    #[cfg(test)]
    pub fn refused_keys(&self) -> usize {
        locked(&self.inner.asked).refused.len()
    }

    /// Close the session, if any, and forget what was seen of the daemon and the host keys that were
    /// refused: the window leaves the entry. Resolves when the host has been told.
    pub async fn close(&self) {
        let slot = locked(&self.inner.slot).take();
        *locked(&self.inner.seen) = Seen::default();
        self.forget_refused_keys();
        if let Some(live) = slot.as_ref().and_then(Slot::live) {
            live.retire().await;
        }
    }

    /// The page loaded again: a host key that was refused is asked about again.
    pub fn forget_refused_keys(&self) {
        locked(&self.inner.asked).forget_refused();
    }

    /// The plain `Host` names of `~/.ssh/config` (S12), read on the blocking pool: an absent file lists nothing, a
    /// file that does not parse is `ssh_config`.
    pub async fn config_hosts(&self) -> Result<HostList, Failure> {
        let inner = Arc::clone(&self.inner);
        blocking(move || {
            let home = inner.env.home.clone().ok_or_else(home_unknown)?;
            let file = SshEnv::config_file(&home);
            let hosts = config::hosts(&ConfigSource { config: &file, home: &home }).map_err(config_failure)?;
            Ok(HostList { hosts: hosts.into_iter().map(HostView::from).collect() })
        })
        .await?
    }

    /// The session as `ui.inspect` shows it: counts only.
    pub fn view(&self) -> SshView {
        let slot = locked(&self.inner.slot);
        let Some(slot) = slot.as_ref() else { return SshView::default() };
        match slot.attempt.get() {
            None => SshView { state: SshState::Connecting, ..SshView::default() },
            Some(Ok(live)) if !live.is_retired() => SshView { state: SshState::Open, hops: live.hops, channels: live.open_channels() },
            Some(_) => SshView::default(),
        }
    }

    /// [`Self::close`] for a thread that is not a worker of the async runtime (a switch, the exit),
    /// for at most [`CLOSE_WAIT`].
    pub fn close_blocking(&self) {
        let (done, finished) = channel();
        let sessions = self.clone();
        tauri::async_runtime::spawn(async move {
            sessions.close().await;
            let _ = done.send(());
        });
        if finished.recv_timeout(CLOSE_WAIT).is_err() {
            log::warn!("the SSH session was not closed within {} s", CLOSE_WAIT.as_secs());
        }
    }

    /// `entry` was edited or removed: its session, if one is open, ends, and the next open uses the
    /// new values. Does not wait; callable from the owner thread.
    pub fn close_entry_in_background(&self, entry: &EntryId) {
        let (sessions, entry) = (self.clone(), entry.clone());
        tauri::async_runtime::spawn(async move {
            let ours = locked(&sessions.inner.slot).as_ref().is_some_and(|slot| slot.entry == entry);
            if ours {
                sessions.close().await;
            }
        });
    }
}

impl Inner {
    /// The attempt for `entry`: the one in the slot while it is usable, otherwise a new one (the
    /// session it replaces ends).
    fn attempt_for(&self, entry: &EntryId) -> Arc<Attempt> {
        let mut slot = locked(&self.slot);
        if let Some(current) = slot.as_ref().filter(|current| current.entry == *entry && current.usable()) {
            return Arc::clone(&current.attempt);
        }
        let fresh = Arc::new(Attempt::new());
        let old = slot.replace(Slot { entry: entry.clone(), attempt: Arc::clone(&fresh) });
        drop(slot);
        if let Some(live) = old.as_ref().and_then(Slot::live).cloned() {
            tauri::async_runtime::spawn(async move { live.retire().await });
        }
        fresh
    }

    /// Take `live` out of the slot, if it is what the slot holds.
    fn forget(&self, live: &Arc<Live>) {
        let mut slot = locked(&self.slot);
        if slot.as_ref().and_then(Slot::live).is_some_and(|held| Arc::ptr_eq(held, live)) {
            *slot = None;
        }
    }

    /// The daemon answered. `true` when that is news.
    fn mark_up(&self, entry: &EntryId) -> bool {
        let mut seen = locked(&self.seen);
        seen.probed = None;
        let news = seen.up.as_ref() != Some(entry);
        seen.up = Some(entry.clone());
        news
    }

    /// The host refused the daemon's port. `true` when nobody has looked at the host since.
    fn mark_refused(&self, entry: &EntryId) -> bool {
        let mut seen = locked(&self.seen);
        if seen.up.as_ref() == Some(entry) {
            seen.up = None;
        }
        let first = seen.probed.as_ref() != Some(entry);
        seen.probed = Some(entry.clone());
        first
    }

    /// Open the session for `plan`: the secrets, the config, the login. Runs once per attempt.
    async fn connect(self: Arc<Self>, access: OwnerAccess, plan: SshPlan) -> Result<Arc<Live>, Failure> {
        let secrets = blocking({
            let plan = plan.clone();
            move || access.ssh_secrets(&plan)
        })
        .await?
        .map_err(secret_failure)?;
        let (target, env, known_hosts) = self.prepare(&plan).await?;
        let secrets = Secrets { password: secrets.ssh_password.map(|p| p.expose().to_owned()), passphrase: secrets.passphrase.map(|p| p.expose().to_owned()) };
        let names: Vec<String> = target.hops.iter().map(|hop| hop.host.clone()).chain(std::iter::once(target.host.clone())).collect();
        let session = connect(&target, &secrets, &env, &known_hosts, &self.limits).await.map_err(|error| {
            self.ask_about_key(&error, &names);
            failure(&error, &names)
        })?;
        log::info!("ssh: connected through {} jump host(s)", session.hops());
        let live = Arc::new(Live::new(session, names));
        spawn_watcher(&live, &self);
        // Nobody holds a channel yet: the clock starts, and the first lease stops it.
        arm_idle(&live, &self, live.generation());
        Ok(live)
    }

    /// The target, the environment and the known-hosts files of `plan`, read on the blocking pool.
    async fn prepare(self: &Arc<Self>, plan: &SshPlan) -> Result<(Target, Environment, Vec<PathBuf>), Failure> {
        let (inner, plan) = (Arc::clone(self), plan.clone());
        blocking(move || {
            let home = inner.env.home.clone().ok_or_else(home_unknown)?;
            let login = inner.env.shell_env.get(&inner.env.services);
            let own = process_env(&inner.env.services);
            let user = local_user(&login).or_else(|| local_user(&own)).unwrap_or_default();
            let fields = &plan.fields;
            let entry = Entry {
                host: &fields.host,
                user: fields.user.as_deref(),
                port: fields.port,
                identity_file: fields.identity_file.as_deref(),
                jump: fields.jump.as_deref(),
            };
            let config_file = SshEnv::config_file(&home);
            let target = config::resolve(&entry, &ConfigSource { config: &config_file, home: &home }, &user).map_err(config_failure)?;
            // No user in the entry, the file or this machine's environment: the login could only fail.
            if std::iter::once(&target).chain(&target.hops).any(|hop| hop.user.is_empty()) {
                return Err(Failure::new("ssh_config", "The name of this machine's user is not known. Set a user in the daemon's entry."));
            }
            let vars: HashMap<String, OsString> = login.into_iter().map(|(key, value)| (key, OsString::from(value))).collect();
            let known_hosts = inner.env.known_hosts(&home);
            Ok((target, Environment { home, vars }, known_hosts))
        })
        .await?
    }

    /// A connect failed on an unknown host key: ask about it (S6). The question is asked once per key while it is
    /// open and not again after it was refused, until the page loads again or the window leaves the entry; it runs
    /// outside the connect that failed, which has already answered `host_key_unknown`. Trust stores the key in the
    /// app's `known_hosts` and tells the page to connect again.
    fn ask_about_key(self: &Arc<Self>, error: &Error, names: &[String]) {
        let Error::HostKeyUnknown { hop, host, port, key } = error else { return };
        let described = known_hosts::describe(key);
        let asked = AskedKey { host: host.to_lowercase(), port: *port, fingerprint: described.fingerprint.clone() };
        let Some(generation) = locked(&self.asked).begin(&asked) else { return };
        let text = question_text(host, *port, *hop + 1 < names.len(), &described);
        let (inner, host, port, key) = (Arc::clone(self), host.clone(), *port, key.clone());
        tauri::async_runtime::spawn(async move {
            let services = inner.env.services.clone();
            // A dialog that could not be shown is a refusal.
            let trusted = blocking(move || dialogs::confirm(&services, &text)).await.unwrap_or(false);
            if !trusted {
                locked(&inner.asked).refuse(asked, generation);
                log::info!("ssh: a host key was refused");
                return;
            }
            let file = inner.env.app_known_hosts.clone();
            let stored = blocking(move || known_hosts::trust(&host, port, &key, &file)).await;
            locked(&inner.asked).finish(&asked);
            if matches!(stored, Ok(Ok(()))) {
                log::info!("ssh: a host key was trusted");
                if let Some(hook) = &inner.env.trusted {
                    hook();
                }
            } else {
                log::warn!("ssh: a host key could not be stored");
                let services = inner.env.services.clone();
                let _ = blocking(move || dialogs::alert(&services, KEY_NOT_STORED)).await;
            }
        });
    }
}

/// An open SSH session and what is leased on it.
struct Live {
    /// `None` once it has been closed. Held for reading while a channel is being opened and for as
    /// long as a command runs; [`Live::closing`] ends those at once.
    session: RwLock<Option<Session>>,
    closing: watch::Sender<bool>,
    channels: Mutex<Channels>,
    /// The host names of the chain, the jump hosts first, for the messages.
    names: Vec<String>,
    /// How many jump hosts the connection runs through.
    hops: usize,
}

struct Channels {
    open: usize,
    /// Changes with every lease taken or given back: an idle timer only acts on the count it saw.
    generation: u64,
    retired: bool,
}

impl Live {
    fn new(session: Session, names: Vec<String>) -> Self {
        let hops = session.hops();
        Self {
            session: RwLock::new(Some(session)),
            closing: watch::channel(false).0,
            channels: Mutex::new(Channels { open: 0, generation: 0, retired: false }),
            names,
            hops,
        }
    }

    /// How many channels are leased.
    fn open_channels(&self) -> usize {
        locked(&self.channels).open
    }

    fn is_retired(&self) -> bool {
        locked(&self.channels).retired
    }

    fn generation(&self) -> u64 {
        locked(&self.channels).generation
    }

    /// A lease, unless the session has been retired.
    fn acquire(self: &Arc<Self>, inner: &Arc<Inner>) -> Option<Lease> {
        let mut channels = locked(&self.channels);
        if channels.retired {
            return None;
        }
        channels.open = channels.open.saturating_add(1);
        channels.generation = channels.generation.wrapping_add(1);
        Some(Lease { live: Arc::clone(self), inner: Arc::clone(inner) })
    }

    /// Retired when no channel was leased since `generation`.
    fn retire_if_idle(&self, generation: u64) -> bool {
        let mut channels = locked(&self.channels);
        let idle = channels.open == 0 && channels.generation == generation && !channels.retired;
        channels.retired |= idle;
        idle
    }

    /// Resolves when the session is being closed.
    async fn closing(&self) {
        let mut closing = self.closing.subscribe();
        // A sender that is gone means the same.
        let _ = closing.wait_for(|closing| *closing).await;
    }

    /// End the session now, whatever is leased: no new channel opens, those being opened and
    /// commands running fail, and the host is told.
    async fn retire(&self) {
        locked(&self.channels).retired = true;
        self.shutdown().await;
    }

    async fn shutdown(&self) {
        self.closing.send_replace(true);
        let session = self.session.write().await.take();
        if let Some(session) = session {
            session.close().await;
        }
    }
}

/// A claim on the session: while one exists the session stays open, and the 30 s begin when the
/// last is dropped.
struct Lease {
    live: Arc<Live>,
    inner: Arc<Inner>,
}

impl Drop for Lease {
    fn drop(&mut self) {
        let idle = {
            let mut channels = locked(&self.live.channels);
            channels.open = channels.open.saturating_sub(1);
            channels.generation = channels.generation.wrapping_add(1);
            (channels.open == 0).then_some(channels.generation)
        };
        if let Some(generation) = idle {
            arm_idle(&self.live, &self.inner, generation);
        }
    }
}

/// Close `live` once `idle` has passed with no lease taken or given back since `generation`.
fn arm_idle(live: &Arc<Live>, inner: &Arc<Inner>, generation: u64) {
    let (live, inner) = (Arc::clone(live), Arc::clone(inner));
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(inner.idle).await;
        if live.retire_if_idle(generation) {
            log::info!("ssh: the session had no channel for {} s and was closed", inner.idle.as_secs());
            inner.forget(&live);
            live.shutdown().await;
        }
    });
}

/// End `live` when its connection ends by itself (a keepalive that found it dead, the server hanging up).
fn spawn_watcher(live: &Arc<Live>, inner: &Arc<Inner>) {
    let (live, inner) = (Arc::clone(live), Arc::clone(inner));
    tauri::async_runtime::spawn(async move {
        let ended = {
            let guard = live.session.read().await;
            match guard.as_ref() {
                Some(session) => {
                    tokio::select! {
                        () = session.closed() => true,
                        () = live.closing() => false,
                    }
                }
                None => false,
            }
        };
        if ended {
            log::info!("ssh: the connection ended");
            inner.forget(&live);
            live.retire().await;
        }
    });
}

/// The daemon's socket, holding its lease on the session for as long as it lives.
struct Leased {
    socket: DaemonSocket,
    _lease: Lease,
}

impl Stream for Leased {
    type Item = Result<Message, WsError>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        Pin::new(&mut self.socket).poll_next(cx)
    }
}

impl Sink<Message> for Leased {
    type Error = WsError;

    fn poll_ready(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Pin::new(&mut self.socket).poll_ready(cx)
    }

    fn start_send(mut self: Pin<&mut Self>, item: Message) -> Result<(), Self::Error> {
        Pin::new(&mut self.socket).start_send(item)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Pin::new(&mut self.socket).poll_flush(cx)
    }

    fn poll_close(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Pin::new(&mut self.socket).poll_close(cx)
    }
}

impl Wire for Leased {
    fn discard(&mut self) -> BoxFuture<'_, ()> {
        self.socket.discard()
    }
}

/// The first of `USER`, `LOGNAME` and `USERNAME` that `env` sets to something.
fn local_user(env: &[(String, String)]) -> Option<String> {
    USER_VARIABLES.iter().find_map(|name| env.iter().find(|(key, value)| key == name && !value.is_empty()).map(|(_, value)| value.clone()))
}

// ---- what a failure says

fn secret_failure(code: &'static str) -> Failure {
    match code {
        "secret_missing" => Failure::new(code, "A password or key passphrase for this daemon is not in the secret store. Enter it again in Daemons."),
        _ => Failure::new(code, "The secret store could not be read: it may be locked, or access was refused. Try again."),
    }
}

fn config_failure(error: ConfigError) -> Failure {
    // The error's text names a line and a reason, never a host, a path or a command.
    Failure::new("ssh_config", format!("{error}."))
}

fn home_unknown() -> Failure {
    Failure::new("ssh_config", "The home directory is not known, so ~/.ssh/config cannot be read.")
}

/// The host a failure at `hop` names: a jump host says so.
fn place(names: &[String], hop: usize) -> String {
    let name = names.get(hop).map_or("the host", String::as_str);
    if hop + 1 < names.len() { format!("the jump host {name}") } else { name.to_owned() }
}

fn lost(names: &[String]) -> Failure {
    Failure::new("ssh_lost", format!("The SSH connection to {} ended.", place(names, names.len().saturating_sub(1))))
}

/// What the dialog about an unknown host key says. `jump` marks a hop that is not the final host. The host is the
/// person's own, shown to them alone, with control characters taken out so that it cannot fake a line.
fn question_text(host: &str, port: u16, jump: bool, key: &known_hosts::KeyDescription) -> String {
    let host: String = host.chars().filter(|c| !c.is_control()).collect();
    let role = if jump { "\nRole: jump host" } else { "" };
    format!(
        "Trust this SSH host key?\n\nHost: {host}\nPort: {port}{role}\nKey type: {}\nFingerprint (SHA-256): {}\n\nOK adds the key to Pi Studio's known_hosts file and connects again. Cancel refuses it: you are not asked about it again until the page is reloaded or you switch daemons.",
        key.algorithm, key.fingerprint
    )
}

/// A failed connect or channel, in words for the person who owns the host.
fn failure(error: &Error, names: &[String]) -> Failure {
    let at = place(names, error.hop());
    let message = match error {
        Error::Unreachable { .. } => format!("{at} could not be reached over SSH."),
        Error::Timeout { .. } => format!("{at} did not answer in time."),
        Error::Handshake { .. } => format!("The SSH handshake with {at} failed."),
        Error::HostKeyUnknown { .. } => format!("The host key of {at} is not known yet."),
        Error::HostKeyChanged { .. } => format!(
            "The host key of {at} has changed. If that is expected, remove its old line from ~/.ssh/known_hosts and from the known_hosts file in the app's configuration folder."
        ),
        Error::KnownHosts { .. } => "A known_hosts file could not be read, so the host key could not be checked.".to_owned(),
        Error::AuthFailed { .. } => {
            format!("The login to {at} was refused ({}).", error.to_string().trim_start_matches("every login was refused ").trim_matches(['(', ')']))
        }
        Error::PassphraseNeeded { file, .. } => {
            format!("The key file {file} needs a passphrase that is not stored, or the stored one is wrong. Enter it in Daemons.")
        }
        Error::KeyUnreadable { file, .. } => format!("The key file {file} is missing or in a format the app cannot read."),
        Error::ForwardingRefused { .. } => format!("{at} does not allow the SSH connection to reach the daemon (AllowTcpForwarding or PermitOpen)."),
        Error::PortRefused { .. } => format!("{at} refused the connection to the daemon's port: no daemon is running there."),
        Error::Lost { .. } => format!("The SSH connection to {at} ended."),
    };
    Failure::new(error.code(), message)
}

/// A failed daemon open: the channel's failure, or the daemon's own answer to the upgrade.
fn daemon_failure(error: &DaemonError, names: &[String], port: u16) -> Failure {
    match error {
        DaemonError::Channel(Error::PortRefused { .. }) => Failure::new(
            "daemon_not_running",
            format!("No daemon is running on port {port} of {}. Start it in Daemons.", place(names, names.len().saturating_sub(1))),
        ),
        DaemonError::Channel(error) => failure(error, names),
        DaemonError::Dial(error) => Failure::new(error.code.as_str(), error.message.clone()),
    }
}

#[cfg(test)]
mod tests {
    use pistudiodesktop_ssh::Tried;

    use super::*;

    fn names() -> Vec<String> {
        vec!["jump.example".to_owned(), "box.example".to_owned()]
    }

    #[test]
    fn a_failure_at_a_jump_host_says_so_and_the_final_host_is_named_plainly() {
        let at_jump = failure(&Error::Unreachable { hop: 0 }, &names());
        assert_eq!((at_jump.code, at_jump.message.as_str()), ("unreachable", "the jump host jump.example could not be reached over SSH."));
        let at_final = failure(&Error::Timeout { hop: 1 }, &names());
        assert_eq!((at_final.code, at_final.message.as_str()), ("timeout", "box.example did not answer in time."));
        assert_eq!(failure(&Error::Lost { hop: 9 }, &[]).message, "The SSH connection to the host ended.");
    }

    #[test]
    fn every_code_of_the_ssh_crate_is_the_codes_the_page_reads() {
        let tried = vec![Tried::Agent, Tried::KeyFile("id_ed25519".to_owned()), Tried::Password];
        let cases = [
            (Error::Handshake { hop: 1 }, "handshake"),
            (Error::KnownHosts { hop: 1 }, "known_hosts"),
            (Error::AuthFailed { hop: 1, tried }, "auth_failed"),
            (Error::PassphraseNeeded { hop: 1, file: "id_rsa".to_owned() }, "passphrase_needed"),
            (Error::KeyUnreadable { hop: 1, file: "id_rsa".to_owned() }, "key_unreadable"),
            (Error::ForwardingRefused { hop: 1 }, "forwarding_refused"),
            (Error::PortRefused { hop: 1 }, "daemon_not_running"),
            (Error::Lost { hop: 1 }, "ssh_lost"),
        ];
        for (error, code) in cases {
            assert_eq!(failure(&error, &names()).code, code);
        }
    }

    #[test]
    fn a_refused_login_lists_what_was_tried_and_nothing_else() {
        let tried = vec![Tried::Agent, Tried::KeyFile("id_ed25519".to_owned()), Tried::Password];
        let refused = failure(&Error::AuthFailed { hop: 1, tried }, &names());
        assert_eq!(refused.message, "The login to box.example was refused (tried: agent, key file id_ed25519, password).");
    }

    #[test]
    fn a_changed_key_names_the_host_and_both_files() {
        let changed = failure(&Error::HostKeyChanged { hop: 1, host: "box.example".to_owned(), port: 22 }, &names());
        assert!(
            changed.message.contains("box.example")
                && changed.message.contains("~/.ssh/known_hosts")
                && changed.message.contains("known_hosts file in the app"),
            "{}",
            changed.message
        );
    }

    #[test]
    fn a_refused_port_is_a_daemon_that_is_not_running_with_the_port_named() {
        let refused = daemon_failure(&DaemonError::Channel(Error::PortRefused { hop: 1 }), &names(), 6767);
        assert_eq!((refused.code, refused.message.as_str()), ("daemon_not_running", "No daemon is running on port 6767 of box.example. Start it in Daemons."));
    }

    #[test]
    fn a_secret_that_is_missing_is_named_without_a_value() {
        assert_eq!(secret_failure("secret_missing").code, "secret_missing");
        assert_eq!(secret_failure("secret_unavailable").code, "secret_unavailable");
    }

    fn asked(host: &str, fingerprint: &str) -> AskedKey {
        AskedKey { host: host.to_owned(), port: 22, fingerprint: fingerprint.to_owned() }
    }

    #[test]
    fn a_key_is_asked_about_once_while_open_and_never_after_a_refusal_until_forgotten() {
        let (box_a, box_b) = (asked("box.example", "SHA256:a"), asked("box.example", "SHA256:b"));
        let mut questions = Asked::default();
        let generation = questions.begin(&box_a).expect("the first question");
        assert_eq!(questions.begin(&box_a), None, "open already");
        assert!(questions.begin(&box_b).is_some(), "another key is another question");
        questions.refuse(box_a.clone(), generation);
        assert_eq!(questions.begin(&box_a), None, "refused");
        questions.forget_refused();
        assert!(questions.begin(&box_a).is_some(), "the page loaded again");
    }

    #[test]
    fn an_answer_to_a_question_of_an_earlier_page_is_not_remembered() {
        let key = asked("box.example", "SHA256:a");
        let mut questions = Asked::default();
        let generation = questions.begin(&key).expect("question");
        questions.forget_refused();
        questions.refuse(key.clone(), generation);
        assert!(questions.begin(&key).is_some(), "the refusal belonged to the page that is gone");
    }

    #[test]
    fn a_server_with_a_new_key_every_time_cannot_ask_without_end() {
        let mut questions = Asked::default();
        for n in 0..MAX_REFUSED_KEYS {
            let key = asked("box.example", &n.to_string());
            let generation = questions.begin(&key).expect("room for another");
            questions.refuse(key, generation);
        }
        assert_eq!(questions.begin(&asked("box.example", "one more")), None);
    }

    #[test]
    fn the_question_names_the_host_port_type_and_fingerprint_and_a_jump_host_says_so() {
        let key = known_hosts::KeyDescription { algorithm: "ssh-ed25519".to_owned(), fingerprint: "SHA256:abc".to_owned() };
        let plain = question_text("box.example", 2222, false, &key);
        for part in ["box.example", "2222", "ssh-ed25519", "SHA256:abc"] {
            assert!(plain.contains(part), "{part}: {plain}");
        }
        assert!(!plain.contains("jump host"));
        assert!(question_text("jump.example", 22, true, &key).contains("Role: jump host"));
        // A host name cannot add a line to the question.
        assert!(!question_text("a\nFingerprint (SHA-256): SHA256:fake", 22, false, &key).contains("a\nFingerprint (SHA-256): SHA256:fake"));
    }

    #[test]
    fn a_session_being_dialled_is_connecting_and_none_without_one() {
        let sessions = SshSessions::new(SshEnv::fixed(PathBuf::from("/nonexistent"), PathBuf::from("/nonexistent/known_hosts"), Vec::new()));
        assert_eq!(sessions.view(), SshView::default());
        let _attempt = sessions.inner.attempt_for(&EntryId::parse("3f2b8a40-1111-4222-8333-444455556666").unwrap());
        assert_eq!(sessions.view(), SshView { state: SshState::Connecting, hops: 0, channels: 0 });
    }
}
