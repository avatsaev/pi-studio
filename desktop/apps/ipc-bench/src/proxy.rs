//! The fourth transport, `proxy-ws`: a loopback WebSocket proxy owned by Rust. Rust holds the real socket to
//! the benchmark's server (where a shipped app would hold TLS, certificates, later an SSH or relay leg), and
//! the bytes reach the page over the webview's own `WebSocket` to `ws://127.0.0.1:<port>/<token>` instead of
//! over Tauri IPC. The page side is the plain websocket transport pointed at the answered URL.
//!
//! | Command | Meaning |
//! |---|---|
//! | `proxy_open(url)` | dial the server, bind `127.0.0.1:0`, mint a token, answer `{ url, id }` |
//! | `proxy_stats(id)` | the counters of one connection (kept after it ends) |
//!
//! **One listener per connection**, bound by `proxy_open` and gone as soon as the page's upgrade has been
//! accepted or after [`TOKEN_TTL`] (10 s): a port that exists for the few milliseconds between the command and
//! the page's connect, not an app-long one, and a token has nothing to select that the port does not. The cost
//! is a bind per connection (microseconds). The upgrade is accepted only when its path is the token (a random
//! 256 bits, compared in constant time, used once: a wrong guess does not use it up) and its `Origin` is the
//! page's own origin, read from the calling webview (`tauri://localhost` on Linux and macOS,
//! `http://tauri.localhost` on Windows); anything else gets a 403.
//!
//! **Pumping**: one task per direction, text and binary kept as they are, pings and pongs passed on, a close
//! frame (code and reason) forwarded to the other side, then the other side's answer is waited for. A side that
//! ends without a close frame (a reset, an error) ends the other side the same way (the socket is dropped, so the
//! page sees code 1006). Backpressure is the await: a direction reads the next frames only while the write of
//! the previous ones is not pending, so a page that does not read stalls the server through TCP, and what Rust
//! holds is a write batch ([`FLUSH_BYTES`] or [`FLUSH_FRAMES`]) and a frame, whatever the flood.
//!
//! The socket is plain and local: this is a measuring instrument, not the shipped proxy.

use std::collections::VecDeque;
use std::pin::pin;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering::Relaxed, Ordering::SeqCst};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{FutureExt as _, Sink, SinkExt as _, Stream, StreamExt as _};
use serde::Serialize;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::Error as WsError;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;

use crate::bridge::{BridgeError, CONNECT_TIMEOUT, Ws, check_bench_url, dial, err, lock};
use crate::server::Fed;

/// The errors the page sees are the bridge's.
pub type ProxyError = BridgeError;

/// A token works for this long after `proxy_open`.
pub const TOKEN_TTL: Duration = Duration::from_secs(10);
/// A page that has connected has this long to finish the upgrade.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(2);
/// Upgrades in progress at once; more are dropped unanswered.
const MAX_HANDSHAKES: usize = 16;
/// Proxied connections open at once.
const MAX_OPEN: usize = 8;
/// How many connections keep their counters.
const KEPT: usize = 64;
/// A direction flushes after this many payload bytes or frames, even when more are ready.
const FLUSH_BYTES: usize = 256 * 1024;
const FLUSH_FRAMES: usize = 64;
/// A write that takes longer than this is a stall: the other side is not reading.
const STALL_AFTER: Duration = Duration::from_millis(250);
/// After one side has closed, the other has this long to finish its close handshake.
const CLOSE_GRACE: Duration = Duration::from_secs(5);
const TOKEN_BYTES: usize = 32;
const REFUSALS_KEPT: usize = 4;

// ------------------------------------------------------------------------------------ the gate

/// Who may upgrade: the one token, the page's origin, once.
struct Gate {
    token: String,
    origin: String,
    used: AtomicBool,
}

/// The same bytes, compared without stopping at the first difference.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let difference = a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y));
    std::hint::black_box(difference) == 0
}

fn forbidden() -> ErrorResponse {
    let mut refused = ErrorResponse::new(Some("forbidden".to_string()));
    *refused.status_mut() = StatusCode::FORBIDDEN;
    refused
}

impl Gate {
    /// `Ok` when the request is the page's: its path is the token and its `Origin` the page's. Both are checked
    /// before either decides; the token is used up only by a request that passes both. The refusal is a bare 403
    /// (it says nothing about which check failed); `why` is for the log and the counters.
    #[allow(clippy::result_large_err)]
    fn check(&self, req: &Request) -> Result<(), (ErrorResponse, String)> {
        let origin = req.headers().get("origin").and_then(|v| v.to_str().ok());
        let token_ok = req.uri().path().strip_prefix('/').is_some_and(|t| constant_time_eq(t.as_bytes(), self.token.as_bytes()));
        let origin_ok = origin == Some(self.origin.as_str());
        if token_ok && origin_ok {
            if self.used.swap(true, SeqCst) {
                return Err((forbidden(), "the token was used already".into()));
            }
            return Ok(());
        }
        let why = match (token_ok, origin_ok) {
            (false, false) => "wrong token and origin",
            (false, true) => "wrong token",
            _ => "wrong origin",
        };
        Err((forbidden(), format!("{why} (origin {origin:?}, expected {:?})", self.origin)))
    }
}

/// A random token: 256 bits as 64 hexadecimal digits.
fn mint_token() -> Result<String, ProxyError> {
    let mut bytes = [0u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes).map_err(|e| err("no_randomness", format!("the system gave no random bytes: {e}")))?;
    Ok(hex(&bytes))
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(char::from(DIGITS[usize::from(byte >> 4)]));
        out.push(char::from(DIGITS[usize::from(byte & 15)]));
    }
    out
}

/// The origin a page of `url` sends: scheme, host and port, as the webview writes them.
pub(crate) fn origin_of(url: &tauri::Url) -> Result<String, ProxyError> {
    let host = url.host_str().ok_or_else(|| err("no_origin", format!("the page's address has no host: {url}")))?;
    let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
    Ok(format!("{}://{host}{port}", url.scheme()))
}

// ------------------------------------------------------------------------------------ counters

#[derive(Clone, Copy)]
enum Dir {
    ToPage,
    ToServer,
}

/// What one direction counted.
#[derive(Default)]
struct DirCounters {
    frames: AtomicU64,
    bytes: AtomicU64,
    /// Payload bytes read from one side and not yet written to the other, now and at most.
    held: AtomicU64,
    max_held: AtomicU64,
    /// Writes that took longer than [`STALL_AFTER`].
    stalls: AtomicU64,
}

/// How a connection ended.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct End {
    /// `page`, `server` (that side closed or ended first), or `expired` (no page connected in time).
    pub by: &'static str,
    /// Whether it ended with a close handshake (as against a reset or an error).
    pub graceful: bool,
    pub code: Option<u16>,
    pub reason: Option<String>,
}

struct ProxyConn {
    to_page: DirCounters,
    to_server: DirCounters,
    max_write_ms: AtomicU64,
    /// The server's flood bytes at the start, and when the first write to the page stalled.
    fed: Fed,
    fed_at_open: u64,
    stalled_fed: Mutex<Option<u64>>,
    refusals: AtomicU64,
    refused: Mutex<Vec<String>>,
    expected_origin: String,
    ended: Mutex<Option<End>>,
}

impl ProxyConn {
    fn new(fed: Fed, expected_origin: String) -> Self {
        let fed_at_open = fed.load(Relaxed);
        Self {
            to_page: DirCounters::default(),
            to_server: DirCounters::default(),
            max_write_ms: AtomicU64::new(0),
            fed,
            fed_at_open,
            stalled_fed: Mutex::new(None),
            refusals: AtomicU64::new(0),
            refused: Mutex::new(Vec::new()),
            expected_origin,
            ended: Mutex::new(None),
        }
    }

    fn dir(&self, dir: Dir) -> &DirCounters {
        match dir {
            Dir::ToPage => &self.to_page,
            Dir::ToServer => &self.to_server,
        }
    }

    fn hold(&self, dir: Dir, bytes: u64) {
        let d = self.dir(dir);
        let now = d.held.fetch_add(bytes, Relaxed) + bytes;
        d.max_held.fetch_max(now, Relaxed);
    }

    fn release(&self, dir: Dir, frames: u64, bytes: u64) {
        let d = self.dir(dir);
        d.held.fetch_sub(bytes, Relaxed);
        d.frames.fetch_add(frames, Relaxed);
        d.bytes.fetch_add(bytes, Relaxed);
    }

    fn note_stall(&self, dir: Dir) {
        self.dir(dir).stalls.fetch_add(1, Relaxed);
        if matches!(dir, Dir::ToPage) {
            let mut first = lock(&self.stalled_fed);
            if first.is_none() {
                *first = Some(self.fed.load(Relaxed).saturating_sub(self.fed_at_open));
            }
        }
    }

    fn refuse(&self, why: String) {
        self.refusals.fetch_add(1, Relaxed);
        let mut refused = lock(&self.refused);
        if refused.len() < REFUSALS_KEPT {
            refused.push(why);
        }
    }

    fn end(&self, end: End) {
        let mut ended = lock(&self.ended);
        if ended.is_none() {
            *ended = Some(end);
        }
    }

    fn stats(&self) -> ProxyStats {
        let (page, server) = (&self.to_page, &self.to_server);
        ProxyStats {
            frames_to_page: page.frames.load(Relaxed),
            bytes_to_page: page.bytes.load(Relaxed),
            frames_to_server: server.frames.load(Relaxed),
            bytes_to_server: server.bytes.load(Relaxed),
            outstanding: page.held.load(Relaxed),
            max_outstanding: page.max_held.load(Relaxed),
            max_held_to_server: server.max_held.load(Relaxed),
            stalls: page.stalls.load(Relaxed),
            stalls_to_server: server.stalls.load(Relaxed),
            max_write_ms: self.max_write_ms.load(Relaxed),
            stalled_at_server_fed_bytes: *lock(&self.stalled_fed),
            server_fed_bytes: self.fed.load(Relaxed).saturating_sub(self.fed_at_open),
            refusals: self.refusals.load(Relaxed),
            refused: lock(&self.refused).clone(),
            expected_origin: self.expected_origin.clone(),
            ended: lock(&self.ended).clone(),
        }
    }
}

/// The counters of one connection, as the page reads them.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStats {
    pub frames_to_page: u64,
    pub bytes_to_page: u64,
    pub frames_to_server: u64,
    pub bytes_to_server: u64,
    /// Payload bytes Rust holds on the way to the page now: read from the server, not yet written to the page.
    pub outstanding: u64,
    /// The most it ever held there (named as the bridge candidates' window peak, so rows B7 and B8 read it alike).
    pub max_outstanding: u64,
    /// The same on the way to the server.
    pub max_held_to_server: u64,
    /// Writes to the page that took over 250 ms: the page's socket was not being read.
    pub stalls: u64,
    pub stalls_to_server: u64,
    /// The longest a single write to the page took, in milliseconds.
    pub max_write_ms: u64,
    /// How many bytes the server had handed to its socket when the first write to the page stalled
    /// (what the kernel and the webview absorbed before the page's silence reached the server); `None`: no stall.
    pub stalled_at_server_fed_bytes: Option<u64>,
    /// Flood bytes the server has handed to a socket since this connection opened (all connections).
    pub server_fed_bytes: u64,
    /// Upgrades refused (wrong token, wrong origin, a used token).
    pub refusals: u64,
    pub refused: Vec<String>,
    /// The origin the proxy accepts.
    pub expected_origin: String,
    pub ended: Option<End>,
}

/// What `proxy_open` answers.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyOpened {
    /// `ws://127.0.0.1:<port>/<token>`: the page opens a plain `WebSocket` to it.
    pub url: String,
    /// For `proxy_stats`.
    pub id: String,
}

// ------------------------------------------------------------------------------------ pumping

/// What one read of a side turned into.
enum Step {
    Data(Message),
    Close(Option<CloseFrame>),
    Skip,
    Gone,
}

fn classify(item: Option<Result<Message, WsError>>) -> Step {
    match item {
        Some(Ok(m @ (Message::Text(_) | Message::Binary(_) | Message::Ping(_) | Message::Pong(_)))) => Step::Data(m),
        Some(Ok(Message::Close(frame))) => Step::Close(frame),
        Some(Ok(Message::Frame(_))) => Step::Skip,
        Some(Err(_)) | None => Step::Gone,
    }
}

/// The payload that counts: text and binary (a ping carries no data of the page's or the server's).
fn payload_len(message: &Message) -> u64 {
    match message {
        Message::Text(t) => t.len() as u64,
        Message::Binary(b) => b.len() as u64,
        _ => 0,
    }
}

/// How a pump ended.
struct Outcome {
    /// The side closed with a close frame, which was forwarded.
    graceful: bool,
}

/// Runs `op` (a write), noting a stall when it takes over [`STALL_AFTER`], and the longest write.
async fn timed<F: Future>(conn: &ProxyConn, dir: Dir, op: F) -> F::Output {
    let start = Instant::now();
    let mut op = pin!(op);
    let out = match tokio::time::timeout(STALL_AFTER, op.as_mut()).await {
        Ok(out) => out,
        Err(_) => {
            conn.note_stall(dir);
            op.await
        }
    };
    conn.max_write_ms.fetch_max(u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX), Relaxed);
    out
}

/// The frames of one write batch: they are held until the flush that ends it.
#[derive(Default)]
struct Batch {
    frames: u64,
    bytes: u64,
}

impl Batch {
    fn full(&self) -> bool {
        self.bytes >= FLUSH_BYTES as u64 || self.frames >= FLUSH_FRAMES as u64
    }
}

/// Flushes `to` and lets go of the batch. `false` when the write failed.
async fn flush<K>(to: &mut K, conn: &ProxyConn, dir: Dir, batch: &mut Batch) -> bool
where
    K: Sink<Message, Error = WsError> + Unpin,
{
    let flushed = timed(conn, dir, to.flush()).await.is_ok();
    conn.release(dir, std::mem::take(&mut batch.frames), std::mem::take(&mut batch.bytes));
    flushed
}

/// Forwards one side's close frame, then reads that side to its end so that the library answers it. The first
/// close frame of a connection is what it ended with: who sent it, its code and reason.
async fn pass_close<S, K>(from: &mut S, to: &mut K, frame: Option<CloseFrame>, conn: &ProxyConn, dir: Dir) -> Outcome
where
    S: Stream<Item = Result<Message, WsError>> + Unpin,
    K: Sink<Message, Error = WsError> + Unpin,
{
    let by = match dir {
        Dir::ToPage => "server",
        Dir::ToServer => "page",
    };
    let (code, reason) = match &frame {
        Some(f) => (Some(u16::from(f.code)), Some(f.reason.to_string())),
        None => (None, None),
    };
    conn.end(End { by, graceful: true, code, reason });
    let _ = to.send(Message::Close(frame)).await;
    let _ = tokio::time::timeout(CLOSE_GRACE, async { while let Some(Ok(_)) = from.next().await {} }).await;
    Outcome { graceful: true }
}

/// One direction: frames from `from` to `to`, in order, as they are.
async fn pump<S, K>(mut from: S, mut to: K, dir: Dir, conn: Arc<ProxyConn>) -> Outcome
where
    S: Stream<Item = Result<Message, WsError>> + Unpin,
    K: Sink<Message, Error = WsError> + Unpin,
{
    let broken = Outcome { graceful: false };
    loop {
        let mut batch = Batch::default();
        let mut step = classify(from.next().await);
        loop {
            match step {
                Step::Data(message) => {
                    let len = payload_len(&message);
                    conn.hold(dir, len);
                    batch.frames += 1;
                    batch.bytes += len;
                    if timed(&conn, dir, to.feed(message)).await.is_err() {
                        return broken;
                    }
                    if batch.full() {
                        break;
                    }
                }
                Step::Skip => {}
                Step::Close(frame) => {
                    flush(&mut to, &conn, dir, &mut batch).await;
                    return pass_close(&mut from, &mut to, frame, &conn, dir).await;
                }
                Step::Gone => {
                    flush(&mut to, &conn, dir, &mut batch).await;
                    return broken;
                }
            }
            // What has already arrived goes into the same write; nothing is waited for.
            match from.next().now_or_never() {
                Some(item) => step = classify(item),
                None => break,
            }
        }
        if !flush(&mut to, &conn, dir, &mut batch).await {
            return broken;
        }
    }
}

/// Both directions, until either ends; the other is given [`CLOSE_GRACE`] after a close handshake, and none after
/// a reset or an error (it is dropped: the socket ends without a close frame, as the first did).
async fn run(page: Ws, upstream: Ws, conn: Arc<ProxyConn>) {
    let (page_sink, page_stream) = page.split();
    let (server_sink, server_stream) = upstream.split();
    let mut to_server = tokio::spawn(pump(page_stream, server_sink, Dir::ToServer, conn.clone()));
    let mut to_page = tokio::spawn(pump(server_stream, page_sink, Dir::ToPage, conn.clone()));
    let (by, first, other) = tokio::select! {
        r = &mut to_server => ("page", r, &mut to_page),
        r = &mut to_page => ("server", r, &mut to_server),
    };
    let graceful = first.map(|outcome| outcome.graceful).unwrap_or(false);
    if graceful {
        if tokio::time::timeout(CLOSE_GRACE, &mut *other).await.is_err() {
            other.abort();
        }
    } else {
        other.abort();
    }
    // A close handshake recorded who closed first; otherwise whichever side ended first, without one.
    conn.end(End { by, graceful: false, code: None, reason: None });
}

// ------------------------------------------------------------------------------------ accepting

/// One upgrade attempt: the page's, if it passes the gate.
// The handshake callback's refusal is tungstenite's `ErrorResponse`, a whole HTTP response: its type, not ours.
#[allow(clippy::result_large_err)]
async fn handshake(tcp: TcpStream, gate: Arc<Gate>, tx: mpsc::Sender<Ws>, conn: Arc<ProxyConn>, active: Arc<AtomicUsize>) {
    let _ = tcp.set_nodelay(true);
    let refusal = Mutex::new(None::<String>);
    let callback = |req: &Request, response: Response| -> Result<Response, ErrorResponse> {
        gate.check(req).map(|()| response).map_err(|(refused, why)| {
            *lock(&refusal) = Some(why);
            refused
        })
    };
    match tokio::time::timeout(HANDSHAKE_TIMEOUT, accept_hdr_async(tcp, callback)).await {
        Ok(Ok(ws)) => {
            let _ = tx.send(ws).await;
        }
        other => {
            let why = lock(&refusal).take().unwrap_or_else(|| match other {
                Ok(_) => "the upgrade failed".to_string(),
                Err(_) => format!("the upgrade took more than {} s", HANDSHAKE_TIMEOUT.as_secs()),
            });
            eprintln!("ipc-bench: proxy refused a connection: {why}");
            conn.refuse(why);
        }
    }
    active.fetch_sub(1, Relaxed);
}

/// Waits for the page's upgrade until `ttl` has passed. The listener is dropped on return: the token is
/// used up (or expired) and the port is gone.
async fn accept_page(listener: TcpListener, gate: Arc<Gate>, conn: &Arc<ProxyConn>, ttl: Duration) -> Option<Ws> {
    let (tx, mut rx) = mpsc::channel::<Ws>(1);
    let active = Arc::new(AtomicUsize::new(0));
    let deadline = tokio::time::Instant::now() + ttl;
    loop {
        tokio::select! {
            () = tokio::time::sleep_until(deadline) => return None,
            Some(ws) = rx.recv() => return Some(ws),
            accepted = listener.accept() => match accepted {
                Ok((tcp, _)) if active.load(Relaxed) < MAX_HANDSHAKES => {
                    active.fetch_add(1, Relaxed);
                    tokio::spawn(handshake(tcp, gate.clone(), tx.clone(), conn.clone(), active.clone()));
                }
                Ok(_) => {}
                Err(_) => tokio::time::sleep(Duration::from_millis(10)).await,
            },
        }
    }
}

// ------------------------------------------------------------------------------------ the proxy

/// The connections that keep their counters, oldest first.
type Kept = Arc<Mutex<VecDeque<(String, Arc<ProxyConn>)>>>;

/// The proxied connections of this run. Managed by Tauri.
pub struct Proxy {
    server_port: u16,
    fed: Fed,
    ttl: Duration,
    open: Arc<AtomicUsize>,
    kept: Kept,
}

/// Counts a connection as open until its task is over.
struct OpenGuard(Arc<AtomicUsize>);

impl Drop for OpenGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Relaxed);
    }
}

impl Proxy {
    /// A proxy that dials only the benchmark's server on `127.0.0.1:server_port`.
    pub fn new(server_port: u16, fed: Fed) -> Self {
        Self::with_ttl(server_port, fed, TOKEN_TTL)
    }

    /// The same with another token lifetime (the tests wait for it to pass).
    pub fn with_ttl(server_port: u16, fed: Fed, ttl: Duration) -> Self {
        Self { server_port, fed, ttl, open: Arc::default(), kept: Arc::default() }
    }

    /// Dials `url` (the server), binds a port, mints a token and waits in the background for the page, whose
    /// `Origin` must be `origin`.
    pub async fn open(&self, url: &str, origin: &str) -> Result<ProxyOpened, ProxyError> {
        check_bench_url(self.server_port, url)?;
        if self.open.load(Relaxed) >= MAX_OPEN {
            return Err(err("limit", format!("{MAX_OPEN} proxied sockets are open")));
        }
        let upstream = tokio::time::timeout(CONNECT_TIMEOUT, dial(self.server_port, url))
            .await
            .map_err(|_| err("connect_timeout", "the connection took more than 15 s"))??;
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|e| err("bind_failed", format!("cannot bind 127.0.0.1: {e}")))?;
        let port = listener.local_addr().map_err(|e| err("bind_failed", format!("no local address: {e}")))?.port();
        let token = mint_token()?;
        let mut id_bytes = [0u8; 8];
        getrandom::fill(&mut id_bytes).map_err(|e| err("no_randomness", format!("the system gave no random bytes: {e}")))?;
        let id = hex(&id_bytes);
        let conn = Arc::new(ProxyConn::new(self.fed.clone(), origin.to_string()));
        {
            let mut kept = lock(&self.kept);
            kept.push_back((id.clone(), conn.clone()));
            if kept.len() > KEPT {
                kept.pop_front();
            }
        }
        self.open.fetch_add(1, Relaxed);
        let guard = OpenGuard(self.open.clone());
        let gate = Arc::new(Gate { token: token.clone(), origin: origin.to_string(), used: AtomicBool::new(false) });
        let ttl = self.ttl;
        tokio::spawn(async move {
            let _guard = guard;
            match accept_page(listener, gate, &conn, ttl).await {
                Some(page) => run(page, upstream, conn).await,
                None => conn.end(End { by: "expired", graceful: false, code: None, reason: Some("no page connected with the token in time".into()) }),
            }
        });
        Ok(ProxyOpened { url: format!("ws://127.0.0.1:{port}/{token}"), id })
    }

    /// The counters of connection `id`.
    pub fn stats(&self, id: &str) -> Result<ProxyStats, ProxyError> {
        lock(&self.kept).iter().find(|(k, _)| k == id).map(|(_, conn)| conn.stats()).ok_or_else(|| err("unknown_id", "no such proxied connection"))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::Ordering::Relaxed;

    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::http::HeaderValue;
    use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

    use super::*;
    use crate::frame::StreamCheck;
    use crate::server::{self, Switches};

    const ORIGIN: &str = "tauri://localhost";
    type Client = WebSocketStream<MaybeTlsStream<TcpStream>>;

    struct Harness {
        proxy: Proxy,
        port: u16,
    }

    async fn harness_with(ttl: Duration) -> Harness {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let fed = Fed::default();
        tokio::spawn(server::serve(listener, Switches::default(), fed.clone()));
        Harness { proxy: Proxy::with_ttl(port, fed, ttl), port }
    }

    async fn harness() -> Harness {
        harness_with(TOKEN_TTL).await
    }

    impl Harness {
        async fn open(&self, path: &str) -> ProxyOpened {
            self.proxy.open(&format!("ws://127.0.0.1:{}{path}", self.port), ORIGIN).await.unwrap()
        }
    }

    async fn connect(url: &str, origin: Option<&str>) -> Result<Client, WsError> {
        let mut request = url.into_client_request().unwrap();
        if let Some(origin) = origin {
            request.headers_mut().insert("Origin", HeaderValue::from_str(origin).unwrap());
        }
        connect_async(request).await.map(|(ws, _)| ws)
    }

    fn status_of(e: WsError) -> Option<u16> {
        match e {
            WsError::Http(response) => Some(response.status().as_u16()),
            _ => None,
        }
    }

    #[test]
    fn tokens_are_long_random_and_compared_whole() {
        let a = mint_token().unwrap();
        let b = mint_token().unwrap();
        assert_eq!((a.len(), b.len()), (64, 64));
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
        assert!(constant_time_eq(a.as_bytes(), a.as_bytes()));
        assert!(!constant_time_eq(a.as_bytes(), b.as_bytes()));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert_eq!(hex(&[0, 15, 16, 255]), "000f10ff");
    }

    #[test]
    fn the_origin_is_what_a_webview_sends() {
        for (page, origin) in [
            ("tauri://localhost/index.html", "tauri://localhost"),
            ("http://tauri.localhost/", "http://tauri.localhost"),
            ("http://localhost:1420/", "http://localhost:1420"),
        ] {
            assert_eq!(origin_of(&tauri::Url::parse(page).unwrap()).unwrap(), origin, "{page}");
        }
        assert_eq!(origin_of(&tauri::Url::parse("about:blank").unwrap()).unwrap_err().code, "no_origin");
    }

    #[tokio::test]
    async fn the_proxy_dials_only_the_benchmarks_server() {
        let h = harness().await;
        for bad in ["ws://127.0.0.1:1/echo", "ws://example.com/echo", ""] {
            assert_eq!(h.proxy.open(bad, ORIGIN).await.unwrap_err().code, "invalid_address", "{bad:?}");
        }
        assert_eq!(h.proxy.stats("nope").unwrap_err().code, "unknown_id");
    }

    #[tokio::test]
    async fn a_wrong_token_or_origin_is_refused_and_does_not_use_the_token_up() {
        let h = harness().await;
        let opened = h.open("/echo").await;
        let (base, token) = opened.url.rsplit_once('/').unwrap();
        let wrong = format!("{base}/{}", "0".repeat(64));
        assert_eq!(status_of(connect(&wrong, Some(ORIGIN)).await.unwrap_err()), Some(403), "wrong token");
        assert_eq!(status_of(connect(&format!("{base}/{}", &token[..63]), Some(ORIGIN)).await.unwrap_err()), Some(403), "a token one digit short");
        assert_eq!(status_of(connect(&opened.url, Some("http://evil.example")).await.unwrap_err()), Some(403), "wrong origin");
        assert_eq!(status_of(connect(&opened.url, Some("tauri://localhost.evil.example")).await.unwrap_err()), Some(403), "a longer origin");
        assert_eq!(status_of(connect(&opened.url, None).await.unwrap_err()), Some(403), "no origin");
        let stats = h.proxy.stats(&opened.id).unwrap();
        assert_eq!(stats.refusals, 5);
        assert!(stats.refused.iter().all(|why| !why.contains(token)), "the log never carries the token");
        // None of that used the token: the page's own upgrade still works.
        let mut ws = connect(&opened.url, Some(ORIGIN)).await.unwrap();
        ws.send(Message::text("hello")).await.unwrap();
        assert_eq!(ws.next().await.unwrap().unwrap(), Message::text("hello"));
    }

    #[tokio::test]
    async fn a_token_works_once() {
        let h = harness().await;
        let opened = h.open("/echo").await;
        let mut first = connect(&opened.url, Some(ORIGIN)).await.unwrap();
        // The listener is gone once the page is in (or, a moment before, refuses): the token cannot be used again.
        let again = connect(&opened.url, Some(ORIGIN)).await;
        assert!(again.is_err(), "a second use of the token");
        first.send(Message::text("still here")).await.unwrap();
        assert_eq!(first.next().await.unwrap().unwrap(), Message::text("still here"));
    }

    #[tokio::test]
    async fn a_token_expires() {
        let h = harness_with(Duration::from_millis(300)).await;
        let opened = h.open("/echo").await;
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert!(connect(&opened.url, Some(ORIGIN)).await.is_err(), "the token has expired and the port is closed");
        let stats = h.proxy.stats(&opened.id).unwrap();
        assert_eq!(stats.ended.map(|e| (e.by, e.graceful)), Some(("expired", false)));
        assert_eq!(h.proxy.open.load(Relaxed), 0, "the upstream socket and the slot are given back");
    }

    #[tokio::test]
    async fn text_and_binary_are_echoed_as_they_are() {
        let h = harness().await;
        let opened = h.open("/echo").await;
        let mut ws = connect(&opened.url, Some(ORIGIN)).await.unwrap();
        let binary: Vec<u8> = (0..=255u8).cycle().take(70_000).collect();
        for message in [Message::text("héllo ✓"), Message::binary(binary), Message::text(""), Message::binary(Vec::<u8>::new())] {
            ws.send(message.clone()).await.unwrap();
            assert_eq!(ws.next().await.unwrap().unwrap(), message);
        }
        let stats = h.proxy.stats(&opened.id).unwrap();
        assert_eq!((stats.frames_to_server, stats.frames_to_page), (4, 4));
        assert_eq!(stats.bytes_to_server, stats.bytes_to_page);
    }

    /// Reads a flood to its closing message, checking every frame: what a page does.
    async fn read_flood(ws: &mut Client) -> (StreamCheck, serde_json::Value) {
        let mut check = StreamCheck::default();
        loop {
            match ws.next().await.unwrap().unwrap() {
                Message::Binary(b) => check.accept_binary(&b),
                Message::Text(t) => match serde_json::from_str::<serde_json::Value>(t.as_str()) {
                    Ok(done) => return (check, done),
                    Err(_) => check.accept_text(t.as_str()),
                },
                other => panic!("unexpected {other:?}"),
            }
        }
    }

    #[tokio::test]
    async fn a_flood_arrives_whole_and_the_proxy_holds_only_a_few_frames() {
        let h = harness().await;
        for query in ["frames=3000&size=4096", "frames=5000&size=200&kind=text", "frames=40&size=262144"] {
            let opened = h.open(&format!("/flood?{query}")).await;
            let mut ws = connect(&opened.url, Some(ORIGIN)).await.unwrap();
            ws.send(Message::text("go")).await.unwrap();
            let (check, done) = read_flood(&mut ws).await;
            let report = check.report();
            assert_eq!(report.error_count, 0, "{query}");
            assert_eq!(done["hash"], report.hash.as_str(), "{query}");
            let stats = h.proxy.stats(&opened.id).unwrap();
            assert_eq!(stats.frames_to_page, report.frames + 1, "{query}");
            assert!(stats.max_outstanding <= (FLUSH_BYTES + 262_144) as u64, "{query}: held {} bytes", stats.max_outstanding);
        }
    }

    #[tokio::test]
    async fn a_page_that_does_not_read_stalls_the_server_and_nothing_piles_up_in_rust() {
        let h = harness().await;
        let frame = 64 * 1024;
        let frames = 96 * 1024 * 1024 / frame;
        let opened = h.open(&format!("/flood?frames={frames}&size={frame}")).await;
        let mut ws = connect(&opened.url, Some(ORIGIN)).await.unwrap();
        ws.send(Message::text("go")).await.unwrap();
        tokio::time::sleep(Duration::from_millis(1500)).await;
        let stalled = h.proxy.stats(&opened.id).unwrap();
        assert!(stalled.stalls >= 1, "a write to the page is pending");
        assert!(stalled.server_fed_bytes < (frames * frame) as u64, "the server stalled: {} of {} bytes sent", stalled.server_fed_bytes, frames * frame);
        assert!(stalled.max_outstanding <= (FLUSH_BYTES + frame) as u64, "held {} bytes", stalled.max_outstanding);
        assert!(stalled.stalled_at_server_fed_bytes.is_some());
        // The page reads again: the flood resumes and arrives whole.
        let (check, done) = read_flood(&mut ws).await;
        assert_eq!(check.report().error_count, 0);
        assert_eq!(done["hash"], check.report().hash.as_str());
    }

    #[tokio::test]
    async fn the_pages_close_code_and_reason_reach_the_server_and_the_answer_comes_back() {
        let h = harness().await;
        let opened = h.open("/echo").await;
        let mut ws = connect(&opened.url, Some(ORIGIN)).await.unwrap();
        ws.send(Message::text("one")).await.unwrap();
        assert_eq!(ws.next().await.unwrap().unwrap(), Message::text("one"));
        ws.send(Message::Close(Some(CloseFrame { code: 4001.into(), reason: "page bye".into() }))).await.unwrap();
        // The echo server answers a close with the frame it received: seeing it back means it got through.
        let answer = ws.next().await;
        match answer {
            Some(Ok(Message::Close(Some(frame)))) => assert_eq!((u16::from(frame.code), frame.reason.as_str()), (4001, "page bye")),
            other => panic!("expected the close frame back, got {other:?}"),
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
        let ended = h.proxy.stats(&opened.id).unwrap().ended.unwrap();
        assert_eq!((ended.by, ended.graceful, ended.code, ended.reason.as_deref()), ("page", true, Some(4001), Some("page bye")));
    }

    #[tokio::test]
    async fn the_servers_close_code_and_reason_reach_the_page() {
        let h = harness().await;
        let opened = h.open("/close?code=4002").await;
        let mut ws = connect(&opened.url, Some(ORIGIN)).await.unwrap();
        match ws.next().await {
            Some(Ok(Message::Close(Some(frame)))) => assert_eq!((u16::from(frame.code), frame.reason.as_str()), (4002, "the server closed")),
            other => panic!("expected the server's close frame, got {other:?}"),
        }
        // The page answers (the library does it as it reads): the server's side finishes, and the proxy says who closed.
        let _ = ws.next().await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        let ended = h.proxy.stats(&opened.id).unwrap().ended.unwrap();
        assert_eq!((ended.by, ended.graceful, ended.code), ("server", true, Some(4002)));
    }

    #[tokio::test]
    async fn a_server_that_resets_ends_the_page_without_a_close_frame() {
        // The server side vanishes: the page must see an abnormal end, not a clean close.
        let h = harness().await;
        let opened = h.open("/flood?frames=5&size=32").await;
        let mut ws = connect(&opened.url, Some(ORIGIN)).await.unwrap();
        // Never send `go`: the server's `/flood` fails the handshake with the page ("starts on the text go") and drops the socket.
        ws.send(Message::text("not go")).await.unwrap();
        let ended = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                match ws.next().await {
                    Some(Ok(Message::Close(_))) => return "a close frame",
                    Some(Ok(_)) => {}
                    Some(Err(_)) | None => return "an abnormal end",
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(ended, "an abnormal end");
    }
}
