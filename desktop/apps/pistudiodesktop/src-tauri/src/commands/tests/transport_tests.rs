//! `transport_open` through Tauri's own IPC path with the app's real permissions, against a local
//! WebSocket server that stands in for the daemon and a local client that stands in for the page.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Once};
use std::time::{Duration, Instant};

use futures_util::{SinkExt as _, StreamExt as _};
use pistudiodesktop_model::EntryId;
use pistudiodesktop_secrets::{MemoryStore, SecretKey, SecretKind, SecretStore};
use pistudiodesktop_shell::Request;
use pistudiodesktop_shell::Services;
use pistudiodesktop_shell::owner::Quiet;
use pistudiodesktop_shell::transfer_mode::TransfersMode;
use serde_json::{Value, json};
use tauri::test::MockRuntime;
use tauri::{App, Manager as _, RunEvent, WebviewWindow, WebviewWindowBuilder};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request as UpgradeRequest, Response as UpgradeResponse};
use tokio_tungstenite::tungstenite::http::{HeaderValue, Response as HttpResponse};
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::{WebSocketStream, accept_hdr_async, client_async};

use super::{built_app_stored, invoke};
use crate::bridge::Launch;
use crate::transport::{self, origin_of};

/// A password nobody would pick: if it appears anywhere but the daemon's upgrade it leaked.
const MARKER: &str = "MARKER-pw-0b6e4d2a";
pub(super) const PATIENCE: Duration = Duration::from_secs(10);

// ---- the log: every line of the test binary, to look for a secret in

static LINES: Mutex<Vec<String>> = Mutex::new(Vec::new());

struct Capture;

impl log::Log for Capture {
    /// The app's own rule (`logging.rs`): its own targets at any level, everything else from `warn` up.
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.target().starts_with("pistudiodesktop") || metadata.level() <= log::Level::Warn
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        if let Ok(mut lines) = LINES.lock() {
            lines.push(format!("{}: {}", record.target(), record.args()));
        }
    }

    fn flush(&self) {}
}

/// Every record the app's logger would print goes to [`LINES`] from here on. Nothing else in the tests sets a logger.
pub(super) fn capture_logs() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        assert!(log::set_logger(&Capture).is_ok(), "another logger is set");
        log::set_max_level(log::LevelFilter::Trace);
    });
}

pub(super) fn logged() -> String {
    LINES.lock().map(|lines| lines.join("\n")).unwrap_or_default()
}

// ---- the daemon stand-in

/// A WebSocket server that echoes, and remembers what it saw: per connection (numbered from 0 in
/// the order they came) the events `open`, `text`, `binary`, `close:<code>` and `end`, and the
/// subprotocols the upgrades offered.
#[derive(Clone)]
pub(super) struct Daemon {
    pub(super) port: u16,
    events: Arc<Mutex<Vec<String>>>,
    offered: Arc<Mutex<Vec<Option<String>>>>,
    upgrades: Arc<AtomicUsize>,
}

impl Daemon {
    /// `password`: when set, an upgrade that does not offer `pi-studio.bearer.<password>` is answered 401.
    pub(super) fn start(password: Option<&'static str>) -> Daemon {
        let events = Arc::new(Mutex::new(Vec::new()));
        let offered = Arc::new(Mutex::new(Vec::new()));
        let upgrades = Arc::new(AtomicUsize::new(0));
        let listener = tauri::async_runtime::block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
        let port = listener.local_addr().unwrap().port();
        let daemon = Daemon { port, events, offered, upgrades };
        let accepting = daemon.clone();
        tauri::async_runtime::spawn(async move {
            while let Ok((tcp, _)) = listener.accept().await {
                let n = accepting.upgrades.fetch_add(1, Ordering::SeqCst);
                tauri::async_runtime::spawn(accepting.clone().serve(n, tcp, password));
            }
        });
        daemon
    }

    async fn serve(self, n: usize, tcp: TcpStream, password: Option<&'static str>) {
        let offered = Arc::clone(&self.offered);
        // The library's callback type fixes this signature.
        #[allow(clippy::result_large_err)]
        let upgrade = move |request: &UpgradeRequest, mut response: UpgradeResponse| -> Result<UpgradeResponse, ErrorResponse> {
            let protocol = request.headers().get("sec-websocket-protocol").and_then(|v| v.to_str().ok()).map(str::to_owned);
            if let Ok(mut seen) = offered.lock() {
                seen.push(protocol.clone());
            }
            if password.is_some_and(|expected| protocol.as_deref() != Some(&format!("pi-studio.bearer.{expected}"))) {
                return Err(HttpResponse::builder().status(401).body(None).unwrap());
            }
            // The daemon echoes the subprotocol it accepted, as the real one does.
            if let Some(protocol) = protocol.and_then(|p| HeaderValue::from_str(&p).ok()) {
                response.headers_mut().insert("sec-websocket-protocol", protocol);
            }
            Ok(response)
        };
        let Ok(mut socket) = accept_hdr_async(tcp, upgrade).await else { return };
        self.note(n, "open".into());
        while let Some(Ok(message)) = socket.next().await {
            match message {
                Message::Text(_) | Message::Binary(_) => {
                    self.note(n, if message.is_text() { "text" } else { "binary" }.into());
                    if socket.send(message).await.is_err() {
                        break;
                    }
                }
                Message::Close(frame) => self.note(n, format!("close:{}", frame.map_or(0, |f| u16::from(f.code)))),
                _ => {}
            }
        }
        self.note(n, "end".into());
    }

    fn note(&self, n: usize, event: String) {
        if let Ok(mut events) = self.events.lock() {
            events.push(format!("{n}:{event}"));
        }
    }

    fn saw(&self, event: &str) -> bool {
        self.events.lock().is_ok_and(|events| events.iter().any(|e| e == event))
    }

    pub(super) fn offered(&self) -> Vec<Option<String>> {
        self.offered.lock().map(|offered| offered.clone()).unwrap_or_default()
    }

    pub(super) fn wait_for(&self, event: &str) {
        wait_until(event, || self.saw(event));
    }
}

pub(super) fn wait_until(what: &str, condition: impl Fn() -> bool) {
    let deadline = Instant::now() + PATIENCE;
    while !condition() {
        assert!(Instant::now() < deadline, "never happened: {what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

// ---- the page stand-in

pub(super) type Page = WebSocketStream<TcpStream>;

/// The page's `WebSocket` to `local_url`, sending `origin` as its `Origin`. Answers the upgrade
/// response's `Sec-WebSocket-Protocol` (none is expected) with the socket.
pub(super) async fn connect_page(local_url: &str, origin: &str) -> Result<(Page, Option<String>), String> {
    let mut request = local_url.into_client_request().map_err(|e| e.to_string())?;
    request.headers_mut().insert("origin", HeaderValue::from_str(origin).map_err(|e| e.to_string())?);
    let authority = request.uri().authority().map(|a| a.to_string()).ok_or("no authority")?;
    let tcp = TcpStream::connect(authority).await.map_err(|e| e.to_string())?;
    let (socket, response) = client_async(request, tcp).await.map_err(|e| e.to_string())?;
    Ok((socket, response.headers().get("sec-websocket-protocol").and_then(|v| v.to_str().ok()).map(str::to_owned)))
}

// ---- the app

struct Fixture {
    _dir: tempfile::TempDir,
    app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    daemon: Daemon,
    store: Arc<MemoryStore>,
    id: String,
    /// What the page derives from the entry's address.
    url: String,
    origin: String,
}

impl Fixture {
    /// An app whose current entry is a direct entry for a local daemon stand-in.
    fn direct(password: Option<&str>, required: Option<&'static str>) -> Fixture {
        capture_logs();
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(MemoryStore::new());
        let launch = Launch { notify: Box::new(Quiet), local_supported: false, notices: Vec::new(), resume: Arc::default(), transfers: TransfersMode::Engine };
        let as_store: Arc<dyn SecretStore> = Arc::clone(&store) as Arc<dyn SecretStore>;
        let app = built_app_stored(dir.path(), Services::default(), launch, as_store);
        let window = WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default()).build().unwrap();
        let daemon = Daemon::start(required);
        let mut params = json!({"kind": "direct", "name": "D", "address": format!("127.0.0.1:{}", daemon.port)});
        if let Some(password) = password {
            params["password"] = json!(password);
        }
        let added = invoke(&window, "engine_command", json!({"id": "daemon.add", "params": params})).unwrap();
        let id = added["id"].as_str().unwrap().to_owned();
        let origin = origin_of(&window.url().unwrap()).unwrap();
        let fixture = Fixture { _dir: dir, app, window, url: format!("ws://127.0.0.1:{}", daemon.port), daemon, store, id: id.clone(), origin };
        fixture.make_current(&id);
        fixture
    }

    /// What the control socket does: switch without the page's confirm and reload.
    fn make_current(&self, id: &str) {
        let switch = Request::Control { method: "engine.execute".into(), params: json!({"command": "daemon.switch", "params": {"id": id}}) };
        assert_eq!(tauri::async_runtime::block_on(self.app.state::<crate::bridge::Bridge>().ask(switch)).unwrap()["ok"], true);
    }

    fn open(&self) -> Result<String, Value> {
        self.open_url(&self.url)
    }

    fn open_url(&self, url: &str) -> Result<String, Value> {
        invoke(&self.window, "transport_open", json!({"url": url})).map(|answer| answer["localUrl"].as_str().unwrap().to_owned())
    }

    fn connect(&self, local_url: &str) -> Page {
        let (page, protocol) = tauri::async_runtime::block_on(connect_page(local_url, &self.origin)).unwrap();
        assert_eq!(protocol, None, "the daemon's subprotocol is not passed back to the page");
        page
    }
}

fn code_of(refused: &Result<String, Value>) -> String {
    refused.as_ref().unwrap_err()["code"].as_str().unwrap().to_owned()
}

// ---- acceptance

#[test]
fn the_page_gets_a_local_address_and_echoes_text_and_binary_through_the_daemon_and_closes_with_a_code_the_daemon_sees() {
    let f = Fixture::direct(None, None);
    let answer = invoke(&f.window, "transport_open", json!({"url": f.url})).unwrap();
    assert_eq!(answer.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()), Some(vec!["localUrl".to_owned()]));
    let local = answer["localUrl"].as_str().unwrap();
    assert!(local.starts_with("ws://127.0.0.1:") && !local.contains(&f.daemon.port.to_string()), "{}", local.len());
    f.daemon.wait_for("0:open");

    let mut page = f.connect(local);
    tauri::async_runtime::block_on(async {
        page.send(Message::text("héllo")).await.unwrap();
        assert_eq!(page.next().await.unwrap().unwrap(), Message::text("héllo"));
        let bytes = vec![0u8, 1, 2, 255, 254];
        page.send(Message::binary(bytes.clone())).await.unwrap();
        assert_eq!(page.next().await.unwrap().unwrap(), Message::binary(bytes));
        page.close(Some(CloseFrame { code: CloseCode::Library(4000), reason: "bye".into() })).await.unwrap();
        while let Some(Ok(_)) = page.next().await {}
    });
    f.daemon.wait_for("0:close:4000");
    f.daemon.wait_for("0:end");
    assert!(f.daemon.saw("0:text") && f.daemon.saw("0:binary"));
}

#[test]
fn an_address_that_is_not_the_current_entrys_is_address_mismatch_and_nothing_is_dialled() {
    let f = Fixture::direct(None, None);
    for url in [
        "ws://127.0.0.1:1".to_owned(),
        format!("ws://localhost:{}", f.daemon.port),
        // The page applies the rule itself: what is only equal after normalising is somebody else's.
        format!("http://127.0.0.1:{}", f.daemon.port),
        format!("ws://127.0.0.1:{}/", f.daemon.port),
        format!("127.0.0.1:{}", f.daemon.port),
        String::new(),
    ] {
        assert_eq!(code_of(&f.open_url(&url)), "address_mismatch", "{url}");
    }
    assert_eq!(f.daemon.upgrades.load(Ordering::SeqCst), 0);
}

#[test]
fn an_address_that_cannot_be_dialled_is_invalid_address_before_any_place_or_secret() {
    let f = Fixture::direct(None, None);
    let added = invoke(
        &f.window,
        "engine_command",
        json!({"id": "daemon.add", "params": {"kind": "direct", "name": "F", "address": "ftp://127.0.0.1:1", "password": MARKER}}),
    );
    let Ok(added) = added else { return };
    f.make_current(added["id"].as_str().unwrap());
    let refused = f.open_url("ftp://127.0.0.1:1");
    assert_eq!(code_of(&refused), "invalid_address");
    assert!(!refused.unwrap_err().to_string().contains(MARKER));
}

#[test]
fn a_fifth_open_is_limit_and_never_dials() {
    let f = Fixture::direct(None, None);
    for _ in 0..4 {
        assert!(f.open().is_ok());
    }
    wait_until("four upgrades", || f.daemon.upgrades.load(Ordering::SeqCst) == 4);
    assert_eq!(code_of(&f.open()), "limit");
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(f.daemon.upgrades.load(Ordering::SeqCst), 4, "the fifth never dialled");
}

#[test]
fn an_entry_whose_password_is_missing_from_the_store_is_secret_missing_and_nothing_is_dialled() {
    let f = Fixture::direct(Some(MARKER), None);
    f.store.delete(&SecretKey::new(EntryId::parse(&f.id).unwrap(), SecretKind::Password)).unwrap();
    let refused = f.open();
    assert_eq!(code_of(&refused), "secret_missing");
    assert!(refused.unwrap_err()["message"].as_str().unwrap().contains("Daemons"));
    assert_eq!(f.daemon.upgrades.load(Ordering::SeqCst), 0);
}

#[test]
fn a_marker_password_reaches_the_daemon_as_the_bearer_subprotocol_and_appears_in_no_answer_or_log_line() {
    let f = Fixture::direct(Some(MARKER), Some(MARKER));
    let answer = invoke(&f.window, "transport_open", json!({"url": f.url})).unwrap();
    let local = answer["localUrl"].as_str().unwrap().to_owned();
    f.daemon.wait_for("0:open");
    assert_eq!(f.daemon.offered(), [Some(format!("pi-studio.bearer.{MARKER}"))]);

    // `connect` also checks that the page's upgrade response carries no subprotocol.
    let mut page = f.connect(&local);
    tauri::async_runtime::block_on(async {
        page.send(Message::text("ping")).await.unwrap();
        assert_eq!(page.next().await.unwrap().unwrap(), Message::text("ping"));
    });

    let mut seen = vec![answer.to_string()];
    seen.push(invoke(&f.window, "boot", json!({})).unwrap().to_string());
    seen.push(invoke(&f.window, "engine_command", json!({"id": "daemon.list"})).unwrap().to_string());
    assert!(seen.iter().all(|text| !text.contains(MARKER)), "{seen:?}");
    // The token is in the command's answer and nowhere else.
    let token = local.rsplit('/').next().unwrap();
    assert_eq!(token.len(), 64);
    assert!(seen[1..].iter().all(|text| !text.contains(token)), "the token is in another answer");
    let lines = logged();
    let leaked: Vec<&str> = lines.lines().filter(|l| l.contains(MARKER)).collect();
    assert!(leaked.is_empty(), "{leaked:?}");
    assert!(!lines.contains(MARKER) && !lines.contains(token) && !lines.contains(&local), "a secret reached a log line");
}

#[test]
fn a_wrong_password_is_unauthorized_and_the_message_does_not_repeat_it() {
    let f = Fixture::direct(Some(MARKER), Some("another-password"));
    let refused = f.open();
    assert_eq!(code_of(&refused), "unauthorized");
    assert!(!refused.unwrap_err().to_string().contains(MARKER));
    assert!(!logged().contains(MARKER));
    // The place was given back: the next attempts are not refused with `limit`.
    for _ in 0..5 {
        assert_eq!(code_of(&f.open()), "unauthorized");
    }
}

#[test]
fn a_daemon_nobody_listens_to_is_unreachable() {
    let f = Fixture::direct(None, None);
    let closed = {
        let listener = tauri::async_runtime::block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
        listener.local_addr().unwrap().port()
    };
    let added = invoke(
        &f.window,
        "engine_command",
        json!({"id": "daemon.add", "params": {"kind": "direct", "name": "Gone", "address": format!("127.0.0.1:{closed}")}}),
    )
    .unwrap();
    f.make_current(added["id"].as_str().unwrap());
    let refused = f.open_url(&format!("ws://127.0.0.1:{closed}"));
    assert_eq!(code_of(&refused), "unreachable");
    assert!(refused.unwrap_err()["message"].as_str().unwrap().contains(&closed.to_string()), "the message names the port");
}

#[test]
fn a_call_with_the_wrong_arguments_is_an_error_not_a_crash() {
    let f = Fixture::direct(None, None);
    assert!(invoke(&f.window, "transport_open", json!({})).is_err());
    assert!(invoke(&f.window, "transport_open", json!({"url": 7})).is_err());
    assert!(f.open().is_ok(), "and the app still answers");
}

// ---- closing

/// Two connections to the daemon: one the page has joined, one still waiting for its page.
fn two_open(f: &Fixture) -> Page {
    let joined = f.open().unwrap();
    f.daemon.wait_for("0:open");
    let page = f.connect(&joined);
    assert!(f.open().is_ok());
    f.daemon.wait_for("1:open");
    page
}

fn all_told_goodbye(f: &Fixture, connections: usize) {
    for n in 0..connections {
        f.daemon.wait_for(&format!("{n}:close:1001"));
    }
}

#[test]
fn boot_closes_every_proxied_connection_with_1001_and_the_places_come_back() {
    let f = Fixture::direct(None, None);
    let mut page = two_open(&f);
    invoke(&f.window, "boot", json!({})).unwrap();
    all_told_goodbye(&f, 2);
    // The page's leg ends too.
    tauri::async_runtime::block_on(async { while let Some(Ok(_)) = page.next().await {} });
    for _ in 0..4 {
        assert!(f.open().is_ok(), "four places are free again");
    }
}

#[test]
fn a_switch_closes_every_proxied_connection_with_1001_before_the_page_reloads() {
    let f = Fixture::direct(None, None);
    let _page = two_open(&f);
    let other = invoke(&f.window, "engine_command", json!({"id": "daemon.add", "params": {"kind": "direct", "name": "B", "address": "h:1"}})).unwrap();
    assert_eq!(invoke(&f.window, "daemon_switch", json!({"id": other["id"]})).unwrap(), Value::Null);
    all_told_goodbye(&f, 2);
}

#[test]
fn a_declined_switch_leaves_the_connections_open() {
    let f = Fixture::direct(None, None);
    let _page = two_open(&f);
    // An unknown id is refused before anything is closed.
    assert_eq!(invoke(&f.window, "daemon_switch", json!({"id": "nope"})).unwrap_err(), json!("not_found"));
    std::thread::sleep(Duration::from_millis(200));
    assert!(!f.daemon.saw("0:close:1001") && !f.daemon.saw("1:close:1001"));
}

#[test]
fn closing_the_last_window_closes_every_proxied_connection_with_1001_as_the_app_exits() {
    capture_logs();
    let dir = tempfile::tempdir().unwrap();
    let launch = Launch { notify: Box::new(Quiet), local_supported: false, notices: Vec::new(), resume: Arc::default(), transfers: TransfersMode::Engine };
    let app = built_app_stored(dir.path(), Services::default(), launch, Arc::new(MemoryStore::new()));
    let daemon = Daemon::start(None);
    let running = daemon.clone();
    // The runtime creates the configured window when it runs; closing the last one ends the app,
    // as in the real one, and `main` hands `Exit` to `transport::on_run_event`.
    app.run(move |handle, event| {
        if matches!(event, RunEvent::Ready) {
            let window = handle.get_webview_window("main").unwrap();
            let params = json!({"kind": "direct", "name": "D", "address": format!("127.0.0.1:{}", running.port)});
            let added = invoke(&window, "engine_command", json!({"id": "daemon.add", "params": params})).unwrap();
            let switch = Request::Control { method: "engine.execute".into(), params: json!({"command": "daemon.switch", "params": {"id": added["id"]}}) };
            assert_eq!(tauri::async_runtime::block_on(handle.state::<crate::bridge::Bridge>().ask(switch)).unwrap()["ok"], true);
            for n in 0..2 {
                invoke(&window, "transport_open", json!({"url": format!("ws://127.0.0.1:{}", running.port)})).unwrap();
                running.wait_for(&format!("{n}:open"));
            }
            window.close().unwrap();
        }
        transport::on_run_event(handle, &event);
    });
    for n in 0..2 {
        daemon.wait_for(&format!("{n}:close:1001"));
    }
}

#[test]
fn the_destroyed_window_closes_every_proxied_connection_with_1001() {
    // The mock runtime does not deliver a window's own `Destroyed` event, so the hook is called as
    // the real runtime calls it.
    let f = Fixture::direct(None, None);
    let _page = two_open(&f);
    let before = Instant::now();
    transport::on_window_event(&f.window.as_ref().window(), &tauri::WindowEvent::Destroyed);
    all_told_goodbye(&f, 2);
    assert!(before.elapsed() < Duration::from_secs(5), "closed by the event, not by the page's timeout");
}

#[test]
fn quitting_the_app_closes_every_proxied_connection_with_1001_before_it_returns() {
    let f = Fixture::direct(None, None);
    let _page = two_open(&f);
    transport::on_run_event(f.app.handle(), &RunEvent::Exit);
    all_told_goodbye(&f, 2);
}

// ---- what the control socket sees

/// `connection` of `ui.inspect`, asked as the control socket asks.
fn inspected(f: &Fixture) -> Value {
    let ask = Request::Control { method: "ui.inspect".into(), params: Value::Null };
    tauri::async_runtime::block_on(f.app.state::<crate::bridge::Bridge>().ask(ask)).unwrap()["result"]["connection"].clone()
}

#[test]
fn ui_inspect_shows_the_connection_connecting_then_open_with_counters_and_none_after_a_close() {
    let f = Fixture::direct(Some(MARKER), Some(MARKER));
    assert_eq!(inspected(&f)["transports"], json!([]));
    let local = f.open().unwrap();
    f.daemon.wait_for("0:open");
    let waiting = inspected(&f);
    assert_eq!(waiting["transports"][0]["state"], "connecting", "{waiting}");
    assert_eq!(waiting["transports"][0]["entryId"], f.id.as_str());
    assert_eq!(waiting["lastError"], Value::Null);

    let mut page = f.connect(&local);
    tauri::async_runtime::block_on(async {
        page.send(Message::text("héllo")).await.unwrap();
        assert_eq!(page.next().await.unwrap().unwrap(), Message::text("héllo"));
    });
    let open = inspected(&f);
    let transports = open["transports"].as_array().unwrap();
    assert_eq!(transports.len(), 1, "{open}");
    assert_eq!(transports[0]["state"], "open", "{open}");
    for counter in ["framesIn", "framesOut", "bytesIn", "bytesOut"] {
        assert!(transports[0][counter].as_u64().unwrap() > 0, "{counter}: {open}");
    }
    assert_eq!(open["lastError"], Value::Null, "{open}");
    // No address, token, password or message text.
    let token = local.rsplit('/').next().unwrap();
    let text = open.to_string();
    assert!(!text.contains(MARKER) && !text.contains(token) && !text.contains("héllo") && !text.contains("127.0.0.1"), "{text}");

    tauri::async_runtime::block_on(async {
        page.close(Some(CloseFrame { code: CloseCode::Library(4000), reason: "bye".into() })).await.unwrap();
        while let Some(Ok(_)) = page.next().await {}
    });
    wait_until("no transport", || inspected(&f)["transports"] == json!([]));
    assert_eq!(inspected(&f)["lastError"], Value::Null, "a close is not an error");
}

#[test]
fn ui_inspect_reports_the_code_of_a_refused_open_as_the_last_error_with_a_time() {
    let f = Fixture::direct(Some(MARKER), Some("another-password"));
    let before = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
    assert_eq!(code_of(&f.open()), "unauthorized");
    let seen = inspected(&f);
    assert_eq!(seen["transports"], json!([]), "{seen}");
    assert_eq!(seen["lastError"]["code"], "unauthorized", "{seen}");
    assert!(seen["lastError"]["atMs"].as_u64().unwrap() >= before, "{seen}");
    assert!(!seen.to_string().contains(MARKER));
    // The next refusal replaces it.
    assert_eq!(code_of(&f.open_url("ws://127.0.0.1:1")), "address_mismatch");
    assert_eq!(inspected(&f)["lastError"]["code"], "address_mismatch");
}

#[test]
fn ui_inspect_reports_page_refused_after_a_client_with_the_wrong_token_and_the_page_never_comes() {
    let f = Fixture::direct(None, None);
    let local = f.open().unwrap();
    let (stem, _) = local.rsplit_once('/').unwrap();
    let wrong = format!("{stem}/{}", "0".repeat(64));
    assert!(tauri::async_runtime::block_on(connect_page(&wrong, &f.origin)).is_err(), "the gate refuses a wrong token");
    assert_eq!(inspected(&f)["transports"][0]["state"], "connecting");
    // The real page does not come either: when its time is up the gate's refusal is the reason.
    let deadline = Instant::now() + Duration::from_secs(30);
    while inspected(&f)["lastError"].is_null() {
        assert!(Instant::now() < deadline, "no last error: {}", inspected(&f));
        std::thread::sleep(Duration::from_millis(100));
    }
    let seen = inspected(&f);
    assert_eq!(seen["lastError"]["code"], "page_refused", "{seen}");
    assert_eq!(seen["transports"], json!([]), "{seen}");
    assert!(!seen.to_string().contains(local.rsplit('/').next().unwrap()));
}
