//! What the page can reach, through Tauri's own IPC path with the app's real permissions (the
//! ones `build.rs` and `capabilities/default.json` generate), in a mock runtime without a window
//! system.

use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use pistudiodesktop_shell::saves::Saves;
use pistudiodesktop_shell::{AppInfo, Services};
use serde_json::{Value, json};
use tauri::http::{HeaderMap, HeaderValue};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager as _, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::{boot, dialog_alert, dialog_confirm, open_external, save_begin, save_discard, save_finish, save_write, storage_set, unwrap_reply};
use crate::bridge::{Bridge, on_run_event, spawn_owner};
use crate::services::opener_plugin;

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
    let (requests, inbox) = channel();
    let app = mock_builder()
        .plugin(tauri_plugin_dialog::init())
        .plugin(opener_plugin())
        .manage(Bridge::new(requests))
        .manage(services.clone())
        .manage(Arc::new(Saves::open(config_dir, None)))
        .invoke_handler(tauri::generate_handler![
            boot,
            storage_set,
            dialog_confirm,
            dialog_alert,
            open_external,
            save_begin,
            save_write,
            save_finish,
            save_discard,
            unlisted
        ])
        .build(tauri::generate_context!())
        .unwrap();
    spawn_owner(AppInfo { title: "Pi Studio".into(), version: "9.9.9".into() }, config_dir.to_path_buf(), services, inbox, NEVER);
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
    assert_eq!(first, json!({"app": {"title": "Pi Studio", "version": "9.9.9", "platform": "desktop"}, "storage": {}, "notices": []}));

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
        ("plugin:event|listen", "event.listen not allowed"),
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
        pick_save_path: None,
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
fn the_capability_grants_the_nine_commands_and_no_plug_in_or_core_permission() {
    let capability: Value = serde_json::from_str(include_str!("../../capabilities/default.json")).unwrap();
    assert_eq!(capability["windows"], json!(["main"]));
    assert_eq!(
        capability["permissions"],
        json!([
            "allow-boot",
            "allow-storage-set",
            "allow-dialog-confirm",
            "allow-dialog-alert",
            "allow-open-external",
            "allow-save-begin",
            "allow-save-write",
            "allow-save-finish",
            "allow-save-discard"
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
fn the_reply_of_the_shell_becomes_a_result() {
    assert_eq!(unwrap_reply(json!({"ok": true, "result": {"a": 1}})), Ok(json!({"a": 1})));
    assert_eq!(unwrap_reply(json!({"ok": true})), Ok(Value::Null));
    assert_eq!(unwrap_reply(json!({"ok": false, "error": "no"})), Err("no".to_string()));
    assert!(unwrap_reply(json!("odd")).is_err());
}
