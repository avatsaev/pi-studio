//! File transfers: the page's count of the ones in flight and the question closing the window asks;
//! the transfer engine's wiring (the page's commands call [`upload`] and [`save`], and every
//! moment the page or the app leaves cancels everything); and the error those commands answer with.
//!
//! The engine itself and its supplier of sockets are in [`engine`]; the local file an upload reads
//! and the save a download is written into are in [`files`].
//!
//! Local paths are the app's secret from the page (D20): they are taken from the tables of
//! `pistudiodesktop_shell` by a handle, and they appear in one place only, the log line of each
//! transfer. No answer, event or error of a transfer holds one, and none holds a handle.

mod engine;
mod files;

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use pistudiodesktop_shell::Services;
use pistudiodesktop_shell::dialogs;
use pistudiodesktop_shell::page::{CloseDecision, close_decision};
use pistudiodesktop_shell::picked::Picked;
use pistudiodesktop_shell::saves::{SaveError, Saves};
use pistudiodesktop_shell::transfer_mode::TransfersMode;
use pistudiodesktop_transfer::engine::Failure;
use pistudiodesktop_transfer::limits::MAX_PATH_BYTES;
use serde::Serialize;
use tauri::{AppHandle, Manager as _, RunEvent, Runtime, Window, WindowEvent};

pub use self::engine::TransferEngine;
use self::files::{FileSource, SaveSink};
use crate::transport::Transport;

/// The longest transfer id (the engine checks the same).
const MAX_ID_BYTES: usize = 64;

/// The page's count of uploads and saves that have not settled. Managed by Tauri.
#[derive(Default)]
pub struct Transfers(AtomicUsize);

impl Transfers {
    pub fn set(&self, count: usize) {
        self.0.store(count, Ordering::SeqCst);
    }

    pub fn get(&self) -> usize {
        self.0.load(Ordering::SeqCst)
    }
}

/// A refused transfer command: `code` is one the page branches on, `message` is for a person. It
/// never holds a local path, a password or a handle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TransferFailure {
    pub code: &'static str,
    pub message: String,
}

impl TransferFailure {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

impl From<Failure> for TransferFailure {
    fn from(failure: Failure) -> Self {
        Self::new(failure.code, failure.message)
    }
}

/// With transfers running, a close request is held back and the user is asked; "no" keeps the
/// window open, "yes" closes it. The dialog waits for the user, so it is shown off the event loop.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else { return };
    let Some(transfers) = window.try_state::<Transfers>() else { return };
    let CloseDecision::Ask(text) = close_decision(transfers.get()) else { return };
    api.prevent_close();
    let (window, services) = (window.clone(), window.try_state::<Services>().map(|s| Services::clone(&s)).unwrap_or_default());
    tauri::async_runtime::spawn_blocking(move || {
        if dialogs::confirm(&services, &text)
            && let Err(e) = window.destroy()
        {
            log::warn!("could not close the window: {e}");
        }
    });
}

/// The window is gone: no transfer outlives it. The runtime may end before the engine has settled
/// everything, so [`on_run_event`] stops them again, waiting, on the way out.
pub fn on_destroyed<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if matches!(event, WindowEvent::Destroyed)
        && let Some(engine) = window.try_state::<TransferEngine>()
    {
        // Nobody waits for it: the receiver is dropped.
        drop(engine.leave_in_background());
    }
}

/// On the way out, every transfer is cancelled and the engine's connection is closed, together with
/// the proxied connections' close and for no longer than it ([`close_all_blocking`]). Call it before
/// [`crate::transport::on_run_event`], which then finds nothing left to wait for.
pub fn on_run_event<R: Runtime>(handle: &AppHandle<R>, event: &RunEvent) {
    if matches!(event, RunEvent::Exit)
        && let (Some(engine), Some(transport)) = (handle.try_state::<TransferEngine>(), handle.try_state::<Transport>())
    {
        close_all_blocking(&engine, &transport);
    }
}

/// Leaving, for a thread that is not a worker of the async runtime (a daemon switch, the exit): the
/// engine's transfers are cancelled and its connection closed (1001) while the proxied connections
/// are told 1001, and both are waited for, each for at most five seconds.
pub fn close_all_blocking(engine: &TransferEngine, transport: &Transport) {
    let left = engine.leave_in_background();
    transport.close_all_blocking();
    TransferEngine::wait_left(&left);
}

/// `engine_off`: `--transfers page` turns the engine off for the run.
pub fn require_engine(mode: TransfersMode) -> Result<(), TransferFailure> {
    match mode {
        TransfersMode::Engine => Ok(()),
        TransfersMode::Page => Err(TransferFailure::new("engine_off", "File transfers use the page's own path in this launch.")),
    }
}

/// A bad `id` or `path`, before a handle is spent on it. The engine checks the same again.
pub fn check_request(id: &str, path: &str) -> Result<(), TransferFailure> {
    if id.is_empty() || id.len() > MAX_ID_BYTES || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-') {
        return Err(TransferFailure::new("invalid_request", "The transfer was refused: the id must be 1 to 64 letters, digits or hyphens."));
    }
    if path.is_empty() || path.len() > MAX_PATH_BYTES {
        return Err(TransferFailure::new("invalid_request", "The transfer was refused: the path must be 1 to 4096 bytes."));
    }
    Ok(())
}

/// Run `work` on the blocking pool: the saves' table and the files wait on the disk.
async fn off_thread<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, TransferFailure> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| TransferFailure::new("internal", format!("The app failed inside: {e}.")))
}

/// The log lines of one transfer: where it started, and how it ended. They hold both paths, the
/// one place a local path is written; never a password, a handle or the file's content.
struct Line<'a> {
    id: &'a str,
    kind: &'static str,
    daemon_path: &'a str,
    local_path: &'a Path,
    started: Instant,
}

impl<'a> Line<'a> {
    fn start(id: &'a str, kind: &'static str, daemon_path: &'a str, local_path: &'a Path) -> Self {
        log::info!("transfer {id}: {kind} started, daemon path {daemon_path:?}, local path {local_path:?}");
        Self { id, kind, daemon_path, local_path, started: Instant::now() }
    }

    fn end(&self, result: &Result<u64, Failure>) {
        let (id, kind, daemon_path, local_path) = (self.id, self.kind, self.daemon_path, self.local_path);
        let ms = self.started.elapsed().as_millis();
        match result {
            Ok(bytes) => log::info!("transfer {id}: {kind} done, {bytes} bytes in {ms} ms, daemon path {daemon_path:?}, local path {local_path:?}"),
            Err(failure) => {
                log::info!("transfer {id}: {kind} failed with {}, after {ms} ms, daemon path {daemon_path:?}, local path {local_path:?}", failure.code);
            }
        }
    }

    /// The transfer failed before it reached the engine: the same line as for one that failed in it.
    fn failed_to_start(&self, failure: &TransferFailure) {
        log::info!(
            "transfer {}: {} failed with {}, before it started, daemon path {:?}, local path {:?}",
            self.id,
            self.kind,
            failure.code,
            self.daemon_path,
            self.local_path
        );
    }
}

/// `transfer_upload`: the picked file of `handle` goes to `path` on the daemon. The handle is spent
/// by this call, whatever it answers once the id and path are accepted. Answers the bytes the daemon
/// confirmed.
pub async fn upload(engine: &TransferEngine, picked: &Picked, id: &str, handle: &str, path: &str) -> Result<u64, TransferFailure> {
    check_request(id, path)?;
    let Some(local) = picked.take(handle) else {
        return Err(TransferFailure::new("unknown_handle", "No such picked file: it is unknown, was used already, or the page was reloaded."));
    };
    let line = Line::start(id, "upload", path, &local);
    let source = match FileSource::open(local.clone()).await {
        Ok(source) => source,
        Err(e) => {
            let failure = TransferFailure::new("source_unreadable", format!("The file could not be opened: {e}."));
            line.failed_to_start(&failure);
            return Err(failure);
        }
    };
    let result = engine.upload(id, path, source).await;
    line.end(&result);
    result.map_err(TransferFailure::from)
}

/// `transfer_save`: the daemon's file at `path` goes into the open save of `handle` (from
/// `save_begin`); the engine owns the save from here and discards it on any failure. Answers the
/// file's bytes.
pub async fn save(engine: &TransferEngine, saves: &Arc<Saves>, id: &str, handle: &str, path: &str) -> Result<u64, TransferFailure> {
    check_request(id, path)?;
    let claimed = off_thread({
        let (saves, handle) = (Arc::clone(saves), handle.to_owned());
        move || saves.claim(&handle)
    })
    .await?
    .map_err(|e| match e {
        SaveError::UnknownHandle => TransferFailure::new("unknown_handle", "No such save: it is unknown, was used already, or the page was reloaded."),
        SaveError::DestinationBusy => TransferFailure::new("destination_busy", "Another save is writing to the same destination."),
        SaveError::Io(reason) => TransferFailure::new("disk", format!("The save could not be used: {reason}.")),
        other => TransferFailure::new("internal", other.to_string()),
    })?;
    let local = claimed.destination().to_path_buf();
    let line = Line::start(id, "save", path, &local);
    let result = engine.save(id, path, SaveSink::new(claimed)).await;
    line.end(&result);
    result.map_err(TransferFailure::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_short_id_of_letters_digits_and_hyphens_and_a_path_of_1_to_4096_bytes_are_accepted() {
        assert!(check_request("a-Z-09", "/srv/a").is_ok());
        assert!(check_request(&"x".repeat(64), &"p".repeat(4096)).is_ok());
        for id in ["", "a b", "a/b", "é", &"x".repeat(65)] {
            assert_eq!(check_request(id, "/srv/a").unwrap_err().code, "invalid_request", "{id:?}");
        }
        for path in [String::new(), "p".repeat(4097)] {
            assert_eq!(check_request("a", &path).unwrap_err().code, "invalid_request");
        }
    }

    #[test]
    fn under_page_the_engine_is_off() {
        assert!(require_engine(TransfersMode::Engine).is_ok());
        assert_eq!(require_engine(TransfersMode::Page).unwrap_err().code, "engine_off");
    }
}
