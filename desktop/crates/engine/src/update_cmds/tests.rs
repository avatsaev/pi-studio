use serde_json::{Value, json};

use crate::{EngineError, Session, UPDATE_UNAVAILABLE, UpdateAction, UpdateGate};

const IDS: [&str; 3] = ["update.check", "update.install", "update.restart"];

fn row(s: &mut Session, id: &str) -> Value {
    let rows = s.execute("command.list", json!({"filter": id})).unwrap();
    rows.as_array().unwrap().iter().find(|r| r["id"] == id).cloned().unwrap()
}

fn gate(check: Option<&str>, install: Option<&str>, restart: Option<&str>) -> UpdateGate {
    let own = |r: Option<&str>| r.map(str::to_owned);
    UpdateGate { check: own(check), install: own(install), restart: own(restart) }
}

#[test]
fn the_three_commands_are_listed_with_their_labels_and_no_params() {
    let mut s = Session::new();
    let rows = s.execute("command.list", json!({"filter": "update."})).unwrap();
    let rows: Vec<(&str, &str, Value)> =
        rows.as_array().unwrap().iter().map(|r| (r["id"].as_str().unwrap(), r["label"].as_str().unwrap(), r["menu"].clone())).collect();
    assert_eq!(
        rows,
        [
            ("update.check", "Check for Updates…", json!(["Help"])),
            ("update.install", "Install Update", json!([])),
            ("update.restart", "Restart to Update", json!([]))
        ]
    );
    assert!(rows.iter().all(|(id, ..)| crate::find(id).is_some_and(|c| c.params == "{}" && c.shortcut.is_none())));
}

#[test]
fn a_session_with_no_updater_refuses_all_three_and_says_why() {
    let mut s = Session::new();
    for id in IDS {
        let r = row(&mut s, id);
        assert_eq!((r["enabled"].as_bool(), r["reason"].as_str()), (Some(false), Some(UPDATE_UNAVAILABLE)), "{id}");
        let error = s.execute(id, Value::Null).unwrap_err();
        assert_eq!(error, EngineError::Disabled { id: id.into(), reason: UPDATE_UNAVAILABLE.into() });
    }
    assert!(!s.has_update_requests());
}

#[test]
fn each_command_is_enabled_by_its_own_gate_entry() {
    let mut s = Session::new();
    s.set_update_gate(gate(None, Some("there is no update to install"), Some("no update is waiting for a restart")));
    let seen: Vec<(Option<bool>, Option<String>)> =
        IDS.iter().map(|id| row(&mut s, id)).map(|r| (r["enabled"].as_bool(), r["reason"].as_str().map(str::to_owned))).collect();
    assert_eq!(
        seen,
        [(Some(true), None), (Some(false), Some("there is no update to install".into())), (Some(false), Some("no update is waiting for a restart".into())),]
    );
    s.set_update_gate(gate(Some("an update is downloading"), None, None));
    assert_eq!(row(&mut s, "update.check")["reason"], "an update is downloading");
    assert_eq!(row(&mut s, "update.install")["enabled"], true);
    assert_eq!(row(&mut s, "update.restart")["enabled"], true);
}

#[test]
fn an_allowed_command_only_queues_the_work_and_answers_accepted() {
    let mut s = Session::new();
    s.set_update_gate(gate(None, None, None));
    assert_eq!(s.execute("update.check", json!({})).unwrap(), json!({"accepted": true}));
    assert!(s.has_update_requests());
    assert_eq!(s.take_update_requests(), [UpdateAction::Check]);
    assert!(!s.has_update_requests());
    assert!(s.take_update_requests().is_empty());
    assert_eq!(s.execute("update.install", Value::Null).unwrap(), json!({"accepted": true}));
    assert_eq!(s.take_update_requests(), [UpdateAction::Install]);
    assert_eq!(s.execute("update.restart", json!({})).unwrap(), json!({"accepted": true}));
    assert_eq!(s.take_update_requests(), [UpdateAction::Restart]);
}

#[test]
fn a_refused_command_queues_nothing_and_returns_the_reason() {
    let mut s = Session::new();
    s.set_update_gate(gate(None, Some("there is no update to install"), Some("no update is waiting for a restart")));
    let error = s.execute("update.install", json!({})).unwrap_err().to_string();
    assert_eq!(error, "`update.install` is unavailable: there is no update to install");
    assert_eq!(s.execute("update.restart", json!({})).unwrap_err().to_string(), "`update.restart` is unavailable: no update is waiting for a restart");
    assert!(!s.has_update_requests());
}

#[test]
fn an_accepted_action_blocks_the_others_until_the_app_takes_it() {
    let mut s = Session::new();
    s.set_update_gate(gate(None, None, None));
    s.execute("update.check", json!({})).unwrap();
    for id in IDS {
        assert_eq!(row(&mut s, id)["enabled"], false, "{id}");
        assert!(s.execute(id, json!({})).unwrap_err().to_string().contains("already starting"), "{id}");
    }
    assert_eq!(s.take_update_requests(), [UpdateAction::Check], "the second click queued nothing");
    assert_eq!(row(&mut s, "update.check")["enabled"], true);
}

#[test]
fn params_are_ignored_and_a_non_object_is_refused_before_anything_runs() {
    let mut s = Session::new();
    s.set_update_gate(gate(None, None, None));
    assert!(s.execute("update.check", json!({"url": "https://example.test/x", "path": "/tmp"})).is_ok());
    s.take_update_requests();
    assert!(matches!(s.execute("update.check", json!([1])), Err(EngineError::BadParams(_))));
    assert!(!s.has_update_requests());
}
