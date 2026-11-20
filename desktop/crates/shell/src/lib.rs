//! The shell: everything a frontend needs that is not the engine, with no UI toolkit in it.
//!
//! Every action goes through [`AppShell::run`] (and from there
//! [`pistudiodesktop_engine::Session::execute`]), all UI state is plain data in [`state::UiState`], and
//! [`control::view`] is the one value a frontend draws: the UI state, the settings, and the menu
//! bar generated from the command registry. Automation reads and drives the same thing through
//! [`control::handle`]. The webview in `apps/pistudiodesktop` asks for two other things only: the
//! boot snapshot and a stored key ([`page`]). [`owner::serve`] is the loop of the thread that
//! owns the shell: it answers requests in order and writes the stored keys to disk.
//!
//! What only the operating system can do for the page goes through [`Services`]: a native confirm
//! and alert ([`dialogs`]) and opening a link outside the app ([`links`]). Both check what the page
//! sent first. The app calls them off the owner thread, because a dialog stays open until the user
//! closes it.
//!
//! Saving a file to disk ([`saves`]) is the one thing here that writes the user's files: Rust owns the
//! destination and the page holds only a handle.
#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

pub mod control;
pub mod dialogs;
pub mod links;
pub mod menus;
pub mod navigation;
pub mod owner;
pub mod page;
#[cfg(not(target_arch = "wasm32"))]
pub mod saves;
pub mod services;
pub mod shortcuts;
pub mod state;

use pistudiodesktop_engine::{Notice, Session};
use serde_json::Value;

pub use control::{Envelope, Request};
pub use page::AppInfo;
pub use services::Services;
pub use state::UiState;

pub struct AppShell {
    pub session: Session,
    pub ui: UiState,
    pub services: Services,
    /// Who the app is, for the boot snapshot.
    pub info: AppInfo,
    /// What went wrong reading the app's files at start. The boot snapshot hands them out once.
    pub notices: Vec<Notice>,
}

impl AppShell {
    pub fn new(session: Session, services: Services) -> Self {
        Self { session, ui: UiState::default(), services, info: AppInfo::default(), notices: Vec::new() }
    }

    /// Run a command by id. Every control request ends here. The outcome goes to the status bar as
    /// well as to the caller.
    pub fn run(&mut self, id: &str, params: Value) -> Result<Value, String> {
        let result = self.session.execute(id, params).map_err(|e| e.to_string());
        self.ui.status = result.as_ref().err().cloned().unwrap_or_default();
        result
    }

    /// Answer one request from the frontend or from automation: `{"ok": true, "result": …}`
    /// or `{"ok": false, "error": "…"}`.
    pub fn answer(&mut self, request: &Request) -> Value {
        match request {
            Request::Control { method, params } => control::handle(self, method, params),
            Request::Boot => control::reply(Ok(page::boot(self))),
            Request::StorageSet { key, value } => control::reply(page::storage_set(self, key, value)),
            Request::Flush => control::reply(page::flush(self)),
        }
    }
}

#[cfg(test)]
mod tests;
