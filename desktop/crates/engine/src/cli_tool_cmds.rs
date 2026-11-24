//! The `pi-studio` command-line tool as commands (D11, P5 of `swe/features/single-binary-daemon.md`):
//! `cli_tool.state` says whether `~/.local/bin/pi-studio` links to the installed binary and whether a new
//! terminal finds it; `cli_tool.install` makes the link.
//!
//! The engine does no file access of its own: the rules and the work are behind [`CliToolHost`], which the
//! shell implements over the supervisor and the app hands to the session ([`Session::set_cli_tool`]). Both
//! commands answer a [`CliToolState`] (`{"state": "absent" | "installed" | "not_on_path" | "shadowed" |
//! "occupied" | "unavailable", "path"?}`). A session with no host answers `unavailable` and refuses the install.
//! The host blocks (the install asks the login shell for its environment again): the page runs these two
//! commands on a worker thread through [`run_cli_tool`], not on the thread that owns the session.

use std::sync::Arc;

use pistudiodesktop_model::CliToolState;
use serde_json::Value;

use crate::commands::{CommandSpec, always};
use crate::{EngineError, Result, Session};

/// The reason `cli_tool.install` has when the session was given no host.
pub const UNAVAILABLE: &str = "the command-line tool is not available in this app";

/// What looks at the machine and links the tool. Every method blocks.
pub trait CliToolHost: Send + Sync {
    /// The state of the tool now (the spec's `cli_tool.state`).
    fn state(&self) -> CliToolState;

    /// Link the tool and answer the state reached (the spec's `cli_tool.install`). `Err` says why nothing
    /// was done, or what failed; a file the app did not make is never replaced.
    fn install(&self) -> std::result::Result<CliToolState, String>;
}

impl Session {
    /// The host the two commands run through; `None` leaves them unavailable.
    pub fn set_cli_tool(&mut self, host: Option<Arc<dyn CliToolHost>>) {
        self.cli_tool = host;
    }

    /// The host the commands run through, for a caller that runs them off this session's thread.
    pub fn cli_tool(&self) -> Option<Arc<dyn CliToolHost>> {
        self.cli_tool.clone()
    }
}

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec { id: "cli_tool.state", label: "Command-Line Tool State", menu: &[], shortcut: None, params: "{}", enabled: always, run: state },
        CommandSpec {
            id: "cli_tool.install",
            label: "Install the Command-Line Tool",
            menu: &[],
            shortcut: None,
            params: "{}",
            enabled: install_enabled,
            run: install,
        },
    ]
}

fn install_enabled(s: &Session) -> std::result::Result<(), String> {
    s.cli_tool.as_ref().map(|_| ()).ok_or_else(|| UNAVAILABLE.to_owned())
}

/// Run `cli_tool.state` or `cli_tool.install` on `host`: the answer is the state, as JSON.
pub fn run_cli_tool(host: Option<&dyn CliToolHost>, id: &str) -> Result<Value> {
    let state = match (id, host) {
        ("cli_tool.state", Some(host)) => host.state(),
        ("cli_tool.state", None) => CliToolState::Unavailable,
        ("cli_tool.install", Some(host)) => host.install().map_err(EngineError::Other)?,
        ("cli_tool.install", None) => return Err(EngineError::Disabled { id: id.to_owned(), reason: UNAVAILABLE.to_owned() }),
        _ => return Err(EngineError::UnknownCommand(id.to_owned())),
    };
    serde_json::to_value(state).map_err(|e| EngineError::Other(format!("internal error: {e}")))
}

fn state(s: &mut Session, _: &Value) -> Result<Value> {
    run_cli_tool(s.cli_tool.as_deref(), "cli_tool.state")
}

fn install(s: &mut Session, _: &Value) -> Result<Value> {
    run_cli_tool(s.cli_tool.as_deref(), "cli_tool.install")
}

/// Whether `id` is one of the two commands, which the page runs off the session's thread.
pub fn is_cli_tool_command(id: &str) -> bool {
    matches!(id, "cli_tool.state" | "cli_tool.install")
}

#[cfg(test)]
mod tests;
