//! The listener, the upgrade, and the handle a test holds.

use std::io;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::net::{TcpListener, TcpStream};
use tokio::task::{JoinHandle, JoinSet};
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::{HeaderValue, StatusCode};

use super::connection::Connection;
use super::fault::Fault;
use super::state::{Content, FileInfo, Shared, UploadRecord};

/// The subprotocol a password is offered in: `pi-studio.bearer.<password>`.
const BEARER_PREFIX: &str = "pi-studio.bearer.";

/// The feature flags of `status` that the engine reads. A flag that is off is left out of the
/// frame, as an older daemon leaves it out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Features {
    /// `fileDownloadRanges`.
    pub file_download_ranges: bool,
    /// `fileTransferAck`.
    pub file_transfer_ack: bool,
    /// `agentStreamsMode`.
    pub agent_streams_mode: bool,
}

impl Default for Features {
    fn default() -> Self {
        Self { file_download_ranges: true, file_transfer_ack: true, agent_streams_mode: true }
    }
}

/// How the stand-in daemon is set up.
#[derive(Debug, Clone)]
pub struct Config {
    /// When set, an upgrade that does not offer `pi-studio.bearer.<password>` is answered 401.
    pub password: Option<String>,
    /// The flags `status` lists.
    pub features: Features,
    /// The file bytes of a download's `Chunk`: 32 KiB, as the real daemon's.
    pub chunk_bytes: usize,
    /// How long a download waits after each `Chunk`; zero sends as fast as the socket takes it. A
    /// test that must cancel or drop a download in flight sets it.
    pub chunk_delay: Duration,
    /// The size of the stream id space (the real daemon's is 256). A test that wants the real
    /// `no_free_stream` sets it small, and keeps uploads open.
    pub stream_slots: usize,
    /// Whether an upload that ended with `End` is kept at its path. Off, the upload is counted and
    /// acknowledged and its bytes are dropped as they arrive, so that a file of any size needs no
    /// memory; [`UploadRecord::bytes_received`] still has the count, and `file` has nothing.
    pub store_uploads: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self { password: None, features: Features::default(), chunk_bytes: 32 * 1024, chunk_delay: Duration::ZERO, stream_slots: 256, store_uploads: true }
    }
}

/// A daemon in this process, on `127.0.0.1` and a port the system chose.
///
/// It keeps files in memory, answers the handshake, `ping`, uploads and downloads in the real
/// daemon's frame order, and misbehaves as scripted ([`Fault`]). Dropping it closes the listener
/// and every connection.
pub struct StandInDaemon {
    addr: SocketAddr,
    shared: Arc<Shared>,
    accept: JoinHandle<()>,
}

impl StandInDaemon {
    /// Starts a daemon with the default configuration.
    ///
    /// # Errors
    /// The listener could not be bound.
    pub async fn start() -> io::Result<Self> {
        Self::start_with(Config::default()).await
    }

    /// Starts a daemon with `config`.
    ///
    /// # Errors
    /// The listener could not be bound.
    pub async fn start_with(config: Config) -> io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let shared = Arc::new(Shared::new(config));
        let accept = tokio::spawn(accept_loop(listener, Arc::clone(&shared)));
        Ok(Self { addr, shared, accept })
    }

    /// The port.
    #[must_use]
    pub fn port(&self) -> u16 {
        self.addr.port()
    }

    /// The address to dial: `ws://127.0.0.1:<port>`.
    #[must_use]
    pub fn url(&self) -> String {
        format!("ws://{}", self.addr)
    }

    /// Puts a file on the daemon (or replaces it) with the next modification time. A replaced file
    /// has a new size or time, so a request guarded by the old ones is answered `changed`. A
    /// download that is running keeps the version it started with.
    pub fn put_file(&self, path: &str, bytes: impl Into<Vec<u8>>) -> FileInfo {
        let bytes = bytes.into();
        self.shared.with(|state| state.store(path, bytes))
    }

    /// Like [`put_file`](Self::put_file), with the modification time given.
    pub fn put_file_at(&self, path: &str, bytes: impl Into<Vec<u8>>, mtime_ms: u64) -> FileInfo {
        let bytes = bytes.into();
        self.shared.with(|state| state.store_at(path, bytes, mtime_ms))
    }

    /// Puts a file of `size` bytes on the daemon that the daemon does not hold: a download of it sends
    /// `size` zero bytes, made as they go out, so that a file of any size needs no memory. For a test of
    /// counters past 4 GiB. [`file`](Self::file) answers `None` for it; [`file_info`](Self::file_info) has its size.
    pub fn put_counted_file(&self, path: &str, size: u64) -> FileInfo {
        self.shared.with(|state| state.store_zeros(path, size))
    }

    /// Removes a file; true when there was one.
    pub fn remove_file(&self, path: &str) -> bool {
        self.shared.with(|state| state.files.remove(path).is_some())
    }

    /// What the daemon holds at `path`: a file put there or an upload that ended with `End`. `None` for
    /// a file that is not held ([`put_counted_file`](Self::put_counted_file)).
    #[must_use]
    pub fn file(&self, path: &str) -> Option<Vec<u8>> {
        self.shared.with(|state| {
            state.files.get(path).and_then(|file| match &file.content {
                Content::Bytes(bytes) => Some(bytes.as_ref().clone()),
                Content::Zeros(_) => None,
            })
        })
    }

    /// The size and modification time of the file at `path`.
    #[must_use]
    pub fn file_info(&self, path: &str) -> Option<FileInfo> {
        self.shared.with(|state| state.files.get(path).map(|file| FileInfo { size: file.content.len(), mtime_ms: file.mtime_ms }))
    }

    /// The streams in use now, on every connection: uploads that were accepted and have not ended, and
    /// downloads that have not sent their last frame. A connection that ended has none. A test that
    /// cancels or drops a transfer at some stage asks for 0 afterwards.
    #[must_use]
    pub fn streams_in_use(&self) -> usize {
        self.shared.with(|state| state.reserved)
    }

    /// Makes every connection that stopped reading ([`Fault::StopReading`]) read again, from the next
    /// frame in its socket. A connection that is not stopped is not affected, now or later.
    pub fn resume_reading(&self) {
        self.shared.resume.send_modify(|calls| *calls = calls.wrapping_add(1));
    }

    /// Queues a fault; it is used once.
    pub fn script(&self, fault: Fault) {
        self.shared.with(|state| state.faults.push(fault));
    }

    /// The faults that have not been used.
    #[must_use]
    pub fn pending_faults(&self) -> usize {
        self.shared.with(|state| state.faults.len())
    }

    /// Every `hello` the daemon accepted, as the client sent it.
    #[must_use]
    pub fn hellos(&self) -> Vec<Value> {
        self.shared.with(|state| state.hellos.clone())
    }

    /// Every upload that ended (`End`, an `Error` from the client, or a failure), oldest first. An
    /// upload that was cut off with its connection never ends and is not listed.
    #[must_use]
    pub fn uploads(&self) -> Vec<UploadRecord> {
        self.shared.with(|state| state.uploads.clone())
    }

    /// Every `file_download_request` the daemon read, as the client sent it (the envelope's `message`),
    /// oldest first, refused ones included.
    #[must_use]
    pub fn download_requests(&self) -> Vec<Value> {
        self.shared.with(|state| state.download_requests.clone())
    }

    /// The connections that completed the upgrade, ever.
    #[must_use]
    pub fn accepted_connections(&self) -> usize {
        self.shared.with(|state| state.accepted)
    }

    /// The connections that are open now.
    #[must_use]
    pub fn open_connections(&self) -> usize {
        self.shared.with(|state| state.open)
    }

    /// The upgrades answered 401.
    #[must_use]
    pub fn refused_upgrades(&self) -> usize {
        self.shared.with(|state| state.refused)
    }

    /// The close frames the daemon read from clients, in order: each one's code, or `None` for a close
    /// frame without one.
    #[must_use]
    pub fn client_closes(&self) -> Vec<Option<u16>> {
        self.shared.with(|state| state.client_closes.clone())
    }
}

impl Drop for StandInDaemon {
    fn drop(&mut self) {
        // The accept task owns the connections' tasks: aborting it aborts them.
        self.accept.abort();
    }
}

async fn accept_loop(listener: TcpListener, shared: Arc<Shared>) {
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let Ok((tcp, _)) = accepted else { return };
                connections.spawn(serve(tcp, Arc::clone(&shared)));
            }
            Some(_) = connections.join_next(), if !connections.is_empty() => {}
        }
    }
}

/// Counts a connection open until it is dropped.
struct OpenGuard(Arc<Shared>);

impl Drop for OpenGuard {
    fn drop(&mut self) {
        self.0.with(|state| state.open = state.open.saturating_sub(1));
    }
}

// The library fixes the upgrade callback's error type, which is large.
#[allow(clippy::result_large_err)]
async fn serve(tcp: TcpStream, shared: Arc<Shared>) {
    if tcp.set_nodelay(true).is_err() {
        return;
    }
    let for_upgrade = Arc::clone(&shared);
    let callback = move |request: &Request, response: Response| authorize(request, response, &for_upgrade);
    let Ok(ws) = accept_hdr_async(tcp, callback).await else { return };
    shared.with(|state| {
        state.accepted += 1;
        state.open += 1;
    });
    let _open = OpenGuard(Arc::clone(&shared));
    Connection::new(ws, shared).run().await;
}

/// The daemon's upgrade rule: with a password, the bearer subprotocol must carry it (401 if not);
/// the subprotocol is echoed back.
// The library fixes the callback's error type, which is large.
#[allow(clippy::result_large_err)]
fn authorize(request: &Request, mut response: Response, shared: &Shared) -> Result<Response, ErrorResponse> {
    let offered = request
        .headers()
        .get("sec-websocket-protocol")
        .and_then(|value| value.to_str().ok())
        .and_then(|list| list.split(',').map(str::trim).find(|protocol| protocol.starts_with(BEARER_PREFIX)));
    if let Some(password) = &shared.config.password
        && offered.and_then(|protocol| protocol.strip_prefix(BEARER_PREFIX)) != Some(password.as_str())
    {
        shared.with(|state| state.refused += 1);
        let mut unauthorized = ErrorResponse::new(None);
        *unauthorized.status_mut() = StatusCode::UNAUTHORIZED;
        return Err(unauthorized);
    }
    if let Some(protocol) = offered
        && let Ok(value) = HeaderValue::from_str(protocol)
    {
        response.headers_mut().insert("sec-websocket-protocol", value);
    }
    Ok(response)
}
