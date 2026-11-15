//! The command registry: what menus, shortcuts, the CLI and automation are generated from.
//!
//! To add a command: write `fn(&mut Session, &Value) -> Result<Value>` in the `<area>_cmds.rs`
//! module it belongs to, describe it in that module's `specs()`, and (for a new module) add one
//! `v.extend(...)` line to [`build`]. Nothing else needs wiring.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde_json::{Value, json};

use crate::{Result, Session};

/// Runs the command. Returns a JSON result; records at most one history step.
pub type Run = fn(&mut Session, &Value) -> Result<Value>;
/// `Err(reason)` when the command cannot run now. Shown as the disabled menu item's tooltip.
pub type Enabled = fn(&Session) -> std::result::Result<(), String>;

/// Metadata and implementation of one command.
pub struct CommandSpec {
    /// Stable, dotted, camelCase: `item.setDone`. Never renamed once released.
    pub id: &'static str,
    pub label: &'static str,
    /// Menu placement, e.g. `["Edit"]`. Empty = not in menus.
    pub menu: &'static [&'static str],
    /// Default shortcut (`Cmd+Shift+Z`); `Cmd` is Ctrl on Windows and Linux.
    pub shortcut: Option<&'static str>,
    /// What agents and scripts read: the params, their types and defaults.
    pub params: &'static str,
    pub enabled: Enabled,
    pub run: Run,
}

pub fn always(_: &Session) -> std::result::Result<(), String> {
    Ok(())
}

pub fn has_doc(s: &Session) -> std::result::Result<(), String> {
    s.active().map(|_| ()).ok_or_else(|| "no document open".to_string())
}

struct Registry {
    specs: Vec<CommandSpec>,
    by_id: HashMap<&'static str, usize>,
}

fn build() -> Vec<CommandSpec> {
    let mut v = Vec::new();
    v.extend(crate::file_cmds::specs());
    v.extend(crate::edit_cmds::specs());
    v.extend(crate::item_cmds::specs());
    v.extend(crate::query_cmds::specs());
    #[cfg(test)]
    v.extend(tests::specs());
    v
}

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let specs = build();
        let by_id = specs.iter().enumerate().map(|(index, c)| (c.id, index)).collect();
        Registry { specs, by_id }
    })
}

pub fn command_specs() -> &'static [CommandSpec] {
    &registry().specs
}

pub fn find(id: &str) -> Option<&'static CommandSpec> {
    let registry = registry();
    registry.by_id.get(id).and_then(|&index| registry.specs.get(index))
}

/// One row of `command.list`: the spec plus whether it can run now.
pub fn list_entry(s: &Session, c: &CommandSpec) -> Value {
    let enabled = (c.enabled)(s);
    json!({
        "id": c.id,
        "label": c.label,
        "menu": c.menu,
        "shortcut": c.shortcut,
        "params": c.params,
        "enabled": enabled.is_ok(),
        "reason": enabled.err(),
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A command that panics, to prove `Session::execute` contains it.
    pub(crate) fn specs() -> Vec<CommandSpec> {
        vec![CommandSpec { id: "test.panic", label: "Panic", menu: &[], shortcut: None, params: "{}", enabled: always, run: |_, _| panic!("boom") }]
    }

    #[test]
    fn ids_and_shortcuts_are_unique() {
        let mut ids = std::collections::HashSet::new();
        let mut shortcuts = std::collections::HashSet::new();
        for c in command_specs() {
            assert!(ids.insert(c.id), "duplicate command id {}", c.id);
            if let Some(s) = c.shortcut {
                assert!(shortcuts.insert(s), "shortcut {s} is bound twice");
            }
            assert!(find(c.id).is_some());
        }
    }
}
