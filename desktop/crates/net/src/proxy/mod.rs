//! The loopback proxy: the page reaches the daemon through Rust.
//!
//! ```text
//! page (webview) --WebSocket, plain, loopback--> Rust --WebSocket, TLS for wss--> daemon
//! ```
//!
//! A [`Proxies`] holds the connections. For each one the caller [`reserves`](Proxies::reserve) a
//! place (a fifth is refused with `limit`, before any dial), dials the daemon ([`crate::dial`]),
//! and [`opens`](Reservation::open) the page's leg from the open socket: a listener on
//! `127.0.0.1` on a port the system chooses, a token of 256 random bits, and a task. The answer is
//! `ws://127.0.0.1:<port>/<token>`: a credential for [`Limits::page_wait`], handed to the calling
//! page only. The first upgrade whose path is the token, whose `Origin` is the expected one and
//! whose `Host` is `127.0.0.1:<port>` becomes the page's leg; the listener is dropped at once, so
//! the port is closed. Everything else gets a bare 403 and does not use the token up.
//!
//! Then messages pass unchanged and in order, one task per direction (`pump`); a close or a loss on
//! either leg ends the other as `run`'s table says. [`Proxies::snapshot`] is what `ui.inspect`
//! shows: no address, no token, no content.
//!
//! The token and the local address are in the [`LocalUrl`] and nowhere else: not in an error, not
//! in a log line (the lines are fixed texts, never a peer's words), not in a snapshot.

mod accept;
mod close;
mod conn;
mod gate;
mod pump;
mod run;
#[cfg(test)]
mod tests;

use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::net::TcpListener;
use tokio::sync::Notify;

pub use conn::State;
use conn::{Conn, Dir};
use gate::{Gate, mint_token};
use run::Task;

use crate::error::{ErrorCode, ProxyError};
use crate::limits::Limits;
use crate::socket::DaemonSocket;

/// `ws://127.0.0.1:<port>/<token>`: the page's way in, for [`Limits::page_wait`] and one use. Its
/// `Debug` shows nothing: the token must not reach a log by accident.
#[derive(Clone, PartialEq, Eq)]
pub struct LocalUrl(String);

impl LocalUrl {
    /// The URL the page opens its `WebSocket` to.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for LocalUrl {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("LocalUrl(..)")
    }
}

/// How a connection ended abnormally. `as_str` is the code `lastError` carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndCode {
    /// The gate refused the page (or something posing as it) and no page got in before the time
    /// was up, or the page's leg broke the protocol after it was in.
    PageRefused,
    /// No page connected in time.
    PageTimeout,
    /// The daemon's leg ended without a close frame (a reset, the keepalive, a TLS error, a
    /// malformed frame).
    UpstreamLost,
    /// A message above the limit.
    TooLarge,
}

impl EndCode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PageRefused => "page_refused",
            Self::PageTimeout => "page_timeout",
            Self::UpstreamLost => "upstream_lost",
            Self::TooLarge => "too_large",
        }
    }
}

/// The last abnormal end of any connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LastError {
    pub code: EndCode,
    /// Milliseconds since the Unix epoch.
    pub at_ms: u64,
}

/// One live connection, as `ui.inspect` shows it. "In" is what went from the daemon to the page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionSnapshot {
    /// What the caller named it (the registry entry's id).
    pub id: String,
    pub state: State,
    pub frames_in: u64,
    pub frames_out: u64,
    pub bytes_in: u64,
    pub bytes_out: u64,
    /// The most payload bytes held at once on the way to the page, and to the daemon: a write
    /// batch and one message at most.
    pub peak_held_in: u64,
    pub peak_held_out: u64,
}

/// The set of connections now and the last abnormal end.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub connections: Vec<ConnectionSnapshot>,
    pub last_error: Option<LastError>,
}

/// A line for the log. Fixed texts and the entry's id: never the token, an address or a peer's words.
type Log = Box<dyn Fn(&str) + Send + Sync>;

struct Entry {
    key: u64,
    id: String,
    conn: Arc<Conn>,
    shutdown: Arc<Notify>,
    /// Whether the connection's task exists (a reservation that is still dialling has none).
    started: bool,
}

#[derive(Default)]
struct Set {
    next_key: u64,
    entries: Vec<Entry>,
    last_error: Option<LastError>,
}

struct Shared {
    limits: Limits,
    log: Log,
    set: Mutex<Set>,
    /// Woken whenever a connection leaves the set.
    gone: Notify,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| u64::try_from(since.as_millis()).unwrap_or(u64::MAX))
}

impl Shared {
    fn say(&self, id: &str, text: &str) {
        (self.log)(&format!("proxy {id}: {text}"));
    }

    /// Takes `key` out of the set and records how it ended.
    fn forget(&self, key: u64, end: Option<EndCode>) {
        let id = {
            let mut set = lock(&self.set);
            let at = set.entries.iter().position(|entry| entry.key == key);
            let removed = at.map(|at| set.entries.swap_remove(at));
            if let Some(code) = end {
                set.last_error = Some(LastError { code, at_ms: now_ms() });
            }
            removed.map(|entry| entry.id)
        };
        if let (Some(id), Some(code)) = (id, end) {
            self.say(&id, &format!("ended abnormally: {}", code.as_str()));
        }
        self.gone.notify_waiters();
    }
}

/// The proxied connections of one app. Cheap to clone: the clones share the set.
#[derive(Clone)]
pub struct Proxies {
    shared: Arc<Shared>,
}

impl Proxies {
    /// An empty set with the shipped limits. `log` receives one line per event worth a log entry.
    #[must_use]
    pub fn new(log: impl Fn(&str) + Send + Sync + 'static) -> Self {
        Self::with_limits(Limits::default(), log)
    }

    /// The same with other limits (the tests shorten lifetimes and lower caps).
    #[must_use]
    pub fn with_limits(limits: Limits, log: impl Fn(&str) + Send + Sync + 'static) -> Self {
        Self { shared: Arc::new(Shared { limits, log: Box::new(log), set: Mutex::new(Set::default()), gone: Notify::new() }) }
    }

    /// Takes a place for connection `id`, in state `connecting`, before the caller dials: a full set
    /// is refused here, with `limit`, so that no daemon is dialled for nothing. Dropping the
    /// reservation gives the place back.
    ///
    /// # Errors
    /// `limit` when [`Limits::max_connections`] connections exist (reserved, waiting or open).
    pub fn reserve(&self, id: impl Into<String>) -> Result<Reservation, ProxyError> {
        let mut set = lock(&self.shared.set);
        let max = self.shared.limits.max_connections;
        if set.entries.len() >= max {
            return Err(ProxyError::new(ErrorCode::Limit, format!("{max} connections to daemons are open already. Close one first.")));
        }
        let key = set.next_key;
        set.next_key = set.next_key.wrapping_add(1);
        let (conn, shutdown) = (Arc::new(Conn::new()), Arc::new(Notify::new()));
        set.entries.push(Entry { key, id: id.into(), conn: conn.clone(), shutdown: shutdown.clone(), started: false });
        Ok(Reservation { shared: self.shared.clone(), key, conn, shutdown, opened: false })
    }

    /// Closes every connection: each daemon is told 1001, each page's leg is dropped. Returns when
    /// the connections that had started are gone (a daemon that does not answer costs the close
    /// wait, all in parallel). A reservation that is still dialling is closed as soon as it opens.
    pub async fn close_all(&self) {
        let waiting: Vec<u64> = {
            let set = lock(&self.shared.set);
            set.entries.iter().for_each(|entry| entry.shutdown.notify_one());
            set.entries.iter().filter(|entry| entry.started).map(|entry| entry.key).collect()
        };
        loop {
            let gone = self.shared.gone.notified();
            tokio::pin!(gone);
            // Registered before the check, so that a connection that leaves in between is not missed.
            gone.as_mut().enable();
            if !lock(&self.shared.set).entries.iter().any(|entry| waiting.contains(&entry.key)) {
                return;
            }
            gone.await;
        }
    }

    /// What `ui.inspect` shows.
    #[must_use]
    pub fn snapshot(&self) -> Snapshot {
        let set = lock(&self.shared.set);
        let connections = set
            .entries
            .iter()
            .map(|entry| ConnectionSnapshot {
                id: entry.id.clone(),
                state: entry.conn.state(),
                frames_in: entry.conn.frames(Dir::ToPage),
                frames_out: entry.conn.frames(Dir::ToDaemon),
                bytes_in: entry.conn.bytes(Dir::ToPage),
                bytes_out: entry.conn.bytes(Dir::ToDaemon),
                peak_held_in: entry.conn.peak_held(Dir::ToPage),
                peak_held_out: entry.conn.peak_held(Dir::ToDaemon),
            })
            .collect();
        Snapshot { connections, last_error: set.last_error }
    }
}

/// A place in the set, taken before the dial.
pub struct Reservation {
    shared: Arc<Shared>,
    key: u64,
    conn: Arc<Conn>,
    shutdown: Arc<Notify>,
    /// Whether a task has taken over the place (otherwise dropping gives it back).
    opened: bool,
}

impl Drop for Reservation {
    fn drop(&mut self) {
        if !self.opened {
            self.shared.forget(self.key, None);
        }
    }
}

fn proxy_failed(what: &str) -> ProxyError {
    ProxyError::new(ErrorCode::ProxyFailed, format!("The app could not open its own local connection: {what}."))
}

/// Whether `daemon` refuses messages above `limit` as the library reads them.
fn has_cap(daemon: &DaemonSocket, limit: usize) -> bool {
    daemon.max_message_bytes() <= limit
}

impl Reservation {
    /// Opens the page's leg for the open daemon socket `daemon` and starts the connection's task.
    /// `origin` is what the page's `Origin` header must say.
    ///
    /// The daemon's socket must refuse messages above [`Limits::max_message_bytes`] as it reads
    /// them, as a socket from [`crate::dial`] does.
    ///
    /// # Errors
    /// `proxy_failed` when `127.0.0.1` cannot be bound, the system gives no random bytes, or the
    /// socket has no message limit. The place is given back.
    pub async fn open(mut self, daemon: DaemonSocket, origin: &str) -> Result<LocalUrl, ProxyError> {
        if !has_cap(&daemon, self.shared.limits.max_message_bytes) {
            return Err(proxy_failed("the daemon's socket has no message size limit"));
        }
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.map_err(|_| proxy_failed("127.0.0.1 could not be bound"))?;
        let port = listener.local_addr().map_err(|_| proxy_failed("the local port is unknown"))?.port();
        let token = mint_token()?;
        let url = LocalUrl(format!("ws://127.0.0.1:{port}/{token}"));
        let id = {
            let mut set = lock(&self.shared.set);
            let entry = set.entries.iter_mut().find(|entry| entry.key == self.key);
            entry.map(|entry| {
                entry.started = true;
                entry.id.clone()
            })
        };
        let task = Task {
            shared: self.shared.clone(),
            key: self.key,
            id: id.unwrap_or_default(),
            conn: self.conn.clone(),
            shutdown: self.shutdown.clone(),
            listener,
            gate: Gate::new(token, origin, port),
            daemon,
        };
        self.opened = true;
        tokio::spawn(run::run(task));
        Ok(url)
    }
}
