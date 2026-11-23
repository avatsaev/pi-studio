//! A relay entry through Tauri's own IPC path with the app's real permissions: `transport_open` and the
//! transfer engine's connector open it in Rust, against the relay stand-in of `pistudiodesktop-relay` (a
//! loopback relay with the daemon's half of the encrypted channel). The pairing link, which holds the
//! daemon's key, never reaches the page.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use pistudiodesktop_model::EntryId;
use pistudiodesktop_relay::testing::{Seen, StandIn, Step};
use pistudiodesktop_relay::{Record, session_id};
use pistudiodesktop_secrets::{MemoryStore, Secret, SecretKey, SecretKind, SecretStore};
use pistudiodesktop_shell::owner::Quiet;
use pistudiodesktop_shell::resume::{Reason, ResumeSignals};
use pistudiodesktop_shell::transfer_mode::TransfersMode;
use pistudiodesktop_shell::{Request, Services};
use serde_json::{Value, json};
use tauri::test::MockRuntime;
use tauri::{App, Manager as _, WebviewWindow, WebviewWindowBuilder};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

use super::transport_tests::{Daemon, Page, capture_logs, connect_page, logged, wait_until};
use super::{built_app_stored, invoke};
use crate::bridge::{Bridge, Launch, idle_update};
use crate::transport::origin_of;

/// The secret key of the daemon half of the stand-in, and another one: a link made of the other's
/// public key is not this daemon's.
const DAEMON_SECRET: [u8; 32] = [7; 32];
const OTHER_SECRET: [u8; 32] = [9; 32];
/// Part of every link: it must appear nowhere but in the link itself.
const MARKER: &str = "MARKER-link-5c0f2d91";

/// The script of a relay that pairs, takes the client's key, opens the channel and echoes.
fn serving() -> Vec<Step> {
    vec![Step::ReadConnect, Step::Paired, Step::Hello, Step::Ready, Step::Echo]
}

// ---- links

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 without padding.
fn base64(bytes: &[u8]) -> String {
    let mut text = String::new();
    for chunk in bytes.chunks(3) {
        let bits = chunk.iter().enumerate().fold(0_u32, |bits, (at, byte)| bits | (u32::from(*byte) << (16 - 8 * at)));
        for at in 0..=chunk.len() {
            text.push(char::from(ALPHABET[usize::try_from((bits >> (18 - 6 * at)) & 63).unwrap()]));
        }
    }
    text
}

/// The key of a daemon as a link carries it (`+` and `/` percent-encoded, as a form value is).
fn offer(key: &[u8; 32]) -> String {
    base64(key).replace('+', "%2B").replace('/', "%2F")
}

/// A pairing link for the daemon with public key `key`, reached by `way` (`relay=<host>` or `host=<host>`).
fn link(key: &[u8; 32], way: &str) -> String {
    format!("#offer={}&{way}&note={MARKER}", offer(key))
}

fn public_of(secret: [u8; 32]) -> [u8; 32] {
    pistudiodesktop_relay::testing::DaemonHalf::new(secret).public()
}

// ---- the relay stand-in

/// A relay stand-in, with what the client sent it collected by a task of its own.
struct Relay {
    url: String,
    /// The daemon half's public key: what a link for this relay carries.
    public: [u8; 32],
    seen: Arc<Mutex<Vec<Seen>>>,
    watcher: tauri::async_runtime::JoinHandle<()>,
}

impl Relay {
    fn start(script: Vec<Step>) -> Relay {
        let mut stand_in = tauri::async_runtime::block_on(StandIn::start(DAEMON_SECRET, script)).unwrap();
        let (url, public) = (stand_in.url(), stand_in.daemon_public());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&seen);
        let watcher = tauri::async_runtime::spawn(async move {
            while let Some(one) = stand_in.seen().await {
                record.lock().unwrap().push(one);
            }
        });
        Relay { url, public, seen, watcher }
    }

    /// `host:port`, as a link names the relay.
    fn host(&self) -> &str {
        self.url.strip_prefix("ws://").unwrap()
    }

    fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }

    /// How many connections have sent their `relay_client_connect`.
    fn connects(&self) -> usize {
        self.seen().iter().filter(|one| matches!(one, Seen::Connect(_))).count()
    }
}

impl Drop for Relay {
    fn drop(&mut self) {
        // The task owns the stand-in: ending it ends the listener and every connection.
        self.watcher.abort();
    }
}

// ---- the app

struct Fixture {
    _config: tempfile::TempDir,
    work: tempfile::TempDir,
    app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    store: Arc<MemoryStore>,
    entry: String,
    origin: String,
    /// What the page derives from the entry: the relay's address, or the daemon's for a host hint.
    url: String,
    /// What the open dialog answers next.
    picks: Arc<Mutex<Vec<PathBuf>>>,
}

impl Fixture {
    /// An app whose current entry is a relay entry for `relay`, with the link of `key`.
    fn relay(relay: &Relay, key: &[u8; 32]) -> Fixture {
        Self::with_link(link(key, &format!("relay={}", relay.host())), relay.url.clone())
    }

    /// An app whose current relay entry holds `link`, which the page turns into `url`.
    fn with_link(link: String, url: String) -> Fixture {
        capture_logs();
        let (config, work) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let picks = Arc::new(Mutex::new(Vec::new()));
        let for_picks = Arc::clone(&picks);
        let services = Services { pick_files: Some(Arc::new(move |_| std::mem::take(&mut *for_picks.lock().unwrap()))), ..Services::default() };
        let launch = Launch {
            notify: Box::new(Quiet),
            local_supported: false,
            notices: Vec::new(),
            resume: Arc::default(),
            transfers: TransfersMode::Engine,
            update: idle_update(),
        };
        let store = Arc::new(MemoryStore::new());
        let as_store: Arc<dyn SecretStore> = Arc::clone(&store) as Arc<dyn SecretStore>;
        let app = built_app_stored(config.path(), services, launch, as_store);
        let window = WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default()).build().unwrap();
        let added = invoke(&window, "engine_command", json!({"id": "daemon.add", "params": {"kind": "relay", "name": "R", "pairingLink": link}})).unwrap();
        let entry = added["id"].as_str().unwrap().to_owned();
        let origin = origin_of(&window.url().unwrap()).unwrap();
        let fixture = Fixture { _config: config, work, app, window, store, entry: entry.clone(), origin, url, picks };
        fixture.make_current(&entry);
        fixture
    }

    /// What the control socket does: switch without the page's confirm and reload.
    fn make_current(&self, id: &str) {
        let switch = Request::Control { method: "engine.execute".into(), params: json!({"command": "daemon.switch", "params": {"id": id}}) };
        assert_eq!(tauri::async_runtime::block_on(self.app.state::<Bridge>().ask(switch)).unwrap()["ok"], true);
    }

    fn open(&self) -> Result<String, Value> {
        self.open_url(&self.url)
    }

    fn open_url(&self, url: &str) -> Result<String, Value> {
        invoke(&self.window, "transport_open", json!({"url": url})).map(|answer| answer["localUrl"].as_str().unwrap().to_owned())
    }

    fn connect(&self, local_url: &str) -> Page {
        let (page, protocol) = tauri::async_runtime::block_on(connect_page(local_url, &self.origin)).unwrap();
        assert_eq!(protocol, None, "no subprotocol is passed back to the page");
        page
    }

    /// `ui.inspect`, as the control socket asks.
    fn inspect(&self) -> Value {
        let ask = Request::Control { method: "ui.inspect".into(), params: Value::Null };
        tauri::async_runtime::block_on(self.app.state::<Bridge>().ask(ask)).unwrap()["result"].clone()
    }

    /// An upload of a small file to the daemon, on a thread of its own: the engine opens its connection for it.
    fn upload(&self, id: &str) -> JoinHandle<Result<Value, Value>> {
        let file = self.work.path().join("up.bin");
        std::fs::write(&file, b"relay bytes").unwrap();
        *self.picks.lock().unwrap() = vec![file];
        let handle = invoke(&self.window, "upload_pick", json!({})).unwrap()[0]["handle"].as_str().unwrap().to_owned();
        let (window, id) = (self.window.clone(), id.to_owned());
        std::thread::spawn(move || invoke(&window, "transfer_upload", json!({"id": id, "handle": handle, "path": "/srv/up.bin"})))
    }

    /// The machine woke: the engine's wait before its next attempt ends.
    fn wake(&self) {
        assert!(crate::resume::emit(self.app.handle(), &ResumeSignals::new(), Reason::Wake, 1_000_000));
    }
}

fn code_of<T: std::fmt::Debug>(refused: &Result<T, Value>) -> String {
    refused.as_ref().unwrap_err()["code"].as_str().unwrap().to_owned()
}

/// The result of a transfer on its thread, once it has settled.
fn settled(upload: JoinHandle<Result<Value, Value>>) -> Result<Value, Value> {
    wait_until("the upload settled", || upload.is_finished());
    upload.join().unwrap()
}

// ---- transport_open

#[test]
fn a_relay_entry_is_opened_in_rust_and_the_pages_messages_cross_the_encrypted_channel() {
    let relay = Relay::start(serving());
    let f = Fixture::relay(&relay, &relay.public);
    // The page is told the relay's address, never the link.
    assert_eq!(invoke(&f.window, "daemon_resolve_current", json!({})).unwrap(), json!({"url": relay.url, "connect": true}));

    let answer = invoke(&f.window, "transport_open", json!({"url": f.url})).unwrap();
    assert_eq!(answer.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()), Some(vec!["localUrl".to_owned()]));
    let local = answer["localUrl"].as_str().unwrap().to_owned();
    let proxy_port = local.strip_prefix("ws://127.0.0.1:").and_then(|rest| rest.split('/').next()).unwrap();
    assert!(proxy_port != relay.host().rsplit(':').next().unwrap(), "the page's address is the app's own, not the relay's");

    let mut page = f.connect(&local);
    wait_until("the transport is listed", || f.inspect()["connection"]["transports"][0]["via"] == "relay");
    tauri::async_runtime::block_on(async {
        page.send(Message::text("héllo")).await.unwrap();
        assert_eq!(page.next().await.unwrap().unwrap(), Message::text("héllo"));
        let bytes = vec![0_u8, 1, 2, 255, 254];
        page.send(Message::binary(bytes.clone())).await.unwrap();
        assert_eq!(page.next().await.unwrap().unwrap(), Message::binary(bytes));
        page.close(Some(CloseFrame { code: CloseCode::Library(4000), reason: "bye".into() })).await.unwrap();
        while let Some(Ok(_)) = page.next().await {}
    });
    wait_until("the daemon half heard the page's close", || relay.seen().contains(&Seen::Closed(Some((4000, "bye".into())))));
    // The relay was asked for this daemon's session, then the channel opened and carried the messages sealed.
    let seen = relay.seen();
    assert_eq!(seen[0], Seen::Connect(format!(r#"{{"type":"relay_client_connect","v":2,"sessionId":"{}"}}"#, session_id(&relay.public))));
    assert!(matches!(seen[1], Seen::Hello(_)), "{seen:?}");
    assert_eq!(
        seen[2..5],
        [Seen::Opened(Record::Text("héllo".into())), Seen::Opened(Record::Binary(vec![0, 1, 2, 255, 254])), Seen::Closed(Some((4000, "bye".into())))]
    );

    // The link is nowhere the page or the log can see: not its text, its note, its key, nor the relay.
    let mut seen_by_page = vec![answer.to_string(), invoke(&f.window, "boot", json!({})).unwrap().to_string()];
    seen_by_page.push(invoke(&f.window, "engine_command", json!({"id": "daemon.list"})).unwrap().to_string());
    seen_by_page.push(f.inspect().to_string());
    let key = offer(&relay.public);
    for text in seen_by_page.iter().map(String::as_str).chain([logged().as_str()]) {
        assert!(!text.contains(MARKER) && !text.contains(&key) && !text.contains(&base64(&relay.public)), "the link leaked: {}", text.len());
    }
}

#[test]
fn a_key_that_is_not_the_daemons_is_wrong_key_and_the_place_is_given_back() {
    let relay = Relay::start(vec![Step::ReadConnect, Step::Paired, Step::Hello, Step::Ready]);
    let f = Fixture::relay(&relay, &public_of(OTHER_SECRET));
    let refused = f.open();
    assert_eq!(code_of(&refused), "wrong_key");
    assert_eq!(refused.unwrap_err()["message"], "The pairing link does not match this daemon. (channel_error)");
    wait_until("the relay heard the client's 4200", || relay.seen().contains(&Seen::Closed(Some((4200, "channel_error".into())))));
    let ended = f.inspect();
    assert_eq!(ended["connection"]["lastError"]["code"], "wrong_key", "{ended}");
    assert_eq!(ended["connection"]["transports"], json!([]));
    // The place was given back: the next attempts are not refused with `limit`.
    for _ in 0..5 {
        assert_eq!(code_of(&f.open()), "wrong_key");
    }
    assert!(!logged().contains(MARKER));
}

#[test]
fn the_relays_own_closes_and_a_relay_nobody_listens_to_are_named_as_the_sdk_names_them() {
    for (script, code) in [
        (vec![Step::ReadConnect, Step::Close(4102, String::new())], "daemon_offline"),
        (vec![Step::ReadConnect, Step::Close(4103, String::new())], "daemon_unresponsive"),
        (vec![Step::ReadConnect, Step::Close(4104, String::new())], "too_many_clients"),
        (vec![Step::ReadConnect, Step::Close(4105, String::new())], "daemon_outdated"),
        (vec![Step::ReadConnect, Step::Close(4001, "odd".into())], "protocol_error"),
        // A socket that ends before the relay paired.
        (vec![Step::ReadConnect, Step::Drop], "relay_unreachable"),
        // A relay that says something that is not a frame of the protocol.
        (vec![Step::ReadConnect, Step::Text("not json".into())], "protocol_error"),
    ] {
        let relay = Relay::start(script);
        let f = Fixture::relay(&relay, &relay.public);
        assert_eq!(code_of(&f.open()), code);
    }
    let closed = {
        let listener = tauri::async_runtime::block_on(tokio::net::TcpListener::bind("127.0.0.1:0")).unwrap();
        listener.local_addr().unwrap().port()
    };
    let f = Fixture::with_link(link(&public_of(DAEMON_SECRET), &format!("relay=127.0.0.1:{closed}")), format!("ws://127.0.0.1:{closed}"));
    let refused = f.open();
    assert_eq!(code_of(&refused), "relay_unreachable");
    assert!(refused.unwrap_err()["message"].as_str().unwrap().starts_with("The relay could not be reached."));
}

#[test]
fn an_address_that_is_not_the_relays_is_address_mismatch_and_the_relay_is_not_dialled() {
    let relay = Relay::start(serving());
    let f = Fixture::relay(&relay, &relay.public);
    let port = relay.host().rsplit(':').next().unwrap().to_owned();
    for url in [
        "ws://127.0.0.1:1".to_owned(),
        format!("ws://localhost:{port}"),
        // `wss` for a relay without TLS, and the forms the page's rule does not produce.
        format!("wss://127.0.0.1:{port}"),
        format!("http://127.0.0.1:{port}"),
        format!("ws://127.0.0.1:{port}/"),
        format!("127.0.0.1:{port}"),
        String::new(),
    ] {
        assert_eq!(code_of(&f.open_url(&url)), "address_mismatch", "{url}");
    }
    std::thread::sleep(Duration::from_millis(200));
    assert!(relay.seen().is_empty(), "{:?}", relay.seen());
}

#[test]
fn a_link_with_a_host_hint_is_dialled_as_a_direct_daemon_and_offers_no_password() {
    let daemon = Daemon::start(None);
    let url = format!("ws://127.0.0.1:{}", daemon.port);
    let f = Fixture::with_link(link(&public_of(DAEMON_SECRET), &format!("host=127.0.0.1:{}", daemon.port)), url.clone());
    assert_eq!(invoke(&f.window, "daemon_resolve_current", json!({})).unwrap(), json!({"url": url, "connect": true}));
    let local = f.open().unwrap();
    daemon.wait_for("0:open");
    assert_eq!(daemon.offered(), vec![None::<String>], "the link's credential is the daemon's key: nothing is sent as a password");
    let mut page = f.connect(&local);
    tauri::async_runtime::block_on(async {
        page.send(Message::text("hint")).await.unwrap();
        assert_eq!(page.next().await.unwrap().unwrap(), Message::text("hint"));
    });
    assert_eq!(f.inspect()["connection"]["transports"][0]["via"], "direct", "a link with a host hint is a direct dial");

    // A daemon that wants a password refuses it: there is none to give.
    let guarded = Daemon::start(Some("needs-a-password"));
    let f = Fixture::with_link(link(&public_of(DAEMON_SECRET), &format!("host=127.0.0.1:{}", guarded.port)), format!("ws://127.0.0.1:{}", guarded.port));
    assert_eq!(code_of(&f.open()), "unauthorized");
}

#[test]
fn a_link_that_is_gone_or_does_not_parse_is_refused_with_its_code_and_nothing_is_dialled() {
    let relay = Relay::start(serving());
    let f = Fixture::relay(&relay, &relay.public);
    let key = SecretKey::new(EntryId::parse(&f.entry).unwrap(), SecretKind::PairingLink);
    f.store.delete(&key).unwrap();
    let missing = f.open();
    assert_eq!(code_of(&missing), "secret_missing");
    assert!(missing.unwrap_err()["message"].as_str().unwrap().contains("pairing link"));

    f.store.set(&key, &Secret::new("not-a-link-MARKER-garbage")).unwrap();
    let invalid = f.open();
    assert_eq!(code_of(&invalid), "invalid_link");
    assert!(!invalid.unwrap_err().to_string().contains("MARKER-garbage"), "the stored text is not repeated");
    assert!(!logged().contains("MARKER-garbage"));
    std::thread::sleep(Duration::from_millis(100));
    assert!(relay.seen().is_empty(), "{:?}", relay.seen());
}

#[test]
fn a_relay_address_that_cannot_be_dialled_is_invalid_address() {
    let f = Fixture::with_link(link(&public_of(DAEMON_SECRET), "relay=user:pw@127.0.0.1:1"), "ws://user:pw@127.0.0.1:1".to_owned());
    for _ in 0..6 {
        assert_eq!(code_of(&f.open()), "invalid_address");
    }
}

// ---- the transfer engine

#[test]
fn the_engine_opens_a_relay_entry_through_the_channel() {
    let relay = Relay::start(serving());
    let f = Fixture::relay(&relay, &relay.public);
    let upload = f.upload("relay-1");
    wait_until("the daemon half opened the engine's hello", || {
        relay
            .seen()
            .iter()
            .any(|one| matches!(one, Seen::Opened(Record::Text(text)) if text.contains(r#""type":"hello""#) && text.contains(r#""platform":"desktop""#)))
    });
    // The stand-in is no daemon: it echoes the hello, which is not an answer. Whatever the engine does with that, the upload ends.
    let _ = invoke(&f.window, "transfer_cancel", json!({"id": "relay-1"}));
    assert!(settled(upload).is_err());
    assert!(!logged().contains(MARKER));
}

#[test]
fn the_engine_retries_daemon_offline_and_a_wake_ends_the_wait() {
    let relay = Relay::start(vec![Step::ReadConnect, Step::Close(4102, String::new())]);
    let f = Fixture::relay(&relay, &relay.public);
    let upload = f.upload("offline-1");
    wait_until("the engine waits to try again", || f.inspect()["transfers"]["connection"]["state"] == "waiting");
    let waiting = f.inspect()["transfers"].clone();
    assert_eq!(waiting["active"][0]["state"], "waiting", "{waiting}");
    assert_eq!(waiting["lastError"]["code"], "daemon_offline", "{waiting}");
    assert_eq!(relay.connects(), 1);
    assert!(!upload.is_finished(), "a daemon that is offline is waited for");

    f.wake();
    wait_until("the second attempt", || relay.connects() == 2);
    assert_eq!(invoke(&f.window, "transfer_cancel", json!({"id": "offline-1"})).unwrap(), json!({"cancelled": true}));
    assert_eq!(code_of(&settled(upload)), "cancelled");
}

#[test]
fn the_engine_fails_at_once_on_wrong_key_and_does_not_try_again() {
    let relay = Relay::start(vec![Step::ReadConnect, Step::Paired, Step::Hello, Step::Ready]);
    let f = Fixture::relay(&relay, &public_of(OTHER_SECRET));
    let failed = settled(f.upload("key-1"));
    assert_eq!(code_of(&failed), "wrong_key", "{failed:?}");
    let ended = f.inspect()["transfers"].clone();
    assert_eq!((ended["connection"]["state"].as_str(), ended["totals"]["failed"].as_u64()), (Some("closed"), Some(1)), "{ended}");
    assert_eq!(ended["lastError"]["code"], "wrong_key");
    assert_eq!(relay.connects(), 1);
}

#[test]
fn the_engine_fails_at_once_on_a_relay_address_that_cannot_be_dialled() {
    let f = Fixture::with_link(link(&public_of(DAEMON_SECRET), "relay=user:pw@127.0.0.1:1"), "ws://user:pw@127.0.0.1:1".to_owned());
    // Not `relay_unreachable`, which is retried: no wait mends an address that is not one.
    assert_eq!(code_of(&settled(f.upload("address-1"))), "invalid_address");
}
