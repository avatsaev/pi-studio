//! The app's self-update: the state the window shows, the transitions between its states, and the
//! schedule of the checks the app makes by itself (spec `swe/features/desktop-self-update.md`
//! § 4 and § Behavior, "The app").
//!
//! The shell holds no updater of its own: everything that touches the network, the disk or the
//! operating system is behind [`UpdaterHook`], which the app binary fills with the Tauri plug-in
//! ([`Services::updater`](crate::services::Services)). Here is only plain data and decisions, so a
//! test drives every transition with a fake hook and a fake clock. Nothing in this module reads a
//! clock: the caller passes `now_ms` (milliseconds since the Unix epoch) in.
//!
//! One [`Updater`] is shared (an `Arc`) between the owner thread, the app's ticker thread and the
//! worker threads that carry out a check or an install. Each action has two halves, like the
//! supervisors:
//!
//! - `begin_*` is quick, changes the state and may run on any thread; it refuses with a
//!   [`Refusal`] when the state does not allow the action, and otherwise returns a ticket;
//! - `run_*` takes the ticket and **blocks** on the hook (a download takes minutes): whoever calls
//!   it must not be the thread that owns the session or the UI thread.
//!
//! The state is in memory only; a launch starts from `idle`. Every change is passed to the
//! notification the app set ([`Updater::set_notify`]), which the app turns into the page's
//! `update_changed` event. Logs name codes, versions and the install kind only.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Map, Value, json};

/// The time limit of one check (the hook enforces it).
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
/// The time limit of one download (the hook enforces it).
pub const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// The checks the app makes by itself are at least this far apart (P16): 24 hours.
pub const CHECK_INTERVAL_MS: u64 = 24 * 60 * 60 * 1000;
/// How often the app's ticker is to call [`Updater::scheduled`] with [`Trigger::Elapsed`].
pub const TICK_MS: u64 = 60 * 60 * 1000;
/// With no known size, a progress change is sent to the page once this many more bytes arrived.
const UNSIZED_STEP: u64 = 256 * 1024;

/// What went wrong, as the page and `ui.inspect` name it (`failed.code`, `lastError`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateCode {
    /// The manifest or the file could not be reached (no network, DNS, TLS, time limit).
    Offline,
    /// The manifest is not JSON, not the format, or holds a version that is not one.
    ManifestInvalid,
    /// The manifest has no entry for this install's kind.
    NoTarget,
    /// The file's signature does not match the key built in.
    Signature,
    /// The download ended early or returned an error status.
    Download,
    /// The install step failed.
    Install,
    /// `pkexec` was dismissed or did not authorise.
    Refused,
}

impl UpdateCode {
    /// The name in JSON and in logs.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Offline => "offline",
            Self::ManifestInvalid => "manifest_invalid",
            Self::NoTarget => "no_target",
            Self::Signature => "signature",
            Self::Download => "download",
            Self::Install => "install",
            Self::Refused => "refused",
        }
    }

    /// What the user is shown (the indicator's tooltip, the check's dialog).
    pub fn text(self) -> &'static str {
        match self {
            Self::Offline => "Could not reach the update server",
            Self::ManifestInvalid => "The update information is not valid",
            Self::NoTarget => "No update for this kind of install",
            Self::Signature => "The update's signature does not match",
            Self::Download => "The download failed",
            Self::Install => "The update could not be installed",
            Self::Refused => "The system did not allow the install",
        }
    }
}

/// Why a newer build is shown but cannot be installed in place (P12).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    /// A development build: the install kind is not one the updater serves (U12).
    DevelopmentBuild,
    /// An AppImage file or its directory the user cannot write to.
    NotWritable,
    /// An application run from a disk image or a quarantined copy (U13).
    ReadOnlyLocation,
    /// A `.deb` or `.rpm` install and no `pkexec` on the path (D7).
    NoPkexec,
}

impl Reason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DevelopmentBuild => "development_build",
            Self::NotWritable => "not_writable",
            Self::ReadOnlyLocation => "read_only_location",
            Self::NoPkexec => "no_pkexec",
        }
    }

    /// What the user is shown (the indicator's tooltip).
    pub fn text(self) -> &'static str {
        match self {
            Self::DevelopmentBuild => "This is a development build; it cannot update itself",
            Self::NotWritable => "The app's file or its folder is not writable",
            Self::ReadOnlyLocation => "The app runs from a disk image or a quarantined copy; move it to Applications first",
            Self::NoPkexec => "Installing a package needs pkexec, which is not available",
        }
    }
}

/// How this copy of the app was installed: the bundle type, and on macOS whether it runs inside a
/// `.app`. The kind chooses the entry of the manifest and the way the update is installed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallKind {
    AppImage,
    Deb,
    Rpm,
    App,
    Nsis,
    Msi,
    /// None of the above (a development build).
    Unknown,
}

impl InstallKind {
    /// The name in `ui.inspect` (`kind`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AppImage => "appimage",
            Self::Deb => "deb",
            Self::Rpm => "rpm",
            Self::App => "app",
            Self::Nsis => "nsis",
            Self::Msi => "msi",
            Self::Unknown => "unknown",
        }
    }

    /// Whether the update is installed at the restart, not at the first click (U8): the Windows
    /// installers replace the running program, so the first click only downloads and verifies.
    pub fn installs_at_restart(self) -> bool {
        matches!(self, Self::Nsis | Self::Msi)
    }
}

/// A newer build the manifest offers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Offer {
    pub version: String,
    /// The release page's address (the manifest's `notes`).
    pub release_url: String,
}

/// What a check found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CheckOutcome {
    Found(Offer),
    /// The manifest names a version equal to or older than this one (never a downgrade, P11).
    UpToDate,
}

/// Which manifest a check reads (U4).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Manifest {
    /// The one in `tauri.conf.json`.
    Default,
    /// The address of `--update-manifest`. Not logged.
    Override(String),
}

impl Manifest {
    /// The name in `ui.inspect` (`manifest`).
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Override(_) => "override",
        }
    }
}

/// A progress report of a download: bytes received so far and the total, when known.
pub type Progress<'a> = &'a (dyn Fn(u64, Option<u64>) + Send + Sync);

/// The updater of the app binary: the plug-in and the operating system behind it. Every method
/// may block (a check is bounded by [`CHECK_TIMEOUT`], a download by [`DOWNLOAD_TIMEOUT`], `pkexec`
/// by the user), so the shell calls them off the owner thread only ([`Updater::run_check`] and
/// [`Updater::run_install`] are the callers); [`install_kind`](Self::install_kind) and
/// [`cannot_install`](Self::cannot_install) read the process and the disk and answer at once.
///
/// The hook holds what a download fetched (the verified bytes) between [`download`](Self::download)
/// and [`install`](Self::install) or [`restart`](Self::restart).
pub trait UpdaterHook: Send + Sync {
    /// Read the manifest and say whether it offers a build newer than this one, for the entry of
    /// this install's kind (the system's first kind when the kind is unknown, U12).
    fn check(&self, manifest: &Manifest) -> Result<CheckOutcome, UpdateCode>;

    /// How this copy was installed.
    fn install_kind(&self) -> InstallKind;

    /// Why `version` cannot be installed over a copy of this `kind` in place (not writable, a
    /// read-only location, no `pkexec`), if it cannot. Not asked for [`InstallKind::Unknown`]: the
    /// shell already knows that one is a development build.
    fn cannot_install(&self, kind: InstallKind, version: &str) -> Option<Reason>;

    /// Download the offered build and verify its signature, keeping the bytes. `progress` is
    /// called as bytes arrive. Nothing on disk is changed.
    fn download(&self, progress: Progress<'_>) -> Result<(), UpdateCode>;

    /// Install what [`download`](Self::download) kept. Not called for the kinds that install at the
    /// restart ([`InstallKind::installs_at_restart`]).
    fn install(&self) -> Result<(), UpdateCode>;

    /// Start the installed build. On the kinds that install at the restart this installs first
    /// and ends the app (it returns only when the installer could not start: the code is then
    /// [`UpdateCode::Install`]); elsewhere it asks the app to restart and always returns `Ok`.
    fn restart(&self) -> Result<(), UpdateCode>;
}

/// The state of the update, as the page receives it (`boot`'s `update`, the `update_changed`
/// event): `{ "state": "<variant>", …camelCase fields }`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum UpdateState {
    /// Nothing known yet, or checks are off.
    Idle,
    Checking,
    UpToDate {
        /// When the check that found it ran: milliseconds since the Unix epoch.
        checked_at: u64,
    },
    Available {
        version: String,
        release_url: String,
    },
    Downloading {
        version: String,
        received: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        total: Option<u64>,
    },
    RestartNeeded {
        version: String,
    },
    CannotInstall {
        version: String,
        release_url: String,
        reason: Reason,
    },
    Failed {
        code: UpdateCode,
        /// Set when the failure is of a download or an install: a retry is possible.
        #[serde(skip_serializing_if = "Option::is_none")]
        version: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        release_url: Option<String>,
    },
}

/// Why an action was not started. The text is the reason a registry command returns.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// The app has no updater (the browser build, a platform without one).
    Unavailable,
    /// A check is running.
    Checking,
    /// A download or an install is running.
    Downloading,
    /// The update is installed; the app only has to restart (P14).
    RestartNeeded,
    /// No newer build is known, or the one known cannot be installed in place.
    NothingToInstall,
    /// No update is waiting for a restart.
    NotRestartNeeded,
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Unavailable => "updates are not available in this app",
            Self::Checking => "an update check is already running",
            Self::Downloading => "an update is downloading",
            Self::RestartNeeded => "the update is installed: restart the app to finish it",
            Self::NothingToInstall => "there is no update to install",
            Self::NotRestartNeeded => "no update is waiting for a restart",
        })
    }
}

impl UpdateState {
    /// Why `update.check` cannot run in this state; `None` when it can. A check runs from every
    /// state but `downloading` and `restart_needed` (P14), and not while one runs.
    pub fn check_refusal(&self) -> Option<Refusal> {
        match self {
            Self::Downloading { .. } => Some(Refusal::Downloading),
            Self::RestartNeeded { .. } => Some(Refusal::RestartNeeded),
            Self::Checking => Some(Refusal::Checking),
            _ => None,
        }
    }

    /// Why `update.install` cannot run in this state: it needs `available`, or `failed` with the
    /// version that was being installed.
    pub fn install_refusal(&self) -> Option<Refusal> {
        match self {
            Self::Available { .. } | Self::Failed { version: Some(_), release_url: Some(_), .. } => None,
            Self::Downloading { .. } => Some(Refusal::Downloading),
            Self::Checking => Some(Refusal::Checking),
            Self::RestartNeeded { .. } => Some(Refusal::RestartNeeded),
            _ => Some(Refusal::NothingToInstall),
        }
    }

    /// Why `update.restart` cannot run in this state: it needs `restart_needed`.
    pub fn restart_refusal(&self) -> Option<Refusal> {
        match self {
            Self::RestartNeeded { .. } => None,
            _ => Some(Refusal::NotRestartNeeded),
        }
    }
}

/// Who asked for a check: it decides what a failure does (P16).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origin {
    /// The schedule: a failure is silent, the state before stays.
    Automatic,
    /// The menu, the page or the control channel: a failure is `failed`.
    Manual,
}

/// What asks the schedule whether a check is due (P16).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trigger {
    /// The app has just started: always due.
    Launch,
    /// The hourly tick, or a wake from sleep: due when the last check is [`CHECK_INTERVAL_MS`] old.
    Elapsed,
}

/// Whether a check is due (P16): never when `enabled` is false; at [`Trigger::Launch`] always;
/// at [`Trigger::Elapsed`] when no check ran yet or the last one began [`CHECK_INTERVAL_MS`] ago or
/// more. A wall clock set back before the last check counts as due (the baseline is lost). The
/// state's own bar (nothing runs in `restart_needed`, nor while checking or downloading) is
/// [`Updater::begin_check`]'s.
pub fn due(trigger: Trigger, enabled: bool, last_check_ms: Option<u64>, now_ms: u64) -> bool {
    if !enabled {
        return false;
    }
    match (trigger, last_check_ms) {
        (Trigger::Launch, _) | (Trigger::Elapsed, None) => true,
        (Trigger::Elapsed, Some(last)) => now_ms < last || now_ms - last >= CHECK_INTERVAL_MS,
    }
}

/// Whether a progress report is worth sending to the page: the percent moved, the total became
/// known or the transfer ended; or, with no known total, [`UNSIZED_STEP`] more bytes arrived.
fn worth_sending(sent: (u64, Option<u64>), received: u64, total: Option<u64>) -> bool {
    let known = total.filter(|t| *t > 0);
    match known {
        Some(t) => sent.1 != total || received >= t || received.saturating_mul(100) / t != sent.0.saturating_mul(100) / t,
        None => received.saturating_sub(sent.0) >= UNSIZED_STEP || (sent.1.is_some() && total.is_none()),
    }
}

/// A check begun by [`Updater::begin_check`]; [`Updater::run_check`] carries it out.
pub struct CheckTicket {
    hook: Arc<dyn UpdaterHook>,
    origin: Origin,
    now_ms: u64,
}

impl CheckTicket {
    pub fn origin(&self) -> Origin {
        self.origin
    }
}

/// An install begun by [`Updater::begin_install`]; [`Updater::run_install`] carries it out.
pub struct InstallTicket {
    hook: Arc<dyn UpdaterHook>,
    version: String,
    release_url: String,
    kind: InstallKind,
}

/// The callback for every change of the state. It runs with the updater's lock held, so it must
/// not call the [`Updater`] (hand the state to the page's event and return).
pub type Notify = Arc<dyn Fn(&UpdateState) + Send + Sync>;

struct Inner {
    state: UpdateState,
    /// The state a check began from, which an automatic check's failure puts back.
    before_check: UpdateState,
    /// The release page of the build an install left waiting for its restart, which a failed
    /// restart (the Windows installer could not start) puts back into the failed state.
    installed_url: Option<String>,
    /// When the last check began (the schedule's baseline), on the caller's clock.
    last_check_ms: Option<u64>,
    last_error: Option<UpdateCode>,
    /// What the page last heard of a download: bytes and total.
    sent: (u64, Option<u64>),
    notify: Option<Notify>,
}

impl Inner {
    fn set(&mut self, state: UpdateState) {
        if self.state == state {
            return;
        }
        self.state = state;
        self.sent = (0, None);
        self.send();
    }

    fn send(&self) {
        if let Some(notify) = &self.notify {
            notify(&self.state);
        }
    }
}

/// The update state and its transitions. See the module's documentation.
pub struct Updater {
    hook: Option<Arc<dyn UpdaterHook>>,
    manifest: Manifest,
    inner: Mutex<Inner>,
}

impl Updater {
    /// An updater over `hook` (`None`: the app has none, every action is refused with
    /// [`Refusal::Unavailable`] and the state stays `idle`) reading `manifest`.
    pub fn new(hook: Option<Arc<dyn UpdaterHook>>, manifest: Manifest) -> Self {
        Self {
            hook,
            manifest,
            inner: Mutex::new(Inner {
                state: UpdateState::Idle,
                before_check: UpdateState::Idle,
                installed_url: None,
                last_check_ms: None,
                last_error: None,
                sent: (0, None),
                notify: None,
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        // Plain data under the lock; a panic elsewhere leaves nothing half-written.
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Call `notify` with the state on every change from now on (the page's `update_changed`).
    pub fn set_notify(&self, notify: Notify) {
        self.lock().notify = Some(notify);
    }

    /// The state now.
    pub fn state(&self) -> UpdateState {
        self.lock().state.clone()
    }

    /// The state as JSON: `boot`'s `update` and the `update_changed` event's payload.
    pub fn state_json(&self) -> Value {
        state_json(&self.state())
    }

    /// The `ui.inspect` part `update` (P18): the state's fields and `current` (this app's version),
    /// `kind`, `checksEnabled`, `manifest`, `lastCheckAt` and `lastError` (the last two only when
    /// there are any).
    pub fn inspect(&self, current: &str, checks_enabled: bool) -> Value {
        let kind = self.hook.as_ref().map_or(InstallKind::Unknown, |h| h.install_kind());
        let inner = self.lock();
        let mut part = match state_json(&inner.state) {
            Value::Object(fields) => fields,
            _ => Map::new(),
        };
        part.insert("current".into(), json!(current));
        part.insert("kind".into(), json!(kind.as_str()));
        part.insert("checksEnabled".into(), json!(checks_enabled));
        part.insert("manifest".into(), json!(self.manifest.as_str()));
        if let Some(at) = inner.last_check_ms {
            part.insert("lastCheckAt".into(), json!(at));
        }
        if let Some(code) = inner.last_error {
            part.insert("lastError".into(), json!(code.as_str()));
        }
        Value::Object(part)
    }

    /// Whether the schedule says a check is due now (P16). Reads only; see [`scheduled`](Self::scheduled).
    pub fn is_due(&self, trigger: Trigger, enabled: bool, now_ms: u64) -> bool {
        due(trigger, enabled, self.lock().last_check_ms, now_ms)
    }

    /// The schedule's one step: when a check is due ([`due`]) and the state allows one, begin it
    /// as [`Origin::Automatic`]. The app calls it at launch, on the hourly tick and on a wake, with
    /// `enabled` the `checkForUpdates` setting as it is now. `None` means nothing to do.
    pub fn scheduled(&self, trigger: Trigger, enabled: bool, now_ms: u64) -> Option<CheckTicket> {
        if !self.is_due(trigger, enabled, now_ms) {
            return None;
        }
        self.begin_check(Origin::Automatic, now_ms).ok()
    }

    /// Begin a check: the state becomes `checking` and the time is the schedule's new baseline.
    /// Refused while downloading, after an install (`restart_needed`, P14) and while a check runs.
    pub fn begin_check(&self, origin: Origin, now_ms: u64) -> Result<CheckTicket, Refusal> {
        let hook = self.hook.clone().ok_or(Refusal::Unavailable)?;
        let mut inner = self.lock();
        if let Some(refusal) = inner.state.check_refusal() {
            return Err(refusal);
        }
        inner.before_check = inner.state.clone();
        inner.last_check_ms = Some(now_ms);
        inner.set(UpdateState::Checking);
        Ok(CheckTicket { hook, origin, now_ms })
    }

    /// Carry out a check. Blocks until the manifest answers or the hook's time limit passes.
    /// `Ok` carries the state reached: `available`, `cannot_install` or `up_to_date`. `Err` is the
    /// code: after a manual check the state is `failed`; after an automatic one it is what it was
    /// (the code is logged and kept as `lastError`).
    pub fn run_check(&self, ticket: CheckTicket) -> Result<UpdateState, UpdateCode> {
        match ticket.hook.check(&self.manifest) {
            Ok(CheckOutcome::UpToDate) => {
                let mut inner = self.lock();
                inner.last_error = None;
                inner.set(UpdateState::UpToDate { checked_at: ticket.now_ms });
                log::info!("update check: up to date");
                Ok(inner.state.clone())
            }
            Ok(CheckOutcome::Found(offer)) => {
                let kind = ticket.hook.install_kind();
                let reason = match kind {
                    InstallKind::Unknown => Some(Reason::DevelopmentBuild),
                    _ => ticket.hook.cannot_install(kind, &offer.version),
                };
                let Offer { version, release_url } = offer;
                log::info!("update check: {version} is available (kind {}, cannot install: {:?})", kind.as_str(), reason.map(Reason::as_str));
                let mut inner = self.lock();
                inner.last_error = None;
                inner.set(match reason {
                    Some(reason) => UpdateState::CannotInstall { version, release_url, reason },
                    None => UpdateState::Available { version, release_url },
                });
                Ok(inner.state.clone())
            }
            Err(code) => {
                log::warn!("update check failed: {}", code.as_str());
                let mut inner = self.lock();
                inner.last_error = Some(code);
                let next = match ticket.origin {
                    Origin::Automatic => inner.before_check.clone(),
                    Origin::Manual => UpdateState::Failed { code, version: None, release_url: None },
                };
                inner.set(next);
                Err(code)
            }
        }
    }

    /// Begin an install (the first click): the state becomes `downloading`. Needs `available`, or
    /// `failed` with the version that failed (a retry starts from zero).
    pub fn begin_install(&self) -> Result<InstallTicket, Refusal> {
        let hook = self.hook.clone().ok_or(Refusal::Unavailable)?;
        let mut inner = self.lock();
        if let Some(refusal) = inner.state.install_refusal() {
            return Err(refusal);
        }
        let (version, release_url) = match &inner.state {
            UpdateState::Available { version, release_url } => (version.clone(), release_url.clone()),
            UpdateState::Failed { version: Some(version), release_url: Some(release_url), .. } => (version.clone(), release_url.clone()),
            _ => return Err(Refusal::NothingToInstall),
        };
        let kind = hook.install_kind();
        inner.set(UpdateState::Downloading { version: version.clone(), received: 0, total: None });
        Ok(InstallTicket { hook, version, release_url, kind })
    }

    /// Carry out an install: download and verify, then (except where the installer runs at the
    /// restart) install; the state becomes `restart_needed`. Any error leaves `failed(code,
    /// version, releaseUrl)`: nothing is changed on disk by a failed step. Blocks like the hook.
    pub fn run_install(&self, ticket: InstallTicket) -> Result<(), UpdateCode> {
        let report = |received: u64, total: Option<u64>| self.progress(received, total);
        let done = ticket.hook.download(&report).and_then(|()| if ticket.kind.installs_at_restart() { Ok(()) } else { ticket.hook.install() });
        let mut inner = self.lock();
        match done {
            Ok(()) => {
                log::info!("update {} installed (kind {}); a restart is needed", ticket.version, ticket.kind.as_str());
                inner.last_error = None;
                inner.installed_url = Some(ticket.release_url);
                inner.set(UpdateState::RestartNeeded { version: ticket.version });
                Ok(())
            }
            Err(code) => {
                log::warn!("update {} failed: {}", ticket.version, code.as_str());
                inner.last_error = Some(code);
                inner.set(UpdateState::Failed { code, version: Some(ticket.version), release_url: Some(ticket.release_url) });
                Err(code)
            }
        }
    }

    /// A download's progress. Only a `downloading` state takes it; the page hears it when it is
    /// worth a message ([`worth_sending`]).
    fn progress(&self, received: u64, total: Option<u64>) {
        let mut inner = self.lock();
        let sent = inner.sent;
        let UpdateState::Downloading { received: now, total: size, .. } = &mut inner.state else { return };
        *now = received;
        *size = total;
        if worth_sending(sent, received, total) {
            inner.sent = (received, total);
            inner.send();
        }
    }

    /// The restart: only from `restart_needed`. Calls the hook's [`restart`](UpdaterHook::restart),
    /// which on Windows runs the installer and ends the app. The close question (P10) is the
    /// caller's, asked before this. `Ok` means the restart was asked for; when the hook says the
    /// installer could not start the state becomes `failed(code, version, releaseUrl)` (a retry
    /// downloads again) and the app keeps running.
    pub fn restart(&self) -> Result<(), Refusal> {
        let hook = self.hook.clone().ok_or(Refusal::Unavailable)?;
        let version = match &self.lock().state {
            UpdateState::RestartNeeded { version } => version.clone(),
            _ => return Err(Refusal::NotRestartNeeded),
        };
        if let Err(code) = hook.restart() {
            log::warn!("update {version} could not be started: {}", code.as_str());
            let mut inner = self.lock();
            inner.last_error = Some(code);
            let release_url = inner.installed_url.clone();
            inner.set(UpdateState::Failed { code, version: Some(version), release_url });
        }
        Ok(())
    }
}

fn state_json(state: &UpdateState) -> Value {
    // A plain enum of strings and numbers: serialising it cannot fail.
    serde_json::to_value(state).unwrap_or(Value::Null)
}

#[cfg(test)]
mod tests;
