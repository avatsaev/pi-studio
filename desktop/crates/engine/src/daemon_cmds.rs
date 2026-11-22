//! The daemon registry as commands: list the entries, switch the current one, add, update and
//! remove entries. The error text of
//! a `daemon.*` command is its code (`not_found`, ...), so callers match on it.

use pistudiodesktop_model::{NewEntry, Secret};
use serde_json::{Value, json};

use crate::commands::{CommandSpec, always};
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
            params: r#"{"kind": "direct", "name": string, "address": string, "password"?: string} | {"kind": "relay", "name": string, "pairingLink": string}"#,
            enabled: always,
            run: add,
        },
        CommandSpec {
            id: "daemon.update",
            label: "Edit Daemon",
            menu: &[],
            shortcut: None,
            params: r#"{"id": string, "name"?: string, "address"?: string, "password"?: string | null, "pairingLink"?: string}"#,
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

fn plan_add(s: &Session, p: &Value) -> Result<SecretJob> {
    let name = params::req_str(p, "name")?.to_owned();
    let (new, secret) = match params::req_str(p, "kind")? {
        "direct" => {
            let password = params::str_param(p, "password")?.map(Secret::new);
            (NewEntry::Direct { name, address: params::req_str(p, "address")?.to_owned(), has_password: password.is_some() }, password)
        }
        "relay" => (NewEntry::Relay { name }, Some(Secret::new(params::req_str(p, "pairingLink")?))),
        other => return Err(EngineError::BadParams(format!("`kind` must be `direct` or `relay`, got `{}`", other.chars().take(32).collect::<String>()))),
    };
    s.plan_add_job(new, secret).map_err(code)
}

fn plan_update(s: &Session, p: &Value) -> Result<SecretJob> {
    let id = params::req_str(p, "id")?;
    // `password: null` clears; an absent field leaves it.
    let password = match p.get("password") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(_) => Some(Some(Secret::new(params::req_str(p, "password")?))),
    };
    let change = EntryChange {
        name: params::str_param(p, "name")?.map(str::to_owned),
        address: params::str_param(p, "address")?.map(str::to_owned),
        password,
        pairing_link: params::str_param(p, "pairingLink")?.map(Secret::new),
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
