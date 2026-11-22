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
//!
//! The local daemon ([`supervisor`]) is driven through the `pi-studio` CLI: the engine queues what was
//! asked, the supervisor runs it off the session's thread and hands back the state reached.
//!
//! The HTML documents the page previews ([`preview`]) are held in memory and served to the webview
//! from a custom scheme of the app, so their scripts can run in a frame isolated from the page.
//!
//! Which secret store a launch uses (the keychain when it answers, else `secrets.json`, or what
//! `--secret-store` says) is chosen by [`secret_choice`]; the kind chosen is `secretStore` in the
//! registry view and in `ui.inspect`.
//!
//! Resume signals ([`resume`]) are the app telling the page that a socket may have died while nothing
//! said so. The detection of a wake and the rate limit are pure; the app's ticker thread passes the
//! times in. The counts are `connection.resumeSignals` in `ui.inspect`.
//!
//! The proxied daemon connections and the last connection error ([`transports`]) are plain data the
//! app's hook ([`Services::transports`]) answers; they are `connection.transports` and
//! `connection.lastError` in `ui.inspect`. The shell holds no socket type.
#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

pub mod cli_answers;
pub mod cli_find;
pub mod control;
pub mod daemons;
#[cfg(not(target_arch = "wasm32"))]
pub mod deferred;
pub mod dialogs;
pub mod links;
pub mod menus;
pub mod navigation;
pub mod owner;
#[cfg(not(target_arch = "wasm32"))]
pub mod owner_access;
pub mod page;
pub mod preview;
#[cfg(not(target_arch = "wasm32"))]
pub mod process;
pub mod resume;
#[cfg(not(target_arch = "wasm32"))]
pub mod saves;
#[cfg(not(target_arch = "wasm32"))]
pub mod secret_choice;
pub mod services;
#[cfg(not(target_arch = "wasm32"))]
pub mod shell_env;
pub mod shortcuts;
pub mod state;
#[cfg(not(target_arch = "wasm32"))]
pub mod supervisor;
#[cfg(not(target_arch = "wasm32"))]
pub mod switch;
pub mod transports;

use pistudiodesktop_engine::{Notice, Session};
use serde_json::Value;
use std::sync::Arc;

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
    /// A switch reloads the page, and the page being left may still send a stored key (its layout
    /// is written as it unloads). Such a key would land in the entry switched to, so from the switch
    /// until the next `boot`, stored keys are dropped.
    pub awaiting_boot: bool,
    /// The resume signals the app's ticker threads have let through (`connection.resumeSignals`
    /// in `ui.inspect`). The app replaces it with the one its tickers hold.
    pub resume: Arc<resume::ResumeSignals>,
    /// `daemon.add/update/remove` whose store step is running on a worker thread (`deferred`).
    #[cfg(not(target_arch = "wasm32"))]
    pub(crate) deferred: deferred::Deferred,
}

impl AppShell {
    pub fn new(session: Session, services: Services) -> Self {
        Self {
            session,
            ui: UiState::default(),
            services,
            info: AppInfo::default(),
            notices: Vec::new(),
            awaiting_boot: false,
            resume: Arc::default(),
            #[cfg(not(target_arch = "wasm32"))]
            deferred: deferred::Deferred::default(),
        }
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
            Request::SwitchEntry { id } => {
                let switched = self.run("daemon.switch", serde_json::json!({ "id": id }));
                self.awaiting_boot |= switched.is_ok();
                control::reply(switched)
            }
            Request::Engine { id, params } => control::reply(daemons::page_command(self, id, params.clone())),
            Request::Local(op) => daemons::local_op(self, op),
        }
    }
}

#[cfg(test)]
mod tests;
