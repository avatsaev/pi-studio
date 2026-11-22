use std::sync::Arc;
use std::sync::atomic::Ordering;

use pistudiodesktop_model::{decode_registry_v2, encode_registry_v2};
use serde_json::json;

use crate::test_store::FakeStore;
use crate::{BridgePassword, Dial, DialPlan, Notice, Session};

const DIRECT: &str = "3f2b8a40-1111-4222-8333-444455556666";
const RELAY: &str = "3f2b8a40-1111-4222-8333-444455557777";

fn v1() -> String {
    json!({"version": 1, "lastUsedId": DIRECT, "extra": 7, "entries": [
        {"id": "local", "kind": "local", "name": "This machine", "password": "MARK-local"},
        {"id": DIRECT, "kind": "direct", "name": "d", "address": "h:1", "password": "MARK-direct", "note": 1},
        {"id": RELAY, "kind": "relay", "name": "r", "pairingLink": "pi://MARK-link"},
    ]})
    .to_string()
}

fn open(dir: &std::path::Path, store: &Arc<FakeStore>) -> (Session, Vec<Notice>) {
    Session::with_config_dir(dir, store.clone())
}

fn url(host: &str, port: u16) -> String {
    format!("ws://{host}:{port}")
}

#[test]
fn a_version_1_file_moves_its_secrets_to_the_store_and_becomes_version_2() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("daemons.json"), v1()).unwrap();
    let store = Arc::new(FakeStore::default());
    let (mut s, notices) = open(dir.path(), &store);
    assert!(notices.is_empty(), "{notices:?}");
    let text = std::fs::read_to_string(dir.path().join("daemons.json")).unwrap();
    assert!(!text.contains("MARK") && !text.contains("pairingLink") && !text.contains("\"password\""), "{text}");
    let doc = decode_registry_v2(text.as_bytes()).unwrap();
    assert_eq!(doc.entries.iter().map(|e| e.has_password).collect::<Vec<_>>(), [true, true, false]);
    assert!(text.contains("\"extra\"") && text.contains("\"note\""), "unknown fields survive");
    assert_eq!(store.value("local/password").as_deref(), Some("MARK-local"));
    assert_eq!(store.value(&format!("{DIRECT}/password")).as_deref(), Some("MARK-direct"));
    assert_eq!(store.value(&format!("{RELAY}/pairingLink")).as_deref(), Some("pi://MARK-link"));
    assert_eq!(store.all().len(), 3);
    assert!(!s.execute("daemon.list", json!({})).unwrap().to_string().contains("MARK"));

    // A second load finds version 2: no store call, the file's bytes are the same.
    let calls = store.calls.load(Ordering::SeqCst);
    let before = std::fs::read(dir.path().join("daemons.json")).unwrap();
    let (_, again) = open(dir.path(), &store);
    assert!(again.is_empty());
    assert_eq!(std::fs::read(dir.path().join("daemons.json")).unwrap(), before);
    assert_eq!(store.calls.load(Ordering::SeqCst), calls);
    assert_eq!(encode_registry_v2(&doc), before);
}

#[test]
fn a_version_1_file_without_secrets_becomes_version_2_and_asks_nothing_of_the_store() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("daemons.json"), json!({"version": 1, "entries": [{"id": "local", "kind": "local", "name": "This machine"}]}).to_string())
        .unwrap();
    let store = Arc::new(FakeStore::default());
    store.fail_all();
    let (_, notices) = open(dir.path(), &store);
    assert!(notices.is_empty());
    assert_eq!(decode_registry_v2(&std::fs::read(dir.path().join("daemons.json")).unwrap()).unwrap().version, 2);
    assert_eq!(store.calls.load(Ordering::SeqCst), 0);
}

#[test]
fn a_store_that_refuses_leaves_the_file_as_it_was_and_serves_this_run_from_memory() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("daemons.json");
    std::fs::write(&path, v1()).unwrap();
    let store = Arc::new(FakeStore::default());
    store.fail_set.store(true, Ordering::SeqCst);
    let (mut s, notices) = open(dir.path(), &store);
    assert_eq!(notices, [Notice::SecretsNotMoved]);
    assert_eq!(notices[0].to_json(), json!({"kind": "secrets_not_moved"}));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), v1(), "byte for byte");
    assert!(store.all().is_empty());

    // The held password is for the bridge's dial: the page's dial answer has the address only, and
    // neither touches the store.
    let calls = store.calls.load(Ordering::SeqCst);
    assert_eq!(s.current_entry_id().map(|i| i.as_str()), Some(DIRECT));
    let plan = s.plan_dial(url).unwrap();
    assert_eq!(plan.clone().finish(&*s.secret_store()), Ok(Dial::Connect { url: "h:1".into() }));
    match &plan {
        DialPlan::Open(bridge) => assert_eq!(bridge.password, BridgePassword::Held(pistudiodesktop_model::Secret::new("MARK-direct"))),
        other => panic!("{other:?}"),
    }
    s.execute("daemon.switch", json!({"id": RELAY})).unwrap();
    assert_eq!(s.plan_dial(url).unwrap().finish(&*s.secret_store()), Ok(Dial::Connect { url: "pi://MARK-link".into() }));
    assert_eq!(store.calls.load(Ordering::SeqCst), calls);

    // Nothing may rewrite the file or the store meanwhile: the file would lose secrets the store lacks.
    for (id, params) in [
        ("daemon.add", json!({"kind": "direct", "name": "N", "address": "a:1", "password": "pw"})),
        ("daemon.update", json!({"id": DIRECT, "name": "z"})),
        ("daemon.remove", json!({"id": DIRECT})),
    ] {
        assert_eq!(s.execute(id, params).unwrap_err().to_string(), "secret_store_failed", "{id}");
    }
    assert_eq!(std::fs::read_to_string(&path).unwrap(), v1());
    assert_eq!(store.calls.load(Ordering::SeqCst), calls);

    // The next launch tries again, and with a store that works, moves them.
    store.fail_set.store(false, Ordering::SeqCst);
    let (_, notices) = open(dir.path(), &store);
    assert!(notices.is_empty());
    assert_eq!(store.all().len(), 3);
    assert!(!std::fs::read_to_string(&path).unwrap().contains("MARK"));
}

#[test]
fn a_store_that_is_down_is_no_notice_when_the_file_is_already_version_2() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(FakeStore::default());
    open(dir.path(), &store);
    store.fail_set.store(true, Ordering::SeqCst);
    let (_, notices) = open(dir.path(), &store);
    assert!(notices.is_empty());
}

#[test]
fn a_secret_the_store_will_not_take_for_its_size_is_a_refused_migration_too() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("daemons.json");
    let text = json!({"version": 1, "entries": [{"id": "local", "kind": "local", "name": "This machine", "password": "p".repeat(1025)}]}).to_string();
    std::fs::write(&path, &text).unwrap();
    let (_, notices) = open(dir.path(), &Arc::new(FakeStore::default()));
    assert_eq!(notices, [Notice::SecretsNotMoved]);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
}

#[test]
fn a_corrupt_registry_is_still_set_aside_and_nothing_is_stored() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("daemons.json"), b"{not json MARK").unwrap();
    let store = Arc::new(FakeStore::default());
    let (_, notices) = open(dir.path(), &store);
    assert!(matches!(notices.as_slice(), [Notice::FileReset { file, .. }] if file == "daemons.json"));
    assert!(store.all().is_empty());
}
