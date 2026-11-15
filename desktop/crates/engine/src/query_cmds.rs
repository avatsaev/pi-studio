//! Read-only commands: what agents call first to learn what exists and what state it is in.

use serde_json::{Value, json};

use crate::commands::{CommandSpec, always, command_specs, has_doc, list_entry};
use crate::{Result, Session, params};

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec {
            id: "command.list",
            label: "List Commands",
            menu: &[],
            shortcut: None,
            params: r#"{"filter": string = ""}"#,
            enabled: always,
            run: command_list,
        },
        CommandSpec { id: "document.inspect", label: "Inspect Document", menu: &[], shortcut: None, params: "{}", enabled: has_doc, run: inspect },
    ]
}

fn command_list(s: &mut Session, p: &Value) -> Result<Value> {
    let needle = params::str_param(p, "filter")?.unwrap_or("").to_lowercase();
    let rows = command_specs().iter().filter(|c| c.id.to_lowercase().contains(&needle) || c.label.to_lowercase().contains(&needle));
    Ok(Value::Array(rows.map(|c| list_entry(s, c)).collect()))
}

fn inspect(s: &mut Session, _: &Value) -> Result<Value> {
    let Some(d) = s.active() else { return Ok(Value::Null) };
    Ok(json!({
        "title": d.doc.title,
        "items": d.doc.items,
        "revision": d.revision,
        "path": d.path,
        "dirty": d.dirty(),
        "undo": d.history.undo_label(),
        "redo": d.history.redo_label(),
    }))
}
