//! What the page can reach, through Tauri's own IPC path with the app's real permissions (the
//! ones `build.rs` and `capabilities/default.json` generate), in a mock runtime without a window
//! system.

use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use pistudiodesktop_engine::Notice;
use pistudiodesktop_secrets::{MemoryStore, SecretStore};
use pistudiodesktop_shell::owner::Quiet;
use pistudiodesktop_shell::owner_access::OwnerAccess;
use pistudiodesktop_shell::picked::Picked;
use pistudiodesktop_shell::preview::{self, Previews};
use pistudiodesktop_shell::saves::Saves;
use pistudiodesktop_shell::supervisor::{Limits, Supervisor};
use pistudiodesktop_shell::transfer_mode::TransfersMode;
use pistudiodesktop_shell::{AppInfo, Services};
use serde_json::{Value, json};
use tauri::http::{HeaderMap, HeaderValue};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager as _, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::{
    boot, daemon_resolve_current, daemon_switch, dialog_alert, dialog_confirm, engine_command, open_external, preview_mount, preview_release, save_begin,
    save_discard, save_finish, save_write, storage_set, transfer_cancel, transfer_save, transfer_upload, transfers_set, transport_open, unwrap_reply,
    upload_pick,
};
use crate::bridge::{Bridge, Launch, on_run_event, spawn_owner};
use crate::daemons::Events;
use crate::services::opener_plugin;
use crate::transfers::TransferEngine;
use crate::transport::{self, Transport};

mod relay_tests;
mod transfer_tests;
mod transport_tests;

/// A flush delay that never ends inside a test: only the exit flush can write a file.
const NEVER: Duration = Duration::from_secs(3600);

/// A command the handler registers but `build.rs` does not list.
#[tauri::command]
fn unlisted() -> &'static str {
    "reached"
}

/// The app as `main` builds it, on a mock runtime, with the owner thread on `config_dir`. The
/// window the configuration declares is created when the app runs, not here.
fn built_app(config_dir: &Path, services: Services) -> App<MockRuntime> {
    built_app_telling(
        config_dir,
        services,
        Launch { notify: Box::new(Quiet), local_supported: false, notices: Vec::new(), resume: Arc::default(), transfers: TransfersMode::Engine },
    )
}

/// The same, with the owner thread told what `launch` says.
fn built_app_telling(config_dir: &Path, services: Services, launch: Launch) -> App<MockRuntime> {
    built_app_stored(config_dir, services, launch, Arc::new(MemoryStore::new()))
}

/// The same, with the session's secret store given (a test that takes a secret away holds it).
fn built_app_stored(config_dir: &Path, mut services: Services, launch: Launch, store: Arc<dyn SecretStore>) -> App<MockRuntime> {
    let transport = Transport::new();
    // As `main` does: `ui.inspect` reads the proxied connections through the hook.
    services.transports = Some(transport.inspector());
    let (requests, inbox) = channel();
    let app = mock_builder()
        .plugin(tauri_plugin_dialog::init())
        .plugin(opener_plugin())
        .manage(Bridge::new(requests.clone(), Arc::clone(&store)))
        .manage(Arc::new(Supervisor::new(services.clone(), Limits::default())))
        .manage(crate::transfers::Transfers::default())
        .manage(Previews::default())
        .manage(transport)
        .on_window_event(|window, event| {
            transport::on_window_event(window, event);
            crate::transfers::on_destroyed(window, event);
        })
        .register_uri_scheme_protocol(preview::SCHEME, crate::preview_scheme::handle)
        .manage(Arc::new(Saves::open(config_dir, None)))
        .manage(Arc::new(Picked::default()))
        .manage(launch.transfers)
        .invoke_handler(tauri::generate_handler![
            boot,
            engine_command,
            daemon_resolve_current,
            daemon_switch,
            storage_set,
            dialog_confirm,
            dialog_alert,
            open_external,
            save_begin,
            save_write,
            save_finish,
            save_discard,
            transfers_set,
            upload_pick,
            transfer_upload,
            transfer_save,
            transfer_cancel,
            preview_mount,
            preview_release,
            transport_open,
            unlisted
        ])
        .build(tauri::generate_context!())
        .unwrap();
    // As `main` does: the engine's snapshot is what `ui.inspect` shows as `transfers`.
    let engine = TransferEngine::new(app.handle().clone(), OwnerAccess::new(requests, Arc::clone(&store)), "9.9.9").unwrap();
    services.transfers = Some(engine.inspector());
    app.manage(engine);
    app.manage(services.clone());
    spawn_owner(AppInfo { title: "Pi Studio".into(), version: "9.9.9".into() }, config_dir.to_path_buf(), services, store, inbox, NEVER, launch);
    app
}

/// The built app, with no platform hooks, and a window labelled `main`, for tests that do not run
/// the app.
fn app_on(config_dir: &Path) -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    app_with(config_dir, Services::default())
}

/// The same, with the given platform hooks.
fn app_with(config_dir: &Path, services: Services) -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = built_app(config_dir, services);
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default()).build().unwrap();
    (app, window)
}

/// Where the app's own page is served from on this platform: the origin Tauri calls "local".
const APP_ORIGIN: &str = if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" };

fn invoke(window: &WebviewWindow<MockRuntime>, cmd: &str, body: Value) -> Result<Value, Value> {
    call(window, cmd, InvokeBody::Json(body), HeaderMap::new())
}

/// A command called with a raw binary body and a `handle` header, as the page sends a chunk.
fn invoke_raw(window: &WebviewWindow<MockRuntime>, cmd: &str, handle: Option<&str>, bytes: Vec<u8>) -> Result<Value, Value> {
    let mut headers = HeaderMap::new();
    if let Some(handle) = handle {
        headers.insert("handle", HeaderValue::from_str(handle).unwrap());
    }
    call(window, cmd, InvokeBody::Raw(bytes), headers)
}

fn call(window: &WebviewWindow<MockRuntime>, cmd: &str, body: InvokeBody, headers: HeaderMap) -> Result<Value, Value> {
    let request = InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: APP_ORIGIN.parse().unwrap(),
        body,
        headers,
        invoke_key: INVOKE_KEY.to_string(),
    };
    get_ipc_response(window, request).map(|body| body.deserialize::<Value>().unwrap())
}

fn rejection(result: Result<Value, Value>) -> String {
    result.expect_err("the call should have been refused").to_string()
}

#[test]
fn the_page_can_boot_and_store_a_key_and_that_is_all() {
    let dir = tempfile::tempdir().unwrap();
    let (app, window) = app_on(dir.path());

    let first = invoke(&window, "boot", json!({})).unwrap();
    assert_eq!(first["app"], json!({"title": "Pi Studio", "version": "9.9.9", "platform": "desktop", "minDaemonVersion": "0.0.127"}));
    assert_eq!((&first["storage"], &first["notices"], &first["preview"]), (&json!({}), &json!([]), &json!(preview::kind().as_str())));
    assert_eq!(first["transfers"], "engine");
    assert_eq!(first["daemons"]["entries"].as_array().map(Vec::len), Some(1), "the local entry");
    assert_eq!(first["daemons"]["settings"], json!({"autoStartLocalDaemon": true, "cliPath": null}));
    assert_eq!(first["daemons"]["secretStore"], "memory");

    assert_eq!(invoke(&window, "storage_set", json!({"key": "pi-studio-pane-layout", "value": "{\"a\":1}"})).unwrap(), Value::Null);
    assert_eq!(invoke(&window, "storage_set", json!({"key": "pi-studio-appearance", "value": "dark"})).unwrap(), Value::Null);
    let second = invoke(&window, "boot", json!({})).unwrap();
    assert_eq!(second["storage"], json!({"pi-studio-pane-layout": "{\"a\":1}", "pi-studio-appearance": "dark"}));

    // Quitting right after a write: the exit flush leaves both on disk.
    on_run_event(app.handle(), &RunEvent::Exit);
    let layout: Value = serde_json::from_slice(&std::fs::read(dir.path().join("daemon-state/local.json")).unwrap()).unwrap();
    assert_eq!(layout["keys"], json!({"pi-studio-pane-layout": "{\"a\":1}"}));
    let settings: Value = serde_json::from_slice(&std::fs::read(dir.path().join("settings.json")).unwrap()).unwrap();
    assert_eq!(settings["workbench"], json!({"pi-studio-appearance": "dark"}));
}

#[test]
fn boot_names_the_transfers_mode_the_launch_was_given() {
    let dir = tempfile::tempdir().unwrap();
    let launch = Launch { notify: Box::new(Quiet), local_supported: false, notices: Vec::new(), resume: Arc::default(), transfers: TransfersMode::Page };
    let app = built_app_telling(dir.path(), Services::default(), launch);
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default()).build().unwrap();
    assert_eq!(invoke(&window, "boot", json!({})).unwrap()["transfers"], "page");
}

#[test]
fn what_the_choice_of_the_secret_store_tells_comes_first_in_boot_and_only_once() {
    let dir = tempfile::tempdir().unwrap();
    // A damaged registry file gives a notice of the session's own.
    std::fs::write(dir.path().join("daemons.json"), "{ not json").unwrap();
    let notices = vec![Notice::SecretStoreFallback { reason: "unavailable".into() }, Notice::FileReset { file: "secrets.json".into(), kept_as: None }];
    let app = built_app_telling(
        dir.path(),
        Services::default(),
        Launch { notify: Box::new(Quiet), local_supported: false, notices, resume: Arc::default(), transfers: TransfersMode::Engine },
    );
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default()).build().unwrap();
    let first = invoke(&window, "boot", json!({})).unwrap();
    let kinds: Vec<&str> = first["notices"].as_array().unwrap().iter().map(|n| n["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["secret_store_fallback", "file_reset", "file_reset"], "{first}");
    assert_eq!(first["notices"][0]["reason"], "unavailable");
    assert_eq!(first["notices"][1], json!({"kind": "file_reset", "file": "secrets.json", "keptAs": null}));
    assert_eq!(first["notices"][2]["file"], "daemons.json");
    assert_eq!(invoke(&window, "boot", json!({})).unwrap()["notices"], json!([]), "a reload does not show them again");
}

#[test]
fn closing_the_last_window_writes_the_unwritten_keys_before_the_app_ends() {
    let dir = tempfile::tempdir().unwrap();
    let app = built_app(dir.path(), Services::default());
    // The mock runtime emits `Exit` when its last window is gone, as the real one does. Nothing
    // else can write: the flush delay is an hour.
    app.run(|handle, event| {
        if matches!(event, RunEvent::Ready) {
            let window = handle.get_webview_window("main").unwrap();
            invoke(&window, "storage_set", json!({"key": "pi-studio-pane-layout", "value": "last-change"})).unwrap();
            window.close().unwrap();
        }
        on_run_event(handle, &event);
    });
    let layout: Value = serde_json::from_slice(&std::fs::read(dir.path().join("daemon-state/local.json")).unwrap()).unwrap();
    assert_eq!(layout["keys"], json!({"pi-studio-pane-layout": "last-change"}));
}

#[test]
fn a_command_that_build_rs_does_not_list_is_refused_before_it_runs() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, window) = app_on(dir.path());
    let refused = rejection(invoke(&window, "unlisted", json!({})));
    assert!(refused.contains("unlisted not allowed"), "{refused}");
    assert!(!refused.contains("reached"));
}

#[test]
fn plug_in_and_core_commands_are_refused_for_the_page() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, window) = app_on(dir.path());
    let refused_as = [
        ("plugin:dialog|open", "dialog.open not allowed"),
        ("plugin:dialog|message", "dialog.message not allowed"),
        ("plugin:dialog|save", "dialog.save not allowed"),
        ("plugin:opener|open_url", "opener.open_url not allowed"),
        ("plugin:opener|open_path", "opener.open_path not allowed"),
        ("plugin:opener|reveal_item_in_dir", "opener.reveal_item_in_dir not allowed"),
        ("plugin:event|emit", "event.emit not allowed"),
        ("plugin:event|emit_to", "event.emit_to not allowed"),
        ("plugin:window|close", "window.close not allowed"),
        ("plugin:webview|webview_close", "webview.webview_close not allowed"),
        ("control", "control not allowed"),
        ("invoke_command", "invoke_command not allowed"),
    ];
    for (cmd, message) in refused_as {
        let refused = rejection(invoke(&window, cmd, json!({})));
        assert!(refused.contains(message), "{cmd}: {refused}");
    }
}

#[test]
fn a_key_over_the_caps_is_refused_in_rust_and_no_file_is_written() {
    let dir = tempfile::tempdir().unwrap();
    let (app, window) = app_on(dir.path());
    let huge = "a".repeat(4 * 1024 * 1024 + 1);
    assert_eq!(invoke(&window, "storage_set", json!({"key": "pi-studio-pane-layout", "value": huge})).unwrap(), Value::Null, "the page is not told");
    assert_eq!(invoke(&window, "storage_set", json!({"key": "k".repeat(300), "value": "v"})).unwrap(), Value::Null);
    assert_eq!(invoke(&window, "boot", json!({})).unwrap()["storage"], json!({}));
    on_run_event(app.handle(), &RunEvent::Exit);
    let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(names, ["daemons.json"], "no stored-key file was written; only the registry exists");
}

#[test]
fn a_page_call_with_the_wrong_arguments_is_an_error_not_a_crash() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, window) = app_on(dir.path());
    assert!(invoke(&window, "storage_set", json!({"key": "k"})).is_err());
    assert!(invoke(&window, "storage_set", json!({"key": 1, "value": 2})).is_err());
    assert!(invoke(&window, "boot", json!({})).is_ok(), "and the app still answers");
}

/// What the platform hooks of a test were asked: the texts of confirmations and messages, and the
/// URLs to open.
#[derive(Clone, Default)]
struct Seen {
    confirmed: Arc<Mutex<Vec<String>>>,
    alerted: Arc<Mutex<Vec<String>>>,
    opened: Arc<Mutex<Vec<String>>>,
}

fn pushed(log: &Mutex<Vec<String>>, text: &str) {
    if let Ok(mut texts) = log.lock() {
        texts.push(text.to_string());
    }
}

fn taken(log: &Mutex<Vec<String>>) -> Vec<String> {
    log.lock().map(|texts| texts.clone()).unwrap_or_default()
}

/// Hooks that record what they are asked and answer every confirmation with `answer`.
fn recording(seen: &Seen, answer: bool) -> Services {
    let (confirmed, alerted, opened) = (Arc::clone(&seen.confirmed), Arc::clone(&seen.alerted), Arc::clone(&seen.opened));
    Services {
        confirm: Some(Arc::new(move |text: &str| {
            pushed(&confirmed, text);
            answer
        })),
        alert: Some(Arc::new(move |text: &str| pushed(&alerted, text))),
        open_url: Some(Arc::new(move |url: &str| {
            pushed(&opened, url);
            Ok(())
        })),
        ..Services::default()
    }
}

#[test]
fn the_page_confirms_alerts_and_opens_a_link_through_the_services() {
    let dir = tempfile::tempdir().unwrap();
    let seen = Seen::default();
    let (_app, window) = app_with(dir.path(), recording(&seen, true));
    assert_eq!(invoke(&window, "dialog_confirm", json!({"message": "Delete a.txt?"})).unwrap(), json!(true));
    assert_eq!(invoke(&window, "dialog_alert", json!({"message": "Saved."})).unwrap(), Value::Null);
    assert_eq!(invoke(&window, "open_external", json!({"url": "https://example.com/a?b#c"})).unwrap(), Value::Null);
    assert_eq!(taken(&seen.confirmed), ["Delete a.txt?"]);
    assert_eq!(taken(&seen.alerted), ["Saved."]);
    assert_eq!(taken(&seen.opened), ["https://example.com/a?b#c"], "once, unchanged");
}

#[test]
fn only_the_affirmative_button_confirms_and_without_hooks_nothing_is_confirmed_shown_or_opened() {
    let dir = tempfile::tempdir().unwrap();
    let seen = Seen::default();
    let (_declined, window) = app_with(dir.path(), recording(&seen, false));
    assert_eq!(invoke(&window, "dialog_confirm", json!({"message": "Delete a.txt?"})).unwrap(), json!(false));
    assert_eq!(taken(&seen.confirmed), ["Delete a.txt?"], "the dialog was shown; the answer was no");

    let other = tempfile::tempdir().unwrap();
    let (_bare, window) = app_on(other.path());
    assert_eq!(invoke(&window, "dialog_confirm", json!({"message": "Delete a.txt?"})).unwrap(), json!(false));
    assert_eq!(invoke(&window, "dialog_alert", json!({"message": "Saved."})).unwrap(), Value::Null);
    assert_eq!(invoke(&window, "open_external", json!({"url": "https://example.com"})).unwrap(), Value::Null);
}

#[test]
fn a_refused_link_is_ignored_and_never_reaches_the_system() {
    let dir = tempfile::tempdir().unwrap();
    let seen = Seen::default();
    let (_app, window) = app_with(dir.path(), recording(&seen, true));
    let too_long = format!("https://example.com/{}", "a".repeat(8192));
    for url in ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "tauri://localhost", " https://example.com", "", too_long.as_str()] {
        assert_eq!(invoke(&window, "open_external", json!({"url": url})).unwrap(), Value::Null, "the page is told nothing: {url}");
    }
    assert_eq!(taken(&seen.opened), Vec::<String>::new());
    assert_eq!(invoke(&window, "open_external", json!({"url": "HTTP://EXAMPLE.COM"})).unwrap(), Value::Null);
    assert_eq!(invoke(&window, "open_external", json!({"url": "mailto:a@b.c"})).unwrap(), Value::Null);
    assert_eq!(taken(&seen.opened), ["HTTP://EXAMPLE.COM", "mailto:a@b.c"]);
}

#[test]
fn a_long_dialog_text_reaches_the_dialog_cut_at_8192_characters_with_an_ellipsis() {
    let dir = tempfile::tempdir().unwrap();
    let seen = Seen::default();
    let (_app, window) = app_with(dir.path(), recording(&seen, true));
    let long = "a".repeat(10_000);
    invoke(&window, "dialog_confirm", json!({"message": long})).unwrap();
    invoke(&window, "dialog_alert", json!({"message": long})).unwrap();
    for shown in [taken(&seen.confirmed), taken(&seen.alerted)] {
        assert_eq!(shown.len(), 1);
        assert_eq!(shown[0].chars().count(), 8192);
        assert!(shown[0].ends_with('…'));
    }
}

#[test]
fn a_dialog_that_stays_open_holds_up_neither_the_session_thread_nor_the_page() {
    let dir = tempfile::tempdir().unwrap();
    let (opened, dialog_is_open) = channel();
    let (close, closed) = channel::<()>();
    let closed = Mutex::new(closed);
    let services = Services {
        confirm: Some(Arc::new(move |_: &str| {
            let _ = opened.send(());
            // The dialog stays open until the test closes it.
            let _ = closed.lock().map(|closed| closed.recv());
            true
        })),
        ..Services::default()
    };
    let (_app, window) = app_with(dir.path(), services);

    let asker = {
        let window = window.clone();
        std::thread::spawn(move || invoke(&window, "dialog_confirm", json!({"message": "Quit?"})))
    };
    dialog_is_open.recv_timeout(Duration::from_secs(10)).unwrap();

    // The dialog is open. The owner thread still answers (`boot` goes through it, and would
    // time out after 60 s if it were waiting for the dialog), and a key is still stored.
    let started = Instant::now();
    assert_eq!(invoke(&window, "storage_set", json!({"key": "pi-studio-appearance", "value": "dark"})).unwrap(), Value::Null);
    assert_eq!(invoke(&window, "boot", json!({})).unwrap()["storage"], json!({"pi-studio-appearance": "dark"}));
    assert!(started.elapsed() < Duration::from_secs(5), "took {:?}", started.elapsed());

    close.send(()).unwrap();
    assert_eq!(asker.join().unwrap().unwrap(), json!(true));
}

#[test]
fn a_dialog_or_link_call_with_the_wrong_arguments_is_an_error_and_shows_and_opens_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let seen = Seen::default();
    let (_app, window) = app_with(dir.path(), recording(&seen, true));
    for (command, body) in [
        ("dialog_confirm", json!({})),
        ("dialog_confirm", json!({"message": 5})),
        ("dialog_alert", json!({})),
        ("dialog_alert", json!({"message": ["a"]})),
        ("open_external", json!({})),
        ("open_external", json!({"url": null})),
        ("open_external", json!({"url": 7})),
    ] {
        assert!(invoke(&window, command, body.clone()).is_err(), "{command} {body}");
    }
    assert_eq!((taken(&seen.confirmed), taken(&seen.alerted), taken(&seen.opened)), (vec![], vec![], vec![]));
    assert!(invoke(&window, "boot", json!({})).is_ok(), "and the app still answers");
}

#[test]
fn the_capability_grants_the_twenty_commands_and_listening_for_events_and_nothing_else() {
    let capability: Value = serde_json::from_str(include_str!("../../capabilities/default.json")).unwrap();
    assert_eq!(capability["windows"], json!(["main"]));
    assert_eq!(
        capability["permissions"],
        json!([
            "allow-boot",
            "allow-engine-command",
            "allow-daemon-resolve-current",
            "allow-daemon-switch",
            "allow-storage-set",
            "allow-dialog-confirm",
            "allow-dialog-alert",
            "allow-open-external",
            "allow-save-begin",
            "allow-save-write",
            "allow-save-finish",
            "allow-save-discard",
            "allow-upload-pick",
            "allow-transfer-upload",
            "allow-transfer-save",
            "allow-transfer-cancel",
            "allow-transfers-set",
            "allow-preview-mount",
            "allow-preview-release",
            "allow-transport-open",
            "core:event:allow-listen",
            "core:event:allow-unlisten"
        ])
    );
}

/// Services whose save dialog answers `chosen` and records the name and folder it was shown with.
/// What the save dialog was shown with: the suggested name and the starting folder.
type DialogAsk = (String, Option<PathBuf>);

fn saving(chosen: Option<PathBuf>) -> (Services, Arc<Mutex<Vec<DialogAsk>>>) {
    let shown = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&shown);
    let services = Services {
        pick_save_path: Some(Arc::new(move |name: &str, folder: Option<&Path>| {
            log.lock().unwrap().push((name.to_string(), folder.map(Path::to_path_buf)));
            chosen.clone()
        })),
        ..Services::default()
    };
    (services, shown)
}

fn handle_of(started: Value) -> String {
    started["handle"].as_str().unwrap().to_string()
}

fn file_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    names
}

#[test]
fn the_page_saves_a_file_in_chunks_and_never_learns_the_path() {
    let (config, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let destination = out.path().join("report.txt");
    let (services, shown) = saving(Some(destination.clone()));
    let (_app, window) = app_with(config.path(), services);

    let started = invoke(&window, "save_begin", json!({"suggestedName": "../../report.txt"})).unwrap();
    assert_eq!(started.as_object().unwrap().len(), 1, "{started}");
    let handle = handle_of(started);
    assert!(!handle.contains(out.path().to_str().unwrap()));
    for chunk in [&b"one "[..], b"two ", b"three"] {
        assert_eq!(invoke_raw(&window, "save_write", Some(&handle), chunk.to_vec()).unwrap(), Value::Null);
    }
    assert!(!destination.exists(), "nothing at the destination before finish");
    assert_eq!(invoke(&window, "save_finish", json!({"handle": handle})).unwrap(), Value::Null);
    assert_eq!(std::fs::read(&destination).unwrap(), b"one two three");
    assert_eq!(file_names(out.path()), ["report.txt"]);
    assert_eq!(shown.lock().unwrap().clone(), [("report.txt".to_string(), None)], "the dialog got a bare name");
    assert!(invoke_raw(&window, "save_write", Some(&handle), vec![1]).is_err(), "a spent handle");
    assert!(invoke(&window, "save_finish", json!({"handle": handle})).is_err());
}

#[test]
fn a_discarded_save_leaves_the_old_file_and_no_temporary_file() {
    let (config, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let destination = out.path().join("a.txt");
    std::fs::write(&destination, b"old").unwrap();
    let (services, _) = saving(Some(destination.clone()));
    let (_app, window) = app_with(config.path(), services);
    let handle = handle_of(invoke(&window, "save_begin", json!({"suggestedName": "a.txt"})).unwrap());
    invoke_raw(&window, "save_write", Some(&handle), b"new".to_vec()).unwrap();
    assert_eq!(invoke(&window, "save_discard", json!({"handle": handle})).unwrap(), Value::Null);
    assert_eq!(std::fs::read(&destination).unwrap(), b"old");
    assert_eq!(file_names(out.path()), ["a.txt"]);
}

#[test]
fn a_cancelled_save_dialog_answers_null_and_writes_nothing_and_without_a_dialog_it_is_an_error() {
    let (config, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (services, shown) = saving(None);
    let (_app, window) = app_with(config.path(), services);
    assert_eq!(invoke(&window, "save_begin", json!({"suggestedName": "a.txt"})).unwrap(), Value::Null);
    assert_eq!(shown.lock().unwrap().len(), 1);
    assert_eq!(file_names(out.path()), Vec::<String>::new());

    let other = tempfile::tempdir().unwrap();
    let (_bare, window) = app_on(other.path());
    assert!(invoke(&window, "save_begin", json!({"suggestedName": "a.txt"})).is_err());
}

/// Services whose open dialog answers `chosen` and records the folder it was shown with.
fn picking(chosen: Vec<PathBuf>) -> (Services, Arc<Mutex<Vec<Option<PathBuf>>>>) {
    let shown = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&shown);
    let services = Services {
        pick_files: Some(Arc::new(move |folder: Option<&Path>| {
            log.lock().unwrap().push(folder.map(Path::to_path_buf));
            chosen.clone()
        })),
        ..Services::default()
    };
    (services, shown)
}

#[test]
fn the_page_picks_three_files_and_gets_handles_names_and_sizes_and_never_a_path() {
    let (config, files) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let paths: Vec<PathBuf> = [("a.txt", &b"abc"[..]), ("b.bin", b""), ("c.md", b"0123456789")]
        .into_iter()
        .map(|(name, bytes)| {
            let path = files.path().join(name);
            std::fs::write(&path, bytes).unwrap();
            path
        })
        .collect();
    let (services, shown) = picking(paths.clone());
    let (app, window) = app_with(config.path(), services);

    let answer = invoke(&window, "upload_pick", json!({})).unwrap();

    let entries = answer.as_array().unwrap();
    assert_eq!(entries.len(), 3, "{answer}");
    for (entry, (name, size)) in entries.iter().zip([("a.txt", 3), ("b.bin", 0), ("c.md", 10)]) {
        assert_eq!(entry["name"], name);
        assert_eq!(entry["size"], size);
        let handle = entry["handle"].as_str().unwrap();
        assert!(handle.len() == 32 && handle.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()), "{handle}");
        let mut keys: Vec<&String> = entry.as_object().unwrap().keys().collect();
        keys.sort();
        assert_eq!(keys, ["handle", "name", "size"]);
    }
    assert!(!answer.to_string().contains(files.path().to_str().unwrap()), "no answer holds a path: {answer}");
    assert_eq!(shown.lock().unwrap().clone(), [None]);

    // What a later task takes by handle: the path, once.
    let picked = app.state::<Arc<Picked>>();
    let handle = entries[1]["handle"].as_str().unwrap();
    assert_eq!(picked.take(handle), Some(paths[1].clone()));
    assert_eq!(picked.take(handle), None);
}

#[test]
fn a_file_whose_size_cannot_be_read_is_answered_without_a_size_and_a_cancelled_dialog_answers_an_empty_list() {
    let config = tempfile::tempdir().unwrap();
    let (services, _) = picking(vec![PathBuf::from("/no/such/dir/gone.txt")]);
    let (_app, window) = app_with(config.path(), services);
    let answer = invoke(&window, "upload_pick", json!({})).unwrap();
    assert_eq!(answer[0]["name"], "gone.txt");
    assert_eq!(answer[0].as_object().unwrap().len(), 2, "no size member: {answer}");

    let (cancelled, shown) = picking(Vec::new());
    let other = tempfile::tempdir().unwrap();
    let (_app, window) = app_with(other.path(), cancelled);
    assert_eq!(invoke(&window, "upload_pick", json!({})).unwrap(), json!([]));
    assert_eq!(shown.lock().unwrap().len(), 1);
}

#[test]
fn under_transfers_page_the_pick_answers_engine_off_and_no_dialog_is_shown() {
    let config = tempfile::tempdir().unwrap();
    let (services, shown) = picking(vec![PathBuf::from("/some/file.txt")]);
    let launch = Launch { notify: Box::new(Quiet), local_supported: false, notices: Vec::new(), resume: Arc::default(), transfers: TransfersMode::Page };
    let app = built_app_telling(config.path(), services, launch);
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default()).build().unwrap();

    let refused = invoke(&window, "upload_pick", json!({})).unwrap_err();

    assert_eq!(refused["code"], "engine_off", "{refused}");
    assert!(refused["message"].is_string());
    assert!(shown.lock().unwrap().is_empty(), "no dialog was shown");
}

#[test]
fn without_an_open_dialog_the_pick_is_an_error_and_boot_drops_the_picked_files() {
    let config = tempfile::tempdir().unwrap();
    let (_app, window) = app_on(config.path());
    assert_eq!(invoke(&window, "upload_pick", json!({})).unwrap_err()["code"], "unavailable");

    let other = tempfile::tempdir().unwrap();
    let (services, shown) = picking(vec![PathBuf::from("/pick/one/a.txt"), PathBuf::from("/pick/one/b.txt")]);
    let (app, window) = app_with(other.path(), services);
    let answer = invoke(&window, "upload_pick", json!({})).unwrap();
    let handles: Vec<String> = answer.as_array().unwrap().iter().map(|entry| entry["handle"].as_str().unwrap().to_string()).collect();
    invoke(&window, "boot", json!({})).unwrap();
    let picked = app.state::<Arc<Picked>>();
    assert!(handles.iter().all(|handle| picked.take(handle).is_none()), "boot dropped every entry");

    // The dialog still starts in the folder used last in this run.
    invoke(&window, "upload_pick", json!({})).unwrap();
    assert_eq!(shown.lock().unwrap().clone(), [None, Some(PathBuf::from("/pick/one"))]);
}

#[test]
fn a_chunk_over_sixteen_mebibytes_and_a_malformed_chunk_call_are_refused() {
    let (config, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (services, _) = saving(Some(out.path().join("big")));
    let (_app, window) = app_with(config.path(), services);
    let handle = handle_of(invoke(&window, "save_begin", json!({"suggestedName": "big"})).unwrap());
    let refused = rejection(invoke_raw(&window, "save_write", Some(&handle), vec![0; 16 * 1024 * 1024 + 1]));
    assert!(refused.contains("over the limit"), "{refused}");
    assert!(invoke_raw(&window, "save_write", Some(&handle), vec![0; 16 * 1024 * 1024]).is_ok(), "exactly the limit");
    assert!(invoke_raw(&window, "save_write", None, vec![1]).is_err(), "no handle header");
    assert!(invoke_raw(&window, "save_write", Some("nope"), vec![1]).is_err(), "unknown handle");
    assert!(invoke(&window, "save_write", json!({"handle": handle, "bytes": [1, 2, 3]})).is_err(), "bytes as JSON are not a raw body");
    invoke(&window, "save_finish", json!({"handle": handle})).unwrap();
    assert_eq!(std::fs::metadata(out.path().join("big")).unwrap().len(), 16 * 1024 * 1024);
    for (command, body) in
        [("save_begin", json!({})), ("save_begin", json!({"suggestedName": 1})), ("save_finish", json!({})), ("save_discard", json!({"handle": 5}))]
    {
        assert!(invoke(&window, command, body.clone()).is_err(), "{command} {body}");
    }
}

#[test]
fn the_page_reports_its_transfer_count_and_boot_resets_it() {
    let dir = tempfile::tempdir().unwrap();
    let (app, window) = app_on(dir.path());
    let transfers = app.state::<crate::transfers::Transfers>();
    assert_eq!(invoke(&window, "transfers_set", json!({"count": 2})).unwrap(), Value::Null);
    assert_eq!(transfers.get(), 2);
    assert!(invoke(&window, "transfers_set", json!({"count": -1})).is_err());
    assert!(invoke(&window, "transfers_set", json!({})).is_err());
    invoke(&window, "boot", json!({})).unwrap();
    assert_eq!(transfers.get(), 0);
}

/// The path of a preview URL, for the scheme handler.
fn path_of(url: &str) -> String {
    format!("/{}", preview::id_of(url).unwrap())
}

fn mounted_url(window: &WebviewWindow<MockRuntime>, html: &str) -> Result<String, Value> {
    invoke(window, "preview_mount", json!({"html": html})).map(|answer| answer["url"].as_str().unwrap().to_string())
}

#[test]
fn the_boot_snapshot_says_whether_previews_run_scripts_here() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, window) = app_on(dir.path());
    let snapshot = invoke(&window, "boot", json!({})).unwrap();
    let expected = if cfg!(target_os = "linux") { "origin" } else { "inert" };
    assert_eq!(snapshot["preview"], expected, "only the platforms the spike measured are `origin`");
}

#[test]
fn the_page_mounts_a_document_gets_its_url_and_releases_it() {
    let dir = tempfile::tempdir().unwrap();
    let (app, window) = app_on(dir.path());
    let previews = app.state::<Previews>();
    if preview::kind() == preview::Kind::Inert {
        let refused = rejection(invoke(&window, "preview_mount", json!({"html": "<p>hi</p>"})));
        assert!(refused.contains("not supported on this platform"), "{refused}");
        assert!(previews.is_empty());
        return;
    }
    let url = mounted_url(&window, "<script>1</script>").unwrap();
    assert!(url.starts_with("pi-preview://localhost/"), "{url}");
    assert_eq!(url.len(), "pi-preview://localhost/".len() + 32);
    let served = previews.serve("GET", &path_of(&url));
    assert_eq!((served.status, served.body.as_slice()), (200, &b"<script>1</script>"[..]), "the scheme handler's core serves it");

    assert_eq!(invoke(&window, "preview_release", json!({"url": "https://example.com/"})).unwrap(), Value::Null);
    assert_eq!(invoke(&window, "preview_release", json!({"url": "pi-preview://localhost/ffffffffffffffffffffffffffffffff"})).unwrap(), Value::Null);
    assert_eq!(previews.len(), 1, "an unknown URL is ignored");
    assert_eq!(invoke(&window, "preview_release", json!({"url": url})).unwrap(), Value::Null);
    assert_eq!(previews.serve("GET", &path_of(&url)).status, 404, "a released URL answers 404");
    assert!(previews.is_empty());
}

#[test]
fn a_url_from_before_boot_answers_404() {
    let dir = tempfile::tempdir().unwrap();
    let (app, window) = app_on(dir.path());
    if preview::kind() == preview::Kind::Inert {
        return;
    }
    let url = mounted_url(&window, "<p>hi</p>").unwrap();
    assert_eq!(app.state::<Previews>().serve("GET", &path_of(&url)).status, 200);
    invoke(&window, "boot", json!({})).unwrap();
    assert_eq!(app.state::<Previews>().serve("GET", &path_of(&url)).status, 404, "the page reloaded: its documents are gone");
    assert!(app.state::<Previews>().is_empty());
}

#[test]
fn a_mount_past_32_documents_or_32_mib_is_an_error_through_the_page_and_nothing_is_kept() {
    let dir = tempfile::tempdir().unwrap();
    let (app, window) = app_on(dir.path());
    if preview::kind() == preview::Kind::Inert {
        return;
    }
    let first = mounted_url(&window, "0").unwrap();
    for n in 1..preview::MAX_DOCUMENTS {
        mounted_url(&window, &n.to_string()).unwrap();
    }
    let refused = rejection(invoke(&window, "preview_mount", json!({"html": "one too many"})));
    assert!(refused.contains("32 previews"), "{refused}");
    assert!(!refused.contains("one too many"), "the document is not echoed");
    invoke(&window, "preview_release", json!({"url": first})).unwrap();
    assert!(mounted_url(&window, "fits again").is_ok(), "released space is reusable");
    assert_eq!(app.state::<Previews>().len(), preview::MAX_DOCUMENTS);

    invoke(&window, "boot", json!({})).unwrap();
    let refused = rejection(invoke(&window, "preview_mount", json!({"html": "a".repeat(preview::MAX_BYTES + 1)})));
    assert!(refused.contains("32 MiB"), "{refused}");
    assert!(app.state::<Previews>().is_empty());
}

#[test]
fn a_preview_call_with_the_wrong_arguments_is_an_error_not_a_crash() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, window) = app_on(dir.path());
    assert!(invoke(&window, "preview_mount", json!({})).is_err());
    assert!(invoke(&window, "preview_mount", json!({"html": 1})).is_err());
    assert!(invoke(&window, "preview_release", json!({})).is_err());
    assert!(invoke(&window, "preview_release", json!({"url": null})).is_err());
    assert!(invoke(&window, "boot", json!({})).is_ok(), "and the app still answers");
}

/// What a frame loaded from the preview origin could do. The frame is not given the page's
/// `__TAURI_INTERNALS__` (the spike saw it `undefined`), so it cannot learn the invoke key; the
/// native side drops a call without the right key before anything runs. Tauri counts a registered
/// custom scheme as a local origin for permissions, so this key is the one barrier between the
/// preview origin and the page's twelve commands: nothing in a capability names the origin.
#[test]
fn a_call_from_the_preview_origin_without_the_invoke_key_is_dropped_and_runs_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (app, window) = app_on(dir.path());
    let origin_url = preview::url_for(&"0".repeat(32));
    // Whether a call from the preview origin with this key got an answer.
    let answered = |cmd: &str, key: &str| {
        let request = InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: origin_url.parse().unwrap(),
            body: InvokeBody::Json(json!({"html": "<p>x</p>", "key": "k", "value": "v", "message": "m", "url": "https://example.com/", "suggestedName": "a"})),
            headers: HeaderMap::new(),
            invoke_key: key.to_string(),
        };
        let (sender, answers) = channel();
        window.as_ref().clone().on_message(
            request,
            Box::new(move |_window, _cmd, response, _callback, _error| {
                let _ = sender.send(response);
            }),
        );
        answers.recv_timeout(Duration::from_millis(200)).is_ok()
    };
    for key in ["", "guessed", "__invoke-key__ "] {
        for cmd in ["preview_mount", "storage_set", "dialog_confirm", "open_external", "save_begin"] {
            assert!(!answered(cmd, key), "{cmd} with key {key:?} must get no answer: it is dropped, not run");
        }
    }
    // The control: the same call with the key the page holds is answered, so the drops above are the key's doing.
    assert!(answered("preview_release", INVOKE_KEY), "the key is what separates the page from the frame");
    assert!(app.state::<Previews>().is_empty(), "nothing was mounted");
    assert_eq!(invoke(&window, "boot", json!({})).unwrap()["storage"], json!({}), "and nothing was stored");
}

#[test]
fn the_preview_origin_appears_in_no_capability() {
    let capability: Value = serde_json::from_str(include_str!("../../capabilities/default.json")).unwrap();
    assert!(capability.get("remote").is_none(), "no remote-origin grant");
    assert_eq!(capability["windows"], json!(["main"]), "the only window is the app's own");
    let dir = std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities")).unwrap();
    let files: Vec<_> = dir.map(|entry| entry.unwrap().path()).collect();
    assert_eq!(files.len(), 1, "one capability file: {files:?}");
    for file in files {
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(!text.contains("pi-preview") && !text.contains(".localhost"), "{}", file.display());
    }
}

#[test]
fn the_reply_of_the_shell_becomes_a_result() {
    assert_eq!(unwrap_reply(json!({"ok": true, "result": {"a": 1}})), Ok(json!({"a": 1})));
    assert_eq!(unwrap_reply(json!({"ok": true})), Ok(Value::Null));
    assert_eq!(unwrap_reply(json!({"ok": false, "error": "no"})), Err("no".to_string()));
    assert!(unwrap_reply(json!("odd")).is_err());
}

/// A fake emitter: the views the page would have been sent.
fn telling(sent: &Arc<Mutex<Vec<Value>>>) -> Launch {
    let sent = Arc::clone(sent);
    let (wake, _woken) = channel();
    Launch {
        notify: Box::new(Events::new(move |view| sent.lock().unwrap().push(view.clone()), wake)),
        local_supported: false,
        notices: Vec::new(),
        resume: Arc::default(),
        transfers: TransfersMode::Engine,
    }
}

#[test]
fn the_page_runs_the_listed_engine_commands_and_is_refused_the_rest() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, window) = app_on(dir.path());
    assert_eq!(invoke(&window, "engine_command", json!({"id": "settings.get"})).unwrap(), json!({"autoStartLocalDaemon": true, "cliPath": null}));
    let added = invoke(&window, "engine_command", json!({"id": "daemon.add", "params": {"kind": "direct", "name": "B", "address": "h:1"}})).unwrap();
    assert_eq!(added["name"], "B");
    let list = invoke(&window, "engine_command", json!({"id": "daemon.list"})).unwrap();
    assert_eq!(list["entries"].as_array().map(Vec::len), Some(2));
    for id in ["daemon.switch", "command.list", "test.panic", "daemon.nothing"] {
        let refused = invoke(&window, "engine_command", json!({"id": id})).unwrap_err();
        assert!(refused.as_str().is_some_and(|e| e.contains("may not run")), "{id}: {refused}");
    }
    assert_eq!(
        invoke(&window, "engine_command", json!({"id": "daemon.add", "params": {"kind": "direct", "name": "B", "address": "h:2"}})).unwrap_err(),
        json!("name_taken")
    );
    assert!(invoke(&window, "engine_command", json!({})).is_err(), "an id is required");
}

fn added_entry(window: &WebviewWindow<MockRuntime>) -> String {
    let added = invoke(window, "engine_command", json!({"id": "daemon.add", "params": {"kind": "direct", "name": "B", "address": "h:1"}})).unwrap();
    added["id"].as_str().unwrap().to_owned()
}

#[test]
fn the_page_switches_after_the_question_and_declining_changes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let seen = Seen::default();
    let (app, window) = app_with(dir.path(), recording(&seen, false));
    let b = added_entry(&window);
    invoke(&window, "storage_set", json!({"key": "pi-studio-pane-layout", "value": "on-local"})).unwrap();
    invoke(&window, "transfers_set", json!({"count": 2})).unwrap();

    assert_eq!(invoke(&window, "daemon_switch", json!({"id": b})).unwrap(), json!("cancelled"));
    assert_eq!(taken(&seen.confirmed), vec!["2 file transfers are still running. Switch anyway?".to_string()]);
    assert_eq!(app.state::<crate::transfers::Transfers>().get(), 2);
    let list = invoke(&window, "engine_command", json!({"id": "daemon.list"})).unwrap();
    assert_eq!(list["currentId"], json!("local"));

    assert_eq!(invoke(&window, "daemon_switch", json!({"id": "nope"})).unwrap_err(), json!("not_found"));
    assert_eq!(taken(&seen.confirmed).len(), 1, "an unknown id is refused before any question");
}

#[test]
fn a_confirmed_switch_records_the_entry_writes_the_old_layout_and_boots_on_the_new_one() {
    let dir = tempfile::tempdir().unwrap();
    let seen = Seen::default();
    let (_app, window) = app_with(dir.path(), recording(&seen, true));
    let b = added_entry(&window);
    invoke(&window, "storage_set", json!({"key": "pi-studio-pane-layout", "value": "on-local"})).unwrap();
    invoke(&window, "transfers_set", json!({"count": 1})).unwrap();

    assert_eq!(invoke(&window, "daemon_switch", json!({"id": b})).unwrap(), Value::Null);
    assert_eq!(taken(&seen.confirmed), vec!["1 file transfer is still running. Switch anyway?".to_string()]);
    let registry: Value = serde_json::from_str(&std::fs::read_to_string(dir.path().join("daemons.json")).unwrap()).unwrap();
    assert_eq!(registry["lastUsedId"], json!(b));
    assert!(std::fs::read_to_string(dir.path().join("daemon-state").join("local.json")).unwrap().contains("on-local"));
    let boot = invoke(&window, "boot", json!({})).unwrap();
    assert_eq!((boot["daemons"]["currentId"].clone(), boot["storage"].get("pi-studio-pane-layout").cloned()), (json!(b), None));
}

#[test]
fn one_add_is_one_event_with_the_view_and_no_secret() {
    let dir = tempfile::tempdir().unwrap();
    let sent = Arc::new(Mutex::new(Vec::new()));
    let app = built_app_telling(dir.path(), Services::default(), telling(&sent));
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default()).build().unwrap();
    invoke(&window, "boot", json!({})).unwrap();
    invoke(&window, "engine_command", json!({"id": "daemon.list"})).unwrap();
    assert!(sent.lock().unwrap().is_empty(), "reading tells nobody");
    // The control socket's way in: a request on the bridge, not a command of the page.
    let bridge = app.state::<Bridge>();
    let control = pistudiodesktop_shell::Request::Control {
        method: "engine.execute".into(),
        params: json!({"command": "daemon.add", "params": {"kind": "direct", "name": "B", "address": "h:1", "password": "hunter2"}}),
    };
    let answer = tauri::async_runtime::block_on(bridge.ask(control)).unwrap();
    assert_eq!(answer["ok"], true);
    // The owner answers first and tells afterwards, on its own thread, and takes the next request
    // only once it has told: a second request answered means the add's event has been sent.
    let read = pistudiodesktop_shell::Request::Control { method: "engine.execute".into(), params: json!({"command": "daemon.list"}) };
    assert_eq!(tauri::async_runtime::block_on(bridge.ask(read)).unwrap()["ok"], true);
    let sent = sent.lock().unwrap();
    assert_eq!(sent.len(), 1, "{sent:?}");
    assert_eq!(sent[0]["entries"].as_array().map(Vec::len), Some(2));
    assert_eq!(sent[0]["secretStore"], "memory", "the event carries the kind too: a view without it would drop the Daemons screen's line");
    assert!(!sent[0].to_string().contains("hunter2"));
}

#[test]
fn ui_inspect_and_boot_hold_the_same_view_and_neither_holds_a_secret() {
    let dir = tempfile::tempdir().unwrap();
    let (app, window) = app_on(dir.path());
    invoke(&window, "engine_command", json!({"id": "daemon.add", "params": {"kind": "direct", "name": "B", "address": "h:1", "password": "hunter2"}})).unwrap();
    invoke(&window, "engine_command", json!({"id": "daemon.add", "params": {"kind": "relay", "name": "R", "pairingLink": "#offer=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&host=secret-link"}})).unwrap();
    let booted = invoke(&window, "boot", json!({})).unwrap();
    let inspect =
        tauri::async_runtime::block_on(app.state::<Bridge>().ask(pistudiodesktop_shell::Request::Control { method: "ui.inspect".into(), params: Value::Null }))
            .unwrap();
    assert_eq!(booted["daemons"], inspect["result"]["daemons"]);
    assert_eq!(
        inspect["result"]["connection"],
        json!({"secretStore": "memory", "transports": [], "lastError": null, "resumeSignals": {"wake": 0, "network": 0}}),
        "the test harness gives the session a memory store"
    );
    for text in [booted.to_string(), inspect.to_string()] {
        assert!(!text.contains("hunter2") && !text.contains("secret-link"), "{text}");
    }
}

#[test]
fn resolving_the_current_entry_answers_the_address_and_no_password_to_the_page() {
    let dir = tempfile::tempdir().unwrap();
    let (app, window) = app_on(dir.path());
    let added = invoke(
        &window,
        "engine_command",
        json!({"id": "daemon.add", "params": {"kind": "direct", "name": "B", "address": "10.0.0.2:8080", "password": "hunter2"}}),
    )
    .unwrap();
    let switch =
        pistudiodesktop_shell::Request::Control { method: "engine.execute".into(), params: json!({"command": "daemon.switch", "params": {"id": added["id"]}}) };
    assert_eq!(tauri::async_runtime::block_on(app.state::<Bridge>().ask(switch)).unwrap()["ok"], true);
    let answer = invoke(&window, "daemon_resolve_current", json!({})).unwrap();
    assert_eq!(answer, json!({"url": "10.0.0.2:8080", "connect": true}));
    assert!(!answer.to_string().contains("hunter2"), "{answer}");
    // It takes no id: a page cannot ask for another entry's secret.
    assert_eq!(invoke(&window, "daemon_resolve_current", json!({"id": "local"})).unwrap()["url"], "10.0.0.2:8080");
}

#[test]
fn resolving_a_relay_entry_answers_the_relays_address_and_never_the_link() {
    const LINK: &str = "#offer=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8&relay=https://relay.example:8443/&relayTls=1&note=hunter2-link";
    let dir = tempfile::tempdir().unwrap();
    let (app, window) = app_on(dir.path());
    let added = invoke(&window, "engine_command", json!({"id": "daemon.add", "params": {"kind": "relay", "name": "R", "pairingLink": LINK}})).unwrap();
    let switch =
        pistudiodesktop_shell::Request::Control { method: "engine.execute".into(), params: json!({"command": "daemon.switch", "params": {"id": added["id"]}}) };
    assert_eq!(tauri::async_runtime::block_on(app.state::<Bridge>().ask(switch)).unwrap()["ok"], true);
    let answer = invoke(&window, "daemon_resolve_current", json!({})).unwrap();
    assert_eq!(answer, json!({"url": "wss://relay.example:8443", "connect": true}));
    assert!(!answer.to_string().contains("hunter2-link") && !answer.to_string().contains("AAECAwQ"), "{answer}");
}

#[test]
fn without_a_local_daemon_the_current_local_entry_cannot_be_dialled() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, window) = app_on(dir.path());
    assert_eq!(invoke(&window, "daemon_resolve_current", json!({})).unwrap_err(), json!("unsupported"));
}
