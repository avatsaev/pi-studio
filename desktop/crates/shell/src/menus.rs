//! The menu bar as data. A command with a `menu` path in the registry shows up here with its
//! label, shortcut and enabled state; the "Daemons" menu is built from the registry view, because
//! its items depend on data. Nothing is hand-written per platform: the app draws this model.

use pistudiodesktop_engine::command_specs;
use serde::Serialize;
use serde_json::Value;

use crate::AppShell;
use crate::daemons;
use crate::shortcuts::{self, Shortcut};

/// The label of the daemons menu.
pub const DAEMONS_MENU: &str = "Daemons";
/// The id of "Manage Daemons…".
pub const MANAGE_ID: &str = "daemons.manage";
/// The prefix of an entry item's id; the rest is the entry's id.
pub const ENTRY_PREFIX: &str = "daemon.entry:";
/// The ids of the local daemon items, which are the engine commands they run.
pub const LOCAL_START: &str = "daemon.local.start";
pub const LOCAL_STOP: &str = "daemon.local.stop";
pub const LOCAL_RESTART: &str = "daemon.local.restart";

/// The id of the item that switches to the entry `entry_id`.
pub fn entry_item_id(entry_id: &str) -> String {
    format!("{ENTRY_PREFIX}{entry_id}")
}

/// One entry of a menu, as the frontend draws it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MenuItem {
    pub id: String,
    pub label: String,
    pub shortcut: Option<Shortcut>,
    pub enabled: bool,
    pub checked: bool,
    /// A separator line: the other fields mean nothing.
    pub separator: bool,
    /// Why the item is disabled: its tooltip.
    pub reason: Option<String>,
}

impl MenuItem {
    fn plain(id: impl Into<String>, label: impl Into<String>, enabled: bool, checked: bool) -> Self {
        Self { id: id.into(), label: label.into(), shortcut: None, enabled, checked, separator: false, reason: None }
    }

    fn separator() -> Self {
        Self { id: String::new(), label: String::new(), shortcut: None, enabled: false, checked: false, separator: true, reason: None }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Menu {
    pub label: String,
    pub items: Vec<MenuItem>,
}

/// The "Daemons" menu for a registry view (`{currentId, entries, local, …}`): one item per entry
/// in registry order, checked on the current one, the local entry's label carrying its state when
/// it is not `running`; then "Manage Daemons…"; then the local daemon's start, stop and restart,
/// each enabled only where it applies.
pub fn daemons_menu(view: &Value) -> Menu {
    let current = view["currentId"].as_str().unwrap_or_default();
    let state = view["local"]["state"].as_str().unwrap_or("checking");
    let mut items: Vec<MenuItem> = view["entries"]
        .as_array()
        .map(|entries| entries.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|entry| {
            let id = entry["id"].as_str()?;
            let name = entry["name"].as_str().unwrap_or(id);
            let label = if entry["kind"] == "local" && state != "running" { format!("{name} ({})", state.replace('_', " ")) } else { name.to_owned() };
            Some(MenuItem::plain(entry_item_id(id), label, true, id == current))
        })
        .collect();
    items.push(MenuItem::separator());
    items.push(MenuItem::plain(MANAGE_ID, "Manage Daemons…", true, false));
    items.push(MenuItem::separator());
    let can_start = matches!(state, "stopped" | "failed");
    let can_stop = state == "running";
    for (id, label, enabled) in
        [(LOCAL_START, "Start Local Daemon", can_start), (LOCAL_STOP, "Stop Local Daemon", can_stop), (LOCAL_RESTART, "Restart Local Daemon", can_stop)]
    {
        let mut item = MenuItem::plain(id, label, enabled, false);
        if !enabled {
            item.reason = Some(format!("not available while the local daemon is {}", state.replace('_', " ")));
        }
        items.push(item);
    }
    Menu { label: DAEMONS_MENU.to_owned(), items }
}

/// The whole menu bar for the current state: the daemons menu, then one menu per first path
/// element in the registry, in the order the registry first names them.
pub fn model(app: &mut AppShell) -> Vec<Menu> {
    let mut bar: Vec<Menu> = vec![daemons_menu(&daemons::view(app))];
    for spec in command_specs() {
        let Some(&top) = spec.menu.first() else { continue };
        let enabled = (spec.enabled)(&app.session);
        let item = MenuItem {
            id: spec.id.to_owned(),
            label: spec.label.to_owned(),
            shortcut: spec.shortcut.and_then(shortcuts::parse),
            enabled: enabled.is_ok(),
            checked: false,
            separator: false,
            reason: enabled.err(),
        };
        match bar.iter_mut().find(|menu| menu.label == top) {
            Some(menu) => menu.items.push(item),
            None => bar.push(Menu { label: top.to_owned(), items: vec![item] }),
        }
    }
    bar
}

/// What a click on an item does.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Click {
    /// Switch to this entry.
    Entry(String),
    /// Show the Daemons screen.
    Manage,
    /// Run this local daemon command.
    Local(&'static str),
}

/// What the item `id` stands for; `None` for an id this menu does not own.
pub fn click_of(id: &str) -> Option<Click> {
    if let Some(entry) = id.strip_prefix(ENTRY_PREFIX) {
        return Some(Click::Entry(entry.to_owned()));
    }
    match id {
        MANAGE_ID => Some(Click::Manage),
        LOCAL_START => Some(Click::Local(LOCAL_START)),
        LOCAL_STOP => Some(Click::Local(LOCAL_STOP)),
        LOCAL_RESTART => Some(Click::Local(LOCAL_RESTART)),
        _ => None,
    }
}

/// Carry out a click of the daemons menu. Refusals are alerted with their reason. `switch` runs
/// the window's switch ([`crate::switch::switch_to`]); `manage` shows the Daemons screen.
/// Blocks on dialogs: call it off the owner thread and off the UI thread.
#[cfg(not(target_arch = "wasm32"))]
pub fn handle_click(
    services: &crate::Services,
    access: &crate::owner_access::OwnerAccess,
    click: &Click,
    switch: impl FnOnce(&str) -> Result<Option<&'static str>, String>,
    manage: impl FnOnce(),
) {
    use serde_json::json;
    let fail = |what: &str, reason: &str| crate::dialogs::alert(services, &format!("{what}: {reason}"));
    let list = || access.execute("daemon.list", Value::Null);
    match click {
        Click::Manage => manage(),
        Click::Entry(id) => match list() {
            // Rust cannot see the page's connection: the current entry does nothing, and Retry
            // in the connection bar reconnects.
            Ok(list) if list["currentId"] == id.as_str() => {}
            Ok(_) => {
                if let Err(e) = switch(id) {
                    fail("Could not switch daemon", &e);
                }
            }
            Err(e) => fail("Could not switch daemon", &e),
        },
        Click::Local(command) => {
            if *command == LOCAL_STOP {
                match list() {
                    Ok(list) if list["currentId"] == "local" && !crate::dialogs::confirm(services, "Agents running on this daemon will stop.") => return,
                    Ok(_) => {}
                    Err(e) => return fail("Could not stop the local daemon", &e),
                }
            }
            if let Err(e) = access.execute(command, json!({})) {
                fail("The local daemon command was refused", &e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn view(local: Value, current: &str) -> Value {
        json!({"currentId": current, "local": local, "entries": [
            {"id": "local", "kind": "local", "name": "This machine", "hasPassword": false},
            {"id": "b", "kind": "direct", "name": "B", "address": "h:1", "hasPassword": false},
            {"id": "c", "kind": "relay", "name": "C", "hasPassword": false},
        ]})
    }

    fn enabled(menu: &Menu) -> Vec<(&str, bool)> {
        [LOCAL_START, LOCAL_STOP, LOCAL_RESTART].iter().map(|id| (*id, menu.items.iter().find(|i| i.id == *id).is_some_and(|i| i.enabled))).collect()
    }

    #[test]
    fn running_local_with_b_current_checks_only_b_and_enables_stop_and_restart() {
        let menu = daemons_menu(&view(json!({"state": "running", "host": "h", "port": 1}), "b"));
        let entries: Vec<_> = menu.items.iter().filter(|i| i.id.starts_with(ENTRY_PREFIX)).collect();
        assert_eq!(entries.iter().map(|i| (i.label.as_str(), i.checked)).collect::<Vec<_>>(), [("This machine", false), ("B", true), ("C", false)]);
        assert_eq!(enabled(&menu), [(LOCAL_START, false), (LOCAL_STOP, true), (LOCAL_RESTART, true)]);
        assert_eq!(menu.items.iter().filter(|i| i.separator).count(), 2);
        assert!(menu.items.iter().any(|i| i.id == MANAGE_ID && i.label == "Manage Daemons…"));
    }

    #[test]
    fn the_local_label_carries_its_state_and_only_what_applies_is_enabled() {
        let stopped = daemons_menu(&view(json!({"state": "stopped"}), "local"));
        assert_eq!(stopped.items[0].label, "This machine (stopped)");
        assert!(stopped.items[0].checked);
        assert_eq!(enabled(&stopped), [(LOCAL_START, true), (LOCAL_STOP, false), (LOCAL_RESTART, false)]);
        let failed = daemons_menu(&view(json!({"state": "failed", "reason": "timeout"}), "b"));
        assert_eq!(enabled(&failed), [(LOCAL_START, true), (LOCAL_STOP, false), (LOCAL_RESTART, false)]);
        for state in ["unsupported", "cli_missing", "cli_outdated", "checking", "starting", "stopping"] {
            let menu = daemons_menu(&view(json!({"state": state}), "b"));
            assert_eq!(enabled(&menu), [(LOCAL_START, false), (LOCAL_STOP, false), (LOCAL_RESTART, false)], "{state}");
        }
        assert_eq!(daemons_menu(&view(json!({"state": "cli_missing"}), "b")).items[0].label, "This machine (cli missing)");
    }

    #[test]
    fn ids_map_to_clicks() {
        assert_eq!(click_of(&entry_item_id("b")), Some(Click::Entry("b".into())));
        assert_eq!(click_of(MANAGE_ID), Some(Click::Manage));
        assert_eq!(click_of(LOCAL_STOP), Some(Click::Local(LOCAL_STOP)));
        assert_eq!(click_of("nope"), None);
    }

    #[cfg(not(target_arch = "wasm32"))]
    mod clicks {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::mpsc::channel;
        use std::sync::{Arc, Mutex};
        use std::time::Duration;

        use pistudiodesktop_engine::Session;

        use serde_json::json;

        use super::super::*;
        use crate::owner_access::OwnerAccess;
        use crate::{Services, owner};

        fn running() -> (OwnerAccess, String) {
            let mut app = AppShell::new(Session::new(), Services::default());
            let store = app.session.secret_store();
            let (tx, rx) = channel();
            std::thread::spawn(move || owner::serve(&mut app, &rx, Duration::from_secs(3600)));
            let access = OwnerAccess::new(tx, store);
            let added = access.execute("daemon.add", json!({"kind": "direct", "name": "B", "address": "10.0.0.2:8080"})).unwrap();
            (access, added["id"].as_str().unwrap().to_owned())
        }

        fn answering(answer: bool, asked: &Arc<Mutex<Vec<String>>>) -> Services {
            let (for_confirm, for_alert) = (Arc::clone(asked), Arc::clone(asked));
            Services {
                confirm: Some(Arc::new(move |text| {
                    for_confirm.lock().unwrap().push(text.to_owned());
                    answer
                })),
                alert: Some(Arc::new(move |text| for_alert.lock().unwrap().push(format!("alert: {text}")))),
                ..Services::default()
            }
        }

        #[test]
        fn the_current_entry_runs_nothing_and_another_switches_once() {
            let (access, b) = running();
            let (asked, switches) = (Arc::new(Mutex::new(vec![])), AtomicUsize::new(0));
            let switch = |_: &str| {
                switches.fetch_add(1, Ordering::SeqCst);
                Ok(None)
            };
            handle_click(&answering(true, &asked), &access, &Click::Entry("local".into()), switch, || {});
            assert_eq!(switches.load(Ordering::SeqCst), 0);
            handle_click(&answering(true, &asked), &access, &Click::Entry(b), switch, || {});
            assert_eq!(switches.load(Ordering::SeqCst), 1);
            assert!(asked.lock().unwrap().is_empty());
        }

        #[test]
        fn a_failed_switch_is_alerted_and_manage_is_forwarded() {
            let (access, b) = running();
            let (asked, managed) = (Arc::new(Mutex::new(vec![])), AtomicUsize::new(0));
            handle_click(&answering(true, &asked), &access, &Click::Entry(b), |_| Err("busy".into()), || {});
            handle_click(
                &answering(true, &asked),
                &access,
                &Click::Manage,
                |_| Ok(None),
                || {
                    managed.fetch_add(1, Ordering::SeqCst);
                },
            );
            assert_eq!(*asked.lock().unwrap(), vec!["alert: Could not switch daemon: busy".to_owned()]);
            assert_eq!(managed.load(Ordering::SeqCst), 1);
        }

        #[test]
        fn stopping_the_current_local_daemon_asks_first_and_no_runs_nothing() {
            let (access, b) = running();
            let asked = Arc::new(Mutex::new(vec![]));
            handle_click(&answering(false, &asked), &access, &Click::Local(LOCAL_STOP), |_| Ok(None), || {});
            assert_eq!(*asked.lock().unwrap(), vec!["Agents running on this daemon will stop.".to_owned()]);
            // Nothing was queued by the declined stop: the daemon list is untouched and no alert came.
            assert_eq!(access.execute("daemon.list", Value::Null).unwrap()["currentId"], "local");
            // With another entry current there is no question.
            access.execute("daemon.switch", json!({"id": b})).unwrap();
            asked.lock().unwrap().clear();
            handle_click(&answering(false, &asked), &access, &Click::Local(LOCAL_START), |_| Ok(None), || {});
            assert!(asked.lock().unwrap().iter().all(|t| t.starts_with("alert:")), "start never asks");
        }
    }
}
