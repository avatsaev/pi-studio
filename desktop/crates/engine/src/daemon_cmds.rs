//! The daemon registry as commands: list the entries, switch the current one, add, update and
//! remove entries. The error text of
//! a `daemon.*` command is its code (`not_found`, ...), so callers match on it.

use pistudiodesktop_model::{DEFAULT_DAEMON_PORT, NewEntry, Secret, SshFields};
use serde_json::{Value, json};

use crate::commands::{CommandSpec, always};
use crate::secret::Slot;
use crate::secret_job::SecretJob;
use crate::session::EntryChange;
use crate::{EngineError, Result, Session, params};

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec { id: "daemon.list", label: "List Daemons", menu: &[], shortcut: None, params: "{}", enabled: always, run: list },
        CommandSpec { id: "daemon.switch", label: "Switch Daemon", menu: &[], shortcut: None, params: r#"{"id": string}"#, enabled: always, run: switch },
        CommandSpec {
            id: "daemon.add",
            label: "Add Daemon",
            menu: &[],
            shortcut: None,
            params: r#"{"kind": "direct", "name": string, "address": string, "password"?: string} | {"kind": "relay", "name": string, "pairingLink": string} | {"kind": "ssh", "name": string, "host": string, "user"?: string, "port"?: number, "identityFile"?: string, "jump"?: string, "daemonPort"?: number (default 6767), "password"?: string, "sshPassword"?: string, "passphrase"?: string}"#,
            enabled: always,
            run: add,
        },
        CommandSpec {
            id: "daemon.update",
            label: "Edit Daemon",
            menu: &[],
            shortcut: None,
            params: r#"{"id": string, "name"?: string, "address"?: string, "password"?: string | null, "pairingLink"?: string, "host"?: string, "user"?: string | null, "port"?: number | null, "identityFile"?: string | null, "jump"?: string | null, "daemonPort"?: number, "sshPassword"?: string | null, "passphrase"?: string | null}"#,
            enabled: always,
            run: update,
        },
        CommandSpec { id: "daemon.remove", label: "Remove Daemon", menu: &[], shortcut: None, params: r#"{"id": string}"#, enabled: always, run: remove },
    ]
}

fn list(s: &mut Session, _: &Value) -> Result<Value> {
    Ok(json!({
        "currentId": s.current_entry_id().map(|id| id.as_str()),
        "entries": s.registry().views(),
        "local": s.local_state(),
        "remote": s.remote_state(),
    }))
}

fn switch(s: &mut Session, p: &Value) -> Result<Value> {
    let id = params::req_str(p, "id")?;
    s.switch_entry(id).map_err(|code| EngineError::Other(code.to_owned()))?;
    Ok(json!({"currentId": s.current_entry_id().map(|id| id.as_str())}))
}

fn code(code: &'static str) -> EngineError {
    EngineError::Other(code.to_owned())
}

/// Whether `id` keeps a secret in the store, so that it is run as a [`SecretJob`].
pub(crate) fn splits(id: &str) -> bool {
    matches!(id, "daemon.add" | "daemon.update" | "daemon.remove")
}

/// Plan one of the three commands for which [`splits`] is true; `params` is an object.
pub(crate) fn plan(s: &Session, id: &str, p: &Value) -> Result<SecretJob> {
    match id {
        "daemon.add" => plan_add(s, p),
        "daemon.update" => plan_update(s, p),
        _ => plan_remove(s, p),
    }
}

/// A field that an update may clear: absent leaves it, `null` clears it, a string sets it.
fn clearable_str(p: &Value, key: &str) -> Result<Option<Option<String>>> {
    match p.get(key) {
        None => Ok(None),
        Some(Value::Null) => Ok(Some(None)),
        Some(_) => Ok(Some(Some(params::req_str(p, key)?.to_owned()))),
    }
}

/// A secret that an update may clear (see [`clearable_str`]).
fn clearable_secret(p: &Value, key: &str) -> Result<Option<Option<Secret>>> {
    Ok(clearable_str(p, key)?.map(|v| v.map(Secret::new)))
}

/// A port: absent is `None`; one that is not 1 to 65535 is `invalid_port`.
fn port_param(p: &Value, key: &str) -> Result<Option<u16>> {
    params::u64_param(p, key)?.map(|n| u16::try_from(n).map_err(|_| code("invalid_port"))).transpose()
}

fn plan_add(s: &Session, p: &Value) -> Result<SecretJob> {
    let name = params::req_str(p, "name")?.to_owned();
    let optional = |key: &str, slot: Slot| params::str_param(p, key).map(|v| v.map(|v| (slot, Secret::new(v))));
    let mut secrets: Vec<(Slot, Secret)> = Vec::new();
    let new = match params::req_str(p, "kind")? {
        "direct" => {
            secrets.extend(optional("password", Slot::Password)?);
            NewEntry::Direct { name, address: params::req_str(p, "address")?.to_owned(), has_password: !secrets.is_empty() }
        }
        "relay" => {
            secrets.push((Slot::PairingLink, Secret::new(params::req_str(p, "pairingLink")?)));
            NewEntry::Relay { name }
        }
        "ssh" => {
            let ssh = SshFields {
                host: params::req_str(p, "host")?.to_owned(),
                user: params::str_param(p, "user")?.map(str::to_owned),
                port: port_param(p, "port")?,
                identity_file: params::str_param(p, "identityFile")?.map(str::to_owned),
                jump: params::str_param(p, "jump")?.map(str::to_owned),
                daemon_port: port_param(p, "daemonPort")?.unwrap_or(DEFAULT_DAEMON_PORT),
            };
            let password = optional("password", Slot::Password)?;
            let ssh_password = optional("sshPassword", Slot::SshPassword)?;
            let passphrase = optional("passphrase", Slot::SshPassphrase)?;
            let new =
                NewEntry::Ssh { name, ssh, has_password: password.is_some(), has_ssh_password: ssh_password.is_some(), has_passphrase: passphrase.is_some() };
            secrets.extend(password.into_iter().chain(ssh_password).chain(passphrase));
            new
        }
        other => {
            return Err(EngineError::BadParams(format!("`kind` must be `direct`, `relay` or `ssh`, got `{}`", other.chars().take(32).collect::<String>())));
        }
    };
    s.plan_add_job(new, secrets).map_err(code)
}

fn plan_update(s: &Session, p: &Value) -> Result<SecretJob> {
    let id = params::req_str(p, "id")?;
    // For a field that can be cleared, `null` clears and an absent field leaves it.
    let port = match p.get("port") {
        Some(Value::Null) => Some(None),
        _ => port_param(p, "port")?.map(Some),
    };
    let change = EntryChange {
        name: params::str_param(p, "name")?.map(str::to_owned),
        address: params::str_param(p, "address")?.map(str::to_owned),
        password: clearable_secret(p, "password")?,
        pairing_link: params::str_param(p, "pairingLink")?.map(Secret::new),
        host: params::str_param(p, "host")?.map(str::to_owned),
        user: clearable_str(p, "user")?,
        port,
        identity_file: clearable_str(p, "identityFile")?,
        jump: clearable_str(p, "jump")?,
        daemon_port: port_param(p, "daemonPort")?,
        ssh_password: clearable_secret(p, "sshPassword")?,
        passphrase: clearable_secret(p, "passphrase")?,
    };
    s.plan_update_job(id, change).map_err(code)
}

fn plan_remove(s: &Session, p: &Value) -> Result<SecretJob> {
    s.plan_remove_job(params::req_str(p, "id")?).map_err(code)
}

// The commands below run the job in one go, which blocks on the store: for a caller that owns its
// thread. A caller that must stay responsive uses `Session::plan_secret_command`.
fn add(s: &mut Session, p: &Value) -> Result<Value> {
    plan_add(s, p)?.run_inline(s)
}

fn update(s: &mut Session, p: &Value) -> Result<Value> {
    plan_update(s, p)?.run_inline(s)
}

fn remove(s: &mut Session, p: &Value) -> Result<Value> {
    plan_remove(s, p)?.run_inline(s)
}

#[cfg(test)]
#[cfg(not(target_arch = "wasm32"))]
mod tests;
