//! What the page can reach, through Tauri's own IPC path with the app's real permissions (the
//! ones `build.rs` and `capabilities/default.json` generate), in a mock runtime without a window
//! system.

use std::path::Path;
use std::sync::mpsc::channel;
use std::time::Duration;

use pistudiodesktop_shell::AppInfo;
use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::InvokeRequest;
use tauri::{App, Manager as _, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::{boot, storage_set, unwrap_reply};
use crate::bridge::{Bridge, on_run_event, spawn_owner};

/// A flush delay that never ends inside a test: only the exit flush can write a file.
const NEVER: Duration = Duration::from_secs(3600);

/// A command the handler registers but `build.rs` does not list.
#[tauri::command]
fn unlisted() -> &'static str {
    "reached"
}

/// The app as `main` builds it, on a mock runtime, with the owner thread on `config_dir`. The
/// window the configuration declares is created when the app runs, not here.
fn built_app(config_dir: &Path) -> App<MockRuntime> {
    let (requests, inbox) = channel();
    let app = mock_builder()
        .plugin(tauri_plugin_dialog::init())
        .manage(Bridge::new(requests))
        .invoke_handler(tauri::generate_handler![boot, storage_set, unlisted])
        .build(tauri::generate_context!())
        .unwrap();
    spawn_owner(AppInfo { title: "Pi Studio".into(), version: "9.9.9".into() }, config_dir.to_path_buf(), inbox, NEVER);
    app
}

/// The built app and a window labelled `main`, for tests that do not run the app.
fn app_on(config_dir: &Path) -> (App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = built_app(config_dir);
    let window = WebviewWindowBuilder::new(&app, "main", WebviewUrl::default()).build().unwrap();
    (app, window)
}

/// Where the app's own page is served from on this platform: the origin Tauri calls "local".
const APP_ORIGIN: &str = if cfg!(windows) { "http://tauri.localhost" } else { "tauri://localhost" };

fn invoke(window: &WebviewWindow<MockRuntime>, cmd: &str, body: Value) -> Result<Value, Value> {
    let request = InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: APP_ORIGIN.parse().unwrap(),
        body: InvokeBody::Json(body),
        headers: Default::default(),
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
    let app = built_app(dir.path());
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
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0, "the configuration directory was not touched");
}

#[test]
fn a_page_call_with_the_wrong_arguments_is_an_error_not_a_crash() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, window) = app_on(dir.path());
    assert!(invoke(&window, "storage_set", json!({"key": "k"})).is_err());
    assert!(invoke(&window, "storage_set", json!({"key": 1, "value": 2})).is_err());
    assert!(invoke(&window, "boot", json!({})).is_ok(), "and the app still answers");
}

#[test]
fn the_reply_of_the_shell_becomes_a_result() {
    assert_eq!(unwrap_reply(json!({"ok": true, "result": {"a": 1}})), Ok(json!({"a": 1})));
    assert_eq!(unwrap_reply(json!({"ok": true})), Ok(Value::Null));
    assert_eq!(unwrap_reply(json!({"ok": false, "error": "no"})), Err("no".to_string()));
    assert!(unwrap_reply(json!("odd")).is_err());
}
