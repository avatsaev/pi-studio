use std::sync::Arc;

use pistudiodesktop_model::{EntryId, Kind, RemoteState};
use serde_json::{Value, json};

use super::{RemoteAction, RemoteRequest};
use crate::test_store::FakeStore;
use crate::{BridgePassword, Dial, DialPlan, Session};

fn open(dir: &std::path::Path) -> (Session, Arc<FakeStore>) {
    let store = Arc::new(FakeStore::default());
    let (session, notices) = Session::with_config_dir(dir, store.clone());
    assert!(notices.is_empty());
    (session, store)
}

fn url(host: &str, port: u16) -> String {
    format!("ws://{host}:{port}")
}

fn add_ssh(s: &mut Session, name: &str) -> Value {
    s.execute(
        "daemon.add",
        json!({"kind": "ssh", "name": name, "host": "box.example", "user": "me", "port": 2222, "identityFile": "~/.ssh/id", "jump": "j.example",
               "password": "PW-daemon", "sshPassword": "PW-ssh", "passphrase": "PW-phrase"}),
    )
    .unwrap()
}

fn code(s: &mut Session, id: &str) -> String {
    s.execute(id, json!({})).unwrap_err().to_string()
}

fn item(id: &str, kind: &str) -> String {
    format!("{id}/{kind}")
}

/// A session whose current entry is the new SSH entry `id`.
fn on_ssh(dir: &std::path::Path) -> (Session, Arc<FakeStore>, String) {
    let (mut s, store) = open(dir);
    let id = add_ssh(&mut s, "S")["id"].as_str().unwrap().to_owned();
    s.switch_entry(&id).unwrap();
    (s, store, id)
}

#[test]
fn adding_an_ssh_entry_stores_its_three_secrets_and_returns_none() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, store) = open(dir.path());
    let view = add_ssh(&mut s, "S");
    let id = view["id"].as_str().unwrap();
    assert_eq!(view["kind"], "ssh");
    assert_eq!(view["hasPassword"], true);
    assert_eq!(
        view["ssh"],
        json!({"host": "box.example", "user": "me", "port": 2222, "identityFile": "~/.ssh/id", "jump": "j.example", "daemonPort": 6767,
               "hasSshPassword": true, "hasPassphrase": true})
    );
    assert!(!view.to_string().contains("PW-"));
    let mut want = vec![item(id, "password"), item(id, "sshPassword"), item(id, "sshPassphrase")];
    want.sort();
    assert_eq!(store.all(), want);
    assert_eq!(store.value(&item(id, "sshPassword")).as_deref(), Some("PW-ssh"));
}

#[test]
fn an_ssh_entry_needs_only_a_host_and_takes_the_default_daemon_port() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, store) = open(dir.path());
    let view = s.execute("daemon.add", json!({"kind": "ssh", "name": "S", "host": "h"})).unwrap();
    assert_eq!(view["ssh"], json!({"host": "h", "daemonPort": 6767, "hasSshPassword": false, "hasPassphrase": false}));
    assert!(store.all().is_empty());
    assert_eq!(s.execute("daemon.add", json!({"kind": "ssh", "name": "T"})).unwrap_err().to_string(), "bad params: `host` is required");
}

#[test]
fn a_bad_ssh_field_or_secret_stores_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, store) = open(dir.path());
    let add = |s: &mut Session, extra: Value| {
        let mut p = json!({"kind": "ssh", "name": "S", "host": "h", "sshPassword": "x"});
        p.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        s.execute("daemon.add", p).unwrap_err().to_string()
    };
    assert_eq!(add(&mut s, json!({"host": ""})), "invalid_host");
    assert_eq!(add(&mut s, json!({"port": 0})), "invalid_port");
    assert_eq!(add(&mut s, json!({"port": 70000})), "invalid_port");
    assert_eq!(add(&mut s, json!({"daemonPort": 0})), "invalid_port");
    assert_eq!(add(&mut s, json!({"jump": "a,"})), "invalid_jump");
    assert_eq!(add(&mut s, json!({"passphrase": ""})), "invalid_password");
    store.fail_all();
    assert_eq!(add(&mut s, json!({})), "secret_store_failed");
    assert_eq!(s.registry().entries.len(), 1);
}

#[test]
fn updating_an_ssh_entry_changes_fields_sets_and_clears_secrets() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, store) = open(dir.path());
    let id = add_ssh(&mut s, "S")["id"].as_str().unwrap().to_owned();
    let view = s
        .execute(
            "daemon.update",
            json!({"id": id, "host": "new.example", "user": null, "port": null, "jump": null, "daemonPort": 7000,
                   "sshPassword": "PW-ssh2", "passphrase": null, "password": null}),
        )
        .unwrap();
    assert_eq!(view["ssh"], json!({"host": "new.example", "identityFile": "~/.ssh/id", "daemonPort": 7000, "hasSshPassword": true, "hasPassphrase": false}));
    assert_eq!(view["hasPassword"], false);
    assert_eq!(store.all(), vec![item(&id, "sshPassword")]);
    assert_eq!(store.value(&item(&id, "sshPassword")).as_deref(), Some("PW-ssh2"));
    assert_eq!(s.execute("daemon.update", json!({"id": id, "port": 99999})).unwrap_err().to_string(), "invalid_port");
}

#[test]
fn an_update_names_only_what_the_kind_has() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, store) = open(dir.path());
    let direct = s.execute("daemon.add", json!({"kind": "direct", "name": "D", "address": "h:1"})).unwrap()["id"].as_str().unwrap().to_owned();
    let ssh = add_ssh(&mut s, "S")["id"].as_str().unwrap().to_owned();
    for p in [json!({"host": "x"}), json!({"sshPassword": "x"}), json!({"passphrase": "x"}), json!({"daemonPort": 1}), json!({"jump": "x"})] {
        let mut p = p;
        p["id"] = json!(direct);
        assert_eq!(s.execute("daemon.update", p).unwrap_err().to_string(), "wrong_kind");
    }
    for p in [json!({"address": "x"}), json!({"pairingLink": "x"})] {
        let mut p = p;
        p["id"] = json!(ssh);
        assert_eq!(s.execute("daemon.update", p).unwrap_err().to_string(), "wrong_kind");
    }
    assert!(!store.has(&item(&direct, "sshPassword")));
}

#[test]
fn removing_an_ssh_entry_removes_its_three_secrets() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, store) = open(dir.path());
    let id = add_ssh(&mut s, "S")["id"].as_str().unwrap().to_owned();
    assert_eq!(store.all().len(), 3);
    assert_eq!(s.execute("daemon.remove", json!({"id": id})).unwrap(), json!({"removed": true}));
    assert!(store.all().is_empty());
}

#[test]
fn the_plan_of_an_ssh_entry_is_its_loopback_daemon_and_says_which_secrets_exist() {
    let dir = tempfile::tempdir().unwrap();
    let (s, store, id) = on_ssh(dir.path());
    let DialPlan::Open(plan) = s.plan_dial(url).unwrap() else { panic!("an SSH entry plans an open") };
    assert_eq!((plan.kind, plan.url.as_str(), &plan.password), (Kind::Ssh, "ws://127.0.0.1:6767", &BridgePassword::Stored));
    assert_eq!(s.plan_bridge(url).unwrap(), plan);
    assert_eq!(DialPlan::Open(plan.clone()).finish(&*store).unwrap(), Dial::Connect { url: "ws://127.0.0.1:6767".into() });
    assert_eq!(plan.read_password(&*store).unwrap().unwrap().expose(), "PW-daemon");
    let ssh = s.plan_ssh().unwrap();
    assert_eq!((ssh.entry.as_str(), ssh.url.as_str(), ssh.has_ssh_password, ssh.has_passphrase), (id.as_str(), "ws://127.0.0.1:6767", true, true));
    assert_eq!(
        (ssh.fields.host.as_str(), ssh.fields.user.as_deref(), ssh.fields.port, ssh.fields.jump.as_deref()),
        ("box.example", Some("me"), Some(2222), Some("j.example"))
    );
    let secrets = ssh.read_secrets(&*store).unwrap();
    assert_eq!((secrets.ssh_password.unwrap().expose(), secrets.passphrase.unwrap().expose()), ("PW-ssh", "PW-phrase"));
    store.take(&item(&id, "sshPassphrase"));
    assert_eq!(ssh.read_secrets(&*store).unwrap_err(), "secret_missing");
}

#[test]
fn an_ssh_entry_without_a_daemon_password_plans_none_and_other_kinds_have_no_ssh_plan() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, _) = open(dir.path());
    let id = s.execute("daemon.add", json!({"kind": "ssh", "name": "S", "host": "h", "daemonPort": 7001})).unwrap()["id"].as_str().unwrap().to_owned();
    assert_eq!(s.plan_ssh(), Err("wrong_kind"), "the local entry is current");
    s.switch_entry(&id).unwrap();
    assert_eq!(s.plan_bridge(url).unwrap().password, BridgePassword::None);
    assert_eq!(s.plan_bridge(url).unwrap().url, "ws://127.0.0.1:7001");
    assert!(s.plan_ssh().unwrap().url.ends_with(":7001"));
}

#[test]
fn remote_commands_refuse_an_entry_that_is_not_ssh() {
    let mut s = Session::new();
    for id in ["daemon.remote.start", "daemon.remote.refresh"] {
        assert_eq!(code(&mut s, id), "wrong_kind", "{id}");
    }
    assert!(!s.has_remote_requests());
    assert_eq!(s.remote_state(), &RemoteState::Unknown);
}

#[test]
fn start_queues_one_request_for_the_current_entry() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, _, id) = on_ssh(dir.path());
    let _ = s.take_registry_changed();
    assert_eq!(s.execute("daemon.remote.start", json!({})).unwrap(), json!({"accepted": true}));
    assert_eq!(s.remote_state(), &RemoteState::Starting);
    assert!(s.has_remote_requests() && s.take_registry_changed());
    let entry = EntryId::parse(&id).unwrap();
    assert_eq!(s.take_remote_requests(), vec![RemoteRequest { entry, action: RemoteAction::Start }]);
    assert!(s.take_remote_requests().is_empty() && !s.has_remote_requests());
    assert_eq!(s.execute("daemon.list", json!({})).unwrap()["remote"], json!({"state": "starting"}));
}

#[test]
fn refresh_merges_and_anything_else_is_busy_until_the_outcome() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, _, id) = on_ssh(dir.path());
    s.execute("daemon.remote.refresh", json!({})).unwrap();
    s.execute("daemon.remote.refresh", json!({})).unwrap();
    assert_eq!(s.remote_state(), &RemoteState::Checking);
    assert_eq!(s.take_remote_requests().len(), 1);
    assert_eq!(code(&mut s, "daemon.remote.start"), "busy");
    let entry = EntryId::parse(&id).unwrap();
    assert!(s.apply_remote_outcome(&entry, RemoteState::Stopped));
    assert_eq!(s.execute("daemon.list", json!({})).unwrap()["remote"], json!({"state": "stopped"}));
    s.execute("daemon.remote.start", json!({})).unwrap();
    assert_eq!(code(&mut s, "daemon.remote.refresh"), "busy");
    assert_eq!(code(&mut s, "daemon.remote.start"), "busy");
    assert_eq!(s.take_remote_requests().len(), 1);
}

#[test]
fn a_missing_or_old_cli_refuses_start_but_not_a_refresh() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, _, id) = on_ssh(dir.path());
    let entry = EntryId::parse(&id).unwrap();
    for (state, expected) in [(RemoteState::NotInstalled, "not_installed"), (RemoteState::CliOutdated { version: "0.0.1".into() }, "cli_outdated")] {
        assert!(s.apply_remote_outcome(&entry, state.clone()));
        assert_eq!(code(&mut s, "daemon.remote.start"), expected);
        assert!(s.take_remote_requests().is_empty());
        assert_eq!(s.remote_state(), &state);
        s.execute("daemon.remote.refresh", json!({})).unwrap();
        assert_eq!(s.take_remote_requests().len(), 1);
    }
}

#[test]
fn opening_another_entry_resets_the_remote_state_and_queue() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, _, id) = on_ssh(dir.path());
    let entry = EntryId::parse(&id).unwrap();
    s.execute("daemon.remote.start", json!({})).unwrap();
    s.switch_entry("local").unwrap();
    assert_eq!(s.remote_state(), &RemoteState::Unknown);
    assert!(!s.has_remote_requests());
    // The outcome of the request that was running for the entry left is dropped.
    assert!(!s.apply_remote_outcome(&entry, RemoteState::Running));
    assert_eq!(s.remote_state(), &RemoteState::Unknown);
    s.switch_entry(&id).unwrap();
    assert!(s.execute("daemon.remote.start", json!({})).is_ok(), "not busy after the reset");
}

#[test]
fn editing_or_removing_the_current_ssh_entry_marks_its_session_to_be_closed() {
    let dir = tempfile::tempdir().unwrap();
    let (mut s, _, id) = on_ssh(dir.path());
    assert_eq!(s.take_ssh_closed(), None);
    s.execute("daemon.update", json!({"id": id, "host": "other"})).unwrap();
    assert_eq!(s.take_ssh_closed().as_ref().map(EntryId::as_str), Some(id.as_str()));
    assert_eq!(s.take_ssh_closed(), None);
    s.execute("daemon.remove", json!({"id": id})).unwrap();
    assert_eq!(s.take_ssh_closed().as_ref().map(EntryId::as_str), Some(id.as_str()));
    // An entry that is not current keeps no session here.
    let other = add_ssh(&mut s, "T")["id"].as_str().unwrap().to_owned();
    s.execute("daemon.update", json!({"id": other, "host": "other"})).unwrap();
    assert_eq!(s.take_ssh_closed(), None);
}
