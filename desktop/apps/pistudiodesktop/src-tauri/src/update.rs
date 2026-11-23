//! The app's self-update, in the app binary: the updater plug-in behind the shell's
//! [`UpdaterHook`], the install kind and what it can install over, the owner of the actions the
//! `update.*` commands queue, the schedule of the checks the app makes by itself, and "Check for
//! Updates…"'s answer (spec `swe/features/desktop-self-update.md` § 6, § Behavior, U4, U9–U13).
//!
//! The state and its transitions are `pistudiodesktop_shell::update`, with no Tauri in it. This
//! file is what touches the world:
//!
//! - [`PluginUpdater`] reads the manifest through the plug-in (30 s limit), for the entry of this
//!   install's kind, and answers whether a newer build exists. The plug-in alone talks to the
//!   network; the page has no permission for it (P1).
//! - [`Env`] is how this copy was installed ([`kind_of`]) and where it lives. [`cannot_install_with`]
//!   is the rule of when a newer build can not be installed in place, over injected probes.
//! - [`Runner`] takes the actions the owner thread hands over ([`pistudiodesktop_shell::owner::Notify::update`]),
//!   begins them and runs them on the blocking pool, answers the menu with U11's dialog, and carries out
//!   the schedule of P16 (at launch, every hour on [`start`]'s thread, after a wake: [`on_wake`]).
//! - [`notify_page`] tells the page of every change with the `update_changed` event.
//! - [`install::Installer`] is the download, the install and the restart behind [`PluginUpdater`]: the plug-in
//!   downloads (15 min limit, signature verified) and swaps the AppImage and the macOS application, the app's own
//!   `pkexec` step installs a `.deb` or `.rpm`, and on Windows the installer runs at the restart (U7, U8).
//!   The restart asks the close question first when transfers run (P10), in [`Runner`].
//!
//! Logs name codes, versions and the install kind only; never a path, a key or an address.

mod install;

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{RecvTimeoutError, Sender, channel};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use pistudiodesktop_engine::{UpdateAction, command_specs};
use pistudiodesktop_shell::owner_access::OwnerAccess;
use pistudiodesktop_shell::page::{CloseDecision, close_decision};
use pistudiodesktop_shell::process;
use pistudiodesktop_shell::update::{
    CHECK_TIMEOUT, CheckOutcome, InstallKind, Manifest, Notify, Offer, Origin, Progress, Reason, TICK_MS, Trigger, UpdateCode, UpdateState, Updater,
    UpdaterHook,
};
use serde_json::{Value, json};
use tauri::utils::config::BundleType;
use tauri::{AppHandle, Emitter as _, Manager as _, RunEvent, Runtime, Url};
use tauri_plugin_updater::UpdaterExt as _;

use self::install::{AppShutdown, Installer, PluginOffer, SystemCommands};

/// The event the page hears on every change of the state; the payload is the state as `boot`'s `update`.
pub const EVENT: &str = "update_changed";

/// Where "a newer build is available" links when the manifest names no release page of its own.
const RELEASES_URL: &str = "https://github.com/avatsaev/pi-studio/releases";

/// The manifest address `--update-manifest` named, or the one in `tauri.conf.json` (U4).
pub fn manifest(argument: Option<&Url>) -> Manifest {
    argument.map_or(Manifest::Default, |url| Manifest::Override(url.to_string()))
}

// --- the install kind and what it can install over ----------------------------------------------

/// The `Contents/MacOS` of an application bundle: the executable's directory is `MacOS`, inside
/// `Contents`, inside a `*.app`.
fn inside_app_bundle(exe: &Path) -> bool {
    let mut up = exe.ancestors().skip(1);
    let named = |dir: Option<&Path>, name: &str| dir.and_then(Path::file_name) == Some(OsStr::new(name));
    named(up.next(), "MacOS") && named(up.next(), "Contents") && up.next().and_then(Path::extension) == Some(OsStr::new("app"))
}

/// How a copy was installed, from the bundle type the bundler stamped into the binary and the
/// executable's path. macOS reports `App` for every binary, so there it counts only inside a
/// `*.app/Contents/MacOS`; a binary from `cargo run` is `Unknown`, like a development build anywhere.
pub fn kind_of(bundle: Option<BundleType>, exe: &Path) -> InstallKind {
    match bundle {
        Some(BundleType::AppImage) => InstallKind::AppImage,
        Some(BundleType::Deb) => InstallKind::Deb,
        Some(BundleType::Rpm) => InstallKind::Rpm,
        Some(BundleType::Msi) => InstallKind::Msi,
        Some(BundleType::Nsis) => InstallKind::Nsis,
        Some(BundleType::App) if inside_app_bundle(exe) => InstallKind::App,
        Some(BundleType::App | BundleType::Dmg) | None => InstallKind::Unknown,
    }
}

/// An application run from a disk image or a translocated (quarantined) copy (U13).
fn read_only_location(exe: &Path) -> bool {
    exe.starts_with("/Volumes") || exe.components().any(|part| part.as_os_str() == "AppTranslocation")
}

/// Where this copy lives and what the system offers.
#[derive(Clone, Debug)]
pub struct Place {
    /// The running executable.
    pub exe: PathBuf,
    /// The AppImage file (`APPIMAGE`), when run from one.
    pub appimage: Option<PathBuf>,
    /// The `PATH`, where `pkexec` is looked for.
    pub path: Option<OsString>,
}

/// Why a newer build can not be installed over a copy of `kind` at `place`, if it can not (P12). The
/// probes are arguments: whether a file or a directory can be written, and whether `pkexec` is on the path.
/// - an unknown kind: a development build;
/// - an AppImage: its file or its directory not writable;
/// - an application under `/Volumes` or `AppTranslocation`: a read-only location;
/// - a `.deb` or `.rpm` with no `pkexec`: D7.
pub fn cannot_install_with(kind: InstallKind, place: &Place, writable: impl Fn(&Path) -> bool, has_pkexec: bool) -> Option<Reason> {
    match kind {
        InstallKind::Unknown => Some(Reason::DevelopmentBuild),
        InstallKind::AppImage => {
            let file = place.appimage.as_deref().unwrap_or(&place.exe);
            let directory_ok = file.parent().is_none_or(&writable);
            (!(writable(file) && directory_ok)).then_some(Reason::NotWritable)
        }
        InstallKind::App => read_only_location(&place.exe).then_some(Reason::ReadOnlyLocation),
        InstallKind::Deb | InstallKind::Rpm => (!has_pkexec).then_some(Reason::NoPkexec),
        InstallKind::Nsis | InstallKind::Msi => None,
    }
}

/// Whether the user can write `path`: a directory takes a file created and removed in it, a file must
/// have a write bit. (`std` has no `access`; the AppImage swap needs the directory most.)
fn is_writable(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else { return false };
    if !meta.is_dir() {
        return !meta.permissions().readonly();
    }
    let probe = path.join(format!(".pi-studio-update-probe-{}", std::process::id()));
    match std::fs::OpenOptions::new().write(true).create_new(true).open(&probe) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return false,
    }
    // A probe that stays behind harms nothing, and the answer is still yes.
    let _ = std::fs::remove_file(&probe);
    true
}

/// Whether `name` is an executable file in one of the directories of `path`.
fn on_path(name: &str, path: Option<&OsStr>, is_executable: impl Fn(&Path) -> bool) -> bool {
    path.is_some_and(|path| std::env::split_paths(path).any(|dir| is_executable(&dir.join(name))))
}

/// The key of this kind's entry in the manifest (P3, P4): the plug-in's `{os}-{arch}` plus the kind's
/// name. The macOS entries carry no kind; an unknown kind reads the entry of the system's first one (U12).
fn entry_target(base: &str, kind: InstallKind) -> String {
    let suffix = match kind {
        InstallKind::AppImage => "-appimage",
        InstallKind::Deb => "-deb",
        InstallKind::Rpm => "-rpm",
        InstallKind::Nsis => "-nsis",
        InstallKind::Msi => "-msi",
        InstallKind::App => "",
        InstallKind::Unknown if cfg!(target_os = "macos") => "",
        InstallKind::Unknown if cfg!(windows) => "-nsis",
        InstallKind::Unknown => "-appimage",
    };
    format!("{base}{suffix}")
}

/// Where this copy is and how it was installed.
#[derive(Clone, Debug)]
pub struct Env {
    pub kind: InstallKind,
    pub place: Place,
}

impl Env {
    /// Read the running process: the bundle type, the executable, `APPIMAGE` and `PATH`.
    pub fn detect() -> Self {
        let exe = std::env::current_exe().unwrap_or_default();
        let kind = kind_of(tauri::utils::platform::bundle_type(), &exe);
        Self { kind, place: Place { exe, appimage: std::env::var_os("APPIMAGE").map(PathBuf::from), path: std::env::var_os("PATH") } }
    }
}

// --- the check, through the plug-in -------------------------------------------------------------

/// What a failed check is called (the spec's error table). The plug-in's error is `#[non_exhaustive]`:
/// what is not named here is the network layer's, so `offline`.
fn check_code(error: &tauri_plugin_updater::Error) -> UpdateCode {
    use tauri_plugin_updater::Error as E;
    match error {
        E::TargetNotFound(_) | E::TargetsNotFound(_) | E::UnsupportedOs | E::UnsupportedArch => UpdateCode::NoTarget,
        // A body that is not JSON, JSON that is not a manifest, a version that is not one, a bad
        // endpoint, an endpoint that is not HTTPS in a release build.
        E::Serialization(_) | E::Semver(_) | E::UrlParse(_) | E::EmptyEndpoints | E::InsecureTransportProtocol => UpdateCode::ManifestInvalid,
        E::Reqwest(e) if e.is_decode() => UpdateCode::ManifestInvalid,
        // No answer, a refused connection, a failed TLS handshake, the time limit, a 404 for a moment
        // (the plug-in then has no release).
        _ => UpdateCode::Offline,
    }
}

/// The release page the manifest's `notes` names, when it is an `https` address; the releases page
/// otherwise. The notes come from the network and the page opens this address on a click.
fn release_url(notes: Option<&str>) -> String {
    notes.map(str::trim).filter(|notes| Url::parse(notes).is_ok_and(|url| url.scheme() == "https")).unwrap_or(RELEASES_URL).to_owned()
}

/// The shell's [`UpdaterHook`] over the updater plug-in. `R` is the app's runtime (the plug-in must be registered on it).
pub struct PluginUpdater<R: Runtime> {
    handle: AppHandle<R>,
    env: Env,
    installer: Installer,
}

impl<R: Runtime> PluginUpdater<R> {
    /// The hook of the running app: `pkexec` is the system's and the restart is the app's.
    pub fn new(handle: AppHandle<R>, env: Env) -> Self {
        let installer = Installer::new(env.kind, install::package_dir(&handle), Arc::new(SystemCommands), Arc::new(AppShutdown { handle: handle.clone() }));
        Self { handle, env, installer }
    }

    /// The plug-in's updater for `manifest` and this kind, with the 30 s limit (U9).
    fn updater(&self, manifest: &Manifest) -> Result<tauri_plugin_updater::Updater, UpdateCode> {
        let mut builder = self.handle.updater_builder().timeout(CHECK_TIMEOUT);
        if let Manifest::Override(address) = manifest {
            let url: Url = address.parse().map_err(|_| UpdateCode::ManifestInvalid)?;
            builder = builder.endpoints(vec![url]).map_err(|e| check_code(&e))?;
        }
        let base = tauri_plugin_updater::target().ok_or(UpdateCode::NoTarget)?;
        builder.target(entry_target(&base, self.env.kind)).build().map_err(|e| check_code(&e))
    }
}

impl<R: Runtime> UpdaterHook for PluginUpdater<R> {
    fn check(&self, manifest: &Manifest) -> Result<CheckOutcome, UpdateCode> {
        let updater = self.updater(manifest)?;
        // Called from a thread of the blocking pool, never from the async runtime's own.
        match tauri::async_runtime::block_on(updater.check()) {
            Ok(Some(update)) => {
                let offer = Offer { version: update.version.clone(), release_url: release_url(update.body.as_deref()) };
                // The build the page is shown is the one a click installs: the `Update` stays until the next check.
                self.installer.offer(Some(Arc::new(PluginOffer(update))));
                Ok(CheckOutcome::Found(offer))
            }
            Ok(None) => {
                self.installer.offer(None);
                Ok(CheckOutcome::UpToDate)
            }
            Err(e) => Err(check_code(&e)),
        }
    }

    fn install_kind(&self) -> InstallKind {
        self.env.kind
    }

    fn cannot_install(&self, kind: InstallKind, _version: &str) -> Option<Reason> {
        let pkexec = on_path("pkexec", self.env.place.path.as_deref(), process::is_executable);
        cannot_install_with(kind, &self.env.place, is_writable, pkexec)
    }

    fn download(&self, progress: Progress<'_>) -> Result<(), UpdateCode> {
        self.installer.download(progress)
    }

    fn install(&self) -> Result<(), UpdateCode> {
        self.installer.install()
    }

    fn restart(&self) -> Result<(), UpdateCode> {
        self.installer.restart()
    }
}

/// Remove the package file a crash left in the cache directory (U7). Call it once at launch.
pub fn remove_leftover<R: Runtime>(handle: &AppHandle<R>) {
    if let Some(dir) = install::package_dir(handle) {
        install::remove_leftover(&dir);
    }
}

// --- the page ---------------------------------------------------------------------------------------

/// The shell's notification of every change of the state: the page hears [`EVENT`], and the native
/// menu is drawn again when "Check for Updates…" turns on or off. Runs with the updater's lock held:
/// it only emits, and the menu is drawn on a thread of its own.
pub fn notify_page<R: Runtime>(handle: AppHandle<R>) -> Notify {
    let was_enabled = AtomicBool::new(true);
    Arc::new(move |state: &UpdateState| {
        if let Err(e) = handle.emit(EVENT, state) {
            log::warn!("the page could not be told of the update's state: {e}");
        }
        let enabled = state.check_refusal().is_none();
        if was_enabled.swap(enabled, Ordering::SeqCst) != enabled {
            crate::menu::install(handle.clone());
        }
    })
}

// --- the owner of the actions ---------------------------------------------------------------------

/// What the native dialogs of the self-update need: a message with OK, a question with Install and Later,
/// and the close question with OK and Cancel.
pub trait Prompts: Send + Sync {
    /// Show `message` and wait for it to be dismissed.
    fn alert(&self, message: &str);
    /// Ask whether to install; `true` for Install, `false` for Later or a dialog closed.
    fn offer(&self, message: &str) -> bool;
    /// Ask `question`; `true` for OK, `false` for Cancel or a dialog closed.
    fn confirm(&self, question: &str) -> bool;
}

/// The session's way to run a registry command, off its own thread (the owner thread's channel).
pub trait Owner: Send + Sync {
    fn execute(&self, command: &str, params: Value) -> Result<Value, String>;
}

impl Owner for OwnerAccess {
    fn execute(&self, command: &str, params: Value) -> Result<Value, String> {
        OwnerAccess::execute(self, command, params)
    }
}

/// What "Check for Updates…" shows once its check is over (U11).
#[derive(Debug, PartialEq, Eq)]
enum Answer {
    Alert(String),
    Offer(String),
}

/// The dialog U11 gives for what a manual check reached; `current` is this app's version.
fn answer_for(result: &Result<UpdateState, UpdateCode>, current: &str) -> Option<Answer> {
    match result {
        Ok(UpdateState::UpToDate { .. }) => Some(Answer::Alert(format!("Pi Studio {current} is up to date."))),
        Ok(UpdateState::Available { version, .. }) => Some(Answer::Offer(format!("Pi Studio {version} is available."))),
        Ok(UpdateState::CannotInstall { version, reason, .. }) => Some(Answer::Alert(format!("Pi Studio {version} is available. {}.", reason.text()))),
        Err(code) => Some(Answer::Alert(code.text().to_owned())),
        Ok(_) => None,
    }
}

/// Work for the blocking pool.
type Job = Box<dyn FnOnce() + Send>;

/// The wall clock in milliseconds since the Unix epoch (0 when the clock is before it).
fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).ok().and_then(|since| u64::try_from(since.as_millis()).ok()).unwrap_or(0)
}

/// Carries out the actions of the update: the ones the commands queue, the menu's, and the schedule's.
pub struct Runner {
    updater: Arc<Updater>,
    prompts: Arc<dyn Prompts>,
    owner: Arc<dyn Owner>,
    /// This app's version, for "is up to date".
    current: String,
    /// How many file transfers run now: the close question's count (P10).
    transfers: Arc<dyn Fn() -> usize + Send + Sync>,
    /// The menu asked for the check it is about to queue, and wants U11's dialog at its end.
    dialog_wanted: AtomicBool,
    /// A restart is being asked about or made: a second click waits for nothing and asks nothing.
    restarting: AtomicBool,
}

impl Runner {
    pub fn new(
        updater: Arc<Updater>,
        prompts: Arc<dyn Prompts>,
        owner: Arc<dyn Owner>,
        current: String,
        transfers: Arc<dyn Fn() -> usize + Send + Sync>,
    ) -> Self {
        Self { updater, prompts, owner, current, transfers, dialog_wanted: AtomicBool::new(false), restarting: AtomicBool::new(false) }
    }

    /// Whether "Check for Updates…" may be clicked now (the menu item's enabled state).
    pub fn check_enabled(&self) -> bool {
        self.updater.state().check_refusal().is_none()
    }

    /// An `update.*` command was accepted: begin the action, quickly, and run it on the blocking
    /// pool. Called on the owner thread, which must never wait.
    pub fn handle(self: &Arc<Self>, action: UpdateAction) {
        if let Some(job) = self.prepare(action) {
            tauri::async_runtime::spawn_blocking(job);
        }
    }

    /// Begin `action` and return what is left to run, or `None` when nothing is (the state refused
    /// it, which `enabled` already said and the log records).
    fn prepare(self: &Arc<Self>, action: UpdateAction) -> Option<Job> {
        let runner = Arc::clone(self);
        match action {
            UpdateAction::Check => {
                let dialog = self.dialog_wanted.swap(false, Ordering::SeqCst);
                match self.updater.begin_check(Origin::Manual, now_ms()) {
                    Ok(ticket) => Some(Box::new(move || {
                        let result = runner.updater.run_check(ticket);
                        if dialog {
                            runner.show(&result);
                        }
                    })),
                    Err(refusal) => {
                        log::info!("update check not begun: {refusal}");
                        dialog.then(|| Box::new(move || runner.prompts.alert(&refusal.to_string())) as Job)
                    }
                }
            }
            UpdateAction::Install => match self.updater.begin_install() {
                Ok(ticket) => Some(Box::new(move || {
                    // The state carries the outcome.
                    let _ = runner.updater.run_install(ticket);
                })),
                Err(refusal) => {
                    log::info!("update install not begun: {refusal}");
                    None
                }
            },
            UpdateAction::Restart => Some(Box::new(move || runner.restart())),
        }
    }

    /// "Restart to update" (P10): with transfers running the close question is asked first and Cancel keeps
    /// everything as it is (the update stays installed, waiting); otherwise, or on OK, the restart is made
    /// (Windows runs its installer here, U8). Blocks on the dialog: runs on the blocking pool.
    fn restart(&self) {
        if let Some(refusal) = self.updater.state().restart_refusal() {
            log::info!("update restart not begun: {refusal}");
            return;
        }
        if self.restarting.swap(true, Ordering::SeqCst) {
            log::info!("update restart not begun: a restart is already asked for");
            return;
        }
        if let CloseDecision::Ask(question) = close_decision((self.transfers)())
            && !self.prompts.confirm(&question)
        {
            log::info!("update restart not made: the close question was answered no");
            self.restarting.store(false, Ordering::SeqCst);
            return;
        }
        // An accepted restart leaves the flag set: the app is on its way out. One that failed (the Windows
        // installer did not start) is the state's `failed`, and its retry may come back here.
        match self.updater.restart() {
            Ok(()) if self.updater.state().restart_refusal().is_some() => self.restarting.store(false, Ordering::SeqCst),
            Ok(()) => {}
            Err(refusal) => {
                log::info!("update restart not begun: {refusal}");
                self.restarting.store(false, Ordering::SeqCst);
            }
        }
    }

    /// The menu was clicked ("Check for Updates…"): run `update.check` like any caller, and have
    /// the answer shown as U11's dialog when the check is over. Blocks on dialogs: call it off the
    /// owner thread and off the event loop.
    pub fn menu_check(&self) {
        self.dialog_wanted.store(true, Ordering::SeqCst);
        if let Err(reason) = self.owner.execute("update.check", json!({})) {
            self.dialog_wanted.store(false, Ordering::SeqCst);
            self.prompts.alert(&reason);
        }
    }

    /// The dialog of U11 for a finished manual check; Install runs `update.install`.
    fn show(&self, result: &Result<UpdateState, UpdateCode>) {
        match answer_for(result, &self.current) {
            Some(Answer::Alert(message)) => self.prompts.alert(&message),
            Some(Answer::Offer(message)) => {
                if self.prompts.offer(&message)
                    && let Err(reason) = self.owner.execute("update.install", json!({}))
                {
                    self.prompts.alert(&reason);
                }
            }
            None => {}
        }
    }

    /// The `checkForUpdates` setting as it is now; `None` when the session did not answer.
    fn checks_enabled(&self) -> Option<bool> {
        match self.owner.execute("settings.get", json!({})) {
            Ok(settings) => Some(settings["checkForUpdates"].as_bool().unwrap_or(true)),
            Err(e) => {
                log::warn!("the setting `checkForUpdates` could not be read: {e}");
                None
            }
        }
    }

    /// One step of the schedule (P16): when a check is due, make it (a failure is silent: the
    /// updater logs the code). Blocks for the length of the check.
    pub fn scheduled(&self, trigger: Trigger) {
        let Some(enabled) = self.checks_enabled() else { return };
        if let Some(ticket) = self.updater.scheduled(trigger, enabled, now_ms()) {
            // The state and the log carry the outcome.
            let _ = self.updater.run_check(ticket);
        }
    }
}

/// A wake from sleep: the schedule's step for it, on the blocking pool (the resume ticker's thread must not wait).
pub fn on_wake<R: Runtime>(handle: &AppHandle<R>) {
    if let Some(runner) = handle.try_state::<Arc<Runner>>() {
        let runner = Arc::clone(&runner);
        tauri::async_runtime::spawn_blocking(move || runner.scheduled(Trigger::Elapsed));
    }
}

// --- the schedule's thread ---------------------------------------------------------------------

/// The running schedule thread, managed by Tauri. Dropping it, or [`stop`](Self::stop), ends the thread.
pub struct Ticker {
    stop: Sender<()>,
}

impl Ticker {
    pub fn stop(&self) {
        // The thread may be gone already: nothing is left to stop.
        let _ = self.stop.send(());
    }
}

/// Start the thread: the check at launch (when `checkForUpdates` allows it), then a step of the
/// schedule every [`TICK_MS`] (an hour). A check runs on this thread, so the next tick waits for it.
pub fn start(runner: Arc<Runner>) -> Ticker {
    let (stop, stopped) = channel::<()>();
    let spawned = std::thread::Builder::new().name("update-ticker".into()).spawn(move || {
        runner.scheduled(Trigger::Launch);
        while matches!(stopped.recv_timeout(Duration::from_millis(TICK_MS)), Err(RecvTimeoutError::Timeout)) {
            runner.scheduled(Trigger::Elapsed);
        }
        log::debug!("the update ticker stopped");
    });
    if let Err(e) = spawned {
        log::warn!("the update ticker did not start: {e}; the app checks for updates only when asked");
    }
    Ticker { stop }
}

/// Stop the thread when the app exits.
pub fn on_run_event<R: Runtime>(handle: &AppHandle<R>, event: &RunEvent) {
    if matches!(event, RunEvent::Exit)
        && let Some(ticker) = handle.try_state::<Ticker>()
    {
        ticker.stop();
    }
}

/// The label and the menu name of "Check for Updates…" as the registry has them.
pub fn check_menu_entry() -> Option<(&'static str, &'static str)> {
    command_specs().iter().find(|spec| spec.id == pistudiodesktop_shell::menus::UPDATE_CHECK_ID).and_then(|spec| Some((*spec.menu.first()?, spec.label)))
}

#[cfg(test)]
mod tests;
