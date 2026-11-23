//! The app's self-update as commands: check for an update, install the one found, restart to
//! finish it (spec `swe/features/desktop-self-update.md` § 3).
//!
//! The engine holds no update state and does no work: like the daemon commands it only records
//! what was asked. The shell owns the state machine; before it answers a command it tells the
//! session, with [`Session::set_update_gate`], which of the three actions the state allows now
//! and, for each one it does not allow, why. A command that is allowed queues an [`UpdateAction`]
//! and answers `{"accepted": true}`; the owner loop hands the queue to the app
//! ([`Session::take_update_requests`]), which begins and runs the action off the owner thread.
//! A command that is not allowed fails with the gate's reason, which is also the `reason` of its
//! row in `command.list` and the tooltip of its menu item.

use serde_json::{Value, json};

use crate::commands::CommandSpec;
use crate::{EngineError, Result, Session};

/// The reason every action has until the shell says otherwise: this session has no updater.
pub const UNAVAILABLE: &str = "updates are not available in this app";

/// The reason while a started action waits for the app to begin it.
const STARTING: &str = "an update action is already starting";

/// What the app is asked to do about the update.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpdateAction {
    /// Ask the manifest whether a newer build exists (a manual check).
    Check,
    /// Download the offered build and install it.
    Install,
    /// Restart into the installed build.
    Restart,
}

impl UpdateAction {
    fn id(self) -> &'static str {
        match self {
            Self::Check => "update.check",
            Self::Install => "update.install",
            Self::Restart => "update.restart",
        }
    }
}

/// For each action, `None` when the update's state allows it now and the reason when it does not.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateGate {
    pub check: Option<String>,
    pub install: Option<String>,
    pub restart: Option<String>,
}

impl UpdateGate {
    /// Every action refused for the same `reason`.
    pub fn refusing(reason: &str) -> Self {
        Self { check: Some(reason.to_owned()), install: Some(reason.to_owned()), restart: Some(reason.to_owned()) }
    }

    fn reason(&self, action: UpdateAction) -> Option<&String> {
        match action {
            UpdateAction::Check => &self.check,
            UpdateAction::Install => &self.install,
            UpdateAction::Restart => &self.restart,
        }
        .as_ref()
    }
}

/// The gate the shell last set, and the actions accepted but not yet taken.
pub(crate) struct UpdateQueue {
    gate: UpdateGate,
    requests: Vec<UpdateAction>,
}

impl Default for UpdateQueue {
    fn default() -> Self {
        Self { gate: UpdateGate::refusing(UNAVAILABLE), requests: Vec::new() }
    }
}

impl Session {
    /// Record which actions the update's state allows now (the shell calls it before it answers).
    pub fn set_update_gate(&mut self, gate: UpdateGate) {
        self.update_queue.gate = gate;
    }

    /// Whether an update action is waiting for the app to take it.
    pub fn has_update_requests(&self) -> bool {
        !self.update_queue.requests.is_empty()
    }

    /// The actions accepted since the last call.
    pub fn take_update_requests(&mut self) -> Vec<UpdateAction> {
        std::mem::take(&mut self.update_queue.requests)
    }

    /// Why `action` cannot start now; `None` when it can. One accepted action blocks the others
    /// until the app takes it, so two quick clicks start one.
    fn update_refusal(&self, action: UpdateAction) -> Option<String> {
        if !self.update_queue.requests.is_empty() {
            return Some(STARTING.to_owned());
        }
        self.update_queue.gate.reason(action).cloned()
    }
}

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec { id: "update.check", label: "Check for Updates…", menu: &["Help"], shortcut: None, params: "{}", enabled: check_enabled, run: check },
        CommandSpec { id: "update.install", label: "Install Update", menu: &[], shortcut: None, params: "{}", enabled: install_enabled, run: install },
        CommandSpec { id: "update.restart", label: "Restart to Update", menu: &[], shortcut: None, params: "{}", enabled: restart_enabled, run: restart },
    ]
}

fn enabled(s: &Session, action: UpdateAction) -> std::result::Result<(), String> {
    s.update_refusal(action).map_or(Ok(()), Err)
}

fn check_enabled(s: &Session) -> std::result::Result<(), String> {
    enabled(s, UpdateAction::Check)
}

fn install_enabled(s: &Session) -> std::result::Result<(), String> {
    enabled(s, UpdateAction::Install)
}

fn restart_enabled(s: &Session) -> std::result::Result<(), String> {
    enabled(s, UpdateAction::Restart)
}

/// Queue `action`, or fail with the reason it cannot run (the `enabled` check ran first, so this
/// only fails for a caller that skipped it).
fn accept(s: &mut Session, action: UpdateAction) -> Result<Value> {
    if let Some(reason) = s.update_refusal(action) {
        return Err(EngineError::Disabled { id: action.id().to_owned(), reason });
    }
    s.update_queue.requests.push(action);
    Ok(json!({"accepted": true}))
}

fn check(s: &mut Session, _: &Value) -> Result<Value> {
    accept(s, UpdateAction::Check)
}

fn install(s: &mut Session, _: &Value) -> Result<Value> {
    accept(s, UpdateAction::Install)
}

fn restart(s: &mut Session, _: &Value) -> Result<Value> {
    accept(s, UpdateAction::Restart)
}

#[cfg(test)]
mod tests;
