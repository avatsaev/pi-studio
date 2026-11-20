//! The app's JSON files, read safely and written atomically.
//!
//! Settings, per-entry state and the daemon registry share three needs: read with a fallback when
//! the file is corrupt, an atomic write, and removal. The crate knows no document type: the caller
//! passes a decoder. Only a file's name ever reaches a log line, never its content.
//!
//! File access is native only: on wasm32 this crate is empty.
#![cfg(not(target_arch = "wasm32"))]

mod read;
mod stamp;
mod write;

pub use read::{Loaded, MAX_BYTES, read};
pub use write::{remove, write_atomic, write_private};

/// The name of `path` for a log line: never the directory, never the content.
fn log_name(path: &std::path::Path) -> std::borrow::Cow<'_, str> {
    path.file_name().map_or(std::borrow::Cow::Borrowed("?"), std::ffi::OsStr::to_string_lossy)
}
