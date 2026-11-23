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
    assert_eq!(view["menus"].as_array().unwrap().len(), 2);
    assert_eq!(view["menus"][1]["label"], "Help");
    assert_eq!(view["daemons"]["currentId"], "local");
    assert_eq!(view["daemons"]["entries"].as_array().unwrap().len(), 1);
    assert_eq!(menus::model(&mut app).len(), 2, "the daemons menu and Help, which holds `update.check`");
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
            "update.check",
            "update.install",
            "update.restart",
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

mod updates {
    use std::sync::{Arc, Mutex};

    use pistudiodesktop_engine::Session;
    use serde_json::{Value, json};

    use crate::update::{CheckOutcome, InstallKind, Manifest, Offer, Origin, Progress, Reason, UpdateCode, UpdaterHook};
    use crate::{AppShell, Services, control, daemons, menus, page};

    const NOW: u64 = 1_800_000_000_000;
    const RELEASE: &str = "https://github.com/avatsaev/pi-studio/releases/tag/desktop-v9.9.9";
    const COMMANDS: [&str; 3] = ["update.check", "update.install", "update.restart"];

    /// A scripted updater: what a check finds and how a download ends.
    struct Fake {
        kind: InstallKind,
        check: Mutex<Result<CheckOutcome, UpdateCode>>,
        download: Mutex<Result<(), UpdateCode>>,
    }

    impl UpdaterHook for Fake {
        fn check(&self, _: &Manifest) -> Result<CheckOutcome, UpdateCode> {
            self.check.lock().unwrap().clone()
        }
        fn install_kind(&self) -> InstallKind {
            self.kind
        }
        fn cannot_install(&self, _: InstallKind, _: &str) -> Option<Reason> {
            None
        }
        fn download(&self, _: Progress<'_>) -> Result<(), UpdateCode> {
            *self.download.lock().unwrap()
        }
        fn install(&self) -> Result<(), UpdateCode> {
            Ok(())
        }
        fn restart(&self) {}
    }

    fn offer() -> Result<CheckOutcome, UpdateCode> {
        Ok(CheckOutcome::Found(Offer { version: "9.9.9".into(), release_url: RELEASE.into() }))
    }

    fn app_with(kind: InstallKind, check: Result<CheckOutcome, UpdateCode>, download: Result<(), UpdateCode>) -> AppShell {
        let hook = Fake { kind, check: Mutex::new(check), download: Mutex::new(download) };
        let mut app = AppShell::new(Session::new(), Services { updater: Some(Arc::new(hook)), ..Services::default() });
        app.info = page::AppInfo { title: "Pi Studio".into(), version: "1.2.3".into() };
        app
    }

    fn checked(app: &AppShell) {
        let ticket = app.update.begin_check(Origin::Manual, NOW).unwrap();
        let _ = app.update.run_check(ticket);
    }

    fn installed(app: &AppShell) {
        let ticket = app.update.begin_install().unwrap();
        let _ = app.update.run_install(ticket);
    }

    /// The app with its update in the state `name`.
    fn in_state(name: &str) -> AppShell {
        match name {
            "idle" => app_with(InstallKind::App, offer(), Ok(())),
            "checking" => {
                let app = app_with(InstallKind::App, offer(), Ok(()));
                app.update.begin_check(Origin::Manual, NOW).unwrap();
                app
            }
            "up_to_date" => {
                let app = app_with(InstallKind::App, Ok(CheckOutcome::UpToDate), Ok(()));
                checked(&app);
                app
            }
            "available" => {
                let app = app_with(InstallKind::App, offer(), Ok(()));
                checked(&app);
                app
            }
            "cannot_install" => {
                let app = app_with(InstallKind::Unknown, offer(), Ok(()));
                checked(&app);
                app
            }
            "downloading" => {
                let app = in_state("available");
                app.update.begin_install().unwrap();
                app
            }
            "restart_needed" => {
                let app = in_state("available");
                installed(&app);
                app
            }
            "failed" => {
                let app = app_with(InstallKind::App, Err(UpdateCode::Offline), Ok(()));
                checked(&app);
                app
            }
            "failed_install" => {
                let app = app_with(InstallKind::App, offer(), Err(UpdateCode::Download));
                checked(&app);
                installed(&app);
                app
            }
            other => panic!("no state {other}"),
        }
    }

    fn row(app: &mut AppShell, id: &str) -> Value {
        let rows = app.run("command.list", json!({"filter": id})).unwrap();
        rows.as_array().unwrap().iter().find(|r| r["id"] == id).cloned().unwrap()
    }

    fn enabled(app: &mut AppShell) -> [bool; 3] {
        COMMANDS.map(|id| row(app, id)["enabled"].as_bool().unwrap())
    }

    #[test]
    fn what_each_state_allows_is_what_command_list_and_the_menu_say() {
        // (state, the state's name in the JSON, check, install, restart)
        let table = [
            ("idle", "idle", [true, false, false]),
            ("checking", "checking", [false, false, false]),
            ("up_to_date", "up_to_date", [true, false, false]),
            ("available", "available", [true, true, false]),
            ("cannot_install", "cannot_install", [true, false, false]),
            ("downloading", "downloading", [false, false, false]),
            ("restart_needed", "restart_needed", [false, false, true]),
            ("failed", "failed", [true, false, false]),
            ("failed_install", "failed", [true, true, false]),
        ];
        for (name, state, allowed) in table {
            let mut app = in_state(name);
            assert_eq!(app.update.state_json()["state"], state, "{name}");
            assert_eq!(enabled(&mut app), allowed, "{name}");
            let help = menus::model(&mut app).into_iter().find(|m| m.label == "Help").unwrap();
            let item = help.items.iter().find(|i| i.id == menus::UPDATE_CHECK_ID).unwrap();
            assert_eq!((item.enabled, item.reason.is_some()), (allowed[0], !allowed[0]), "{name}: the menu item follows the command");
            for (id, allowed) in COMMANDS.iter().zip(allowed) {
                let outcome = app.run(id, Value::Null);
                assert_eq!(outcome.is_ok(), allowed, "{name} {id}: {outcome:?}");
                app.session.take_update_requests();
            }
        }
    }

    #[test]
    fn a_refusal_says_why_in_the_words_of_the_state() {
        let mut app = in_state("idle");
        assert_eq!(row(&mut app, "update.check")["reason"], Value::Null);
        assert_eq!(row(&mut app, "update.install")["reason"], "there is no update to install");
        assert_eq!(row(&mut app, "update.restart")["reason"], "no update is waiting for a restart");
        assert_eq!(app.run("update.install", Value::Null).unwrap_err(), "`update.install` is unavailable: there is no update to install");

        let mut app = in_state("checking");
        assert_eq!(row(&mut app, "update.check")["reason"], "an update check is already running");
        assert_eq!(row(&mut app, "update.install")["reason"], "an update check is already running");

        let mut app = in_state("downloading");
        for id in COMMANDS.iter().take(2) {
            assert_eq!(row(&mut app, id)["reason"], "an update is downloading", "{id}");
        }

        let mut app = in_state("restart_needed");
        assert_eq!(row(&mut app, "update.check")["reason"], "the update is installed: restart the app to finish it");
        assert_eq!(row(&mut app, "update.install")["reason"], "the update is installed: restart the app to finish it");
    }

    #[test]
    fn an_app_with_no_updater_refuses_all_three_and_the_commands_are_still_listed() {
        let mut app = super::app();
        let rows = app.run("command.list", json!({"filter": "update."})).unwrap();
        assert_eq!(rows.as_array().unwrap().len(), 3);
        for id in COMMANDS {
            let r = row(&mut app, id);
            assert_eq!((r["enabled"].as_bool(), r["reason"].as_str()), (Some(false), Some("updates are not available in this app")), "{id}");
        }
        assert_eq!(app.update.state_json(), json!({"state": "idle"}));
        assert_eq!(
            crate::update::Refusal::Unavailable.to_string(),
            pistudiodesktop_engine::UPDATE_UNAVAILABLE,
            "the engine's default and the shell's refusal say the same"
        );
    }

    #[test]
    fn help_holds_check_for_updates_and_macos_moves_it_to_the_application_menu() {
        let mut app = in_state("idle");
        let bar = menus::model(&mut app);
        let labels: Vec<&str> = bar.iter().map(|m| m.label.as_str()).collect();
        assert_eq!(labels, ["Daemons", "Help"]);
        let help = &bar[1];
        assert_eq!(help.items.len(), 1);
        let item = &help.items[0];
        assert_eq!((item.id.as_str(), item.label.as_str(), item.enabled, item.shortcut.is_none()), ("update.check", "Check for Updates…", true, true));
        assert_eq!(menus::UPDATE_CHECK_ID, "update.check");
        assert_eq!(menus::in_application_menu("update.check"), cfg!(target_os = "macos"));
        assert!(!menus::in_application_menu("update.install"));
        assert!(!menus::in_application_menu("daemons.manage"));
    }

    #[test]
    fn the_page_may_run_the_three_commands() {
        for id in COMMANDS {
            assert!(daemons::page_may_run(id), "{id}");
        }
        let mut app = in_state("idle");
        assert_eq!(daemons::page_command(&mut app, "update.check", Value::Null).unwrap(), json!({"accepted": true}));
        assert!(app.session.has_update_requests());
    }

    #[test]
    fn boot_carries_the_state() {
        let mut app = in_state("idle");
        assert_eq!(page::boot(&mut app)["update"], json!({"state": "idle"}));
        let mut app = in_state("available");
        assert_eq!(page::boot(&mut app)["update"], json!({"state": "available", "version": "9.9.9", "releaseUrl": RELEASE}));
        let mut app = in_state("downloading");
        assert_eq!(page::boot(&mut app)["update"], json!({"state": "downloading", "version": "9.9.9", "received": 0}));
        let mut app = in_state("cannot_install");
        assert_eq!(
            page::boot(&mut app)["update"],
            json!({"state": "cannot_install", "version": "9.9.9", "releaseUrl": RELEASE, "reason": "development_build"})
        );
        let mut app = in_state("restart_needed");
        assert_eq!(page::boot(&mut app)["update"], json!({"state": "restart_needed", "version": "9.9.9"}));
        let mut app = in_state("failed_install");
        assert_eq!(page::boot(&mut app)["update"], json!({"state": "failed", "code": "download", "version": "9.9.9", "releaseUrl": RELEASE}));
        let mut app = in_state("failed");
        assert_eq!(page::boot(&mut app)["update"], json!({"state": "failed", "code": "offline"}));
        let mut app = in_state("up_to_date");
        assert_eq!(page::boot(&mut app)["update"], json!({"state": "up_to_date", "checkedAt": NOW}));
        let mut app = super::app();
        assert_eq!(page::boot(&mut app)["update"], json!({"state": "idle"}), "an app with no updater boots `idle`");
    }

    #[test]
    fn inspect_carries_the_state_the_version_the_kind_the_setting_and_the_manifest() {
        let mut app = in_state("idle");
        let seen = control::view(&mut app);
        assert_eq!(seen["update"], json!({"state": "idle", "current": "1.2.3", "kind": "app", "checksEnabled": true, "manifest": "default"}));

        let mut app = in_state("available");
        app.run("settings.set", json!({"key": "checkForUpdates", "value": false})).unwrap();
        let seen = control::view(&mut app);
        assert_eq!(
            seen["update"],
            json!({"state": "available", "version": "9.9.9", "releaseUrl": RELEASE, "current": "1.2.3", "kind": "app", "checksEnabled": false, "manifest": "default", "lastCheckAt": NOW})
        );

        let mut app = in_state("failed");
        let seen = control::handle(&mut app, "ui.inspect", &Value::Null);
        assert_eq!(seen["result"]["update"]["lastError"], "offline");
        assert_eq!(seen["result"]["update"]["code"], "offline");

        let mut app = in_state("cannot_install");
        assert_eq!(control::view(&mut app)["update"]["kind"], "unknown");

        let mut app = super::app();
        let seen = control::view(&mut app);
        assert_eq!(seen["update"]["kind"], "unknown", "no updater: no install kind");
        assert_eq!(seen["update"]["state"], "idle");
    }

    #[test]
    fn neither_part_holds_a_key_a_path_or_an_address_but_the_release_page() {
        for name in ["available", "failed_install", "cannot_install", "restart_needed"] {
            let mut app = in_state(name);
            let text = format!("{}{}", page::boot(&mut app)["update"], control::view(&mut app)["update"]);
            assert!(text.contains(RELEASE) || name == "restart_needed", "{name}: the release page is the one address that is shown: {text}");
            let without_release = text.replace(RELEASE, "");
            assert!(!without_release.contains("://") && !without_release.contains('/'), "{name}: {without_release}");
        }
    }
}
