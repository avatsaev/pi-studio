use std::sync::Arc;
use std::sync::atomic::Ordering;

use pistudiodesktop_model::{EntryId, NewEntry, RegistryV2, decode_registry_v2, encode_registry_v2};
use serde_json::json;

use crate::test_store::FakeStore;
use crate::{EngineError, Notice, Session};

const B: &str = "11111111-1111-4111-8111-111111111111";

fn open(dir: &std::path::Path) -> (Session, Vec<Notice>, Arc<FakeStore>) {
    let store = Arc::new(FakeStore::default());
    let (session, notices) = Session::with_config_dir(dir, store.clone());
    (session, notices, store)
}

fn seed(dir: &std::path::Path, last_used: Option<&str>) {
    let mut registry = RegistryV2::default()
        .add(EntryId::parse(B).unwrap(), NewEntry::Direct { name: "B".into(), address: "10.0.0.2:8080".into(), has_password: false })
        .unwrap();
    if let Some(id) = last_used {
        registry.last_used_id = Some(EntryId::parse(id).unwrap());
    }
    std::fs::write(dir.join("daemons.json"), encode_registry_v2(&registry)).unwrap();
}

fn read_registry(dir: &std::path::Path) -> RegistryV2 {
    decode_registry_v2(&std::fs::read(dir.join("daemons.json")).unwrap()).unwrap()
}

fn err(r: crate::Result<serde_json::Value>) -> String {
    r.unwrap_err().to_string()
}

fn add_direct(s: &mut Session, name: &str, password: Option<&str>) -> serde_json::Value {
    s.execute("daemon.add", json!({"kind": "direct", "name": name, "address": "10.0.0.9:8080", "password": password})).unwrap()
}

fn item(id: &str, kind: &str) -> String {
    format!("{id}/{kind}")
}

#[test]
fn an_empty_directory_gets_a_private_registry_with_local() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, notices, _) = open(dir.path());
    assert!(notices.is_empty());
    let path = dir.path().join("daemons.json");
    let on_disk = read_registry(dir.path());
    assert_eq!((on_disk.version, on_disk.entries.len()), (2, 1));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let list = s.execute("daemon.list", json!({})).unwrap();
    assert_eq!(list["currentId"], "local");
    assert_eq!(list["entries"].as_array().unwrap().len(), 1);
    assert_eq!(list["local"], json!({"state": "checking"}));
    assert!(!list.to_string().contains("password\""));
}

#[test]
fn a_memory_session_has_local_and_writes_nothing() {
    let mut s = Session::new();
    let list = s.execute("daemon.list", json!({})).unwrap();
    assert_eq!(list["currentId"], "local");
    assert_eq!(list["entries"].as_array().unwrap().len(), 1);
    s.set_local_supported(false);
    assert_eq!(s.execute("daemon.list", json!({})).unwrap()["local"], json!({"state": "unsupported"}));
    assert!(s.take_registry_changed());
    assert!(!s.take_registry_changed());
}

#[test]
fn switching_is_written_and_the_next_session_starts_there() {
    let dir = tempfile::tempdir().unwrap();
    seed(dir.path(), None);
    let (mut s, _, _) = open(dir.path());
    assert_eq!(s.execute("daemon.switch", json!({"id": B})).unwrap(), json!({"currentId": B}));
    assert!(s.take_registry_changed());
    assert_eq!(read_registry(dir.path()).last_used_id.as_ref().map(EntryId::as_str), Some(B));
    let (mut again, _, _) = open(dir.path());
    assert_eq!(again.execute("daemon.list", json!({})).unwrap()["currentId"], B);
    // The current entry again: nothing changes.
    assert_eq!(s.execute("daemon.switch", json!({"id": B})).unwrap(), json!({"currentId": B}));
    assert!(!s.take_registry_changed());
}

#[test]
fn stored_keys_follow_the_entry() {
    let dir = tempfile::tempdir().unwrap();
    seed(dir.path(), None);
    let (mut s, _, _) = open(dir.path());
    let entry_key = "pi-studio-tabs";
    let global_key = "pi-studio-appearance";
    s.storage_set(entry_key, "on-local").unwrap();
    s.storage_set(global_key, "dark").unwrap();
    let in_local = s.storage_snapshot();
    assert!(in_local.contains_key(entry_key));
    s.execute("daemon.switch", json!({"id": B})).unwrap();
    let in_b = s.storage_snapshot();
    assert!(!in_b.contains_key(entry_key));
    assert_eq!(in_b.get(global_key).map(String::as_str), Some("dark"));
    s.execute("daemon.switch", json!({"id": "local"})).unwrap();
    assert_eq!(s.storage_snapshot(), in_local);
    s.storage_flush().unwrap();
    assert!(!s.storage_unwritten());
}

#[test]
fn an_unknown_id_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, _, _) = open(dir.path());
    let before = std::fs::read(dir.path().join("daemons.json")).unwrap();
    let _ = s.take_registry_changed();
    assert_eq!(s.execute("daemon.switch", json!({"id": B})), Err(EngineError::Other("not_found".into())));
    assert_eq!(s.execute("daemon.switch", json!({"id": "nope"})).unwrap_err().to_string(), "not_found");
    assert!(matches!(s.execute("daemon.switch", json!({})), Err(EngineError::BadParams(_))));
    assert_eq!(std::fs::read(dir.path().join("daemons.json")).unwrap(), before);
    assert!(!s.take_registry_changed());
}

#[test]
fn a_last_used_id_without_an_entry_opens_on_local() {
    let dir = tempfile::tempdir().unwrap();
    let registry = RegistryV2 { last_used_id: Some(EntryId::parse(B).unwrap()), ..RegistryV2::default() };
    std::fs::write(dir.path().join("daemons.json"), encode_registry_v2(&registry)).unwrap();
    let (s, notices, _) = open(dir.path());
    assert!(notices.is_empty());
    assert_eq!(s.current_entry_id().map(EntryId::as_str), Some("local"));
    assert!(read_registry(dir.path()).last_used_id.is_none());
}

#[test]
fn a_corrupt_registry_is_set_aside() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("daemons.json"), b"{not json").unwrap();
    let (mut s, notices, _) = open(dir.path());
    assert_eq!(notices.len(), 1);
    assert!(matches!(&notices[0], Notice::FileReset { file, kept_as: Some(_) } if file == "daemons.json"));
    assert_eq!(s.execute("daemon.list", json!({})).unwrap()["entries"].as_array().unwrap().len(), 1);
    let names: Vec<String> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    assert!(names.iter().any(|n| n.starts_with("daemons.json.corrupt-")), "{names:?}");
}

#[test]
fn add_stores_the_secret_writes_the_entry_without_it_and_does_not_switch() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, _, store) = open(dir.path());
    let _ = s.take_registry_changed();
    let view = add_direct(&mut s, "  Work ", Some("hunter2"));
    assert_eq!(view["name"], "Work");
    assert_eq!(view["kind"], "direct");
    assert_eq!(view["hasPassword"], true);
    assert!(!view.to_string().contains("hunter2"));
    let id = view["id"].as_str().unwrap().to_owned();
    assert!(EntryId::parse(&id).is_ok() && id != "local");
    assert!(s.take_registry_changed());
    let text = std::fs::read_to_string(dir.path().join("daemons.json")).unwrap();
    assert!(!text.contains("hunter2") && text.contains("\"hasPassword\": true"), "{text}");
    assert_eq!(s.execute("daemon.list", json!({})).unwrap()["currentId"], "local");
    let relay = s.execute("daemon.add", json!({"kind": "relay", "name": "R", "pairingLink": "pi://x"})).unwrap();
    assert_eq!(relay["kind"], "relay");
    assert_eq!(read_registry(dir.path()).entries.len(), 3);
    let rid = relay["id"].as_str().unwrap();
    let mut want = vec![item(&id, "password"), item(rid, "pairingLink")];
    want.sort();
    assert_eq!(store.all(), want);
}

#[test]
fn refused_commands_leave_the_file_and_the_store_alone() {
    let dir = tempfile::tempdir().unwrap();
    seed(dir.path(), None);
    let (mut s, _, store) = open(dir.path());
    let relay = s.execute("daemon.add", json!({"kind": "relay", "name": "R", "pairingLink": "pi://x"})).unwrap();
    let rid = relay["id"].as_str().unwrap().to_owned();
    let _ = s.take_registry_changed();
    let before = std::fs::read(dir.path().join("daemons.json")).unwrap();
    let calls = store.calls.load(Ordering::SeqCst);
    let direct = |name: &str, address: &str| json!({"kind": "direct", "name": name, "address": address});
    assert_eq!(err(s.execute("daemon.add", direct(" ", "a:1"))), "invalid_name");
    assert_eq!(err(s.execute("daemon.add", direct(&"n".repeat(65), "a:1"))), "invalid_name");
    assert_eq!(err(s.execute("daemon.add", direct("b", "a:1"))), "name_taken");
    assert_eq!(err(s.execute("daemon.add", direct("x", ""))), "invalid_address");
    assert_eq!(err(s.execute("daemon.add", json!({"kind": "relay", "name": "x", "pairingLink": ""}))), "invalid_link");
    assert_eq!(err(s.execute("daemon.add", json!({"kind": "direct", "name": "x", "address": "a:1", "password": ""}))), "invalid_password");
    assert_eq!(err(s.execute("daemon.update", json!({"id": B, "name": "R"}))), "name_taken");
    assert_eq!(err(s.execute("daemon.update", json!({"id": B, "name": ""}))), "invalid_name");
    assert_eq!(err(s.execute("daemon.update", json!({"id": B, "address": ""}))), "invalid_address");
    assert_eq!(err(s.execute("daemon.update", json!({"id": rid, "pairingLink": ""}))), "invalid_link");
    assert_eq!(err(s.execute("daemon.update", json!({"id": B, "password": ""}))), "invalid_password");
    assert_eq!(err(s.execute("daemon.update", json!({"id": "11111111-1111-4111-8111-222222222222", "name": "q"}))), "not_found");
    assert_eq!(err(s.execute("daemon.update", json!({"id": rid, "address": "a:1"}))), "wrong_kind");
    assert_eq!(err(s.execute("daemon.update", json!({"id": rid, "password": "p"}))), "wrong_kind");
    assert_eq!(err(s.execute("daemon.update", json!({"id": B, "pairingLink": "l"}))), "wrong_kind");
    assert_eq!(err(s.execute("daemon.update", json!({"id": "local", "address": "a:1"}))), "wrong_kind");
    assert_eq!(err(s.execute("daemon.remove", json!({"id": "local"}))), "local_not_removable");
    assert_eq!(err(s.execute("daemon.remove", json!({"id": "nope"}))), "not_found");
    assert!(matches!(s.execute("daemon.add", json!({"kind": "x", "name": "y"})), Err(EngineError::BadParams(_))));
    assert!(matches!(s.execute("daemon.update", json!({"id": B, "password": 5})), Err(EngineError::BadParams(_))));
    assert_eq!(std::fs::read(dir.path().join("daemons.json")).unwrap(), before);
    assert_eq!(store.calls.load(Ordering::SeqCst), calls, "a refused command never reaches the store");
    assert!(!s.take_registry_changed());
    for _ in 0..62 {
        let n = read_registry(dir.path()).entries.len();
        if n >= 64 {
            break;
        }
        add_direct(&mut s, &format!("e{n}"), None);
    }
    let full = std::fs::read(dir.path().join("daemons.json")).unwrap();
    assert_eq!(err(s.execute("daemon.add", direct("one more", "a:1"))), "too_many");
    assert_eq!(std::fs::read(dir.path().join("daemons.json")).unwrap(), full);
}

#[test]
fn update_changes_only_what_is_given() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, _, store) = open(dir.path());
    let id = add_direct(&mut s, "Work", Some("pw"))["id"].as_str().unwrap().to_owned();
    let password = item(&id, "password");
    let v = s.execute("daemon.update", json!({"id": id, "address": "h:2"})).unwrap();
    assert_eq!((v["address"].as_str(), v["hasPassword"].as_bool(), v["name"].as_str()), (Some("h:2"), Some(true), Some("Work")));
    assert!(store.has(&password));
    let v = s.execute("daemon.update", json!({"id": id, "password": null})).unwrap();
    assert_eq!(v["hasPassword"], false);
    assert!(!store.has(&password), "clearing a password removes the item");
    let v = s.execute("daemon.update", json!({"id": id, "password": "new"})).unwrap();
    assert_eq!(v["hasPassword"], true);
    assert!(store.has(&password));
    // The same name again is the entry's own.
    s.execute("daemon.update", json!({"id": id, "name": "work"})).unwrap();
    // Local: name and password only.
    let v = s.execute("daemon.update", json!({"id": "local", "name": "Mine", "password": "lp"})).unwrap();
    assert_eq!((v["name"].as_str(), v["hasPassword"].as_bool()), (Some("Mine"), Some(true)));
    assert!(store.has("local/password"));
    // A relay entry keeps its name and id when the link changes, and the new link replaces the old.
    let r = s.execute("daemon.add", json!({"kind": "relay", "name": "R", "pairingLink": "pi://old"})).unwrap();
    let rid = r["id"].as_str().unwrap();
    let v = s.execute("daemon.update", json!({"id": rid, "pairingLink": "pi://new"})).unwrap();
    assert_eq!((v["id"].as_str(), v["name"].as_str()), (Some(rid), Some("R")));
    let text = std::fs::read_to_string(dir.path().join("daemons.json")).unwrap();
    assert!(!text.contains("pi://") && !text.contains("\"pw\"") && !text.contains("lp"), "{text}");
    assert_eq!(store.value(&item(rid, "pairingLink")).as_deref(), Some("pi://new"));
}

#[test]
fn removing_deletes_the_entry_its_state_and_its_secrets() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, _, store) = open(dir.path());
    let id =
        s.execute("daemon.add", json!({"kind": "direct", "name": "W", "address": "h:1", "password": "s3cret-pw"})).unwrap()["id"].as_str().unwrap().to_owned();
    assert!(store.has(&item(&id, "password")));
    s.execute("daemon.switch", json!({"id": id})).unwrap();
    s.storage_set("pi-studio-tabs", "mine").unwrap();
    s.storage_flush().unwrap();
    let state = dir.path().join("daemon-state").join(format!("{id}.json"));
    assert!(state.is_file());
    let _ = s.take_registry_changed();
    assert_eq!(s.execute("daemon.remove", json!({"id": id})).unwrap(), json!({"removed": true}));
    assert!(s.take_registry_changed());
    assert!(!state.exists());
    assert!(!store.has(&item(&id, "password")));
    let list = s.execute("daemon.list", json!({})).unwrap();
    assert_eq!(list["currentId"], serde_json::Value::Null);
    assert_eq!(list["entries"].as_array().unwrap().len(), 1);
    // No current entry: an entry key is dropped, a global key is kept.
    s.storage_set("pi-studio-tabs", "lost").unwrap();
    s.storage_set("pi-studio-appearance", "dark").unwrap();
    assert!(!s.storage_snapshot().contains_key("pi-studio-tabs"));
    s.storage_flush().unwrap();
    for entry in walk(dir.path()) {
        let text = std::fs::read_to_string(&entry).unwrap_or_default();
        assert!(!text.contains("s3cret-pw") && !text.contains(&id) && !text.contains("mine"), "{entry:?}");
        assert!(!entry.to_string_lossy().contains(&id), "{entry:?}");
    }
    assert!(
        !dir.path().join("daemon-state/local.json").exists() || !std::fs::read_to_string(dir.path().join("daemon-state/local.json")).unwrap().contains("lost")
    );
    let (mut again, _, _) = open(dir.path());
    assert_eq!(again.execute("daemon.list", json!({})).unwrap()["currentId"], "local");
    // A switch makes an entry current again.
    s.execute("daemon.switch", json!({"id": "local"})).unwrap();
    assert_eq!(s.execute("daemon.list", json!({})).unwrap()["currentId"], "local");
}

fn walk(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            out.extend(walk(&p));
        } else {
            out.push(p);
        }
    }
    out
}

#[test]
fn a_missing_state_file_is_not_an_error_on_remove() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, _, _) = open(dir.path());
    let id = add_direct(&mut s, "W", None)["id"].as_str().unwrap().to_owned();
    assert!(s.execute("daemon.remove", json!({"id": id})).is_ok());
}

#[test]
fn a_write_failure_fails_the_command_keeps_the_old_registry_and_leaves_no_new_secret() {
    let dir = tempfile::tempdir().unwrap();
    seed(dir.path(), None);
    let (mut s, _, store) = open(dir.path());
    let _ = s.take_registry_changed();
    // Replace the file by a non-empty directory: the rename over it fails.
    std::fs::remove_file(dir.path().join("daemons.json")).unwrap();
    std::fs::create_dir_all(dir.path().join("daemons.json")).unwrap();
    std::fs::write(dir.path().join("daemons.json/keep"), b"k").unwrap();
    let before = s.execute("daemon.list", json!({})).unwrap();
    assert_eq!(err(s.execute("daemon.add", json!({"kind": "direct", "name": "Z", "address": "a:1"}))), "write_failed");
    assert_eq!(err(s.execute("daemon.add", json!({"kind": "relay", "name": "Y", "pairingLink": "pi://y"}))), "write_failed");
    assert_eq!(err(s.execute("daemon.update", json!({"id": B, "name": "Z"}))), "write_failed");
    assert_eq!(err(s.execute("daemon.remove", json!({"id": B}))), "write_failed");
    assert_eq!(s.execute("daemon.list", json!({})).unwrap(), before);
    assert!(!s.take_registry_changed());
    // The relay add stored its link first and took it back when the file would not write.
    assert_eq!(store.all(), Vec::<String>::new());
}

#[test]
fn a_store_that_refuses_fails_add_and_update_and_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    seed(dir.path(), None);
    let (mut s, _, store) = open(dir.path());
    let _ = s.take_registry_changed();
    let before = std::fs::read(dir.path().join("daemons.json")).unwrap();
    store.fail_set.store(true, Ordering::SeqCst);
    assert_eq!(err(s.execute("daemon.add", json!({"kind": "direct", "name": "Z", "address": "a:1", "password": "pw"}))), "secret_store_failed");
    assert_eq!(err(s.execute("daemon.add", json!({"kind": "relay", "name": "Y", "pairingLink": "pi://y"}))), "secret_store_failed");
    assert_eq!(err(s.execute("daemon.update", json!({"id": B, "password": "pw"}))), "secret_store_failed");
    store.fail_set.store(false, Ordering::SeqCst);
    store.fail_delete.store(true, Ordering::SeqCst);
    s.execute("daemon.update", json!({"id": B, "password": "pw"})).unwrap();
    let with_password = std::fs::read(dir.path().join("daemons.json")).unwrap();
    assert_eq!(err(s.execute("daemon.update", json!({"id": B, "password": null}))), "secret_store_failed");
    assert_eq!(std::fs::read(dir.path().join("daemons.json")).unwrap(), with_password, "a password that cannot be removed stays in the registry");
    assert_ne!(with_password, before);
}

#[test]
fn a_secret_that_cannot_be_deleted_on_remove_does_not_keep_the_entry() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, _, store) = open(dir.path());
    let id = add_direct(&mut s, "W", Some("pw"))["id"].as_str().unwrap().to_owned();
    store.fail_delete.store(true, Ordering::SeqCst);
    assert_eq!(s.execute("daemon.remove", json!({"id": id})).unwrap(), json!({"removed": true}));
    assert!(read_registry(dir.path()).get(&id).is_none());
}
