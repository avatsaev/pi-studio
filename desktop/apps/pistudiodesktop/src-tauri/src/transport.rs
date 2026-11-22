//! The page's way to its daemon: the work behind `transport_open`.
//!
//! The page asks for a connection to the current entry's daemon; Rust dials it (TLS, the password
//! as the bearer subprotocol) and answers a single-use loopback address the page connects its own
//! `WebSocket` to ([`pistudiodesktop_net::proxy`]). Rust then holds the daemon's socket and passes
//! messages between the two legs on Tauri's async runtime: frames never cross the owner thread or
//! Tauri's IPC. The owner thread is asked once, for the current entry (kind, address, where the
//! password is); the password is read from the secret store on the blocking pool.
//!
//! Nothing here logs or returns a password, a token or the page's URL: errors carry a code and a
//! message written for a person, and `localUrl` is only in the command's answer.

use std::sync::mpsc::channel;
use std::time::Duration;

use pistudiodesktop_model::address_matches;
use pistudiodesktop_net::{DIAL_LIMIT, DialError, Proxies, ProxyError, check_address, dial};
use pistudiodesktop_shell::owner_access::OwnerAccess;
use serde::Serialize;
use tauri::{AppHandle, Manager as _, RunEvent, Runtime, Url, Window, WindowEvent};

/// The longest a blocking close waits for the daemons' answers to their 1001. A daemon that does
/// not answer costs the proxy's own close wait, so this only bounds a stuck runtime.
const CLOSE_ALL_WAIT: Duration = Duration::from_secs(5);

/// A refused `transport_open`: `code` is one the page branches on, `message` is for a person.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Failure {
    pub code: &'static str,
    pub message: String,
}

impl Failure {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

impl From<DialError> for Failure {
    fn from(e: DialError) -> Self {
        Self::new(e.code.as_str(), e.message)
    }
}

impl From<ProxyError> for Failure {
    fn from(e: ProxyError) -> Self {
        Self::new(e.code.as_str(), e.message)
    }
}

/// The answer of `transport_open`. It has no `Debug`: the address is a credential.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub local_url: String,
}

/// The proxied connections of the app. Managed by Tauri.
pub struct Transport {
    proxies: Proxies,
}

impl Default for Transport {
    fn default() -> Self {
        Self::new()
    }
}

impl Transport {
    pub fn new() -> Self {
        // The proxy's lines are fixed texts: never a peer's words, a token or an address.
        Self { proxies: Proxies::new(|line| log::debug!("transport: {line}")) }
    }

    /// Open a proxied connection to the current entry's daemon for the page whose origin is
    /// `origin`, and answer the address the page connects to. `url` is what the page derived from
    /// the entry's stored address. Must run on Tauri's async runtime (the proxy spawns its tasks).
    pub async fn open(&self, access: &OwnerAccess, origin: &str, url: &str) -> Result<String, Failure> {
        let plan = blocking({
            let access = access.clone();
            move || access.bridge_plan()
        })
        .await?
        .map_err(plan_failure)?;
        // The page is trusted with the entry it opens and no other: the address is the entry's,
        // not the page's choice.
        if !address_matches(url, &plan.url) {
            return Err(Failure::new("address_mismatch", "The page asked for an address that is not the current daemon's."));
        }
        // Before a place is taken or a secret read: only `ws:` and `wss:`, no user information.
        check_address(url)?;
        // The place is taken before the dial, so that a fifth connection never dials.
        let reservation = self.proxies.reserve(plan.entry.as_str())?;
        let password = blocking({
            let access = access.clone();
            move || access.bridge_password(&plan)
        })
        .await?
        .map_err(secret_failure)?;
        let socket = dial(url, password.as_ref().map(pistudiodesktop_model::Secret::expose), DIAL_LIMIT).await?;
        Ok(reservation.open(socket, origin).await?.expose().to_owned())
    }

    /// Close every proxied connection: each daemon is told 1001, each page leg is dropped.
    pub async fn close_all(&self) {
        self.proxies.close_all().await;
    }

    /// [`Self::close_all`] for a thread that is not a worker of the async runtime (a blocking-pool
    /// or plain thread), for at most [`CLOSE_ALL_WAIT`].
    pub fn close_all_blocking(&self) {
        let (done, finished) = channel();
        let proxies = self.proxies.clone();
        tauri::async_runtime::spawn(async move {
            proxies.close_all().await;
            let _ = done.send(());
        });
        if finished.recv_timeout(CLOSE_ALL_WAIT).is_err() {
            log::warn!("the proxied connections were not all closed within {} s", CLOSE_ALL_WAIT.as_secs());
        }
    }
}

/// Run `work` on the blocking pool: the owner thread's answer and a keychain read both wait.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, Failure> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| Failure::new("internal", format!("The app failed inside: {e}.")))
}

/// What a refusal of the owner thread's plan says. The codes of the local daemon are those of
/// `daemon_resolve_current`; `local_not_ready` is a local daemon that is being started or has to be.
fn plan_failure(code: &'static str) -> Failure {
    let message = match code {
        "not_bridged" => "This daemon is reached through the relay, not through the app's own connection.".to_owned(),
        "no_current" => "No daemon is selected.".to_owned(),
        "local_not_ready" => "The local daemon is not running yet. Wait for it to start, or start it in Daemons.".to_owned(),
        "local_stopped" => "The local daemon is stopped. Start it in Daemons.".to_owned(),
        "unsupported" => "This system cannot run a local daemon.".to_owned(),
        other => format!("The current daemon cannot be opened ({other})."),
    };
    Failure::new(code, message)
}

fn secret_failure(code: &'static str) -> Failure {
    match code {
        "secret_missing" => Failure::new(code, "The password for this daemon is not in the secret store. Enter it again in Daemons."),
        _ => Failure::new(code, "The secret store could not be read: it may be locked, or access was refused. Try again."),
    }
}

/// The origin a page of `url` sends: scheme, host and port, as the webview writes it
/// (`tauri://localhost` on Linux and macOS, `http://tauri.localhost` on Windows).
pub fn origin_of(url: &Url) -> Result<String, Failure> {
    let host =
        url.host_str().ok_or_else(|| Failure::new("proxy_failed", "The page's address has no host, so the app cannot tell which origin may connect."))?;
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    Ok(format!("{}://{host}{port}", url.scheme()))
}

/// The window is gone: no proxied connection outlives it. The runtime may end before the close
/// completes, so [`on_run_event`] closes again, waiting, on the way out.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if matches!(event, WindowEvent::Destroyed)
        && let Some(transport) = window.try_state::<Transport>()
    {
        let proxies = transport.proxies.clone();
        tauri::async_runtime::spawn(async move { proxies.close_all().await });
    }
}

/// On the way out, every daemon is told 1001 before the process ends.
pub fn on_run_event<R: Runtime>(handle: &AppHandle<R>, event: &RunEvent) {
    if matches!(event, RunEvent::Exit)
        && let Some(transport) = handle.try_state::<Transport>()
    {
        transport.close_all_blocking();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_origin_is_what_the_webview_sends() {
        for (page, origin) in [
            ("tauri://localhost/", "tauri://localhost"),
            ("tauri://localhost/index.html", "tauri://localhost"),
            ("http://tauri.localhost/", "http://tauri.localhost"),
            ("http://localhost:1420/", "http://localhost:1420"),
        ] {
            assert_eq!(origin_of(&page.parse().unwrap()).unwrap(), origin, "{page}");
        }
        assert_eq!(origin_of(&"data:text/plain,x".parse().unwrap()).unwrap_err().code, "proxy_failed");
    }
}
