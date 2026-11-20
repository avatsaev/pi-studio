//! Saving a file to disk for the page. The page never names a path on the user's machine: Rust
//! shows the save dialog, creates a temporary file beside the chosen destination and hands the page
//! an opaque handle that is valid for that one save. The page sends the bytes in order, then
//! finishes the save (the temporary file is flushed and renamed over the destination) or discards
//! it (the temporary file is removed). Until the rename an existing destination is untouched, so a
//! save that fails midway leaves the old file as it was.
//!
//! A save that is open when the app dies leaves its temporary file behind. Every open save is
//! listed in [`JOURNAL`] in the configuration directory; [`Saves::open`] removes what the journal
//! lists at the next launch.
//!
//! The calls here write files, so the app runs them off the thread that owns the session.

use std::collections::HashMap;
use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use pistudiodesktop_store::{Loaded, remove, write_atomic};
use serde::{Deserialize, Serialize};

use crate::Services;

/// How many saves may be open at once. A page that opens more is broken or hostile; each open save
/// holds a file descriptor and a temporary file.
pub const MAX_OPEN: usize = 8;

/// The most bytes one [`Saves::write`] takes. The page sends a file in chunks; a bigger one is
/// refused instead of being held in memory.
pub const MAX_WRITE_BYTES: usize = 16 * 1024 * 1024;

/// The file in the configuration directory that lists the temporary files of the open saves.
pub const JOURNAL: &str = "pending-saves.json";

/// The longest file name, in bytes, that file systems accept.
const MAX_NAME_BYTES: usize = 255;

/// The longest extension kept when a name is cut to [`MAX_NAME_BYTES`], dot included.
const MAX_KEPT_EXTENSION_BYTES: usize = 32;

/// What a suggested name becomes when nothing of it is left.
const FALLBACK_NAME: &str = "download";

/// A temporary file is named `.pistudio-save-<32 hex digits>.part` beside its destination. The
/// launch cleanup removes only files named like that, so a damaged journal cannot delete anything
/// else.
const TEMP_PREFIX: &str = ".pistudio-save-";
const TEMP_SUFFIX: &str = ".part";

/// Why a save call failed. The text is shown to the page and never holds a path.
#[derive(Debug, PartialEq, Eq)]
pub enum SaveError {
    /// No handle like that: it never existed, or the save is finished or discarded.
    UnknownHandle,
    /// [`MAX_OPEN`] saves are open.
    TooManyOpen,
    /// A write of more than [`MAX_WRITE_BYTES`].
    TooLarge(usize),
    /// This build cannot show a save dialog.
    Unavailable,
    /// The destination cannot be written beside: it has no file name or folder, or its path is not text.
    BadDestination,
    /// The file system refused; carries its reason.
    Io(String),
}

impl fmt::Display for SaveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownHandle => f.write_str("no such save: it is unknown, finished or discarded"),
            Self::TooManyOpen => write!(f, "too many saves are open (at most {MAX_OPEN}): finish or discard one first"),
            Self::TooLarge(len) => write!(f, "a write of {len} bytes is over the limit of {MAX_WRITE_BYTES} bytes: send smaller chunks"),
            Self::Unavailable => f.write_str("saving to disk is not available on this platform"),
            Self::BadDestination => f.write_str("the chosen destination cannot be saved to"),
            Self::Io(reason) => write!(f, "cannot write the file: {reason}"),
        }
    }
}

impl From<std::io::Error> for SaveError {
    fn from(e: std::io::Error) -> Self {
        // Logged in full by the caller; the page gets the kind's wording, which holds no path.
        Self::Io(e.kind().to_string())
    }
}

/// What the journal file holds.
#[derive(Serialize, Deserialize)]
struct Journal {
    files: Vec<PathBuf>,
}

/// One open save.
struct Save {
    temp: PathBuf,
    destination: PathBuf,
    /// `None` once the save is finished or discarded: nothing more can be written.
    file: Mutex<Option<File>>,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panic in the middle of a write protects nothing worth refusing every later call for.
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Save {
    /// Flush the temporary file to disk, then rename it over the destination. On any failure the
    /// temporary file is removed and the destination is as it was.
    fn commit(&self) -> Result<(), SaveError> {
        let file = locked(&self.file).take().ok_or(SaveError::UnknownHandle)?;
        let flushed = file.sync_all();
        // Closed before the rename: Windows cannot rename an open file.
        drop(file);
        let renamed = flushed.and_then(|()| std::fs::rename(&self.temp, &self.destination));
        renamed.map_err(|e| {
            log::warn!("save failed on finish: {e}");
            self.remove_temp();
            SaveError::from(e)
        })
    }

    /// Close and remove the temporary file.
    fn abandon(&self) -> Result<(), SaveError> {
        drop(locked(&self.file).take().ok_or(SaveError::UnknownHandle)?);
        remove(&self.temp).map_err(SaveError::from)
    }

    fn remove_temp(&self) {
        if let Err(e) = remove(&self.temp) {
            log::warn!("cannot remove a temporary save file: {e}");
        }
    }
}

impl Drop for Save {
    /// A save that is dropped open (the app shut down cleanly mid-save) leaves nothing behind.
    fn drop(&mut self) {
        let open = self.file.get_mut().unwrap_or_else(PoisonError::into_inner).take();
        if open.is_some() {
            drop(open);
            self.remove_temp();
        }
    }
}

#[derive(Default)]
struct State {
    open: HashMap<String, Arc<Save>>,
    /// The folder of the destination chosen last in this run.
    last_folder: Option<PathBuf>,
}

/// The saves that are open, and the journal that lists their temporary files. Managed by the app
/// and shared by the page's commands.
pub struct Saves {
    state: Mutex<State>,
    journal: PathBuf,
    /// Where the dialog starts when no save has been made in this run.
    downloads: Option<PathBuf>,
}

/// `len` random bytes as lowercase hex.
fn random_hex(len: usize) -> Result<String, SaveError> {
    let mut bytes = vec![0_u8; len];
    getrandom::fill(&mut bytes).map_err(|e| SaveError::Io(format!("no random source ({e})")))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Whether `path` is named like the temporary file of a save.
fn is_temp_name(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with(TEMP_PREFIX) && name.ends_with(TEMP_SUFFIX))
}

impl Saves {
    /// The saves of this run. The temporary files that the journal in `config_dir` lists, left by
    /// a run that ended mid-save, are removed and the journal is emptied. `downloads` is where the
    /// dialog starts until a save has been made.
    pub fn open(config_dir: &Path, downloads: Option<PathBuf>) -> Self {
        let saves = Self { state: Mutex::default(), journal: config_dir.join(JOURNAL), downloads };
        saves.clean_up_after_a_crash();
        saves
    }

    fn clean_up_after_a_crash(&self) {
        let listed = match pistudiodesktop_store::read(&self.journal, |bytes| serde_json::from_slice::<Journal>(bytes).ok()) {
            Loaded::Value(journal) => journal.files,
            Loaded::Missing => return,
            // Set aside by the store: nothing is known about what was open.
            Loaded::Reset { .. } => Vec::new(),
        };
        for file in listed {
            if !is_temp_name(&file) {
                log::warn!("the journal of saves lists a file that is not a temporary save file: left alone");
            } else if let Err(e) = remove(&file) {
                log::warn!("cannot remove a temporary save file left by the last run: {e}");
            } else {
                log::info!("removed a temporary save file left by the last run");
            }
        }
        self.write_journal_or_log(&[]);
    }

    fn write_journal(&self, files: &[PathBuf]) -> std::io::Result<()> {
        let journal = Journal { files: files.to_vec() };
        let bytes = serde_json::to_vec(&journal).map_err(std::io::Error::other)?;
        write_atomic(&self.journal, &bytes)
    }

    /// [`Self::write_journal`] where a failure only costs the cleanup after a crash: logged.
    fn write_journal_or_log(&self, files: &[PathBuf]) {
        if let Err(e) = self.write_journal(files) {
            log::warn!("cannot write the journal of saves: {e}");
        }
    }

    /// The temporary files of the open saves, plus `extra`.
    fn temps(state: &State, extra: Option<&Path>) -> Vec<PathBuf> {
        state.open.values().map(|save| save.temp.clone()).chain(extra.map(Path::to_path_buf)).collect()
    }

    /// Where the save dialog starts: the folder of the last destination in this run, else the
    /// user's Downloads folder, else nowhere in particular.
    pub fn start_folder(&self) -> Option<PathBuf> {
        locked(&self.state).last_folder.clone().or_else(|| self.downloads.clone())
    }

    /// Start a save to `destination`: create the temporary file beside it and return the handle.
    /// The handle is 128 random bits as 32 hex digits. The destination is not touched.
    pub fn begin(&self, destination: &Path) -> Result<String, SaveError> {
        let folder = destination.parent().filter(|folder| !folder.as_os_str().is_empty()).ok_or(SaveError::BadDestination)?;
        // The journal stores paths as text, so a path that is not text cannot be cleaned up after a crash.
        if destination.file_name().is_none() || destination.to_str().is_none() {
            return Err(SaveError::BadDestination);
        }
        let handle = random_hex(16)?;
        // Beside the destination: the final rename stays on one volume, which keeps it atomic.
        let temp = folder.join(format!("{TEMP_PREFIX}{}{TEMP_SUFFIX}", random_hex(16)?));
        let mut state = locked(&self.state);
        if state.open.len() >= MAX_OPEN {
            return Err(SaveError::TooManyOpen);
        }
        // Journalled before the file exists: a crash in between lists a file that is not there,
        // which is harmless, where the other order could leave one nobody knows of.
        // A save that could not be listed would not be cleaned up after a crash, so it does not start.
        let mut listed = Self::temps(&state, Some(&temp));
        self.write_journal(&listed).inspect_err(|e| log::warn!("cannot write the journal of saves: {e}"))?;
        // `create_new` refuses to open anything that exists, a symbolic link included.
        let file = OpenOptions::new().write(true).create_new(true).open(&temp);
        let file = match file {
            Ok(file) => file,
            Err(e) => {
                log::warn!("cannot create a temporary save file: {e}");
                listed.pop();
                self.write_journal_or_log(&listed);
                return Err(e.into());
            }
        };
        state.last_folder = Some(folder.to_path_buf());
        let save = Save { temp, destination: destination.to_path_buf(), file: Mutex::new(Some(file)) };
        state.open.insert(handle.clone(), Arc::new(save));
        Ok(handle)
    }

    fn get(&self, handle: &str) -> Result<Arc<Save>, SaveError> {
        locked(&self.state).open.get(handle).cloned().ok_or(SaveError::UnknownHandle)
    }

    /// Forget a save that is over and update the journal.
    fn forget(&self, handle: &str) {
        let mut state = locked(&self.state);
        state.open.remove(handle);
        self.write_journal_or_log(&Self::temps(&state, None));
    }

    /// Append `bytes` to the save, after what was written before. At most [`MAX_WRITE_BYTES`].
    pub fn write(&self, handle: &str, bytes: &[u8]) -> Result<(), SaveError> {
        if bytes.len() > MAX_WRITE_BYTES {
            return Err(SaveError::TooLarge(bytes.len()));
        }
        let save = self.get(handle)?;
        let mut file = locked(&save.file);
        let file = file.as_mut().ok_or(SaveError::UnknownHandle)?;
        file.write_all(bytes).map_err(|e| {
            log::warn!("save failed on write: {e}");
            SaveError::from(e)
        })
    }

    /// End the save: flush the temporary file to disk, then rename it over the destination. The
    /// handle is spent either way; a failure removes the temporary file.
    pub fn finish(&self, handle: &str) -> Result<(), SaveError> {
        let save = self.get(handle)?;
        let result = save.commit();
        // After the rename: until then the journal must keep listing the temporary file.
        if !matches!(result, Err(SaveError::UnknownHandle)) {
            self.forget(handle);
        }
        result
    }

    /// Abandon the save: the temporary file is removed and the destination is as it was.
    pub fn discard(&self, handle: &str) -> Result<(), SaveError> {
        let save = self.get(handle)?;
        let result = save.abandon();
        if !matches!(result, Err(SaveError::UnknownHandle)) {
            self.forget(handle);
        }
        result
    }

    /// Show the save dialog for `suggested_name` (cut down to a file name by [`file_name`]) and
    /// begin a save at the path the user chose: its handle, or `None` when the dialog was
    /// cancelled. Blocks until the dialog is closed.
    pub fn choose(&self, services: &Services, suggested_name: &str) -> Result<Option<String>, SaveError> {
        let hook = services.pick_save_path.as_ref().ok_or(SaveError::Unavailable)?;
        match hook(&file_name(suggested_name), self.start_folder().as_deref()) {
            Some(destination) => self.begin(&destination).map(Some),
            None => Ok(None),
        }
    }
}

/// `suggested` as a file name for the dialog: only the last path segment (split at `/` and `\`, a
/// segment of `.` or `..` skipped), without control characters or surrounding whitespace, at most
/// 255 bytes (an extension of up to 32 bytes survives the cut), and `download` when nothing is
/// left. The page chose the text, so it never names a folder.
pub fn file_name(suggested: &str) -> String {
    let segment = suggested.rsplit(['/', '\\']).map(clean_segment).find(|s| !s.is_empty() && s != "." && s != "..").unwrap_or_default();
    let name = cap_bytes(&segment);
    if name.trim().is_empty() { FALLBACK_NAME.to_string() } else { name.trim().to_string() }
}

/// `segment` without control characters, trimmed.
fn clean_segment(segment: &str) -> String {
    segment.chars().filter(|c| !c.is_control()).collect::<String>().trim().to_string()
}

/// `name` cut to [`MAX_NAME_BYTES`] at a character boundary, keeping a short extension.
fn cap_bytes(name: &str) -> String {
    if name.len() <= MAX_NAME_BYTES {
        return name.to_string();
    }
    let extension_at = name.rfind('.').filter(|at| *at > 0 && name.len() - at <= MAX_KEPT_EXTENSION_BYTES).unwrap_or(name.len());
    let (stem, extension) = name.split_at(extension_at);
    let mut end = MAX_NAME_BYTES - extension.len();
    while !stem.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{extension}", stem.get(..end).unwrap_or_default())
}

#[cfg(test)]
mod tests;
