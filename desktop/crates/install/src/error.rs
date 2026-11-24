//! The crate's errors. None holds a URL (its query can carry a token), a secret or a file's content: a request
//! error is reduced to its kind with the address cut off (`reqwest::Error::without_url`).

use std::io;

/// Why a download failed. The partial file is already removed when one is returned.
#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    /// The request could not be made, or the connection broke while the body streamed (DNS, refused, TLS, reset).
    #[error("The download failed: {0}")]
    Request(String),
    /// The server answered with a status that is not a success (after the redirects).
    #[error("The server answered {0}.")]
    Status(u16),
    /// Nothing arrived within the stall limit, before the answer or between two pieces of the body.
    #[error("The download stalled: no data arrived within the stall limit.")]
    Stalled,
    /// The server sent a different number of bytes from the pinned size (more bytes are never read to the end).
    #[error("The download has the wrong size: {received} bytes, expected {expected}.")]
    WrongSize { expected: u64, received: u64 },
    /// The bytes are not the pinned file.
    #[error("The download's SHA-256 differs from the pinned one.")]
    ChecksumMismatch,
    /// A local file or folder could not be written, read or removed.
    #[error("A file of the download could not be used: {0}")]
    Io(String),
    /// A version or a target that is not one plain file name (`..`, a separator, empty): the cache refuses to build a path.
    #[error("The version or the target is not a plain name.")]
    InvalidName,
}

impl DownloadError {
    /// True when the bytes arrived but are not the pinned file (a wrong size or a wrong hash): the app's
    /// `checksum_mismatch`; every other failure is its `download_failed`.
    pub fn is_integrity_failure(&self) -> bool {
        matches!(self, Self::ChecksumMismatch | Self::WrongSize { .. })
    }
}

/// Why `--version` of a binary gave no version.
#[derive(Debug, thiserror::Error)]
pub enum VersionError {
    /// The program could not be started (missing, not executable, a folder mounted `noexec`, a wrong architecture).
    #[error("The program could not be started: {0}")]
    Spawn(String),
    /// It did not finish within the limit; it was killed.
    #[error("The program did not answer within the limit.")]
    TimedOut { output: String },
    /// It ended with a failure status.
    #[error("The program failed with {}.", status_text(*.code))]
    Failed { code: Option<i32>, output: String },
}

fn status_text(code: Option<i32>) -> String {
    code.map_or_else(|| "a signal".to_string(), |c| format!("status {c}"))
}

impl VersionError {
    /// What the program printed (the tail of its output), when it ran.
    pub fn output(&self) -> Option<&str> {
        match self {
            Self::Spawn(_) => None,
            Self::TimedOut { output } | Self::Failed { output, .. } => Some(output),
        }
    }
}

/// Why an install failed. Whatever was made is removed: `versions/` and `current` keep their old state unless the
/// last step (the switch) itself failed.
#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    /// The version is not one plain file name.
    #[error("The version is not a plain name.")]
    InvalidName,
    /// The archive could not be read or unpacked (not a gzip tar, truncated, a disk that cannot take it).
    #[error("The archive could not be unpacked: {0}")]
    Unpack(String),
    /// An entry would leave the unpack folder, or is a kind this installer never creates (a hard link, a device).
    #[error("The archive holds an entry that is not allowed: {0}")]
    UnsafeEntry(String),
    /// More entries or bytes than a daemon archive can hold.
    #[error("The archive is larger than any daemon archive can be.")]
    TooLarge,
    /// The archive has no `pi-studio` at its root (or in its one top folder).
    #[error("The archive holds no pi-studio program.")]
    NoBinary,
    /// A folder or file of the layout could not be made, moved or removed.
    #[error("The install folder could not be used: {0}")]
    Io(String),
    /// The unpacked program gave no version.
    #[error("The unpacked program does not run: {0}")]
    Version(#[source] VersionError),
    /// The unpacked program answers another version than the one installed.
    #[error("The unpacked program answers version {found}, not the expected one.")]
    WrongVersion { found: String },
}

impl InstallError {
    /// What the unpacked program printed, to show beside a failed install.
    pub fn output(&self) -> Option<&str> {
        match self {
            Self::Version(e) => e.output(),
            Self::WrongVersion { found } => Some(found),
            _ => None,
        }
    }
}

pub(crate) fn io_text(context: &str, e: &io::Error) -> String {
    format!("{context}: {e}")
}
