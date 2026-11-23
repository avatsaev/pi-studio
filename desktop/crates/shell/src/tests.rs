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
    assert_eq!(view["settings"], json!({"autoStartLocalDaemon": true, "checkForUpdates": true, "cliPath": null}));
    assert_eq!(view["menus"][0]["label"], "Daemons");
    assert_eq!(view["menus"].as_array().unwrap().len(), 1);
    assert_eq!(view["daemons"]["currentId"], "local");
    assert_eq!(view["daemons"]["entries"].as_array().unwrap().len(), 1);
    assert_eq!(menus::model(&mut app).len(), 1, "only the daemons menu: no command has a menu path yet");
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
    assert_eq!(changed, json!({"ok": true, "result": {"autoStartLocalDaemon": false, "checkForUpdates": true, "cliPath": null}}));
    let seen = call(&mut app, "ui.inspect", Value::Null);
    assert_eq!(seen["result"]["settings"]["autoStartLocalDaemon"], false);
    assert_eq!(seen["result"]["menus"][0]["label"], "Daemons");
    assert_eq!(
        seen["result"]["connection"],
        json!({"secretStore": "memory", "transports": [], "ssh": {"state": "none", "hops": 0, "channels": 0}, "lastError": null, "resumeSignals": {"wake": 0, "network": 0}}),
        "ui.inspect names the kind of secret store, no connection, no SSH session and no error without a hook, and the resume signal counts"
    );
    assert!(app.resume.signal(crate::resume::Reason::Wake, 1_000));
    assert!(!app.resume.signal(crate::resume::Reason::Network, 2_000), "inside the shared 5 s");
    assert_eq!(call(&mut app, "ui.inspect", Value::Null)["result"]["connection"]["resumeSignals"], json!({"wake": 1, "network": 0}));
    let count = |seen: &Value| {
        seen["result"]["menus"][0]["items"].as_array().unwrap().iter().filter(|i| i["id"].as_str().unwrap().starts_with("daemon.entry:")).count()
    };
    assert_eq!(count(&seen), 1);
    call(&mut app, "engine.execute", json!({"command": "daemon.add", "params": {"kind": "direct", "name": "B", "address": "h:1"}}));
    assert_eq!(count(&call(&mut app, "ui.inspect", Value::Null)), 2, "the menu model follows the registry");

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
    assert_eq!(
        ids,
        [
            "daemon.list",
            "daemon.switch",
            "daemon.add",
            "daemon.update",
            "daemon.remove",
            "daemon.local.start",
            "daemon.local.stop",
            "daemon.local.restart",
            "daemon.local.refresh",
            "daemon.remote.start",
            "daemon.remote.refresh",
            "command.list",
            "settings.get",
            "settings.set",
        ]
    );
}

#[test]
fn the_hooks_connections_and_last_error_are_in_the_view_and_nothing_else_of_them() {
    use crate::transports::{ConnectionError, Snapshot, SshState, SshView, TransportState, TransportView, Via};
    let snapshot = Snapshot {
        transports: vec![TransportView {
            entry_id: "e1".into(),
            via: Via::Relay,
            state: TransportState::Open,
            frames_in: 3,
            frames_out: 2,
            bytes_in: 30,
            bytes_out: 20,
            peak_held_in: 7,
            peak_held_out: 5,
        }],
        ssh: SshView { state: SshState::Open, hops: 1, channels: 2 },
        last_error: Some(ConnectionError { code: "page_refused", at_ms: 42 }),
    };
    let services = Services { transports: Some(std::sync::Arc::new(move || snapshot.clone())), ..Services::default() };
    let mut app = AppShell::new(Session::new(), services);
    let seen = call(&mut app, "ui.inspect", Value::Null);
    assert_eq!(
        seen["result"]["connection"]["transports"],
        json!([{"entryId": "e1", "via": "relay", "state": "open", "framesIn": 3, "framesOut": 2, "bytesIn": 30, "bytesOut": 20, "peakHeldIn": 7, "peakHeldOut": 5}])
    );
    assert_eq!(seen["result"]["connection"]["ssh"], json!({"state": "open", "hops": 1, "channels": 2}));
    assert_eq!(seen["result"]["connection"]["lastError"], json!({"code": "page_refused", "atMs": 42}));
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

#[test]
fn transfers_without_a_hook_is_the_launch_mode_and_zeros() {
    let mut app = app();
    app.transfers = crate::transfer_mode::TransfersMode::Page;
    let seen = call(&mut app, "ui.inspect", Value::Null);
    assert_eq!(
        seen["result"]["transfers"],
        json!({
            "mode": "page",
            "connection": {"state": "closed", "entryId": null, "opens": 0},
            "active": [],
            "queued": 0,
            "totals": {"done": 0, "failed": 0, "cancelled": 0},
            "peakHeld": 0,
            "lastError": null
        })
    );
}

#[test]
fn transfers_with_a_hook_show_what_it_answers_and_not_what_it_holds() {
    use crate::transfers_view::{ActiveState, ActiveView, BulkState, BulkView, Snapshot, Totals, TransferKind};
    let held = "/home/marker/secret-file.bin".to_owned();
    let snapshot = Snapshot {
        connection: BulkView { state: BulkState::Open, entry_id: Some("e1".into()), opens: 1 },
        active: vec![ActiveView {
            id: "t1".into(),
            kind: TransferKind::Upload,
            state: ActiveState::Running,
            bytes_done: 10,
            bytes_total: Some(20),
            restarts: 0,
        }],
        queued: 2,
        totals: Totals { done: 1, failed: 0, cancelled: 0 },
        peak_held: 4096,
        last_error: None,
    };
    let services = Services {
        transfers: Some(std::sync::Arc::new(move || {
            let _held = &held;
            snapshot.clone()
        })),
        ..Services::default()
    };
    let mut app = AppShell::new(Session::new(), services);
    let seen = call(&mut app, "ui.inspect", Value::Null);
    assert_eq!(seen["result"]["transfers"]["mode"], "engine");
    assert_eq!(seen["result"]["transfers"]["connection"], json!({"state": "open", "entryId": "e1", "opens": 1}));
    assert_eq!(seen["result"]["transfers"]["peakHeld"], 4096);
    assert_eq!(seen["result"]["transfers"]["active"][0]["bytesTotal"], 20);
    assert!(!seen.to_string().contains("marker"), "{seen}");
}
