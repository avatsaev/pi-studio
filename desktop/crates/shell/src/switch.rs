//! Switching the window to another daemon entry: the one path the page command and the native menu
//! share. It asks first when file transfers are running, has the session switch (which writes the
//! stored keys of the entry being left, records the new last-used entry and writes the registry),
//! and then has the page reloaded, so the workbench boots on the new entry's stored state.

use serde_json::Value;

use crate::owner_access::OwnerAccess;
use crate::page::{SwitchDecision, switch_decision};
use crate::{Request, Services, dialogs};

/// How a switch ended when it did not fail.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Switched {
    /// The registry now says `id`, and the page was reloaded.
    Done,
    /// The user declined the question about running transfers: nothing changed.
    Cancelled,
}

/// Switch to the entry `id`. `transfers` is the page's count of running file transfers; `leave` ends
/// what the entry being left holds open (its file transfers and connections) and `reload` reloads
/// the page. `leave` runs once the switch is certain (after the question, if there was one) and
/// before the registry changes, so that nothing the old page started can reconnect to the new
/// entry's daemon; it does not run for a declined or an impossible switch. Errors are codes
/// (`not_found`) or the text of the failure; the page is reloaded only after the registry is switched.
///
/// Blocks on the confirm, on `leave` and on the owner thread: call it off the session's thread and
/// off the UI thread.
pub fn switch_to(
    services: &Services,
    access: &OwnerAccess,
    transfers: usize,
    id: &str,
    leave: impl FnOnce(),
    reload: impl FnOnce() -> Result<(), String>,
) -> Result<Switched, String> {
    let list = access.execute("daemon.list", Value::Null)?;
    let known = list["entries"].as_array().is_some_and(|entries| entries.iter().any(|entry| entry["id"] == id));
    match switch_decision(known, transfers) {
        SwitchDecision::NotFound => return Err("not_found".into()),
        SwitchDecision::Ask(text) if !dialogs::confirm(services, &text) => return Ok(Switched::Cancelled),
        SwitchDecision::Ask(_) | SwitchDecision::Switch => {}
    }
    leave();
    access.call(Request::SwitchEntry { id: id.to_owned() })?;
    reload()?;
    Ok(Switched::Done)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc::channel;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use pistudiodesktop_engine::Session;
    use serde_json::json;

    use super::*;
    use crate::{AppShell, Request, owner};

    /// An owner thread on `dir`, and the id of a direct entry B added to its registry.
    fn running(dir: &std::path::Path) -> (OwnerAccess, String) {
        let (session, _) = Session::with_config_dir(dir, Arc::new(pistudiodesktop_secrets::MemoryStore::new()));
        let store = session.secret_store();
        let mut app = AppShell::new(session, Services::default());
        let (tx, rx) = channel();
        std::thread::spawn(move || owner::serve(&mut app, &rx, Duration::from_secs(3600)));
        let access = OwnerAccess::new(tx, store);
        let added = access.execute("daemon.add", json!({"kind": "direct", "name": "B", "address": "10.0.0.2:8080"})).unwrap();
        (access, added["id"].as_str().unwrap().to_owned())
    }

    fn answering(answer: bool, asked: &Arc<Mutex<Vec<String>>>) -> Services {
        let asked = Arc::clone(asked);
        Services {
            confirm: Some(Arc::new(move |text| {
                asked.lock().unwrap().push(text.to_owned());
                answer
            })),
            ..Services::default()
        }
    }

    fn reloaded(count: &AtomicUsize) -> Result<(), String> {
        count.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn current(access: &OwnerAccess) -> Value {
        access.execute("daemon.list", Value::Null).unwrap()["currentId"].clone()
    }

    #[test]
    fn an_unknown_id_is_not_found_with_no_question_no_switch_and_no_reload() {
        let dir = tempfile::tempdir().unwrap();
        let (access, _) = running(dir.path());
        let (asked, reloads) = (Arc::new(Mutex::new(vec![])), AtomicUsize::new(0));
        let result = switch_to(&answering(true, &asked), &access, 3, "nope", || {}, || reloaded(&reloads));
        assert_eq!(result, Err("not_found".into()));
        assert_eq!((asked.lock().unwrap().len(), reloads.load(Ordering::SeqCst), current(&access)), (0, 0, json!("local")));
    }

    #[test]
    fn declining_the_question_leaves_the_registry_the_page_and_the_count_alone() {
        let dir = tempfile::tempdir().unwrap();
        let (access, b) = running(dir.path());
        let (asked, reloads) = (Arc::new(Mutex::new(vec![])), AtomicUsize::new(0));
        let result = switch_to(&answering(false, &asked), &access, 2, &b, || {}, || reloaded(&reloads));
        assert_eq!(result, Ok(Switched::Cancelled));
        assert_eq!(*asked.lock().unwrap(), vec!["2 file transfers are still running. Switch anyway?".to_owned()]);
        assert_eq!((reloads.load(Ordering::SeqCst), current(&access)), (0, json!("local")));
        let on_disk: Value = serde_json::from_str(&std::fs::read_to_string(dir.path().join("daemons.json")).unwrap()).unwrap();
        assert_ne!(on_disk["lastUsedId"], json!(b));
    }

    #[test]
    fn accepting_switches_without_a_question_when_nothing_runs_and_boot_returns_the_new_entrys_keys() {
        let dir = tempfile::tempdir().unwrap();
        let (access, b) = running(dir.path());
        access.execute("daemon.switch", json!({"id": b})).unwrap();
        access.execute("daemon.switch", json!({"id": "local"})).unwrap();
        // A key stored while on `local`, not yet written: the switch writes it to local's file.
        access.call(Request::StorageSet { key: "pi-studio-pane-layout".into(), value: "on-local".into() }).unwrap();

        let (asked, reloads) = (Arc::new(Mutex::new(vec![])), AtomicUsize::new(0));
        let result = switch_to(&answering(false, &asked), &access, 0, &b, || {}, || reloaded(&reloads));
        assert_eq!(result, Ok(Switched::Done));
        assert_eq!((asked.lock().unwrap().len(), reloads.load(Ordering::SeqCst), current(&access)), (0, 1, json!(b)));

        let registry: Value = serde_json::from_str(&std::fs::read_to_string(dir.path().join("daemons.json")).unwrap()).unwrap();
        assert_eq!(registry["lastUsedId"], json!(b));
        let local = std::fs::read_to_string(dir.path().join("daemon-state").join("local.json")).unwrap();
        assert!(local.contains("on-local"), "{local}");
        let boot = access.call(Request::Boot).unwrap();
        assert_eq!(boot["storage"].get("pi-studio-pane-layout"), None, "{boot}");
        assert_eq!(boot["daemons"]["currentId"], json!(b));
    }

    #[test]
    fn a_key_the_old_page_sends_while_unloading_is_not_stored_on_the_new_entry() {
        let dir = tempfile::tempdir().unwrap();
        let (access, b) = running(dir.path());
        access.execute("daemon.switch", json!({"id": b})).unwrap();
        access.call(Request::StorageSet { key: "pi-studio-pane-layout".into(), value: "layout-of-b".into() }).unwrap();
        access.execute("daemon.switch", json!({"id": "local"})).unwrap();
        access.call(Request::StorageSet { key: "pi-studio-pane-layout".into(), value: "layout-of-local".into() }).unwrap();

        // The reload sends the old page's last write, after the switch.
        let late = || access.call(Request::StorageSet { key: "pi-studio-pane-layout".into(), value: "layout-of-local".into() }).map(|_| ());
        assert_eq!(switch_to(&Services::default(), &access, 0, &b, || {}, late), Ok(Switched::Done));

        let boot = access.call(Request::Boot).unwrap();
        assert_eq!(boot["storage"]["pi-studio-pane-layout"], json!("layout-of-b"), "{boot}");
        // The new page's own writes are stored again.
        access.call(Request::StorageSet { key: "pi-studio-pane-layout".into(), value: "newer".into() }).unwrap();
        assert_eq!(access.call(Request::Boot).unwrap()["storage"]["pi-studio-pane-layout"], json!("newer"));
    }

    #[test]
    fn a_confirmed_switch_goes_through_and_a_failed_reload_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let (access, b) = running(dir.path());
        let asked = Arc::new(Mutex::new(vec![]));
        let result = switch_to(&answering(true, &asked), &access, 1, &b, || {}, || Err("no window".into()));
        assert_eq!(result, Err("no window".into()));
        assert_eq!(*asked.lock().unwrap(), vec!["1 file transfer is still running. Switch anyway?".to_owned()]);
        assert_eq!(current(&access), json!(b));
    }

    #[test]
    fn what_the_old_entry_holds_open_is_left_after_the_question_and_before_the_registry_changes() {
        let dir = tempfile::tempdir().unwrap();
        let (access, b) = running(dir.path());
        let left = AtomicUsize::new(0);
        let leave = || {
            // The registry still says the entry being left: nothing can resume against the new one.
            assert_eq!(current(&access), json!("local"));
            left.fetch_add(1, Ordering::SeqCst);
        };
        let asked = Arc::new(Mutex::new(vec![]));
        assert_eq!(switch_to(&answering(false, &asked), &access, 2, &b, leave, || Ok(())), Ok(Switched::Cancelled));
        assert_eq!(switch_to(&answering(true, &asked), &access, 2, "nope", leave, || Ok(())), Err("not_found".into()));
        assert_eq!(left.load(Ordering::SeqCst), 0, "a declined or impossible switch leaves nothing");
        assert_eq!(switch_to(&answering(true, &asked), &access, 2, &b, leave, || Ok(())), Ok(Switched::Done));
        assert_eq!((left.load(Ordering::SeqCst), current(&access)), (1, json!(b)));
    }
}
