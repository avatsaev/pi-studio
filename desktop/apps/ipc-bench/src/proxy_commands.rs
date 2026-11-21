//! The proxy's commands: thin wrappers over [`crate::proxy::Proxy`]. The list is in `build.rs` and the grants
//! in `capabilities/default.json`.

// `#[tauri::command]` generates code beside each function that names `unreachable!`, which the
// crate denies for code written by hand.
#![allow(clippy::unreachable)]

use tauri::{State, Webview};

use crate::bridge::err;
use crate::proxy::{Proxy, ProxyError, ProxyOpened, ProxyStats, origin_of};

/// Dials the server, opens a loopback port for this page and answers the URL to connect to. The origin the
/// upgrade must carry is the calling page's own, read from its webview (`tauri://localhost` on Linux and macOS,
/// `http://tauri.localhost` on Windows).
#[tauri::command]
pub async fn proxy_open(webview: Webview, proxy: State<'_, Proxy>, url: String) -> Result<ProxyOpened, ProxyError> {
    let page = webview.url().map_err(|e| err("no_origin", format!("the page's address is not known: {e}")))?;
    proxy.open(&url, &origin_of(&page)?).await
}

/// The counters of one proxied connection (they outlive it).
#[tauri::command]
pub async fn proxy_stats(proxy: State<'_, Proxy>, id: String) -> Result<ProxyStats, ProxyError> {
    proxy.stats(&id)
}
