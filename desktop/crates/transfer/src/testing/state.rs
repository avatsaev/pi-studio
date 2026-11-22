//! What the daemon keeps across connections: its files, its queued faults and what it has seen.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde_json::Value;

use super::fault::Fault;
use super::server::Config;

/// The modification time of the first file; each write after it is a second later, so that two
/// versions of a file never share one.
const FIRST_MTIME_MS: u64 = 1_767_225_600_000;
const MTIME_STEP_MS: u64 = 1_000;

/// A file the daemon holds.
#[derive(Debug, Clone)]
pub(super) struct StoredFile {
    /// Shared with the downloads that read it: a download keeps the version it started with, as an
    /// open file keeps its inode.
    pub bytes: Arc<Vec<u8>>,
    pub mtime_ms: u64,
}

/// The size and modification time of a file, as a download's answer would give them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileInfo {
    /// The file's size.
    pub size: u64,
    /// The file's modification time in milliseconds.
    pub mtime_ms: u64,
}

/// An upload that ended, whether or not the file was kept.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadRecord {
    /// The `transferId` of the request.
    pub transfer_id: String,
    /// The path of the request.
    pub path: String,
    /// The bytes that arrived in `Chunk` frames.
    pub bytes_received: u64,
    /// `None` when the file was kept; the `error` the push carried (or would have) when not.
    pub error: Option<String>,
}

#[derive(Default)]
pub(super) struct State {
    pub files: HashMap<String, StoredFile>,
    pub faults: Vec<Fault>,
    pub hellos: Vec<Value>,
    pub uploads: Vec<UploadRecord>,
    pub download_requests: Vec<Value>,
    pub accepted: usize,
    pub open: usize,
    pub refused: usize,
    pub client_closes: Vec<Option<u16>>,
    writes: u64,
}

impl State {
    /// Stores `bytes` at `path` with the next modification time.
    pub fn store(&mut self, path: &str, bytes: Vec<u8>) -> FileInfo {
        self.writes += 1;
        self.store_at(path, bytes, FIRST_MTIME_MS + self.writes * MTIME_STEP_MS)
    }

    pub fn store_at(&mut self, path: &str, bytes: Vec<u8>, mtime_ms: u64) -> FileInfo {
        let info = FileInfo { size: bytes.len() as u64, mtime_ms };
        self.files.insert(path.to_owned(), StoredFile { bytes: Arc::new(bytes), mtime_ms });
        info
    }

    /// Removes and returns the first queued fault `wanted` accepts.
    pub fn take_fault(&mut self, wanted: impl Fn(&Fault) -> bool) -> Option<Fault> {
        let at = self.faults.iter().position(wanted)?;
        Some(self.faults.remove(at))
    }
}

/// The daemon's configuration and state, shared by its connections and the test that owns it.
pub(super) struct Shared {
    pub config: Config,
    state: Mutex<State>,
}

impl Shared {
    pub fn new(config: Config) -> Self {
        Self { config, state: Mutex::new(State::default()) }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // A test that panicked while holding the lock leaves the state as it was: carry on.
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn with<R>(&self, f: impl FnOnce(&mut State) -> R) -> R {
        f(&mut self.lock())
    }
}
