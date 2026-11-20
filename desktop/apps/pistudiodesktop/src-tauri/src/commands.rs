//! What the webview may call: two commands, and nothing else of the app is reachable from it.
//!
//! The list is enforced by Tauri, not by this file: `build.rs` names the commands, and
//! `capabilities/default.json` grants `allow-boot` and `allow-storage-set` to the main window.
//! A command missing from either is refused before it runs. Keep the three in step; the tests
//! at the end of this file check what the page can reach.
// `#[tauri::command]` generates code beside each function that names `unreachable!`. This module
// holds nothing but the two commands, so the allowance covers no code written by hand.
#![allow(clippy::unreachable)]

use pistudiodesktop_shell::Request;
use serde_json::Value;
use tauri::State;

use crate::bridge::Bridge;

/// The page's first call, made before the workbench renders: the app's identity, every stored
/// key, and the notices about files that were reset (handed out once).
#[tauri::command]
pub async fn boot(bridge: State<'_, Bridge>) -> Result<Value, String> {
    unwrap_reply(bridge.ask(Request::Boot).await?)
}

/// One workbench key. Answers once the write is queued, not once it is on disk: the owner thread
/// checks the caps, keeps the value in memory and writes the file within a second. A refused
/// write is logged there and the page is not told (the workbench's `set` never throws).
///
/// Not `async`: Tauri runs this on the thread that receives the page's calls, in the order the
/// page made them, and queueing never blocks. An async command could be scheduled out of order,
/// and then the older of two writes of one key could win.
#[tauri::command]
pub fn storage_set(bridge: State<'_, Bridge>, key: String, value: String) -> Result<(), String> {
    bridge.post(Request::StorageSet { key, value })
}

/// A shell reply, `{"ok": true, "result": …}` or `{"ok": false, "error": "…"}`, as a `Result`.
fn unwrap_reply(mut reply: Value) -> Result<Value, String> {
    if reply["ok"] == true {
        Ok(reply.get_mut("result").map(Value::take).unwrap_or(Value::Null))
    } else {
        Err(reply["error"].as_str().unwrap_or("internal error: no reason given").to_string())
    }
}

#[cfg(test)]
mod tests;
