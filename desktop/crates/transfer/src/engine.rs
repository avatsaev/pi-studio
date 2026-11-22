//! The engine: one object that takes uploads and saves, runs at most three at once on one bulk
//! connection, opens that connection when the first transfer needs it, closes it when it is idle, and
//! says what it is doing.
//!
//! ```text
//! let engine = Engine::new(connector, Config::new(client_id, app_version), |event| { /* transfer_progress */ });
//! let bytes = engine.upload("u-1", "/srv/a.bin", source).await?;      // resolves when it has settled
//! let bytes = engine.save("s-1", "/srv/b.bin", sink).await?;
//! engine.cancel("s-1");                                               // that call resolves with `cancelled`
//! engine.cancel_all_and_close(Close::GoingAway).await;                // boot, a switch, exit
//! engine.snapshot();                                                  // `ui.inspect` → `transfers`
//! ```
//!
//! * **Starting.** [`Engine::upload`] and [`Engine::save`] take the transfer's `id` (1 to 64 characters
//!   of `A-Z a-z 0-9 -`, else `invalid_request`; one that is running or waiting is `duplicate_id`),
//!   the path on the daemon (1 to 4096 bytes) and the caller's [`UploadSource`](crate::upload::UploadSource) or
//!   [`Sink`](crate::download::Sink). The call resolves when the transfer has settled, with the bytes
//!   or a [`Failure`] (`code`, `message`). From the start the sink is the engine's: a save that does
//!   not complete, whether it was refused, cancelled or failed, is discarded before its call resolves.
//!   Dropping the call's future does not stop the transfer: cancel it.
//! * **The queue.** At most [`Limits::max_transfers`](crate::Limits::max_transfers) (3) transfers are active; the rest
//!   wait in order and start, first in first out, as one settles. There is no limit on the queue.
//! * **The connection.** The connector is asked for a socket when the first transfer becomes active.
//!   The engine says `hello`, requires the daemon's three features and keeps one connection for all
//!   transfers. 30 s after nothing is active or queued it is closed with 1000; a transfer that starts
//!   before that keeps it. A connection that cannot open fails every transfer that waits for it
//!   or for its turn, with the connector's code (`unauthorized`, `unreachable`, …), `unsupported_daemon`
//!   or `protocol`; one that drops fails the transfers running on it with `connection_lost`. The
//!   engine does not reconnect or resume yet.
//! * **Events.** The callback gets an [`Event`] at every change of state (`queued`, `waiting`, `running`)
//!   and at most once per [`Limits::progress_interval`](crate::Limits::progress_interval) (100 ms) per
//!   transfer while bytes move. Nothing is sent when a transfer settles. The callback runs on whichever
//!   task changed the state, with an engine lock held for a state change: it must be quick and must not
//!   call the engine.
//! * **Cancel.** [`Engine::cancel`] settles a queued or waiting transfer at once and an active one when
//!   its task has told the daemon (an upload sends `client_aborted`, a save sends a cancel and keeps
//!   its stream until the daemon is done with it). A save that did not complete is discarded before its call
//!   resolves. [`Engine::cancel_all_and_close`] cancels every transfer, waits for each to settle and
//!   closes the connection (1000 or 1001); the engine can be used again afterwards.
//! * **Snapshot.** [`Engine::snapshot`] is the `transfers` of the control socket, less `mode` and
//!   `entryId`, which the app knows: the connection's state and how often it opened, the active
//!   transfers (id, kind, state, bytes done and total, restarts), how many wait, the totals of done, failed and
//!   cancelled, the most bytes held at one moment, and the last error with its time. It holds no path.
//! * **Memory.** An upload holds one chunk; a save holds at most the download hold (1 MiB) and one frame
//!   of what the daemon sent and the sink has not written. Neither grows with the file. `peak_held` is
//!   the most of both together: an upload counts its read buffer from the moment it runs.
//!
//! The one lock is in `queue`; the type-erased uploads and saves are in `work`.

mod connector;
mod event;
mod failure;
mod queue;
mod snapshot;
mod work;

#[cfg(test)]
mod tests;

use std::sync::Arc;

pub use self::connector::{ConnectError, Connector};
pub use self::event::{Event, TransferState};
pub use self::failure::Failure;
use self::queue::Inner;
pub use self::snapshot::{ActiveTransfer, ConnectionInfo, ConnectionState, Kind, LastError, Snapshot, Totals};
use self::work::{SaveWork, UploadWork, Work};
use crate::connection::Close;
use crate::download::Sink;
use crate::limits::Limits;
use crate::upload::UploadSource;

/// Who the engine is, and the limits it works within.
#[derive(Debug, Clone)]
pub struct Config {
    /// The `clientId` of `hello`: random, made once per run of the app, and not the page's. It also
    /// prefixes each upload's `transferId`.
    pub client_id: String,
    /// The `appVersion` of `hello`: `pistudiodesktop/<version>`.
    pub app_version: String,
    /// The limits. [`Limits::default`] is what ships.
    pub limits: Limits,
}

impl Config {
    /// A configuration with the shipped limits.
    pub fn new(client_id: impl Into<String>, app_version: impl Into<String>) -> Self {
        Self { client_id: client_id.into(), app_version: app_version.into(), limits: Limits::default() }
    }
}

/// The transfer engine. See the module's documentation.
///
/// It must be made and used inside a tokio runtime. Dropping it cancels every transfer and hangs up
/// the connection without waiting: [`cancel_all_and_close`](Self::cancel_all_and_close) is the clean way.
pub struct Engine<C: Connector> {
    inner: Arc<Inner<C>>,
}

impl<C: Connector> Engine<C> {
    /// An engine that gets its sockets from `connector` and tells `events` what its transfers do.
    pub fn new(connector: C, config: Config, events: impl Fn(Event) + Send + Sync + 'static) -> Self {
        Self { inner: Inner::new(connector, config.client_id, config.app_version, config.limits, Arc::new(events)) }
    }

    /// Uploads `source` to `path` on the daemon. Resolves when the upload has settled, with the bytes
    /// the daemon confirmed.
    ///
    /// # Errors
    /// A [`Failure`]: `invalid_request`, `duplicate_id`, `cancelled`, `daemon_refused`, `source_unreadable`,
    /// `source_changed`, `size_mismatch`, `protocol`, `unsupported_daemon`, `connection_lost`, a code of the
    /// connection's opening, or `internal`.
    pub async fn upload<S: UploadSource + 'static>(&self, id: &str, path: &str, source: S) -> Result<u64, Failure> {
        let total = source.size();
        self.run(id, path, Box::new(UploadWork { path: path.to_owned(), source }), total).await
    }

    /// Saves the file at `path` on the daemon into `sink`. Resolves when the file is in place
    /// ([`Sink::finish`] ran), with its bytes. A save that does not complete is discarded first.
    ///
    /// # Errors
    /// A [`Failure`]: `invalid_request`, `duplicate_id`, `cancelled`, `daemon_refused`, `changed`, `disk`,
    /// `protocol`, `unsupported_daemon`, `connection_lost`, a code of the connection's opening, or `internal`.
    pub async fn save<S: Sink + 'static>(&self, id: &str, path: &str, sink: S) -> Result<u64, Failure> {
        self.run(id, path, Box::new(SaveWork { path: path.to_owned(), sink }), None).await
    }

    async fn run(&self, id: &str, path: &str, work: Box<dyn Work>, total: Option<u64>) -> Result<u64, Failure> {
        match self.inner.submit(id, path, work, total) {
            Ok(answer) => answer.await.unwrap_or_else(|_| Err(Failure::internal("a transfer was dropped without an answer"))),
            Err(mut rejected) => {
                rejected.work.discard().await;
                Err(rejected.failure)
            }
        }
    }

    /// Cancels the transfer with this `id`, queued, waiting or running. Its call resolves with
    /// `cancelled`. False when no transfer with this `id` is queued, waiting or running.
    #[must_use]
    pub fn cancel(&self, id: &str) -> bool {
        self.inner.cancel(id)
    }

    /// Cancels every transfer, waits until each has settled, and closes the connection with `how`
    /// (1000 for a switch, 1001 for exit). The engine can start transfers again afterwards; a transfer
    /// started while this waits is waited for too, so stop starting them first.
    pub async fn cancel_all_and_close(&self, how: Close) {
        self.inner.close(how).await;
    }

    /// What the engine is doing now.
    #[must_use]
    pub fn snapshot(&self) -> Snapshot {
        self.inner.snapshot()
    }
}

impl<C: Connector> Drop for Engine<C> {
    fn drop(&mut self) {
        self.inner.shut_down();
    }
}
