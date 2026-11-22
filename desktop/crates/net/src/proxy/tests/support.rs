//! Stand-ins for the daemon and the page, and the helpers the tests share.

use std::future::Future;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use tokio::io::AsyncWriteExt as _;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Error as WsError;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::{WebSocketStream, accept_async_with_config, client_async_with_config};

use crate::proxy::{LocalUrl, Proxies};
use crate::stream::Stream;
use crate::testing::Rng;
use crate::{Limits, Socket, dial};

/// What the page's origin is on Linux and macOS.
pub const ORIGIN: &str = "tauri://localhost";

/// The page's socket, and the daemon stand-in's.
pub type Client = WebSocketStream<TcpStream>;
pub type Server = WebSocketStream<TcpStream>;

/// Long enough for a slow machine, short enough for a failed test to end.
pub const PATIENCE: Duration = Duration::from_secs(20);

/// A message size limit large enough that a test is never stopped by it (except where it means to).
fn unlimited() -> WebSocketConfig {
    WebSocketConfig::default().max_message_size(None).max_frame_size(None)
}

/// What a daemon stand-in saw, in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Seen {
    Data(usize),
    Ping,
    Pong,
    /// A close frame, with its code and reason.
    Close(Option<(u16, String)>),
    /// The socket ended (after whatever was seen before).
    End,
}

pub fn close_of(frame: Option<CloseFrame>) -> Seen {
    Seen::Close(frame.map(|f| (u16::from(f.code), f.reason.to_string())))
}

/// A daemon stand-in: accepts connections for as long as the test runs and runs `handler(n, socket)`
/// for the n-th (from 0). Returns its port.
pub async fn daemon<F, Fut>(handler: F) -> u16
where
    F: Fn(usize, Server) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let handler = Arc::new(handler);
    tokio::spawn(async move {
        for n in 0.. {
            let Ok((tcp, _)) = listener.accept().await else { return };
            let handler = handler.clone();
            tokio::spawn(async move {
                if let Ok(socket) = accept_async_with_config(tcp, Some(unlimited())).await {
                    handler(n, socket).await;
                }
            });
        }
    });
    port
}

/// A daemon that echoes what it is sent and reports what it saw on the channel.
pub async fn echo_daemon() -> (u16, mpsc::UnboundedReceiver<Seen>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let port = daemon(move |_, socket| echo(socket, tx.clone())).await;
    (port, rx)
}

/// Echoes every message, reports pings, pongs and close frames.
pub async fn echo(mut socket: Server, seen: mpsc::UnboundedSender<Seen>) {
    while let Some(item) = socket.next().await {
        match item {
            Ok(message @ (Message::Text(_) | Message::Binary(_))) => {
                let _ = seen.send(Seen::Data(message.len()));
                if socket.send(message).await.is_err() {
                    break;
                }
            }
            Ok(Message::Ping(_)) => {
                let _ = seen.send(Seen::Ping);
            }
            Ok(Message::Pong(_)) => {
                let _ = seen.send(Seen::Pong);
            }
            Ok(Message::Close(frame)) => {
                let _ = seen.send(close_of(frame));
            }
            Ok(Message::Frame(_)) => {}
            Err(_) => break,
        }
    }
    let _ = seen.send(Seen::End);
}

/// A daemon that keeps each connection open and reports how it ended: the close frame it got, or
/// nothing. It reads, so a close handshake completes.
pub async fn quiet_daemon() -> (u16, mpsc::UnboundedReceiver<(usize, Seen)>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let port = daemon(move |n, mut socket| {
        let tx = tx.clone();
        async move {
            loop {
                match socket.next().await {
                    Some(Ok(Message::Close(frame))) => {
                        let _ = tx.send((n, close_of(frame)));
                    }
                    Some(Ok(_)) => {}
                    Some(Err(_)) | None => {
                        let _ = tx.send((n, Seen::End));
                        return;
                    }
                }
            }
        }
    })
    .await;
    (port, rx)
}

/// The next thing the stand-in saw, within [`PATIENCE`].
pub async fn next_seen<T>(seen: &mut mpsc::UnboundedReceiver<T>) -> T {
    tokio::time::timeout(PATIENCE, seen.recv()).await.expect("the daemon stand-in saw nothing").expect("the daemon stand-in is gone")
}

/// What the app would do: the proxies, with the lines they log.
pub struct Rig {
    pub proxies: Proxies,
    lines: Arc<Mutex<Vec<String>>>,
}

impl Rig {
    pub fn new() -> Self {
        Self::with(Limits::default())
    }

    pub fn with(limits: Limits) -> Self {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = lines.clone();
        let proxies = Proxies::with_limits(limits, move |line| sink.lock().unwrap_or_else(PoisonError::into_inner).push(line.to_owned()));
        Self { proxies, lines }
    }

    /// Every line logged so far.
    pub fn log(&self) -> Vec<String> {
        self.lines.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// Reserves a place, dials the daemon with the real dial and opens the page's leg.
    pub async fn open(&self, id: &str, port: u16) -> LocalUrl {
        let reservation = self.proxies.reserve(id).unwrap();
        reservation.open(dial_for(port).await, ORIGIN).await.unwrap()
    }

    /// The same, with a daemon socket whose message limit is `cap` (to match lowered limits).
    pub async fn open_capped(&self, id: &str, port: u16, cap: usize) -> LocalUrl {
        let reservation = self.proxies.reserve(id).unwrap();
        reservation.open(upstream(port, cap).await, ORIGIN).await.unwrap()
    }

    /// Waits until the snapshot has no connection.
    pub async fn empty(&self) {
        eventually(|| self.proxies.snapshot().connections.is_empty()).await;
    }
}

/// A daemon socket from the real dial.
pub async fn dial_for(port: u16) -> Socket {
    dial(&format!("ws://127.0.0.1:{port}"), None, PATIENCE).await.unwrap()
}

/// A daemon socket with message limit `cap`.
pub async fn upstream(port: u16, cap: usize) -> Socket {
    let tcp = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let request = format!("ws://127.0.0.1:{port}/").into_client_request().unwrap();
    let config = WebSocketConfig::default().max_message_size(Some(cap)).max_frame_size(Some(cap));
    client_async_with_config(request, Stream::Plain(tcp), Some(config)).await.unwrap().0
}

/// Polls `condition` until it holds, within [`PATIENCE`].
pub async fn eventually(mut condition: impl FnMut() -> bool) {
    let deadline = tokio::time::Instant::now() + PATIENCE;
    while !condition() {
        assert!(tokio::time::Instant::now() < deadline, "the condition did not hold in time");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// The port and the token of a local URL.
pub fn parts(url: &LocalUrl) -> (u16, String) {
    let rest = url.expose().strip_prefix("ws://127.0.0.1:").expect("a loopback URL");
    let (port, token) = rest.split_once('/').expect("a path");
    (port.parse().expect("a port"), token.to_owned())
}

/// The page's upgrade as a browser would send it: connects to `port` and asks for `path` as host
/// `authority` with `origin`.
pub async fn page_request(port: u16, authority: &str, path: &str, origin: Option<&str>) -> Result<Client, WsError> {
    let tcp = TcpStream::connect(("127.0.0.1", port)).await?;
    let mut request = format!("ws://{authority}{path}").into_client_request()?;
    if let Some(origin) = origin {
        request.headers_mut().insert("Origin", HeaderValue::from_str(origin).unwrap());
    }
    client_async_with_config(request, tcp, Some(unlimited())).await.map(|(socket, _)| socket)
}

/// The page, connecting properly.
pub async fn page(url: &LocalUrl) -> Client {
    let (port, token) = parts(url);
    page_request(port, &format!("127.0.0.1:{port}"), &format!("/{token}"), Some(ORIGIN)).await.unwrap()
}

/// The status of a refused upgrade.
pub fn status_of(error: &WsError) -> Option<u16> {
    match error {
        WsError::Http(response) => Some(response.status().as_u16()),
        _ => None,
    }
}

/// A 64-bit FNV-1a over a message stream: kind, length and bytes of each message.
#[derive(Default)]
pub struct Digest(u64);

impl Digest {
    pub fn new() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }

    fn byte(&mut self, byte: u8) {
        self.0 = (self.0 ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
    }

    pub fn add(&mut self, message: &Message) {
        let (kind, bytes): (u8, &[u8]) = match message {
            Message::Text(text) => (1, text.as_bytes()),
            Message::Binary(bytes) => (2, bytes),
            _ => (0, &[]),
        };
        self.byte(kind);
        bytes.len().to_le_bytes().into_iter().for_each(|b| self.byte(b));
        bytes.iter().for_each(|b| self.byte(*b));
    }

    pub fn value(&self) -> u64 {
        self.0
    }
}

/// A reproducible stream of mixed messages: text and binary, empty to a hundred kilobytes, mostly small.
pub struct Mix(Rng);

impl Mix {
    pub fn new(seed: u64) -> Self {
        Self(Rng::new(seed))
    }

    pub fn next(&mut self) -> Message {
        let size = match self.0.below(500) {
            0 => 20_000 + self.0.below(80_000),
            1..=50 => 1_000 + self.0.below(4_000),
            _ => self.0.below(400),
        };
        if self.0.below(2) == 0 { Message::text(self.0.text(size)) } else { Message::binary(self.0.bytes(size)) }
    }
}

/// Writes `bytes` to the socket under the WebSocket library's feet: a frame it did not make.
pub async fn write_raw(socket: &mut WebSocketStream<TcpStream>, bytes: &[u8]) {
    let tcp = socket.get_mut();
    tcp.write_all(bytes).await.unwrap();
    tcp.flush().await.unwrap();
}

/// A single-frame text message with the given payload, masked as a client must.
pub fn raw_masked_text(payload: &[u8]) -> Vec<u8> {
    let key = [0x11, 0x22, 0x33, 0x44];
    let mut frame = vec![0x81, 0x80 | u8::try_from(payload.len()).unwrap()];
    frame.extend(key);
    frame.extend(payload.iter().enumerate().map(|(i, b)| b ^ key[i % 4]));
    frame
}

/// A single-frame text message with the given payload, unmasked as a server sends it.
pub fn raw_unmasked_text(payload: &[u8]) -> Vec<u8> {
    let mut frame = vec![0x81, u8::try_from(payload.len()).unwrap()];
    frame.extend(payload);
    frame
}

/// Makes closing `tcp` send a reset instead of an orderly end.
pub fn reset_on_close(tcp: &TcpStream) {
    socket2::SockRef::from(tcp).set_linger(Some(Duration::ZERO)).unwrap();
}
