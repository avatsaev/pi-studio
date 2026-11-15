//! What the webview may call: two commands, and nothing else of the app is reachable from it.
// `#[tauri::command]` generates code beside each function that names `unreachable!`. This module
// holds nothing but the two commands, so the allowance covers no code written by hand.
#![allow(clippy::unreachable)]

use pistudiodesktop_shell::Request;
use serde_json::Value;
use tauri::State;

use crate::bridge::Bridge;

/// A control-protocol call: the same four methods automation uses.
#[tauri::command]
pub async fn control(bridge: State<'_, Bridge>, method: String, params: Option<Value>) -> Result<Value, String> {
    bridge.ask(Request::Control { method, params: params.unwrap_or(Value::Null) }).await
}

/// A menu click or a shortcut.
#[tauri::command]
pub async fn invoke_command(bridge: State<'_, Bridge>, command: String) -> Result<Value, String> {
    bridge.ask(Request::Invoke { command }).await
}
