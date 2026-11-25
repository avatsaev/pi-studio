//! Platform services, injected by each app binary. The shell asks for what it needs through
//! these hooks, so this crate has no dialogs, clipboard or OS code of its own, and the same shell
//! runs in the desktop app and in headless tests.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// Show a native confirmation with `message` and wait for the answer: `true` only for the
/// affirmative button, `false` for the other button and for closing the dialog.
/// A hook may block until the dialog is closed, so whoever calls it ([`crate::dialogs::confirm`])
/// must not be the thread that owns the session or the UI thread.
pub type ConfirmHook = Arc<dyn Fn(&str) -> bool + Send + Sync>;

/// Show a native message with `message` and wait until it is closed. Blocks like [`ConfirmHook`].
pub type AlertHook = Arc<dyn Fn(&str) + Send + Sync>;

/// Hand `url` to the system's default application. The shell has checked it already
/// ([`crate::links::check`]); the error says why the system could not open it, without the URL.
pub type OpenUrlHook = Arc<dyn Fn(&str) -> Result<(), String> + Send + Sync>;

/// Show a native save dialog suggesting the file name given (already reduced to a bare name by
/// [`crate::saves::file_name`]), starting in the folder given when there is one, and wait for the
/// user. The path the user chose, or `None` when the dialog was cancelled or could not be shown.
/// Blocks like [`ConfirmHook`].
pub type PickSavePathHook = Arc<dyn Fn(&str, Option<&Path>) -> Option<PathBuf> + Send + Sync>;

/// Show a native open dialog for one or more files, starting in the folder given when there is one,
/// and wait for the user. The paths the user chose; empty when the dialog was cancelled, could not
/// be shown, or answered with something that is not a file path. Blocks like [`ConfirmHook`].
pub type PickFilesHook = Arc<dyn Fn(Option<&Path>) -> Vec<PathBuf> + Send + Sync>;

/// A program to run, for [`RunHook`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    /// The whole environment of the program: nothing is inherited. May hold tokens, so a `RunSpec`
    /// is never logged.
    pub env: Vec<(String, String)>,
    /// A program that runs longer is killed, with its children.
    pub limit: Duration,
}

/// Why a program gave no output.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunFailure {
    CouldNotStart,
    TimedOut,
}

/// Run a program and give its standard output (lossy UTF-8); the exit code is not reported, the
/// CLI's answer is in its output. Blocks until the program ends or its limit passes.
pub type RunHook = Arc<dyn Fn(&RunSpec) -> Result<String, RunFailure> + Send + Sync>;

/// The environment of the app's own process.
pub type EnvHook = Arc<dyn Fn() -> Vec<(String, String)> + Send + Sync>;

/// The user's home directory.
pub type HomeDirHook = Arc<dyn Fn() -> Option<PathBuf> + Send + Sync>;

/// The version the daemon listening on `host:port` (the address the supervisor connects to) reports on its health
/// endpoint; `None` when it cannot be read within a few seconds. The app fills it with an HTTP request to the
/// loopback; the shell holds no socket. Blocks.
pub type DaemonVersionHook = Arc<dyn Fn(&str, u16) -> Option<String> + Send + Sync>;

/// What an install of the pinned daemon binary failed with, as the local daemon's states name it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InstallFailure {
    /// The archive could not be fetched (no network, a refused or stalled download, a disk that cannot hold it):
    /// `download_failed`.
    Download,
    /// The archive is not the pinned file; it was deleted and nothing of it was run: `checksum_mismatch`.
    Checksum,
    /// The archive could not be unpacked, or its program does not answer the pinned version, or `current` could not be
    /// switched: `install_failed`. `output` is what the unpacked program printed, when it ran.
    Install { output: Option<String> },
}

/// How far an install has come.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallProgress {
    /// Bytes received of the archive's size, reported on every piece (the supervisor throttles what the page sees).
    Downloading { received: u64, total: u64 },
    /// The archive is complete and verified; it is being unpacked and checked.
    Installing,
}

/// The daemon installer, behind the shell's one view of it: `crates/install` is above the shell, so the app fills this
/// hook with an object over that crate and over the launch's pin. Every method blocks (a download takes as long as the
/// link needs): whoever calls it ([`crate::supervisor`]) must not own the session.
pub trait Installer: Send + Sync {
    /// The pinned version.
    fn version(&self) -> &str;

    /// Whether `<bin_dir>/versions/<pinned version>` already holds a program that answers the pinned version; when it
    /// does, `current` is switched to it and `true` is answered, with no download.
    fn adopt_installed(&self, bin_dir: &Path) -> bool;

    /// Fetch the pinned archive (the cache, or a download), check it, unpack it into `<bin_dir>/versions/<version>`
    /// and switch `current` to it. Reports its progress; nothing of an archive that failed its checksum is run.
    fn install(&self, bin_dir: &Path, progress: &mut dyn FnMut(InstallProgress)) -> Result<(), InstallFailure>;

    /// After a start that left the daemon running: remove the version folders other than `current` and the previous
    /// one, and every archive of the cache but the pin's. Best effort.
    fn tidy(&self, bin_dir: &Path);
}

/// What the app's proxied daemon connections look like now, for `ui.inspect`
/// (`connection.transports`, `connection.lastError`). Runs on the thread that owns the session:
/// it must only read counters, never wait on a socket or a lock held across an await.
pub type TransportsHook = Arc<dyn Fn() -> crate::transports::Snapshot + Send + Sync>;

/// What the transfer engine is doing now, for `ui.inspect` (`transfers`). Runs on the thread that
/// owns the session: it must only read counters, never wait on a socket or a lock held across an await.
pub type TransfersHook = Arc<dyn Fn() -> crate::transfers_view::Snapshot + Send + Sync>;

/// What a command run on the SSH host gave.
#[derive(Clone, PartialEq, Eq)]
pub struct RemoteOutput {
    /// The command's exit status, as the host's shell reported it between the markers.
    pub status: i32,
    /// What the command printed on standard output, markers removed. May hold a pairing link:
    /// never logged, never kept.
    pub stdout: String,
}

impl std::fmt::Debug for RemoteOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RemoteOutput").field("status", &self.status).finish_non_exhaustive()
    }
}

/// Why a command on the SSH host gave no output.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemoteRunFailure {
    /// The command could not be run: no SSH session, a refused channel, a lost connection.
    ExecFailed,
    /// The host's shell printed no marker: the account runs no commands.
    NoShell,
    /// The command ran longer than its limit and was killed.
    TimedOut,
}

/// Run `command` (given as typed, the hook wraps it for the login shell) on the current SSH
/// entry's host and give its status and standard output; killed after the limit. Blocks until
/// then: whoever calls it ([`crate::remote_supervisor`]) must not own the session. The app fills
/// it over the entry's SSH session; the shell holds no socket.
pub type RemoteRunHook = Arc<dyn Fn(&str, Duration) -> Result<RemoteOutput, RemoteRunFailure> + Send + Sync>;

/// Why a file did not reach the SSH host.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemoteSendFailure {
    /// The host's own command failed (no space left, no permission, no such folder): what it said is worth showing.
    Rejected,
    /// No channel, a stall, a lost connection, or the file could not be read.
    Failed,
}

/// Write the file at the local path (given second) on the current SSH entry's host at the absolute path given first, with
/// the file's size and the stall limit (no total limit), telling the callback the bytes sent so far. Blocks until the
/// file is there or the send failed: whoever calls it ([`crate::remote_supervisor`]) must not own the session. The app
/// fills it over the entry's SSH session; the shell holds no socket. Neither the path nor the data is logged.
pub type RemoteSendHook = Arc<dyn Fn(&str, &Path, u64, Duration, &mut dyn FnMut(u64)) -> Result<(), RemoteSendFailure> + Send + Sync>;

/// The version the daemon behind the current SSH entry's session reports on its health endpoint; `None` when it cannot
/// be read within a few seconds. Blocks like [`RemoteRunHook`].
pub type RemoteDaemonVersionHook = Arc<dyn Fn() -> Option<String> + Send + Sync>;

/// A pinned daemon archive on the app's disk, ready to send.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Archive {
    pub path: PathBuf,
    /// The file's size in bytes, as the pin says (the cache checked it).
    pub size: u64,
    /// The file's SHA-256 as the pin says, 64 hexadecimal digits.
    pub sha256: String,
}

/// Why a pinned archive could not be had.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FetchFailure {
    /// No network, a refused or stalled download, a disk that cannot hold it: `download_failed`.
    Download,
    /// The download is not the pinned file; it was deleted: `checksum_mismatch`.
    Checksum,
}

/// The pinned daemon archives, behind the shell's view of them: `crates/install` is above the shell. Blocks (a download
/// takes as long as the link needs): whoever calls it must not own the session.
pub trait ArchiveSource: Send + Sync {
    /// The pinned version.
    fn version(&self) -> &str;

    /// The archive of the pin for `target` (one of the four published systems), from the app's archive cache or
    /// downloaded into it; the callback gets `(received, total)` bytes while it downloads. A cached file is used only
    /// when it matches the pin.
    fn fetch(&self, target: &str, progress: &mut dyn FnMut(u64, u64)) -> Result<Archive, FetchFailure>;
}

/// Every hook is optional: where one is missing (tests, a platform without it), what needs it is
/// disabled instead of failing: a confirmation is declined, a message and a link are dropped, and saving to disk and picking files are refused.
///
/// Cheap to clone (the hooks are shared), so the thread that owns the session and the page's
/// commands each hold one.
#[derive(Clone, Default)]
pub struct Services {
    pub confirm: Option<ConfirmHook>,
    pub alert: Option<AlertHook>,
    pub open_url: Option<OpenUrlHook>,
    pub pick_save_path: Option<PickSavePathHook>,
    pub pick_files: Option<PickFilesHook>,
    pub run: Option<RunHook>,
    pub env: Option<EnvHook>,
    pub home_dir: Option<HomeDirHook>,
    pub transports: Option<TransportsHook>,
    pub transfers: Option<TransfersHook>,
    pub remote_run: Option<RemoteRunHook>,
    /// Sends a file over the current SSH entry's session ([`RemoteSendHook`]). Missing in tests that need no send:
    /// an install over SSH then fails with `send_failed`.
    pub remote_send: Option<RemoteSendHook>,
    /// The version the daemon of the current SSH entry reports ([`RemoteDaemonVersionHook`]); without it a running
    /// remote daemon is never `outdated`.
    pub remote_daemon_version: Option<RemoteDaemonVersionHook>,
    /// The pinned daemon archives for any of the four systems (the pin, the archive cache, the download), which an
    /// install over SSH sends. The app fills it with the same object as [`Self::installer`]. Missing in the headless
    /// CLI: an install over SSH is refused.
    pub archives: Option<Arc<dyn ArchiveSource>>,
    /// The daemon binary's installer (the pin, the archive cache, the download). Missing in the headless CLI
    /// and in tests that run a binary that is already in place: the supervisor then runs `current/pi-studio` as it
    /// finds it and installs nothing.
    pub installer: Option<Arc<dyn Installer>>,
    /// The version a running local daemon reports; without it a running daemon is never `outdated`.
    pub daemon_version: Option<DaemonVersionHook>,
    /// The self-update: the plug-in behind [`crate::update::Updater`]. Missing in the browser
    /// build and in tests that do not drive an update: every update action is then refused.
    pub updater: Option<Arc<dyn crate::update::UpdaterHook>>,
    /// The command-line tool behind `cli_tool.state` and `cli_tool.install`: the app fills it with the local
    /// supervisor. Missing in the headless CLI and in tests: the state is then `unavailable` and the install is refused.
    pub cli_tool: Option<Arc<dyn pistudiodesktop_engine::CliToolHost>>,
    /// Sends one usage event ([`crate::usage::UsageHook`]); the app fills it only in a build that has a token. Missing
    /// in the browser build, the headless CLI and tests: every run is then `blocked: "build"` and nothing is sent.
    pub usage: Option<crate::usage::UsageHook>,
}
