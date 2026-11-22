//! Files the user picked to upload. The page never names a file on the user's machine (D20): Rust
//! shows the open dialog, keeps the paths and hands the page an opaque handle, a name and a size
//! for each. A later call takes the path by its handle ([`Picked::take`]); a handle works once.
//!
//! The table is in memory only. It holds at most [`MAX_UNUSED`] unused entries (the oldest is
//! dropped for a new one), and the app empties it at every `boot`: a reloaded page holds no handle
//! it was given before. No answer of this module holds a path.
//!
//! The dialog waits for the user, so [`Picked::pick`] runs off the thread that owns the session.

use std::collections::VecDeque;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;

use crate::Services;
use crate::saves::random_hex;

/// How many picked files may wait unused. A page that picks more is broken or hostile; the oldest
/// handle is dropped, and a later [`Picked::take`] of it finds nothing.
pub const MAX_UNUSED: usize = 1024;

/// A handle is 128 random bits as 32 hex digits.
const HANDLE_BYTES: usize = 16;

/// Why picking files failed. The text is shown to the page and never holds a path.
#[derive(Debug, PartialEq, Eq)]
pub enum PickError {
    /// This build cannot show an open dialog.
    Unavailable,
    /// No random handle could be made.
    NoRandomSource,
}

impl fmt::Display for PickError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable => f.write_str("picking files is not available on this platform"),
            Self::NoRandomSource => f.write_str("cannot make a handle: no random source"),
        }
    }
}

/// One file the page was given: what it may know of it. It has no path. Serialized as the page's
/// `{ handle, name, size? }`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PickedFile {
    pub handle: String,
    /// The last path component; characters that are not valid Unicode are replaced.
    pub name: String,
    /// The file's size in bytes, when its metadata could be read and it is a file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Default)]
struct State {
    /// Unused entries, the oldest first.
    entries: VecDeque<(String, PathBuf)>,
    /// The folder of the file picked first in the last pick of this run.
    last_folder: Option<PathBuf>,
}

/// The picked files that no call has taken yet. Managed by the app and shared by the page's commands.
#[derive(Default)]
pub struct Picked {
    state: Mutex<State>,
}

fn locked(state: &Mutex<State>) -> MutexGuard<'_, State> {
    // A panic while the table was held leaves entries that are still valid.
    state.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Picked {
    /// Show the open dialog (starting in the folder of the last pick in this run), keep the path of
    /// each file chosen and answer its handle, name and size. Empty when the dialog was cancelled.
    /// A path without a file name is skipped. Blocks until the dialog is closed.
    pub fn pick(&self, services: &Services) -> Result<Vec<PickedFile>, PickError> {
        let hook = services.pick_files.as_ref().ok_or(PickError::Unavailable)?;
        let folder = locked(&self.state).last_folder.clone();
        // Without the table locked: the dialog stays open until the user closes it.
        let mut paths = hook(folder.as_deref());
        paths.retain(|path| path.file_name().is_some());
        // Past the limit the oldest of these would be dropped on entry: they get no handle.
        paths.drain(..paths.len().saturating_sub(MAX_UNUSED));
        let mut files = Vec::with_capacity(paths.len());
        let mut staged = Vec::with_capacity(paths.len());
        for path in paths {
            let handle = random_hex(HANDLE_BYTES).map_err(|e| {
                log::warn!("no random source for a picked file's handle: {e}");
                PickError::NoRandomSource
            })?;
            files.push(describe(&handle, &path));
            staged.push((handle, path));
        }
        if let Some((_, first)) = staged.first() {
            let mut state = locked(&self.state);
            state.last_folder = first.parent().filter(|folder| !folder.as_os_str().is_empty()).map(Path::to_path_buf);
            for entry in staged {
                if state.entries.len() >= MAX_UNUSED {
                    state.entries.pop_front();
                }
                state.entries.push_back(entry);
            }
        }
        Ok(files)
    }

    /// The path of `handle`, once: the entry is gone after this. `None` for a handle that was never
    /// given, was taken already, was dropped for a newer one or was cleared.
    pub fn take(&self, handle: &str) -> Option<PathBuf> {
        let mut state = locked(&self.state);
        let at = state.entries.iter().position(|(known, _)| known == handle)?;
        state.entries.remove(at).map(|(_, path)| path)
    }

    /// Drop every entry. The page calls `boot` when it starts: nothing from an older page lives on.
    /// The folder the dialog starts in is kept.
    pub fn clear(&self) {
        locked(&self.state).entries.clear();
    }
}

/// What the page is told of the file at `path`.
fn describe(handle: &str, path: &Path) -> PickedFile {
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let size = std::fs::metadata(path).ok().filter(|meta| meta.is_file()).map(|meta| meta.len());
    PickedFile { handle: handle.to_owned(), name, size }
}

#[cfg(test)]
mod tests;
