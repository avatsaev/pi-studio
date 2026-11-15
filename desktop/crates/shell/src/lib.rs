//! The shell: everything a frontend needs that is not the engine, with no UI toolkit in it.
//!
//! Every action goes through [`AppShell::run`] (and from there
//! [`pistudiodesktop_engine::Session::execute`]), all UI state is plain data in [`state::UiState`], and
//! [`control::view`] is the one value a frontend draws: the UI state, the document, and the menu
//! bar generated from the command registry. The webview in `apps/pistudiodesktop` renders that value and
//! sends ids back; automation reads and drives the same thing through [`control::handle`].
#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

pub mod control;
pub mod menus;
pub mod services;
pub mod shortcuts;
pub mod state;

use pistudiodesktop_engine::Session;
use serde_json::Value;

pub use control::{Envelope, Request};
pub use services::{PickKind, Services};
pub use state::{ThemeKind, UiState};

pub struct AppShell {
    pub session: Session,
    pub ui: UiState,
    pub services: Services,
}

impl AppShell {
    pub fn new(session: Session, services: Services) -> Self {
        Self { session, ui: UiState::default(), services }
    }

    /// Run a command by id. Every click, shortcut, menu item and control request ends here:
    /// shell commands (pure view state) first, then the engine. The outcome goes to the
    /// status bar as well as to the caller.
    pub fn run(&mut self, id: &str, params: Value) -> Result<Value, String> {
        let result = match menus::shell_command(id) {
            Some(command) => {
                (command.run)(self);
                Ok(Value::Null)
            }
            None => self.session.execute(id, params).map_err(|e| e.to_string()),
        };
        self.ui.status = result.as_ref().err().cloned().unwrap_or_default();
        result
    }

    /// Answer one request from the frontend or from automation: `{"ok": true, "result": …}`
    /// or `{"ok": false, "error": "…"}`.
    pub fn answer(&mut self, request: &Request) -> Value {
        match request {
            Request::Control { method, params } => control::handle(self, method, params),
            Request::Invoke { command } => control::reply(menus::invoke(self, command)),
        }
    }
}

#[cfg(test)]
mod tests;
