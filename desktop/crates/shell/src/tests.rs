use pistudiodesktop_engine::Session;
use serde_json::{Value, json};

use crate::{AppShell, Envelope, Request, Services, control, menus};

fn app() -> AppShell {
    AppShell::new(Session::new(), Services::default())
}

fn call(app: &mut AppShell, method: &str, params: Value) -> Value {
    control::handle(app, method, &params)
}

#[test]
fn the_view_is_the_ui_state_the_settings_and_the_generated_menu_bar() {
    let mut app = app();
    let view = control::view(&mut app);
    assert_eq!(view["ui"], json!({"status": ""}));
    assert_eq!(view["settings"], json!({"autoStartLocalDaemon": true, "cliPath": null}));
    assert_eq!(view["menus"], json!([]));
    assert_eq!(view["daemons"]["currentId"], "local");
    assert_eq!(view["daemons"]["entries"].as_array().unwrap().len(), 1);
    assert!(menus::model(&app).is_empty(), "no command has a menu path yet");
}

#[test]
fn a_failed_command_reaches_the_status_bar_and_a_success_clears_it() {
    let mut app = app();
    assert!(app.run("settings.set", json!({"key": "nope", "value": true})).is_err());
    assert!(!app.ui.status.is_empty());
    app.run("settings.get", Value::Null).unwrap();
    assert_eq!(app.ui.status, "");
}

#[test]
fn the_control_protocol_drives_and_inspects_the_app() {
    let mut app = app();
    let changed = call(&mut app, "engine.execute", json!({"command": "settings.set", "params": {"key": "autoStartLocalDaemon", "value": false}}));
    assert_eq!(changed, json!({"ok": true, "result": {"autoStartLocalDaemon": false, "cliPath": null}}));
    let seen = call(&mut app, "ui.inspect", Value::Null);
    assert_eq!(seen["result"]["settings"]["autoStartLocalDaemon"], false);
    assert_eq!(seen["result"]["menus"], json!([]));

    assert_eq!(call(&mut app, "ui.set", json!({})), json!({"ok": true, "result": null}));
    let before = app.ui.clone();
    let refused = call(&mut app, "ui.set", json!({"theme": "dark"}));
    assert_eq!(refused, json!({"ok": false, "error": "unknown field `theme`"}));
    assert_eq!(app.ui, before, "a refused ui.set changes nothing");
    assert_eq!(call(&mut app, "ui.set", json!([1]))["ok"], false);
    assert_eq!(call(&mut app, "ui.nope", Value::Null)["ok"], false);
    assert_eq!(call(&mut app, "engine.execute", json!({}))["error"], "missing `command`");
    let listed = call(&mut app, "engine.commands", Value::Null);
    let ids: Vec<&str> = listed["result"].as_array().unwrap().iter().filter_map(|c| c["id"].as_str()).collect();
    assert_eq!(ids, ["daemon.list", "daemon.switch", "daemon.add", "daemon.update", "daemon.remove", "command.list", "settings.get", "settings.set"]);
}

#[test]
fn requests_from_a_channel_are_answered_in_order() {
    let mut app = app();
    let (tx, rx) = std::sync::mpsc::channel();
    let (first, first_reply) = Envelope::new(Request::Control {
        method: "engine.execute".into(),
        params: json!({"command": "settings.set", "params": {"key": "cliPath", "value": "/x"}}),
    });
    let (second, second_reply) = Envelope::new(Request::StorageSet { key: "pi-studio-pane-layout".into(), value: "{}".into() });
    let (third, third_reply) = Envelope::new(Request::Boot);
    let (fourth, fourth_reply) = Envelope::new(Request::StorageSet { key: String::new(), value: "v".into() });
    for envelope in [first, second, third, fourth] {
        tx.send(envelope).unwrap();
    }
    drop(tx);
    for envelope in rx {
        let reply = app.answer(&envelope.request);
        envelope.reply.send(reply).unwrap();
    }
    assert_eq!(first_reply.try_recv().unwrap()["result"]["cliPath"], "/x");
    assert_eq!(second_reply.try_recv().unwrap(), json!({"ok": true, "result": null}));
    let booted = third_reply.try_recv().unwrap();
    assert_eq!(booted["result"]["storage"], json!({"pi-studio-pane-layout": "{}"}), "the page's key is in the snapshot");
    assert_eq!(booted["result"]["app"]["platform"], "desktop");
    let refused = fourth_reply.try_recv().unwrap();
    assert_eq!((refused["ok"].clone(), refused["error"].is_string()), (json!(false), true));
}
