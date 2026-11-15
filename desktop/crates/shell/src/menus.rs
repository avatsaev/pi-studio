//! The menu bar as data, generated from the command registry: a command with a `menu` path
//! shows up here with its label, shortcut and enabled state, with no frontend code of its own.

use pistudiodesktop_engine::command_specs;
use serde::Serialize;
use serde_json::{Value, json};

use crate::shortcuts::{self, Shortcut};
use crate::state::ThemeKind;
use crate::{AppShell, PickKind};

pub const MENU_ORDER: &[&str] = &["File", "Edit", "Item", "View"];

const NO_PICKER: &str = "file dialogs are not available here";

/// A command that changes only view state. These live in the shell, not the engine: they
/// touch no document, record no history and mean nothing to the CLI.
pub struct ShellCommand {
    pub id: &'static str,
    pub label: &'static str,
    pub menu: &'static str,
    pub run: fn(&mut AppShell),
    pub checked: fn(&AppShell) -> bool,
}

pub const UI_COMMANDS: &[ShellCommand] = &[
    ShellCommand {
        id: "view.theme.dark",
        label: "Dark Theme",
        menu: "View",
        run: |app| app.ui.theme = ThemeKind::Dark,
        checked: |app| app.ui.theme == ThemeKind::Dark,
    },
    ShellCommand {
        id: "view.theme.light",
        label: "Light Theme",
        menu: "View",
        run: |app| app.ui.theme = ThemeKind::Light,
        checked: |app| app.ui.theme == ThemeKind::Light,
    },
    ShellCommand {
        id: "view.hideDone",
        label: "Hide Completed",
        menu: "View",
        run: |app| app.ui.hide_done = !app.ui.hide_done,
        checked: |app| app.ui.hide_done,
    },
];

pub fn shell_command(id: &str) -> Option<&'static ShellCommand> {
    UI_COMMANDS.iter().find(|c| c.id == id)
}

/// Commands whose menu click first asks the user for a file.
fn needs_picker(id: &str) -> bool {
    matches!(id, "file.open" | "file.saveAs")
}

/// What a menu click or a shortcut does. Commands that need a value only the platform can ask
/// for get it here (a file dialog); everything else runs with its default params. A value the
/// user types into the frontend travels as params of `engine.execute` instead.
pub fn invoke(app: &mut AppShell, id: &str) -> Result<Value, String> {
    // Save on a document that has no file yet behaves as Save As.
    let id = if id == "file.save" && app.session.active().is_some_and(|d| d.path.is_none()) { "file.saveAs" } else { id };
    let params = match id {
        "file.open" | "file.saveAs" => {
            let kind = if id == "file.open" { PickKind::Open } else { PickKind::Save };
            let Some(pick) = app.services.pick_file.as_mut() else {
                app.ui.status = NO_PICKER.into();
                return Err(NO_PICKER.into());
            };
            match pick(kind) {
                Some(path) => json!({"path": path}),
                // The user cancelled: nothing ran and nothing changed.
                None => return Ok(Value::Null),
            }
        }
        _ => Value::Null,
    };
    app.run(id, params)
}

/// One entry of a menu, as the frontend draws it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MenuItem {
    pub id: &'static str,
    pub label: &'static str,
    pub shortcut: Option<Shortcut>,
    pub enabled: bool,
    /// Why the item is disabled: its tooltip.
    pub reason: Option<String>,
    /// `Some` for a shell command that is a toggle.
    pub checked: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Menu {
    pub label: &'static str,
    pub items: Vec<MenuItem>,
}

/// The whole menu bar for the current state.
pub fn model(app: &AppShell) -> Vec<Menu> {
    MENU_ORDER.iter().map(|top| Menu { label: top, items: items(app, top) }).collect()
}

fn items(app: &AppShell, top: &str) -> Vec<MenuItem> {
    let commands = command_specs().iter().filter(|c| c.menu.first().is_some_and(|m| *m == top)).map(|spec| {
        let mut enabled = (spec.enabled)(&app.session);
        if needs_picker(spec.id) && app.services.pick_file.is_none() {
            enabled = Err(NO_PICKER.into());
        }
        MenuItem {
            id: spec.id,
            label: spec.label,
            shortcut: spec.shortcut.and_then(shortcuts::parse),
            enabled: enabled.is_ok(),
            reason: enabled.err(),
            checked: None,
        }
    });
    let toggles = UI_COMMANDS.iter().filter(|c| c.menu == top).map(|command| MenuItem {
        id: command.id,
        label: command.label,
        shortcut: None,
        enabled: true,
        reason: None,
        checked: Some((command.checked)(app)),
    });
    commands.chain(toggles).collect()
}
