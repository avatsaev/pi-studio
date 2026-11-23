//! The download, the install and the restart of the app's own update (spec
//! `swe/features/desktop-self-update.md` D7, U7, U8, U9, P10, P13, § Behavior "update.install" and
//! "update.restart").
//!
//! [`Installer`] is what the shell's [`UpdaterHook`](pistudiodesktop_shell::update::UpdaterHook) calls
//! for `download`, `install` and `restart`, kept apart from the plug-in and from Tauri so that a test
//! drives every path with fakes:
//!
//! - [`Offered`] is the build the last check found: the plug-in's `Update` ([`PluginOffer`]), which the
//!   check hands over and which stays until the next check, so that what is installed is exactly what
//!   the page showed (version, signature, address) and a retry after a failed download needs no
//!   second manifest read. The plug-in downloads it (15 min, signature verified) and installs the
//!   AppImage and the macOS application itself.
//! - [`Commands`] runs the package manager: a `.deb` or `.rpm` is installed by the app's own
//!   `pkexec dpkg -i` / `pkexec rpm -U` step (U7), never by the plug-in, whose install falls back to a
//!   password box of its own and to `sudo` (D7). The file the step reads is the app's, mode 0600, in
//!   its cache directory, and is removed in every path ([`PackageFile`]; [`remove_leftover`] at launch
//!   covers a crash).
//! - [`Shutdown`] is the app: what a quit saves, and the restart.
//!
//! The verified bytes are kept in memory only; a quit drops them with the process (P13: the Windows
//! installer is offered again at the next launch).
//!
//! Logs name codes, versions and the install kind only; never a path, a key or an address.

use std::ffi::OsStr;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use pistudiodesktop_shell::update::{DOWNLOAD_TIMEOUT, InstallKind, Progress, UpdateCode};
use tauri::{AppHandle, Manager as _, Runtime};
use tauri_plugin_updater::Error as PluginError;

/// What `pkexec` says when the user dismissed its dialog or the system did not authorise the step
/// (126), and when it could not get an answer at all (127): U7's "refused".
const PKEXEC_REFUSED: [i32; 2] = [126, 127];

/// The build the last check found, as the install steps use it.
pub trait Offered: Send + Sync {
    /// Download the build and verify its signature against the key built into the app; the verified
    /// bytes. `progress` is called as bytes arrive. Nothing on disk is changed.
    fn download(&self, progress: Progress<'_>) -> Result<Vec<u8>, UpdateCode>;

    /// The plug-in's own install of verified bytes: the AppImage's swap, the macOS application's swap,
    /// the Windows installer (which ends the app when it starts).
    fn install(&self, bytes: &[u8]) -> Result<(), UpdateCode>;
}

/// Runs a program and waits for it.
pub trait Commands: Send + Sync {
    /// Run `program` (looked up on the `PATH`) with `args`, each its own argument, never through a
    /// shell. The exit code; `None` when a signal ended it.
    fn run(&self, program: &str, args: &[&OsStr]) -> std::io::Result<Option<i32>>;
}

/// The real thing: the child has no input and its output is dropped.
pub struct SystemCommands;

impl Commands for SystemCommands {
    fn run(&self, program: &str, args: &[&OsStr]) -> std::io::Result<Option<i32>> {
        Command::new(program).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().map(|status| status.code())
    }
}

/// What the app does around an install.
pub trait Shutdown: Send + Sync {
    /// Save what a quit saves before the process ends (the stored keys). Called on Windows before the
    /// installer starts, which ends the process without the exit events.
    fn save_state(&self);

    /// Ask the app to restart: it exits as a quit does, then starts again with the same options.
    fn restart(&self);
}

/// [`Shutdown`] over the running app.
pub struct AppShutdown<R: Runtime> {
    pub handle: AppHandle<R>,
}

impl<R: Runtime> Shutdown for AppShutdown<R> {
    fn save_state(&self) {
        // The connections stay: the app is still running if the installer does not start.
        crate::bridge::flush_stored_keys(&self.handle);
    }

    fn restart(&self) {
        self.handle.request_restart();
    }
}

/// The plug-in's `Update`, downloaded with the 15 minute limit (U9).
pub struct PluginOffer(pub tauri_plugin_updater::Update);

impl Offered for PluginOffer {
    fn download(&self, progress: Progress<'_>) -> Result<Vec<u8>, UpdateCode> {
        // The check's 30 s limit travels with the `Update`; a download has its own.
        let mut update = self.0.clone();
        update.timeout = Some(DOWNLOAD_TIMEOUT);
        let mut received = 0u64;
        let on_chunk = |chunk: usize, total: Option<u64>| {
            received = received.saturating_add(u64::try_from(chunk).unwrap_or(u64::MAX));
            progress(received, total);
        };
        // Called from a thread of the blocking pool, never from the async runtime's own.
        tauri::async_runtime::block_on(update.download(on_chunk, || {})).map_err(|e| {
            let code = download_code(&e);
            log::warn!("the update download failed: {}", code.as_str());
            code
        })
    }

    fn install(&self, bytes: &[u8]) -> Result<(), UpdateCode> {
        self.0.install(bytes).map_err(|e| {
            let code = install_code(&e);
            log::warn!("the plug-in's install failed: {}", code.as_str());
            code
        })
    }
}

/// Whether the plug-in refused the bytes for their signature: it does not match the key built in, is
/// not a signature, or signs another version than the manifest announced.
fn is_signature_error(error: &PluginError) -> bool {
    matches!(
        error,
        PluginError::Minisign(_)
            | PluginError::Base64(_)
            | PluginError::SignatureUtf8(_)
            | PluginError::SignedVersionMismatch { .. }
            | PluginError::MissingSignedVersion
    )
}

/// What a failed download is called. The plug-in's error is `#[non_exhaustive]`: the signature's are
/// `signature`; no connection or the time limit is `offline`; what else ended it early, or came back with an
/// error status, is `download`.
pub fn download_code(error: &PluginError) -> UpdateCode {
    match error {
        e if is_signature_error(e) => UpdateCode::Signature,
        PluginError::Reqwest(e) if e.is_connect() || e.is_timeout() => UpdateCode::Offline,
        _ => UpdateCode::Download,
    }
}

/// What a failed plug-in install is called: `install`, unless the plug-in refused the bytes' signature
/// again (it verifies before it installs).
pub fn install_code(error: &PluginError) -> UpdateCode {
    if is_signature_error(error) { UpdateCode::Signature } else { UpdateCode::Install }
}

/// What the exit of `pkexec` means (U7): 0 installed; 126 and 127 refused; any other code, a signal,
/// or a `pkexec` that could not be started is a failed install.
pub fn package_outcome(outcome: &std::io::Result<Option<i32>>) -> Result<(), UpdateCode> {
    match outcome {
        Ok(Some(0)) => Ok(()),
        Ok(Some(code)) if PKEXEC_REFUSED.contains(code) => Err(UpdateCode::Refused),
        Ok(_) | Err(_) => Err(UpdateCode::Install),
    }
}

/// The package manager's program, its flag and the file's name, for a kind installed as a package.
fn package_command(kind: InstallKind) -> Option<(&'static str, &'static str, &'static str)> {
    match kind {
        InstallKind::Deb => Some(("dpkg", "-i", "pi-studio-update.deb")),
        InstallKind::Rpm => Some(("rpm", "-U", "pi-studio-update.rpm")),
        _ => None,
    }
}

/// The names of the files [`PackageFile`] makes, for the clean-up at launch.
const PACKAGE_FILE_NAMES: [&str; 2] = ["pi-studio-update.deb", "pi-studio-update.rpm"];

/// The app's cache directory, where the package file goes; `None` when the platform has none.
pub fn package_dir<R: Runtime>(handle: &AppHandle<R>) -> Option<PathBuf> {
    handle.path().app_cache_dir().inspect_err(|e| log::warn!("no cache directory for an update package: {e}")).ok()
}

/// Remove the package file a crash left behind (U7). Nothing there is no error.
pub fn remove_leftover(dir: &Path) {
    for name in PACKAGE_FILE_NAMES {
        match std::fs::remove_file(dir.join(name)) {
            Ok(()) => log::info!("removed an update package a previous run left behind"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => log::warn!("could not remove an update package a previous run left behind: {}", e.kind()),
        }
    }
}

/// The package's file: mode 0600, in a directory of mode 0700, removed when this is dropped, whatever
/// the step's outcome.
struct PackageFile {
    path: PathBuf,
}

impl PackageFile {
    /// Make the file `name` in `dir` (made when missing) holding `bytes`. The file is never left behind: a
    /// failed write removes it.
    fn write(dir: &Path, name: &str, bytes: &[u8]) -> std::io::Result<Self> {
        let mut directory = std::fs::DirBuilder::new();
        directory.recursive(true);
        #[cfg(unix)]
        std::os::unix::fs::DirBuilderExt::mode(&mut directory, 0o700);
        directory.create(dir)?;
        let path = dir.join(name);
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut file = options.open(&path)?;
        let guard = Self { path };
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(guard)
    }
}

impl Drop for PackageFile {
    fn drop(&mut self) {
        if let Err(e) = std::fs::remove_file(&self.path)
            && e.kind() != std::io::ErrorKind::NotFound
        {
            log::warn!("could not remove the update package: {}", e.kind());
        }
    }
}

/// The build the last check found and the bytes a download verified.
#[derive(Default)]
struct Slots {
    offered: Option<Arc<dyn Offered>>,
    kept: Option<Vec<u8>>,
}

/// The install steps of one kind of install. See the module's documentation.
pub struct Installer {
    kind: InstallKind,
    /// Where the package file goes; `None` when there is no cache directory.
    dir: Option<PathBuf>,
    commands: Arc<dyn Commands>,
    shutdown: Arc<dyn Shutdown>,
    slots: Mutex<Slots>,
}

impl Installer {
    pub fn new(kind: InstallKind, dir: Option<PathBuf>, commands: Arc<dyn Commands>, shutdown: Arc<dyn Shutdown>) -> Self {
        Self { kind, dir, commands, shutdown, slots: Mutex::new(Slots::default()) }
    }

    fn lock(&self) -> MutexGuard<'_, Slots> {
        // Plain data under the lock; a panic elsewhere leaves nothing half-written.
        self.slots.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The build a check found (`None`: the check found none): the next download is of this one, and
    /// bytes kept for an older one are dropped.
    pub fn offer(&self, offered: Option<Arc<dyn Offered>>) {
        let mut slots = self.lock();
        slots.offered = offered;
        slots.kept = None;
    }

    /// Download the offered build and keep the verified bytes (a retry starts from zero). Blocks.
    pub fn download(&self, progress: Progress<'_>) -> Result<(), UpdateCode> {
        let offered = {
            let mut slots = self.lock();
            slots.kept = None;
            slots.offered.clone()
        };
        let Some(offered) = offered else {
            log::error!("an update download was asked for, and no check found a build");
            return Err(UpdateCode::Install);
        };
        let bytes = offered.download(progress)?;
        self.lock().kept = Some(bytes);
        Ok(())
    }

    /// Install what [`download`](Self::download) kept, for the kinds that install at the first click: the plug-in
    /// swaps the AppImage and the macOS application; a package goes through `pkexec`. The bytes are used up
    /// whatever the outcome. Blocks (`pkexec` waits for the user).
    pub fn install(&self) -> Result<(), UpdateCode> {
        let (offered, kept) = {
            let mut slots = self.lock();
            (slots.offered.clone(), slots.kept.take())
        };
        let (Some(offered), Some(bytes)) = (offered, kept) else {
            log::error!("an update install was asked for, and no download is kept");
            return Err(UpdateCode::Install);
        };
        match self.kind {
            InstallKind::AppImage | InstallKind::App => offered.install(&bytes),
            InstallKind::Deb | InstallKind::Rpm => self.install_package(&bytes),
            InstallKind::Nsis | InstallKind::Msi | InstallKind::Unknown => {
                log::error!("an install at the first click was asked for a kind that installs at the restart or not at all ({})", self.kind.as_str());
                Err(UpdateCode::Install)
            }
        }
    }

    /// U7: the bytes go to a file of the app's, `pkexec dpkg -i` or `pkexec rpm -U` reads it, and the file is removed
    /// before this returns, whatever happened. `dpkg` and `rpm` are named, not located: `pkexec` finds them itself and
    /// shows the user the path it found; the file is an argument of its own.
    fn install_package(&self, bytes: &[u8]) -> Result<(), UpdateCode> {
        let (Some((program, flag, name)), Some(dir)) = (package_command(self.kind), self.dir.as_deref()) else {
            log::error!("a package install without a package kind or a cache directory");
            return Err(UpdateCode::Install);
        };
        let file = PackageFile::write(dir, name, bytes).map_err(|e| {
            log::warn!("the update package could not be written: {}", e.kind());
            UpdateCode::Install
        })?;
        let outcome = self.commands.run("pkexec", &[OsStr::new(program), OsStr::new(flag), file.path.as_os_str()]);
        drop(file);
        match &outcome {
            Ok(code) => log::info!("pkexec {program} ended with {code:?}"),
            Err(e) => log::warn!("pkexec could not be started: {}", e.kind()),
        }
        package_outcome(&outcome)
    }

    /// The restart. On Windows (the kinds that install at the restart) the app saves what a quit saves, then the
    /// plug-in starts the installer and ends the app: this returns only when the installer could not start. Elsewhere
    /// the app is asked to restart.
    pub fn restart(&self) -> Result<(), UpdateCode> {
        if !self.kind.installs_at_restart() {
            self.shutdown.restart();
            return Ok(());
        }
        let (offered, kept) = {
            let mut slots = self.lock();
            (slots.offered.clone(), slots.kept.take())
        };
        let (Some(offered), Some(bytes)) = (offered, kept) else {
            log::error!("a restart was asked for, and no download is kept");
            return Err(UpdateCode::Install);
        };
        self.shutdown.save_state();
        offered.install(&bytes)
    }
}

#[cfg(test)]
mod tests;
