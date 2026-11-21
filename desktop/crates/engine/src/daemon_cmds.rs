//! The daemon registry as commands: list the entries, switch the current one, add, update and
//! remove entries. The error text of
//! a `daemon.*` command is its code (`not_found`, ...), so callers match on it.

use pistudiodesktop_model::{EntryView, NewEntry, Secret};
use serde_json::{Value, json};

use crate::commands::{CommandSpec, always};
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

fn view_json(view: &EntryView) -> Result<Value> {
    serde_json::to_value(view).map_err(|_| code("write_failed"))
}

fn add(s: &mut Session, p: &Value) -> Result<Value> {
    let name = params::req_str(p, "name")?.to_owned();
    let (new, secret) = match params::req_str(p, "kind")? {
        "direct" => {
            let password = params::str_param(p, "password")?.map(Secret::new);
            (NewEntry::Direct { name, address: params::req_str(p, "address")?.to_owned(), has_password: password.is_some() }, password)
        }
        "relay" => (NewEntry::Relay { name }, Some(Secret::new(params::req_str(p, "pairingLink")?))),
        other => return Err(EngineError::BadParams(format!("`kind` must be `direct` or `relay`, got `{}`", other.chars().take(32).collect::<String>()))),
    };
    view_json(&s.add_entry(new, secret).map_err(code)?)
}

fn update(s: &mut Session, p: &Value) -> Result<Value> {
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
    view_json(&s.update_entry(id, change).map_err(code)?)
}

fn remove(s: &mut Session, p: &Value) -> Result<Value> {
    let id = params::req_str(p, "id")?;
    s.remove_entry(id).map_err(code)?;
    Ok(json!({"removed": true}))
}

#[cfg(test)]
#[cfg(not(target_arch = "wasm32"))]
mod tests;
