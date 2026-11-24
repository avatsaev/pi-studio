//! The current SSH entry's daemon as the engine sees it, mirroring the local daemon's queue
//! (`local.rs`) but per entry: a queue of requests for the host to run, a busy flag that lasts
//! until the host hands back the outcome, and the state the host reached.
//!
//! The engine never opens a connection. A command records what was asked; the host drains
//! [`Session::take_remote_requests`], does the work and applies the new state with
//! [`Session::apply_remote_outcome`]. The state is in memory only and is forgotten when another
//! entry is opened.

#[cfg(not(target_arch = "wasm32"))]
use pistudiodesktop_model::Secret;
use pistudiodesktop_model::{EntryId, Kind, RemoteState, SshFields};
use serde_json::{Value, json};

use crate::commands::{CommandSpec, always};
use crate::{EngineError, Result, Session};

/// What the host is asked to do for the current SSH entry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemoteAction {
    /// Start the daemon on the host, over the entry's SSH session.
    Start,
    /// Look again at whether the daemon runs and the CLI is installed.
    Probe,
    /// `pi-studio update` on the host, then the version again, then a start.
    Update,
}

/// One request: what to do, and for which entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteRequest {
    pub entry: EntryId,
    pub action: RemoteAction,
}

/// Requests waiting for the host, and whether an action is in flight.
#[derive(Default)]
pub(crate) struct RemoteQueue {
    requests: Vec<RemoteRequest>,
    busy: bool,
    refreshing: bool,
}

impl Session {
    /// The state of the current SSH entry's daemon; `Unknown` when nothing was learned since the
    /// entry was opened, and for any other kind of entry.
    pub fn remote_state(&self) -> &RemoteState {
        &self.remote
    }

    /// Whether a remote daemon request is waiting for the host to take it.
    pub fn has_remote_requests(&self) -> bool {
        !self.remote_queue.requests.is_empty()
    }

    /// Forget what was learned about the previous entry's daemon, and its pending requests.
    pub(crate) fn reset_remote(&mut self) {
        self.remote = RemoteState::Unknown;
        self.remote_queue = RemoteQueue::default();
    }

    /// Record `start` or a refresh for the current entry. `Err` is the code the command answers with.
    fn request_remote(&mut self, action: RemoteAction) -> std::result::Result<(), &'static str> {
        let entry = self.current_entry_id().ok_or("no_current")?.clone();
        if self.registry().get(entry.as_str()).map(|e| e.kind) != Some(Kind::Ssh) {
            return Err("wrong_kind");
        }
        let refresh = action == RemoteAction::Probe;
        match self.remote {
            // Retry in the Daemons screen is a refresh, so a refresh goes through these two.
            RemoteState::NotInstalled if !refresh => return Err("not_installed"),
            RemoteState::CliOutdated { .. } if !matches!(action, RemoteAction::Probe | RemoteAction::Update) => return Err("cli_outdated"),
            _ => {}
        }
        if self.remote_queue.busy {
            // A refresh while a refresh is pending merges into it.
            return if refresh && self.remote_queue.refreshing { Ok(()) } else { Err("busy") };
        }
        self.remote_queue.busy = true;
        self.remote_queue.refreshing = refresh;
        self.remote_queue.requests.push(RemoteRequest { entry, action });
        self.set_remote_state(match action {
            RemoteAction::Probe => RemoteState::Checking,
            RemoteAction::Start => RemoteState::Starting,
            RemoteAction::Update => RemoteState::Updating,
        });
        Ok(())
    }

    /// The requests accepted since the last call. The session stays busy until the outcome of
    /// each is applied.
    pub fn take_remote_requests(&mut self) -> Vec<RemoteRequest> {
        std::mem::take(&mut self.remote_queue.requests)
    }

    /// Store the state the host reached for the request it ran for `entry`, clear busy and mark
    /// the registry view as changed. An outcome for an entry that is no longer current is dropped
    /// (the state was reset when it was left); `false` then.
    pub fn apply_remote_outcome(&mut self, entry: &EntryId, state: RemoteState) -> bool {
        if self.current_entry_id() != Some(entry) {
            return false;
        }
        self.remote_queue.busy = false;
        self.remote_queue.refreshing = false;
        self.set_remote_state(state);
        self.mark_changed();
        true
    }

    /// Store a state the host learned without a request (the SSH session dropped, say); a
    /// different one counts as a change. Dropped for an entry that is not current.
    pub fn set_remote_state_for(&mut self, entry: &EntryId, state: RemoteState) -> bool {
        if self.current_entry_id() != Some(entry) {
            return false;
        }
        self.set_remote_state(state);
        true
    }

    fn set_remote_state(&mut self, state: RemoteState) {
        if self.remote != state {
            self.remote = state;
            self.mark_changed();
        }
    }
}

/// The address of an SSH entry's daemon as the page and the bridge see it: its own port on the
/// host's loopback.
pub(crate) fn ssh_address(daemon_port: u16) -> String {
    format!("ws://127.0.0.1:{daemon_port}")
}

/// What the host needs to open the current SSH entry: where it connects and which secrets the
/// store holds for it. Like [`BridgePlan`](crate::BridgePlan) it reads nothing from the store.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SshPlan {
    pub entry: EntryId,
    pub fields: SshFields,
    /// The daemon's address as the page sees it ([`ssh_address`]).
    pub url: String,
    pub has_ssh_password: bool,
    pub has_passphrase: bool,
}

/// The secrets of an SSH entry's SSH login, read from the store.
#[cfg(not(target_arch = "wasm32"))]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SshSecrets {
    pub ssh_password: Option<Secret>,
    pub passphrase: Option<Secret>,
}

#[cfg(not(target_arch = "wasm32"))]
impl SshPlan {
    /// The SSH password and key passphrase the entry has, read from `store`. This may block until
    /// the user answers a system prompt: never call it on the thread that owns the session. `Err`
    /// is `secret_missing` or `secret_unavailable` (see [`BridgePlan::read_password`](crate::BridgePlan::read_password)).
    pub fn read_secrets(&self, store: &dyn pistudiodesktop_secrets::SecretStore) -> std::result::Result<SshSecrets, &'static str> {
        use crate::secret::{Slot, key, read_code};
        let read = |wanted: bool, slot: Slot| -> std::result::Result<Option<Secret>, &'static str> {
            if !wanted {
                return Ok(None);
            }
            Ok(Some(Secret::new(read_code(store.get(&key(&self.entry, slot)))?.expose())))
        };
        Ok(SshSecrets { ssh_password: read(self.has_ssh_password, Slot::SshPassword)?, passphrase: read(self.has_passphrase, Slot::SshPassphrase)? })
    }
}

impl Session {
    /// The plan for opening the current entry over SSH. `Err` is `no_current`, or `wrong_kind` for
    /// an entry that is not an SSH one.
    pub fn plan_ssh(&self) -> std::result::Result<SshPlan, &'static str> {
        let id = self.current_entry_id().ok_or("no_current")?;
        let entry = self.registry().get(id.as_str()).ok_or("no_current")?;
        let fields = entry.ssh_fields().ok_or("wrong_kind")?;
        Ok(SshPlan {
            entry: entry.id.clone(),
            url: ssh_address(fields.daemon_port),
            fields,
            has_ssh_password: entry.has_ssh_password,
            has_passphrase: entry.has_passphrase,
        })
    }
}

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec { id: "daemon.remote.start", label: "Start Remote Daemon", menu: &[], shortcut: None, params: "{}", enabled: always, run: start },
        CommandSpec { id: "daemon.remote.refresh", label: "Refresh Remote Daemon", menu: &[], shortcut: None, params: "{}", enabled: always, run: refresh },
        CommandSpec {
            id: "daemon.remote.update",
            label: "Update Remote Daemon",
            menu: &[],
            shortcut: None,
            params: "{}",
            enabled: update_enabled,
            run: update,
        },
    ]
}

fn accept(s: &mut Session, action: RemoteAction) -> Result<Value> {
    s.request_remote(action).map_err(|code| EngineError::Other(code.to_owned()))?;
    Ok(json!({"accepted": true}))
}

fn start(s: &mut Session, _: &Value) -> Result<Value> {
    accept(s, RemoteAction::Start)
}

fn update_offered(state: &RemoteState) -> bool {
    matches!(state, RemoteState::CliOutdated { .. } | RemoteState::Stopped)
}

/// Update is offered for an outdated CLI and a stopped daemon of the current SSH entry; the reason
/// says why not otherwise (`not_installed` has nothing to update).
fn update_enabled(s: &Session) -> std::result::Result<(), String> {
    let entry = s.current_entry_id().ok_or("no_current")?;
    if s.registry().get(entry.as_str()).map(|e| e.kind) != Some(Kind::Ssh) {
        return Err("wrong_kind".to_owned());
    }
    match s.remote_state() {
        RemoteState::NotInstalled => Err("not_installed".to_owned()),
        state if update_offered(state) => Ok(()),
        _ => Err("update_not_offered".to_owned()),
    }
}

fn update(s: &mut Session, _: &Value) -> Result<Value> {
    accept(s, RemoteAction::Update)
}

fn refresh(s: &mut Session, _: &Value) -> Result<Value> {
    accept(s, RemoteAction::Probe)
}

#[cfg(test)]
#[cfg(not(target_arch = "wasm32"))]
mod tests;
