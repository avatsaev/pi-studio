//! The menu bar as data, generated from the command registry: a command with a `menu` path
//! shows up here with its label, shortcut and enabled state, with no frontend code of its own.
//! No command has a menu path yet, so the bar is empty.

use pistudiodesktop_engine::command_specs;
use serde::Serialize;

use crate::AppShell;
use crate::shortcuts::{self, Shortcut};

/// One entry of a menu, as the frontend draws it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MenuItem {
    pub id: &'static str,
    pub label: &'static str,
    pub shortcut: Option<Shortcut>,
    pub enabled: bool,
    /// Why the item is disabled: its tooltip.
    pub reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Menu {
    pub label: &'static str,
    pub items: Vec<MenuItem>,
}

/// The whole menu bar for the current state: one menu per first path element in the registry, in
/// the order the registry first names them.
pub fn model(app: &AppShell) -> Vec<Menu> {
    let mut bar: Vec<Menu> = Vec::new();
    for spec in command_specs() {
        let Some(&top) = spec.menu.first() else { continue };
        let enabled = (spec.enabled)(&app.session);
        let item =
            MenuItem { id: spec.id, label: spec.label, shortcut: spec.shortcut.and_then(shortcuts::parse), enabled: enabled.is_ok(), reason: enabled.err() };
        match bar.iter_mut().find(|menu| menu.label == top) {
            Some(menu) => menu.items.push(item),
            None => bar.push(Menu { label: top, items: vec![item] }),
        }
    }
    bar
}
