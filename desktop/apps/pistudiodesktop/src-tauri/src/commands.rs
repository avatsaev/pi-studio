//! What the webview may call: ten commands, and nothing else of the app is reachable from it.
//!
//! The list is enforced by Tauri, not by this file: `build.rs` names the commands, and
//! `capabilities/default.json` grants `allow-boot`, `allow-storage-set`, `allow-dialog-confirm`,
//! `allow-dialog-alert`, `allow-open-external`, `allow-save-begin`, `allow-save-write`,
//! `allow-save-finish`, `allow-save-discard` and `allow-transfers-set` to the main window. A command missing from either
//! is refused before it runs. Keep the three in step; the tests at the end of this file check what
//! the page can reach.
// `#[tauri::command]` generates code beside each function that names `unreachable!`. This module
// holds nothing but the commands, so the allowance covers no code written by hand.
#![allow(clippy::unreachable)]

use std::sync::Arc;

use pistudiodesktop_shell::saves::{MAX_WRITE_BYTES, SaveError, Saves};
use pistudiodesktop_shell::{Request, Services, dialogs, links};
use serde_json::{Value, json};
use tauri::ipc::InvokeBody;
use tauri::{State, ipc};

use crate::bridge::Bridge;
use crate::transfers::Transfers;

/// The page's first call, made before the workbench renders: the app's identity, every stored
/// key, and the notices about files that were reset (handed out once).
#[tauri::command]
pub async fn boot(bridge: State<'_, Bridge>, transfers: State<'_, Transfers>) -> Result<Value, String> {
    // A reloaded page has no transfers running, whatever the old one last said.
    transfers.set(0);
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

/// A native confirmation: `true` only when the user pressed the affirmative button, `false` for
/// the other button and for closing the dialog. The text is cut at 8,192 characters. Answers once
/// the dialog is closed; storage writes and the control socket are not held up meanwhile.
#[tauri::command]
pub async fn dialog_confirm(services: State<'_, Services>, message: String) -> Result<bool, String> {
    blocking(&services, move |services| dialogs::confirm(services, &message)).await
}

/// A native message. Answers, with nothing, once the user has closed it. The text is cut like
/// [`dialog_confirm`]'s.
#[tauri::command]
pub async fn dialog_alert(services: State<'_, Services>, message: String) -> Result<(), String> {
    blocking(&services, move |services| dialogs::alert(services, &message)).await
}

/// Open a link in the system's default application. The URL is checked here ([`links::check`]):
/// only `http`, `https` and `mailto` leave the app. A refused URL is ignored and logged with its
/// scheme only, and so is one the system could not open: the page is told nothing either way.
#[tauri::command]
pub async fn open_external(services: State<'_, Services>, url: String) -> Result<(), String> {
    blocking(&services, move |services| {
        if let Err(why) = links::open(services, &url) {
            log::warn!("open_external: {why}");
        }
    })
    .await
}

/// Start saving a file: show the native save dialog suggesting `suggestedName` (cut down to a bare
/// file name here), and create a temporary file beside the path the user chose. Answers
/// `{ "handle": … }`, the one handle of this save, or `null` when the dialog was cancelled. The
/// page never learns the path. Answers once the dialog is closed.
#[tauri::command]
pub async fn save_begin(services: State<'_, Services>, saves: State<'_, Arc<Saves>>, suggested_name: String) -> Result<Option<Value>, String> {
    let (services, saves) = (Services::clone(&services), Arc::clone(&saves));
    let started = off_thread(move || saves.choose(&services, &suggested_name)).await?;
    started.map(|handle| handle.map(|handle| json!({ "handle": handle }))).map_err(|e| e.to_string())
}

/// Append bytes to an open save. The body is the bytes, raw (not a JSON array), at most 16 MiB; the
/// save is named by the `handle` header. Answers once the bytes are written, so the page sends the
/// next chunk only after this one.
#[tauri::command]
pub async fn save_write(saves: State<'_, Arc<Saves>>, request: ipc::Request<'_>) -> Result<(), String> {
    let handle = request.headers().get("handle").and_then(|value| value.to_str().ok()).ok_or("the `handle` header is missing")?.to_string();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("the bytes must be sent as a raw binary body".to_string());
    };
    // Checked before the copy that crosses to the writing thread.
    if bytes.len() > MAX_WRITE_BYTES {
        return Err(SaveError::TooLarge(bytes.len()).to_string());
    }
    let (saves, bytes) = (Arc::clone(&saves), bytes.clone());
    off_thread(move || saves.write(&handle, &bytes)).await?.map_err(|e| e.to_string())
}

/// End a save: the temporary file is flushed to disk and renamed over the destination. Answers
/// once that is done. The handle is spent, also when this fails.
#[tauri::command]
pub async fn save_finish(saves: State<'_, Arc<Saves>>, handle: String) -> Result<(), String> {
    let saves = Arc::clone(&saves);
    off_thread(move || saves.finish(&handle)).await?.map_err(|e| e.to_string())
}

/// Abandon a save: the temporary file is removed and the destination is as it was.
#[tauri::command]
pub async fn save_discard(saves: State<'_, Arc<Saves>>, handle: String) -> Result<(), String> {
    let saves = Arc::clone(&saves);
    off_thread(move || saves.discard(&handle)).await?.map_err(|e| e.to_string())
}

/// The page's count of file transfers (uploads and saves) that have not settled. Closing the window
/// asks first while it is above zero. A hint from the page: a wrong number only causes or skips a question.
#[tauri::command]
pub fn transfers_set(transfers: State<'_, Transfers>, count: usize) {
    transfers.set(count);
}

/// Run `work` with the services on a thread of the blocking pool. A dialog hook waits for the user,
/// so it runs neither on the main thread (where a sync command would) nor on one of the async
/// runtime's workers, and not on the thread that owns the session either.
async fn blocking<T: Send + 'static>(services: &State<'_, Services>, work: impl FnOnce(&Services) -> T + Send + 'static) -> Result<T, String> {
    let services = Services::clone(services);
    off_thread(move || work(&services)).await
}

/// Run `work` on a thread of the blocking pool: file writes and dialogs wait, and must not hold up
/// the main thread, the async runtime or the thread that owns the session.
async fn off_thread<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| format!("internal error: {e}"))
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
