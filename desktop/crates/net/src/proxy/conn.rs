//! What one connection counts, shared between its tasks and the snapshot.

use std::sync::atomic::{AtomicU8, AtomicU64, Ordering::Relaxed};

/// Where a connection is in its life. `Connecting` lasts until the page's upgrade is accepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    /// Waiting for the page: the daemon's leg is open and the listener is up.
    Connecting,
    /// The page is connected and the pump runs.
    Open,
    /// A close handshake (or a shutdown) is in progress.
    Closing,
}

impl State {
    /// The state as `ui.inspect` writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Connecting => "connecting",
            Self::Open => "open",
            Self::Closing => "closing",
        }
    }
}

/// A direction of the pump. The names follow the page: "in" is what reaches it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Dir {
    /// Daemon to page.
    ToPage,
    /// Page to daemon.
    ToDaemon,
}

/// One of the two legs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Leg {
    Daemon,
    Page,
}

impl Dir {
    /// The leg this direction reads.
    pub(super) const fn source(self) -> Leg {
        match self {
            Self::ToPage => Leg::Daemon,
            Self::ToDaemon => Leg::Page,
        }
    }

    /// The leg this direction writes.
    pub(super) const fn sink(self) -> Leg {
        match self {
            Self::ToPage => Leg::Page,
            Self::ToDaemon => Leg::Daemon,
        }
    }
}

/// What one direction counted.
#[derive(Default)]
struct Counters {
    frames: AtomicU64,
    bytes: AtomicU64,
    /// The most payload bytes this direction held at once: read from one leg and not yet written to
    /// the other (a write batch and the message that ended it).
    peak_held: AtomicU64,
}

/// The shared counters and state of one connection.
pub(super) struct Conn {
    state: AtomicU8,
    refusals: AtomicU64,
    to_page: Counters,
    to_daemon: Counters,
}

const CONNECTING: u8 = 0;
const OPEN: u8 = 1;
const CLOSING: u8 = 2;

impl Conn {
    pub(super) fn new() -> Self {
        Self { state: AtomicU8::new(CONNECTING), refusals: AtomicU64::new(0), to_page: Counters::default(), to_daemon: Counters::default() }
    }

    fn counters(&self, dir: Dir) -> &Counters {
        match dir {
            Dir::ToPage => &self.to_page,
            Dir::ToDaemon => &self.to_daemon,
        }
    }

    pub(super) fn state(&self) -> State {
        match self.state.load(Relaxed) {
            CONNECTING => State::Connecting,
            OPEN => State::Open,
            _ => State::Closing,
        }
    }

    /// The page is in. Never moves a connection that is closing back to open.
    pub(super) fn opened(&self) {
        let _ = self.state.compare_exchange(CONNECTING, OPEN, Relaxed, Relaxed);
    }

    pub(super) fn closing(&self) {
        self.state.store(CLOSING, Relaxed);
    }

    /// Messages that were written to the other leg.
    pub(super) fn delivered(&self, dir: Dir, frames: u64, bytes: u64) {
        let counters = self.counters(dir);
        counters.frames.fetch_add(frames, Relaxed);
        counters.bytes.fetch_add(bytes, Relaxed);
    }

    /// `bytes` of payload are held now.
    pub(super) fn held(&self, dir: Dir, bytes: u64) {
        self.counters(dir).peak_held.fetch_max(bytes, Relaxed);
    }

    /// An upgrade was refused.
    pub(super) fn refused(&self) {
        self.refusals.fetch_add(1, Relaxed);
    }

    pub(super) fn refusals(&self) -> u64 {
        self.refusals.load(Relaxed)
    }

    pub(super) fn frames(&self, dir: Dir) -> u64 {
        self.counters(dir).frames.load(Relaxed)
    }

    pub(super) fn bytes(&self, dir: Dir) -> u64 {
        self.counters(dir).bytes.load(Relaxed)
    }

    pub(super) fn peak_held(&self, dir: Dir) -> u64 {
        self.counters(dir).peak_held.load(Relaxed)
    }
}
