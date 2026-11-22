//! A relay stand-in on loopback, for the tests of this crate and (with the `testing` feature) of the
//! crates that use it. It plays the relay and the daemon's half of the channel from a script of
//! [`Step`]s, so a test can make the relay pair, refuse, close, fall silent or send a hostile frame, and
//! can make the daemon accept or refuse the client's key, and watch what the client sent through
//! [`StandIn::seen`].
//!
//! Every connection runs the same script from its start. After the last step the stand-in keeps reading
//! and recording what the client sends until the client closes. Nothing here is for a shipped build:
//! the module is compiled only for tests and with the feature.

use std::collections::VecDeque;

use crypto_box::aead::Aead;
use crypto_box::{PublicKey, SalsaBox, SecretKey};
use futures_util::{SinkExt as _, StreamExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio::task::{JoinHandle, JoinSet};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::{WebSocketStream, accept_async};

use crate::channel::{
    CHANNEL_VERSION, CLIENT_TO_DAEMON, DAEMON_TO_CLIENT, HELLO_LENGTH, KEY_LENGTH, KIND_BINARY, KIND_READY, KIND_TEXT, Record, SALT_LENGTH, nonce,
};

/// The `connectionId` of `relay_paired`.
pub const CONNECTION_ID: &str = "0123456789abcdef0123456789abcdef";
/// The salt the daemon half chooses.
pub const SALT: [u8; SALT_LENGTH] = [7; SALT_LENGTH];

/// One thing the stand-in does on a connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// Read the client's first frame, which must be text; [`Seen::Connect`] carries it.
    ReadConnect,
    /// Send `relay_registered`.
    Registered,
    /// Send `relay_paired` with [`CONNECTION_ID`].
    Paired,
    /// Send a text frame as given.
    Text(String),
    /// Send a binary frame as given.
    Binary(Vec<u8>),
    /// Send a close frame with this code and reason, then read what the client sends until it ends.
    Close(u16, String),
    /// Send a close frame with no code, then read what the client sends until it ends.
    CloseEmpty,
    /// End the connection with no close frame.
    Drop,
    /// Read the client's `hello`, which must be binary; [`Seen::Hello`] carries its key.
    Hello,
    /// Send the daemon's `ready` (after a [`Step::Hello`]).
    Ready,
    /// Seal a record and send it (after a [`Step::Ready`]).
    Send(Record),
    /// Open every frame the client sends and seal it back as it is, until the client closes.
    Echo,
}

/// What the stand-in saw, in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Seen {
    /// The text of the client's first frame.
    Connect(String),
    /// The client's public key from its `hello`.
    Hello([u8; KEY_LENGTH]),
    /// A text frame after the steps that read.
    Text(String),
    /// A binary frame after the steps that read.
    Binary(Vec<u8>),
    /// A record the daemon half opened in [`Step::Echo`].
    Opened(Record),
    /// The client's close frame: its code and reason, or `None` for a socket that ended without one.
    Closed(Option<(u16, String)>),
    /// A step could not run; the connection ended.
    Failed(String),
}

/// The daemon's end of the channel: the mirror of [`crate::Channel`], with the daemon's key pair, the
/// salt it chose, and the directions' bytes swapped.
pub struct DaemonHalf {
    secret: SecretKey,
    cipher: Option<SalsaBox>,
    sent: u64,
    received: u64,
}

impl DaemonHalf {
    #[must_use]
    pub fn new(secret: [u8; KEY_LENGTH]) -> Self {
        Self { secret: SecretKey::from_bytes(secret), cipher: None, sent: 0, received: 0 }
    }

    /// The daemon's public key: what a pairing link carries.
    #[must_use]
    pub fn public(&self) -> [u8; KEY_LENGTH] {
        self.secret.public_key().to_bytes()
    }

    /// Takes the client's `hello` (`0x01` ‖ its public key) and derives the shared key; returns the client's key.
    ///
    /// # Errors
    /// A text describing what is wrong with the frame.
    pub fn accept_hello(&mut self, frame: &[u8]) -> Result<[u8; KEY_LENGTH], String> {
        let key = match frame.split_first() {
            Some((&CHANNEL_VERSION, key)) if frame.len() == HELLO_LENGTH => {
                <[u8; KEY_LENGTH]>::try_from(key).map_err(|_| "the hello is malformed".to_owned())?
            }
            _ => return Err("the hello is malformed".to_owned()),
        };
        self.cipher = Some(SalsaBox::new(&PublicKey::from_bytes(key), &self.secret));
        Ok(key)
    }

    /// The `ready` frame: `0x01` ‖ salt ‖ the box of a `ready` record.
    ///
    /// # Errors
    /// A text, when there is no `hello` yet.
    pub fn ready_frame(&mut self) -> Result<Vec<u8>, String> {
        let sealed = self.seal_plain(&[KIND_READY])?;
        Ok([&[CHANNEL_VERSION][..], &SALT[..], &sealed[..]].concat())
    }

    /// The box of a message record at the next daemon-to-client counter.
    ///
    /// # Errors
    /// A text, when there is no `hello` yet.
    pub fn seal(&mut self, record: &Record) -> Result<Vec<u8>, String> {
        let (kind, payload) = match record {
            Record::Text(text) => (KIND_TEXT, text.as_bytes()),
            Record::Binary(bytes) => (KIND_BINARY, bytes.as_slice()),
        };
        let plain = [&[kind][..], payload].concat();
        self.seal_plain(&plain)
    }

    fn seal_plain(&mut self, plain: &[u8]) -> Result<Vec<u8>, String> {
        let cipher = self.cipher.as_ref().ok_or("no hello yet")?;
        let sealed = cipher.encrypt(&nonce(&SALT, DAEMON_TO_CLIENT, self.sent), plain).map_err(|_| "sealing failed".to_owned())?;
        self.sent += 1;
        Ok(sealed)
    }

    /// Opens a box of the client's at the next client-to-daemon counter.
    ///
    /// # Errors
    /// A text, when there is no `hello` yet, the box does not open or its record is empty or of an unknown kind.
    pub fn open(&mut self, frame: &[u8]) -> Result<Record, String> {
        let cipher = self.cipher.as_ref().ok_or("no hello yet")?;
        let plain = cipher.decrypt(&nonce(&SALT, CLIENT_TO_DAEMON, self.received), frame).map_err(|_| "the box did not open".to_owned())?;
        self.received += 1;
        match plain.split_first() {
            Some((&KIND_TEXT, text)) => String::from_utf8(text.to_vec()).map(Record::Text).map_err(|_| "the text is not UTF-8".to_owned()),
            Some((&KIND_BINARY, bytes)) => Ok(Record::Binary(bytes.to_vec())),
            _ => Err("the record is empty or of an unknown kind".to_owned()),
        }
    }
}

/// A listening stand-in. Dropping it stops the listener and every connection.
pub struct StandIn {
    port: u16,
    daemon_public: [u8; KEY_LENGTH],
    seen: UnboundedReceiver<Seen>,
    task: JoinHandle<()>,
}

impl StandIn {
    /// Listens on `127.0.0.1` at a port of the system's choosing; every connection runs `script` with a
    /// daemon half of `daemon_secret`.
    ///
    /// # Errors
    /// The listener could not be bound.
    pub async fn start(daemon_secret: [u8; KEY_LENGTH], script: Vec<Step>) -> std::io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let (sender, seen) = unbounded_channel();
        let daemon_public = DaemonHalf::new(daemon_secret).public();
        let task = tokio::spawn(accept_loop(listener, daemon_secret, script, sender));
        Ok(Self { port, daemon_public, seen, task })
    }

    /// The relay's address: `ws://127.0.0.1:<port>`.
    #[must_use]
    pub fn url(&self) -> String {
        format!("ws://127.0.0.1:{}", self.port)
    }

    /// The daemon half's public key: what a pairing link for this stand-in carries.
    #[must_use]
    pub const fn daemon_public(&self) -> [u8; KEY_LENGTH] {
        self.daemon_public
    }

    /// The next thing seen, in order; `None` once the stand-in has stopped and all is read.
    pub async fn seen(&mut self) -> Option<Seen> {
        self.seen.recv().await
    }
}

impl Drop for StandIn {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn accept_loop(listener: TcpListener, secret: [u8; KEY_LENGTH], script: Vec<Step>, seen: UnboundedSender<Seen>) {
    // The set aborts every connection when this task is aborted.
    let mut connections = JoinSet::new();
    while let Ok((tcp, _)) = listener.accept().await {
        connections.spawn(serve(tcp, secret, script.clone(), seen.clone()));
    }
}

/// Whether the script goes on.
enum Flow {
    Continue,
    /// The client closed or the script ended the connection.
    Done,
}

type Socket = WebSocketStream<TcpStream>;

async fn serve(tcp: TcpStream, secret: [u8; KEY_LENGTH], script: Vec<Step>, seen: UnboundedSender<Seen>) {
    let Ok(mut socket) = accept_async(tcp).await else { return };
    let mut daemon = DaemonHalf::new(secret);
    let mut script = VecDeque::from(script);
    while let Some(step) = script.pop_front() {
        match run(&mut socket, &mut daemon, &seen, step).await {
            Ok(Flow::Continue) => {}
            Ok(Flow::Done) => return,
            Err(problem) => {
                let _ = seen.send(Seen::Failed(problem));
                return;
            }
        }
    }
    record_until_closed(&mut socket, &seen).await;
}

async fn run(socket: &mut Socket, daemon: &mut DaemonHalf, seen: &UnboundedSender<Seen>, step: Step) -> Result<Flow, String> {
    match step {
        Step::ReadConnect => {
            let Some(message) = read(socket, seen).await else { return Ok(Flow::Done) };
            let Message::Text(text) = message else { return Err("the first frame is not text".to_owned()) };
            let _ = seen.send(Seen::Connect(text.as_str().to_owned()));
        }
        Step::Hello => {
            let Some(message) = read(socket, seen).await else { return Ok(Flow::Done) };
            let Message::Binary(frame) = message else { return Err("the hello is not binary".to_owned()) };
            let _ = seen.send(Seen::Hello(daemon.accept_hello(&frame)?));
        }
        Step::Registered => write(socket, Message::text(r#"{"type":"relay_registered"}"#)).await?,
        Step::Paired => write(socket, Message::text(format!(r#"{{"type":"relay_paired","connectionId":"{CONNECTION_ID}"}}"#))).await?,
        Step::Text(text) => write(socket, Message::text(text)).await?,
        Step::Binary(bytes) => write(socket, Message::binary(bytes)).await?,
        Step::Ready => {
            let frame = daemon.ready_frame()?;
            write(socket, Message::binary(frame)).await?;
        }
        Step::Send(record) => {
            let frame = daemon.seal(&record)?;
            write(socket, Message::binary(frame)).await?;
        }
        Step::CloseEmpty => {
            write(socket, Message::Close(None)).await?;
            record_until_closed(socket, seen).await;
            return Ok(Flow::Done);
        }
        Step::Close(code, reason) => {
            write(socket, Message::Close(Some(CloseFrame { code: CloseCode::from(code), reason: reason.into() }))).await?;
            record_until_closed(socket, seen).await;
            return Ok(Flow::Done);
        }
        Step::Drop => return Ok(Flow::Done),
        Step::Echo => return echo(socket, daemon, seen).await,
    }
    Ok(Flow::Continue)
}

async fn write(socket: &mut Socket, message: Message) -> Result<(), String> {
    socket.send(message).await.map_err(|error| error.to_string())
}

/// The next text or binary frame; `None` once the client closed or the socket ended (recorded as [`Seen::Closed`]).
async fn read(socket: &mut Socket, seen: &UnboundedSender<Seen>) -> Option<Message> {
    loop {
        match socket.next().await {
            Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => {}
            Some(Ok(Message::Close(frame))) => {
                let _ = seen.send(Seen::Closed(frame.map(|f| (u16::from(f.code), f.reason.as_str().to_owned()))));
                return None;
            }
            Some(Ok(message)) => return Some(message),
            Some(Err(_)) | None => {
                let _ = seen.send(Seen::Closed(None));
                return None;
            }
        }
    }
}

async fn record_until_closed(socket: &mut Socket, seen: &UnboundedSender<Seen>) {
    while let Some(message) = read(socket, seen).await {
        let _ = match message {
            Message::Text(text) => seen.send(Seen::Text(text.as_str().to_owned())),
            Message::Binary(bytes) => seen.send(Seen::Binary(bytes.to_vec())),
            _ => Ok(()),
        };
    }
}

async fn echo(socket: &mut Socket, daemon: &mut DaemonHalf, seen: &UnboundedSender<Seen>) -> Result<Flow, String> {
    while let Some(message) = read(socket, seen).await {
        let Message::Binary(frame) = message else { return Err("the client sent a text frame".to_owned()) };
        let record = daemon.open(&frame)?;
        let _ = seen.send(Seen::Opened(record.clone()));
        write(socket, Message::binary(daemon.seal(&record)?)).await?;
    }
    Ok(Flow::Done)
}
