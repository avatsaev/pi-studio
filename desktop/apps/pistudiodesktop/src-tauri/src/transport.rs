//! The page's way to its daemon: the work behind `transport_open`.
//!
//! The page asks for a connection to the current entry's daemon; Rust opens it and answers a
//! single-use loopback address the page connects its own `WebSocket` to
//! ([`pistudiodesktop_net::proxy`]). A local or direct entry is dialled (TLS, the password as the
//! bearer subprotocol); a relay entry is opened through the relay's protocol 2
//! ([`pistudiodesktop_relay`]) with the daemon's key from its pairing link, or, for a link with a
//! host hint, dialled as a direct daemon with no password; an SSH entry is a channel of the entry's
//! shared SSH session ([`crate::ssh_session`]) to the daemon's port on the host, with the daemon's
//! own password. Rust then holds the daemon's socket and
//! passes messages between the two legs on Tauri's async runtime: frames never cross the owner
//! thread or Tauri's IPC. The owner thread is asked once, for the current entry (kind, address,
//! where the secret is; for an SSH entry once more, for its fields); the secret (a password, or a
//! relay entry's pairing link) is read from the secret store on the blocking pool. [`Route`] is
//! that opening, shared with the transfer engine.
//!
//! Nothing here logs or returns a password, a pairing link, a token or the page's URL: errors carry
//! a code and a message written for a person, and `localUrl` is only in the command's answer.

use std::collections::{HashMap, HashSet};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use pistudiodesktop_engine::{BridgePlan, SshPlan, relay_address};
use pistudiodesktop_model::pairing::{self, DAEMON_KEY_BYTES, Target};
use pistudiodesktop_model::{Kind, Secret, address_matches, normalize_daemon_url};
use pistudiodesktop_net::limits::MAX_MESSAGE_BYTES;
use pistudiodesktop_net::{DIAL_LIMIT, DaemonSocket, DialError, Proxies, ProxyError, Snapshot as ProxySnapshot, State, check_address, dial};
use pistudiodesktop_relay::{CONNECT_LIMIT, RelayError};
use pistudiodesktop_shell::owner_access::OwnerAccess;
use pistudiodesktop_shell::services::TransportsHook;
use pistudiodesktop_shell::transports::{ConnectionError, Snapshot, SshView, TransportState, TransportView, Via};
use serde::Serialize;
use tauri::{AppHandle, Manager as _, RunEvent, Runtime, Url, Window, WindowEvent};

use crate::ssh_session::SshSessions;

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
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
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

impl From<RelayError> for Failure {
    /// The SDK's relay reasons are the codes (`wrong_key`, `daemon_offline`, …), with the SDK's texts.
    fn from(e: RelayError) -> Self {
        Self::new(e.reason.as_str(), e.message)
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
    /// The last `transport_open` that failed, for `ui.inspect`'s `lastError` (the proxy keeps the
    /// last abnormal end of a connection that existed). Only a code and a time.
    last_failure: Arc<Mutex<Option<ConnectionError>>>,
    /// How the connections of each entry go (`ui.inspect`'s `via`): the entry's kind fixes it.
    vias: Arc<Mutex<HashMap<String, Via>>>,
}

impl Default for Transport {
    fn default() -> Self {
        Self::new()
    }
}

impl Transport {
    pub fn new() -> Self {
        // The proxy's lines are fixed texts: never a peer's words, a token or an address.
        Self { proxies: Proxies::new(|line| log::debug!("transport: {line}")), last_failure: Arc::default(), vias: Arc::default() }
    }

    /// What `ui.inspect` reads (`Services::transports`): the live connections, the SSH session of
    /// `ssh` and whichever is newer of the last refused open and the last abnormal end. It reads
    /// counters and takes a few short locks; it waits on nothing.
    pub fn inspector(&self, ssh: &SshSessions) -> TransportsHook {
        let (proxies, last_failure, vias, ssh) = (self.proxies.clone(), Arc::clone(&self.last_failure), Arc::clone(&self.vias), ssh.clone());
        Arc::new(move || {
            let failure = *last_failure.lock().unwrap_or_else(PoisonError::into_inner);
            let vias = vias.lock().unwrap_or_else(PoisonError::into_inner);
            inspect(&proxies.snapshot(), &vias, ssh.view(), failure)
        })
    }

    /// Open a proxied connection to the current entry's daemon for the page whose origin is
    /// `origin`, and answer the address the page connects to. `url` is what the page derived from
    /// the entry's stored address. Must run on Tauri's async runtime (the proxy spawns its tasks).
    /// A refusal is remembered as the last error.
    pub async fn open(&self, access: &OwnerAccess, ssh: &SshSessions, origin: &str, url: &str) -> Result<String, Failure> {
        let opened = self.try_open(access, ssh, origin, url).await;
        if let Err(failure) = &opened {
            *self.last_failure.lock().unwrap_or_else(PoisonError::into_inner) = Some(ConnectionError { code: failure.code, at_ms: now_ms() });
        }
        opened
    }

    async fn try_open(&self, access: &OwnerAccess, ssh: &SshSessions, origin: &str, url: &str) -> Result<String, Failure> {
        let plan = current_plan(access).await?;
        let entry = plan.entry.clone();
        let route = Route::resolve(access, ssh, plan).await?;
        // The page is trusted with the entry it opens and no other: the address is the entry's,
        // not the page's choice.
        if !address_matches(url, route.address()) {
            return Err(Failure::new("address_mismatch", "The page asked for an address that is not the current daemon's."));
        }
        // Before a place is taken or a password read: only `ws:` and `wss:`, no user information.
        check_address(url)?;
        // Recorded before the place is taken, so that a connection is never listed without its way.
        self.record_via(entry.as_str(), route.via());
        // The place is taken before the dial, so that a fifth connection never dials.
        let reservation = self.proxies.reserve(entry.as_str())?;
        let socket = route.connect(access, MAX_MESSAGE_BYTES).await?;
        Ok(reservation.open(socket, origin).await?.expose().to_owned())
    }

    /// Remember how the connections of `entry` go, and forget the entries that have no connection.
    fn record_via(&self, entry: &str, via: Via) {
        let live: HashSet<String> = self.proxies.snapshot().connections.into_iter().map(|c| c.id).collect();
        let mut vias = self.vias.lock().unwrap_or_else(PoisonError::into_inner);
        vias.retain(|id, _| live.contains(id));
        vias.insert(entry.to_owned(), via);
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

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| u64::try_from(since.as_millis()).unwrap_or(u64::MAX))
}

/// The proxy's snapshot as the shell's view: the connections, each with the way recorded for its
/// entry (`vias`; a connection nobody recorded is a direct one), the SSH session as `ssh`, and as
/// `lastError` whichever is newer of the proxy's last abnormal end and `refused`, the last
/// `transport_open` that failed. Nothing but ids, ways, states, counters and a code crosses: the
/// proxy's snapshot holds no address or token.
fn inspect(proxies: &ProxySnapshot, vias: &HashMap<String, Via>, ssh: SshView, refused: Option<ConnectionError>) -> Snapshot {
    let transports = proxies
        .connections
        .iter()
        .map(|c| TransportView {
            entry_id: c.id.clone(),
            via: vias.get(&c.id).copied().unwrap_or(Via::Direct),
            state: match c.state {
                State::Connecting => TransportState::Connecting,
                State::Open => TransportState::Open,
                State::Closing => TransportState::Closing,
            },
            frames_in: c.frames_in,
            frames_out: c.frames_out,
            bytes_in: c.bytes_in,
            bytes_out: c.bytes_out,
            peak_held_in: c.peak_held_in,
            peak_held_out: c.peak_held_out,
        })
        .collect();
    let ended = proxies.last_error.map(|e| ConnectionError { code: e.code.as_str(), at_ms: e.at_ms });
    let last_error = match (ended, refused) {
        (Some(ended), refused) => Some(ended.or_newer(refused)),
        (None, refused) => refused,
    };
    Snapshot { transports, ssh, last_error }
}

/// Run `work` on the blocking pool: the owner thread's answer and a keychain read both wait.
pub(crate) async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, Failure> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| Failure::new("internal", format!("The app failed inside: {e}.")))
}

/// What the owner thread says about opening the current entry: which entry, of what kind, and where
/// its secret is. Nothing is read from the secret store.
pub(crate) async fn current_plan(access: &OwnerAccess) -> Result<BridgePlan, Failure> {
    blocking({
        let access = access.clone();
        move || access.bridge_plan()
    })
    .await?
    .map_err(plan_failure)
}

/// What a refusal of the owner thread's plan says. The codes of the local daemon are those of
/// `daemon_resolve_current`; `local_not_ready` is a local daemon that is being started or has to be.
fn plan_failure(code: &'static str) -> Failure {
    let message = match code {
        "no_current" => "No daemon is selected.".to_owned(),
        "local_not_ready" => "The local daemon is not running yet. Wait for it to start, or start it in Daemons.".to_owned(),
        "local_stopped" => "The local daemon is stopped. Start it in Daemons.".to_owned(),
        "unsupported" => "This system cannot run a local daemon.".to_owned(),
        "invalid_link" => INVALID_LINK.to_owned(),
        other => format!("The current daemon cannot be opened ({other})."),
    };
    Failure::new(code, message)
}

/// What a refusal to read the secret of an entry of `kind` says: its password, a relay entry's
/// pairing link, or an SSH entry's password.
fn secret_failure(code: &'static str, kind: Kind) -> Failure {
    match (code, kind) {
        ("secret_missing", Kind::Relay) => Failure::new(code, "The pairing link for this daemon is not in the secret store. Replace it in Daemons."),
        ("secret_missing", _) => Failure::new(code, "The password for this daemon is not in the secret store. Enter it again in Daemons."),
        _ => Failure::new(code, "The secret store could not be read: it may be locked, or access was refused. Try again."),
    }
}

/// The password of the planned entry (the daemon's own, for an SSH entry), read on the blocking pool.
async fn read_password(access: &OwnerAccess, plan: BridgePlan) -> Result<Option<Secret>, Failure> {
    let kind = plan.kind;
    blocking({
        let access = access.clone();
        move || access.bridge_password(&plan)
    })
    .await?
    .map_err(|code| secret_failure(code, kind))
}

/// The stored pairing link does not parse. It is not repeated: it holds the daemon's key.
const INVALID_LINK: &str = "The pairing link stored for this daemon is not valid. Replace it in Daemons.";

/// How the current entry's daemon is opened, once the owner thread has said which entry it is: the
/// one branch per kind that `transport_open` and the transfer engine's connector share. It holds a
/// pairing link's key, so it has no `Debug`.
pub(crate) struct Route {
    /// The address the page derives from the entry (what `transport_open`'s `url` must be): the
    /// stored address of a local or direct entry, the relay's (`ws(s)://<relay host>`) for a relay
    /// entry, the daemon's own for a pairing link with a host hint.
    address: String,
    way: Way,
}

enum Way {
    /// A WebSocket with the entry's own password, read from the store when the socket is dialled
    /// (after the place is taken): a local or direct entry.
    Password(BridgePlan),
    /// A pairing link with a host hint: the daemon itself, no password, as a direct entry.
    Host,
    /// Through the relay at the address: the encrypted channel to the daemon with this public key.
    Relay { daemon_key: [u8; DAEMON_KEY_BYTES] },
    /// Through the shared SSH session of the entry: a channel to the daemon's port on the host, with
    /// the daemon's own password (`bridge`'s, read when the channel is opened).
    Ssh { bridge: BridgePlan, plan: SshPlan, sessions: SshSessions },
}

impl Route {
    /// The address the page derives from the entry: what a `url` must equal to be this entry's.
    pub(crate) fn address(&self) -> &str {
        &self.address
    }

    /// How this route reaches the daemon, for `ui.inspect`. A pairing link with a host hint is a direct dial.
    pub(crate) const fn via(&self) -> Via {
        match self.way {
            Way::Password(_) | Way::Host => Via::Direct,
            Way::Relay { .. } => Via::Relay,
            Way::Ssh { .. } => Via::Ssh,
        }
    }

    /// The route for the entry `plan` is for. A relay entry's pairing link is read here, on the
    /// blocking pool, because its address comes from it: with the link held in memory the plan
    /// knows the address already, with the link in the store it does not. An SSH entry's fields
    /// are asked of the owner thread, once more.
    pub(crate) async fn resolve(access: &OwnerAccess, ssh: &SshSessions, plan: BridgePlan) -> Result<Self, Failure> {
        match plan.kind {
            Kind::Local | Kind::Direct => Ok(Self { address: normalize_daemon_url(&plan.url), way: Way::Password(plan) }),
            Kind::Relay => {
                let link = blocking({
                    let access = access.clone();
                    move || access.bridge_password(&plan)
                })
                .await?
                .map_err(|code| secret_failure(code, Kind::Relay))?
                .ok_or_else(|| secret_failure("secret_missing", Kind::Relay))?;
                Self::from_link(link.expose())
            }
            Kind::Ssh => Self::from_ssh(access, ssh, plan).await,
        }
    }

    /// An SSH entry: its address is its loopback daemon on the host. The owner thread is asked for
    /// the entry's fields; when the current entry changed meanwhile the open is retried.
    async fn from_ssh(access: &OwnerAccess, ssh: &SshSessions, bridge: BridgePlan) -> Result<Self, Failure> {
        let plan = blocking({
            let access = access.clone();
            move || access.ssh_plan()
        })
        .await?
        .map_err(plan_failure)?;
        if plan.entry != bridge.entry {
            return Err(Failure::new("busy", "The current daemon changed while it was being opened. Try again."));
        }
        Ok(Self { address: plan.url.clone(), way: Way::Ssh { bridge, plan, sessions: ssh.clone() } })
    }

    /// The route a pairing link gives: through its relay, or straight to the daemon at its host hint.
    fn from_link(link: &str) -> Result<Self, Failure> {
        let invalid = || Failure::new("invalid_link", INVALID_LINK);
        let parsed = pairing::parse(link).map_err(|_| invalid())?;
        // The address is the engine's own rule, the one the page is told: never derived twice.
        let address = relay_address(link).map_err(|_| invalid())?;
        let way = match parsed.target {
            Target::Relay { .. } => Way::Relay { daemon_key: parsed.daemon_key },
            Target::Direct { .. } => Way::Host,
        };
        Ok(Self { address, way })
    }

    /// Open the socket to the daemon, with messages of at most `max_message_bytes`. A local, direct
    /// or SSH entry's password is read here, on the blocking pool.
    pub(crate) async fn connect(self, access: &OwnerAccess, max_message_bytes: usize) -> Result<DaemonSocket, Failure> {
        match self.way {
            Way::Password(plan) => {
                let password = read_password(access, plan).await?;
                Ok(dial(&self.address, password.as_ref().map(Secret::expose), DIAL_LIMIT, max_message_bytes).await?)
            }
            Way::Host => Ok(dial(&self.address, None, DIAL_LIMIT, max_message_bytes).await?),
            Way::Relay { daemon_key } => {
                // The relay's connect calls every dial failure but a timeout `relay_unreachable` (S5), which
                // the engine retries: an address that can never be dialled is refused as such, and is final.
                check_address(&self.address)?;
                Ok(pistudiodesktop_relay::connect(&self.address, &daemon_key, max_message_bytes, CONNECT_LIMIT).await?.into_socket())
            }
            Way::Ssh { bridge, plan, sessions } => {
                let password = read_password(access, bridge).await?;
                sessions.open_daemon(access, &plan, password.as_ref(), max_message_bytes).await
            }
        }
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
    use std::path::PathBuf;

    use super::*;
    use crate::ssh_session::SshEnv;
    use pistudiodesktop_engine::BridgePassword;
    use pistudiodesktop_model::EntryId;
    use pistudiodesktop_net::{ConnectionSnapshot, EndCode, LastError};
    use pistudiodesktop_secrets::MemoryStore;

    fn ended(at_ms: u64) -> Option<LastError> {
        Some(LastError { code: EndCode::UpstreamLost, at_ms })
    }

    #[test]
    fn the_last_error_is_the_newer_of_the_refused_open_and_the_abnormal_end() {
        let refused = |at_ms| Some(ConnectionError { code: "unreachable", at_ms });
        let seen =
            |ended, refused| inspect(&ProxySnapshot { connections: Vec::new(), last_error: ended }, &HashMap::new(), SshView::default(), refused).last_error;
        assert_eq!(seen(None, None), None);
        assert_eq!(seen(None, refused(5)), refused(5));
        assert_eq!(seen(ended(5), None), Some(ConnectionError { code: "upstream_lost", at_ms: 5 }));
        assert_eq!(seen(ended(5), refused(9)), refused(9), "a refusal after the end");
        assert_eq!(seen(ended(9), refused(5)), Some(ConnectionError { code: "upstream_lost", at_ms: 9 }), "an end after the refusal");
    }

    #[test]
    fn a_connection_keeps_its_id_way_state_and_counters() {
        let one =
            |state| ConnectionSnapshot { id: "e1".into(), state, frames_in: 1, frames_out: 2, bytes_in: 3, bytes_out: 4, peak_held_in: 5, peak_held_out: 6 };
        let proxies = ProxySnapshot { connections: vec![one(State::Connecting), one(State::Open), one(State::Closing)], last_error: None };
        let vias = HashMap::from([("e1".to_owned(), Via::Relay)]);
        let seen = inspect(&proxies, &vias, SshView::default(), None).transports;
        assert!(seen.iter().all(|t| t.via == Via::Relay));
        let states: Vec<TransportState> = seen.iter().map(|t| t.state).collect();
        assert_eq!(states, [TransportState::Connecting, TransportState::Open, TransportState::Closing]);
        let first = &seen[0];
        assert_eq!((first.entry_id.as_str(), first.frames_in, first.frames_out, first.bytes_in, first.bytes_out), ("e1", 1, 2, 3, 4));
        assert_eq!((first.peak_held_in, first.peak_held_out), (5, 6));
    }

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

    /// A key of 32 bytes, 0 to 31, as a link carries it.
    const KEY: &str = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

    fn plan(kind: Kind, url: &str, password: BridgePassword) -> BridgePlan {
        BridgePlan { entry: EntryId::parse("3f2b8a40-1111-4222-8333-444455556666").unwrap(), kind, url: url.to_owned(), password }
    }

    /// An access whose owner thread is gone: only a plan that reads nothing from the store may use it.
    fn access() -> OwnerAccess {
        OwnerAccess::new(channel().0, Arc::new(MemoryStore::new()))
    }

    /// Sessions that dial nothing in these tests: no route that is not an SSH one reaches them.
    fn ssh() -> SshSessions {
        SshSessions::new(SshEnv::fixed(PathBuf::from("/nonexistent"), PathBuf::from("/nonexistent/known_hosts"), Vec::new()))
    }

    #[test]
    fn a_pairing_link_is_a_route_through_its_relay_or_straight_to_its_host_hint() {
        let link = format!("#offer={KEY}&relay=https://relay.example:8443/&relayTls=1&note=hunter2-link");
        let relay = Route::from_link(&link).unwrap();
        // The address is the one the page is told, from the engine's own rule.
        assert_eq!(relay.address(), "wss://relay.example:8443");
        assert_eq!(Ok(relay.address().to_owned()), relay_address(&link).map_err(|_| ()));
        assert!(matches!(relay.way, Way::Relay { daemon_key } if daemon_key[..4] == [0, 1, 2, 3] && daemon_key[31] == 31));
        let hint = Route::from_link(&format!("#offer={KEY}&host=daemon.example:6767")).unwrap();
        assert_eq!(hint.address(), "ws://daemon.example:6767");
        assert!(matches!(hint.way, Way::Host));
    }

    #[test]
    fn a_link_that_does_not_parse_is_invalid_link_and_the_message_does_not_repeat_it() {
        for link in [
            "",
            "hunter2-link",
            "#offer=AAEC&relay=relay.example",
            &format!("#offer={KEY}"),
            &format!("#offer={KEY}&relay=relay.example&host=daemon.example&note=hunter2-link"),
        ] {
            let failure = Route::from_link(link).err().unwrap();
            assert_eq!((failure.code, failure.message.as_str()), ("invalid_link", INVALID_LINK), "{link}");
            assert!(!failure.message.contains("hunter2") && !failure.message.contains(KEY));
        }
    }

    #[test]
    fn a_local_or_direct_entry_is_dialled_at_its_normalised_address_and_its_password_is_read_later() {
        for kind in [Kind::Local, Kind::Direct] {
            let route = tauri::async_runtime::block_on(Route::resolve(&access(), &ssh(), plan(kind, "Daemon.example:6767/", BridgePassword::Stored))).unwrap();
            assert_eq!(route.address(), "ws://Daemon.example:6767");
            assert!(matches!(route.way, Way::Password(_)));
            assert_eq!(route.via(), Via::Direct);
        }
    }

    #[test]
    fn a_relay_entrys_link_held_in_memory_is_the_route_and_an_ssh_entry_asks_the_owner_thread_for_its_fields() {
        let held = BridgePassword::Held(Secret::new(format!("#offer={KEY}&relay=relay.example")));
        let route = tauri::async_runtime::block_on(Route::resolve(&access(), &ssh(), plan(Kind::Relay, "", held))).unwrap();
        assert_eq!(route.address(), "ws://relay.example");
        assert!(matches!(route.way, Way::Relay { .. }));
        assert_eq!(route.via(), Via::Relay);
        let held = BridgePassword::Held(Secret::new("not a link"));
        assert_eq!(tauri::async_runtime::block_on(Route::resolve(&access(), &ssh(), plan(Kind::Relay, "", held))).err().unwrap().code, "invalid_link");
        // The owner thread of `access()` is gone: the SSH entry's fields cannot be had, and nothing is dialled.
        let refused =
            tauri::async_runtime::block_on(Route::resolve(&access(), &ssh(), plan(Kind::Ssh, "ws://127.0.0.1:6767", BridgePassword::None))).err().unwrap();
        assert_eq!(refused.code, "internal");
    }

    #[test]
    fn a_missing_secret_names_what_is_missing() {
        assert!(secret_failure("secret_missing", Kind::Relay).message.contains("pairing link"));
        assert!(secret_failure("secret_missing", Kind::Direct).message.contains("password"));
        assert_eq!(secret_failure("secret_unavailable", Kind::Relay).code, "secret_unavailable");
        assert!(secret_failure("secret_unavailable", Kind::Relay).message.contains("secret store"));
    }
}
