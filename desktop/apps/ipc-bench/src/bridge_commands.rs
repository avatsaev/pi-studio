//! The bridge candidates' commands: thin wrappers over [`crate::bridge::Bridge`]. The list is in
//! `build.rs` and the grants in `capabilities/default.json`.

// `#[tauri::command]` generates code beside each function that names `unreachable!`, which the
// crate denies for code written by hand.
#![allow(clippy::unreachable)]

use serde::Serialize;
use tauri::State;
use tauri::ipc::{Channel, InvokeResponseBody, Request};

use crate::bridge::{Bridge, BridgeError, Inbound, Stats};

#[derive(Serialize)]
pub struct Opened {
    pub handle: String,
}

/// The header of a raw send: `handle` as text, `seq` as a decimal number.
fn header<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str, BridgeError> {
    let value = request.headers().get(name).and_then(|v| v.to_str().ok());
    value.ok_or_else(|| BridgeError { code: "bad_header", message: format!("the `{name}` header is missing") })
}

fn raw_send_args<'a>(request: &'a Request<'_>) -> Result<(&'a str, u64), BridgeError> {
    let handle = header(request, "handle")?;
    let seq = header(request, "seq")?.parse::<u64>().map_err(|_| BridgeError { code: "bad_header", message: "the `seq` header is not a number".into() })?;
    Ok((handle, seq))
}

/// Dials the benchmark's server (`url`), `inbound` being `frame` or `batch`; what the server sends
/// arrives on `on_message`.
#[tauri::command]
pub async fn bridge_open(bridge: State<'_, Bridge>, url: String, inbound: String, on_message: Channel<InvokeResponseBody>) -> Result<Opened, BridgeError> {
    let handle = bridge.open(&url, Inbound::parse(&inbound)?, on_message).await?;
    Ok(Opened { handle })
}

#[tauri::command]
pub async fn bridge_send_text(bridge: State<'_, Bridge>, handle: String, seq: u64, data: String) -> Result<(), BridgeError> {
    bridge.send_text(&handle, seq, data).await
}

/// A raw body, with the headers `handle` and `seq`.
#[tauri::command]
pub async fn bridge_send_binary(bridge: State<'_, Bridge>, request: Request<'_>) -> Result<(), BridgeError> {
    let (handle, seq) = raw_send_args(&request)?;
    bridge.send_binary(handle, seq, request.body()).await
}

/// A raw body in the codec's format, with the headers `handle` and `seq`: several frames, one send.
#[tauri::command]
pub async fn bridge_send_batch(bridge: State<'_, Bridge>, request: Request<'_>) -> Result<(), BridgeError> {
    let (handle, seq) = raw_send_args(&request)?;
    bridge.send_batch(handle, seq, request.body()).await
}

#[tauri::command]
pub async fn bridge_ack(bridge: State<'_, Bridge>, handle: String, bytes: u64) -> Result<(), BridgeError> {
    bridge.ack(&handle, bytes)
}

/// Closes the connection; answers its final counters (nothing for an unknown handle).
#[tauri::command]
pub async fn bridge_close(bridge: State<'_, Bridge>, handle: String, code: Option<u16>, reason: Option<String>) -> Result<Option<Stats>, BridgeError> {
    Ok(bridge.close(&handle, code, reason))
}

#[tauri::command]
pub async fn bridge_stats(bridge: State<'_, Bridge>, handle: String) -> Result<Stats, BridgeError> {
    bridge.stats(&handle)
}
