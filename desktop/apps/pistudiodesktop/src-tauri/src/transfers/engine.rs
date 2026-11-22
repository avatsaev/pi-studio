//! The transfer engine as the app runs it: the supplier of its sockets (the current entry's plan,
//! the password from the secret store, [`dial`]), the event it tells the page, the `ui.inspect`
//! view, and the one rule the page's commands need that the engine does not have: a cancel that
//! arrives before its transfer has reached the engine is remembered, so that the start settles
//! as `cancelled` instead of running on.
//!
//! The engine runs on Tauri's async runtime. Nothing here blocks it: the owner thread is asked
//! once per attempt for the current entry, and the store is read on the blocking pool.

use std::collections::VecDeque;
use std::future::{Future, poll_fn};
use std::pin::pin;
use std::sync::mpsc::{Receiver, channel};
use std::sync::{Arc, Mutex, PoisonError};
use std::task::Poll;
use std::time::{Duration, Instant};

use pistudiodesktop_model::{Secret, normalize_daemon_url};
use pistudiodesktop_net::{DIAL_LIMIT, Socket, dial};
use pistudiodesktop_shell::owner_access::OwnerAccess;
use pistudiodesktop_shell::services::TransfersHook;
use pistudiodesktop_shell::transfers_view::{ActiveState, ActiveView, BulkState, BulkView, Snapshot, Totals, TransferKind};
use pistudiodesktop_shell::transports::ConnectionError;
use pistudiodesktop_transfer::connection::Close;
use pistudiodesktop_transfer::download::Sink;
use pistudiodesktop_transfer::engine::{
    Config, ConnectError, ConnectionState, Connector, Engine, Event, Failure, Kind, Snapshot as EngineSnapshot, TransferState,
};
use pistudiodesktop_transfer::limits::MAX_MESSAGE_BYTES;
use pistudiodesktop_transfer::upload::UploadSource;
use serde_json::json;
use tauri::{AppHandle, Emitter as _, Runtime};

use crate::transport::{self, Failure as Refusal, blocking};

/// The event the page listens to: payload `{ id, state, done, total }` ([`Event`]).
pub const EVENT: &str = "transfer_progress";

/// The longest a blocking leave waits for the engine to settle every transfer and close its
/// connection. A daemon that does not answer the close costs the engine's own close wait, so this
/// only bounds a stuck runtime. The proxied connections' close has the same bound.
const LEAVE_WAIT: Duration = Duration::from_secs(5);

/// How long a cancel is remembered for a transfer that has not started, and how many are.
/// The race it covers is the page's two calls reaching Rust out of order: milliseconds.
const EARLY_CANCEL_TTL: Duration = Duration::from_secs(10);
const EARLY_CANCEL_MAX: usize = 64;
/// No transfer has a longer id, so no cancel of a longer one can be early.
const MAX_ID_BYTES: usize = 64;

/// The codes of a refused plan or secret that another attempt can mend: the local daemon is still
/// starting, or the owner thread did not answer in time. Every other one waits for the user.
const RETRIED: [&str; 4] = ["local_not_ready", "local_stopped", "timeout", "busy"];

fn locked<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    // Nothing under these locks can leave their data half-changed.
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What a refusal to open the bulk connection means for the engine's retry.
fn connect_error(refusal: Refusal) -> ConnectError {
    ConnectError::new(refusal.code, refusal.message, RETRIED.contains(&refusal.code))
}

/// The engine's supplier of sockets: the current entry's address and password, as `transport_open`
/// reads them, dialled with the engine's message limit.
pub struct AppConnector {
    access: OwnerAccess,
    /// The entry the last attempt was for, for `ui.inspect`'s `connection.entryId`.
    entry: Arc<Mutex<Option<String>>>,
}

impl Connector for AppConnector {
    async fn connect(&self) -> Result<Socket, ConnectError> {
        let plan = blocking({
            let access = self.access.clone();
            move || access.bridge_plan()
        })
        .await
        .map_err(connect_error)?
        .map_err(|code| connect_error(transport::plan_failure(code)))?;
        *locked(&self.entry) = Some(plan.entry.as_str().to_owned());
        let password = blocking({
            let access = self.access.clone();
            let plan = plan.clone();
            move || access.bridge_password(&plan)
        })
        .await
        .map_err(connect_error)?
        .map_err(|code| connect_error(transport::secret_failure(code)))?;
        // The address of a local or direct entry as the page derives it: what `transport_open` dials.
        let url = normalize_daemon_url(&plan.url);
        Ok(dial(&url, password.as_ref().map(Secret::expose), DIAL_LIMIT, MAX_MESSAGE_BYTES).await?)
    }
}

/// Cancels that came for a transfer that has not reached the engine. At most [`EARLY_CANCEL_MAX`],
/// each kept for [`EARLY_CANCEL_TTL`]; the oldest goes first.
#[derive(Default)]
struct EarlyCancels(Mutex<VecDeque<(String, Instant)>>);

impl EarlyCancels {
    fn prune(held: &mut VecDeque<(String, Instant)>, now: Instant) {
        held.retain(|(_, at)| now.saturating_duration_since(*at) < EARLY_CANCEL_TTL);
    }

    fn remember(&self, id: &str) {
        if id.len() > MAX_ID_BYTES {
            return;
        }
        let mut held = locked(&self.0);
        let now = Instant::now();
        Self::prune(&mut held, now);
        if held.iter().any(|(known, _)| known == id) {
            return;
        }
        if held.len() >= EARLY_CANCEL_MAX {
            held.pop_front();
        }
        held.push_back((id.to_owned(), now));
    }

    /// Whether a cancel of `id` is remembered; it is forgotten by the call.
    fn take(&self, id: &str) -> bool {
        self.take_at(id, Instant::now())
    }

    fn take_at(&self, id: &str, now: Instant) -> bool {
        let mut held = locked(&self.0);
        Self::prune(&mut held, now);
        held.iter().position(|(known, _)| known == id).and_then(|at| held.remove(at)).is_some()
    }

    fn clear(&self) {
        locked(&self.0).clear();
    }
}

/// The app's one transfer engine, and what goes with it. Managed by Tauri.
pub struct TransferEngine {
    engine: Arc<Engine<AppConnector>>,
    early: EarlyCancels,
    entry: Arc<Mutex<Option<String>>>,
}

impl TransferEngine {
    /// An engine for `access`'s current entry that tells the page every event of its transfers. Its
    /// `clientId` is random and made here, once per run; `version` is the app's.
    ///
    /// # Errors
    /// No random source for the client id.
    pub fn new<R: Runtime>(handle: AppHandle<R>, access: OwnerAccess, version: &str) -> Result<Self, getrandom::Error> {
        let mut bytes = [0_u8; 16];
        getrandom::fill(&mut bytes)?;
        let client_id = bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
        let entry = Arc::new(Mutex::new(None));
        let connector = AppConnector { access, entry: Arc::clone(&entry) };
        let config = Config::new(client_id, format!("pistudiodesktop/{version}"));
        let engine = Engine::new(connector, config, move |event| tell_page(&handle, &event));
        Ok(Self { engine: Arc::new(engine), early: EarlyCancels::default(), entry })
    }

    /// What `ui.inspect` reads (`Services::transfers`): the engine's snapshot as the shell's view.
    /// It takes the engine's lock for a moment and waits on nothing.
    pub fn inspector(&self) -> TransfersHook {
        let (engine, entry) = (Arc::clone(&self.engine), Arc::clone(&self.entry));
        Arc::new(move || view(&engine.snapshot(), locked(&entry).clone()))
    }

    /// Upload `source` to `path` on the daemon; resolves when the upload has settled.
    ///
    /// # Errors
    /// The engine's [`Failure`].
    pub async fn upload<S: UploadSource + 'static>(&self, id: &str, path: &str, source: S) -> Result<u64, Failure> {
        self.started(id, self.engine.upload(id, path, source)).await
    }

    /// Save the daemon's file at `path` into `sink`; resolves when the save has settled.
    ///
    /// # Errors
    /// The engine's [`Failure`].
    pub async fn save<S: Sink + 'static>(&self, id: &str, path: &str, sink: S) -> Result<u64, Failure> {
        self.started(id, self.engine.save(id, path, sink)).await
    }

    /// Run `transfer` (a call of the engine for `id`), and cancel it as soon as it is in the engine
    /// when a cancel of `id` came first. The engine takes a transfer in at the first poll of its call.
    async fn started(&self, id: &str, transfer: impl Future<Output = Result<u64, Failure>>) -> Result<u64, Failure> {
        let mut transfer = pin!(transfer);
        let mut first = true;
        poll_fn(|cx| {
            let polled = transfer.as_mut().poll(cx);
            if first {
                first = false;
                // A call that was refused is over at once; one that is pending is in the engine.
                if self.early.take(id) && matches!(polled, Poll::Pending) {
                    let _ = self.engine.cancel(id);
                }
            }
            polled
        })
        .await
    }

    /// Cancel the transfer `id`: true when one was queued, waiting or running. When none is, the
    /// cancel is remembered for a few seconds: its transfer may be on its way, and then it settles
    /// as `cancelled` when it arrives.
    ///
    /// Must run on the async runtime: the engine starts tasks.
    #[must_use]
    pub fn cancel(&self, id: &str) -> bool {
        // Remembered first, so that a transfer that reaches the engine between the two steps finds it.
        self.early.remember(id);
        let found = self.engine.cancel(id);
        if found {
            self.early.take(id);
        }
        found
    }

    /// Cancel every transfer, wait until each has settled, and close the connection (1001): the page
    /// is gone, the window closes, the app quits.
    pub async fn leave(&self) {
        self.early.clear();
        self.engine.cancel_all_and_close(Close::GoingAway).await;
    }

    /// [`Self::leave`] on the async runtime, without waiting: the receiver hears when it is done.
    pub fn leave_in_background(&self) -> Receiver<()> {
        self.early.clear();
        let (done, finished) = channel();
        let engine = Arc::clone(&self.engine);
        tauri::async_runtime::spawn(async move {
            engine.cancel_all_and_close(Close::GoingAway).await;
            let _ = done.send(());
        });
        finished
    }

    /// Wait for [`Self::leave_in_background`], for at most [`LEAVE_WAIT`]. For a thread that is not a
    /// worker of the async runtime (a blocking-pool or plain thread).
    pub fn wait_left(left: &Receiver<()>) {
        if left.recv_timeout(LEAVE_WAIT).is_err() {
            log::warn!("the file transfers were not all stopped within {} s", LEAVE_WAIT.as_secs());
        }
    }

    /// The machine woke, the network changed, or the page's own connection to the daemon opened: the
    /// daemon may be reachable now, so a wait before the next attempt ends. Callable from any thread.
    pub fn wake(&self) {
        let engine = Arc::clone(&self.engine);
        tauri::async_runtime::spawn(async move { engine.wake() });
    }
}

/// `transfer_progress`. A page that is not listening, or an event that cannot be sent, costs a stale
/// percentage: the command's answer is what settles a transfer.
fn tell_page<R: Runtime>(handle: &AppHandle<R>, event: &Event) {
    let payload = json!({ "id": event.id, "state": event.state.as_str(), "done": event.done, "total": event.total });
    if let Err(e) = handle.emit(EVENT, payload) {
        log::warn!("the `{EVENT}` event was not sent: {e}");
    }
}

/// The engine's snapshot as the shell's view. `entry` is the entry of the last attempt to open the
/// connection; it is shown only while there is a connection or an attempt.
fn view(snapshot: &EngineSnapshot, entry: Option<String>) -> Snapshot {
    let state = match snapshot.connection.state {
        ConnectionState::Closed => BulkState::Closed,
        ConnectionState::Connecting => BulkState::Connecting,
        ConnectionState::Open => BulkState::Open,
        ConnectionState::Waiting => BulkState::Waiting,
    };
    Snapshot {
        connection: BulkView { state, entry_id: entry.filter(|_| state != BulkState::Closed), opens: snapshot.connection.opens },
        active: snapshot
            .active
            .iter()
            .map(|transfer| ActiveView {
                id: transfer.id.clone(),
                kind: match transfer.kind {
                    Kind::Upload => TransferKind::Upload,
                    Kind::Save => TransferKind::Save,
                },
                // An active transfer is running or waiting for the connection; a queued one is not listed.
                state: if transfer.state == TransferState::Running { ActiveState::Running } else { ActiveState::Waiting },
                bytes_done: transfer.done,
                bytes_total: transfer.total,
                restarts: u64::from(transfer.restarts),
            })
            .collect(),
        queued: u64::try_from(snapshot.queued).unwrap_or(u64::MAX),
        totals: Totals { done: snapshot.totals.done, failed: snapshot.totals.failed, cancelled: snapshot.totals.cancelled },
        peak_held: snapshot.peak_held,
        last_error: snapshot.last_error.map(|e| ConnectionError { code: e.code, at_ms: e.at_ms }),
    }
}

#[cfg(test)]
mod tests {
    use pistudiodesktop_transfer::engine::{ActiveTransfer, ConnectionInfo, LastError, Totals as EngineTotals};

    use super::*;

    #[test]
    fn a_cancel_is_remembered_once_taken_once_and_forgotten_after_its_time() {
        let early = EarlyCancels::default();
        assert!(!early.take("a"));
        early.remember("a");
        early.remember("a");
        assert!(early.take("a"));
        assert!(!early.take("a"), "taken once");
        early.remember("b");
        assert!(!early.take_at("b", Instant::now() + EARLY_CANCEL_TTL), "forgotten after {EARLY_CANCEL_TTL:?}");
    }

    #[test]
    fn at_most_sixty_four_cancels_are_kept_and_the_oldest_goes_first_and_a_long_id_is_not_kept() {
        let early = EarlyCancels::default();
        for n in 0..EARLY_CANCEL_MAX + 5 {
            early.remember(&format!("t{n}"));
        }
        assert_eq!(locked(&early.0).len(), EARLY_CANCEL_MAX);
        assert!(!early.take("t0") && !early.take("t4"), "the five oldest were dropped");
        assert!(early.take("t5") && early.take(&format!("t{}", EARLY_CANCEL_MAX + 4)));
        early.remember(&"x".repeat(MAX_ID_BYTES + 1));
        assert_eq!(locked(&early.0).len(), EARLY_CANCEL_MAX - 2, "a longer id than any transfer has is not kept");
        early.clear();
        assert!(locked(&early.0).is_empty());
    }

    #[test]
    fn a_refused_plan_is_retried_only_while_the_local_daemon_may_still_come_up() {
        for code in ["local_not_ready", "local_stopped", "timeout", "busy"] {
            assert!(connect_error(transport::plan_failure(code_static(code))).retry, "{code}");
        }
        for code in ["not_bridged", "no_current", "unsupported", "internal", "secret_missing", "secret_unavailable"] {
            assert!(!connect_error(transport::plan_failure(code_static(code))).retry, "{code}");
        }
        let relay = connect_error(transport::plan_failure("not_bridged"));
        assert_eq!(relay.code, "not_bridged");
    }

    fn code_static(code: &str) -> &'static str {
        pistudiodesktop_shell::daemons::static_code(code)
    }

    #[test]
    fn the_snapshot_becomes_the_view_with_the_entry_only_while_there_is_a_connection() {
        let snapshot = EngineSnapshot {
            connection: ConnectionInfo { state: ConnectionState::Open, opens: 2 },
            active: vec![
                ActiveTransfer { id: "a".into(), kind: Kind::Upload, state: TransferState::Running, done: 5, total: Some(9), restarts: 1 },
                ActiveTransfer { id: "b".into(), kind: Kind::Save, state: TransferState::Waiting, done: 0, total: None, restarts: 0 },
            ],
            queued: 3,
            totals: EngineTotals { done: 1, failed: 2, cancelled: 3 },
            peak_held: 77,
            last_error: Some(LastError { code: "unreachable", at_ms: 8 }),
        };
        let shown = view(&snapshot, Some("e1".into()));
        assert_eq!((shown.connection.state, shown.connection.entry_id.as_deref(), shown.connection.opens), (BulkState::Open, Some("e1"), 2));
        assert_eq!(shown.active.len(), 2);
        assert_eq!(
            (shown.active[0].kind, shown.active[0].state, shown.active[0].bytes_done, shown.active[0].bytes_total),
            (TransferKind::Upload, ActiveState::Running, 5, Some(9))
        );
        assert_eq!((shown.active[1].kind, shown.active[1].state, shown.active[0].restarts), (TransferKind::Save, ActiveState::Waiting, 1));
        assert_eq!((shown.queued, shown.peak_held, shown.totals.failed), (3, 77, 2));
        assert_eq!(shown.last_error, Some(ConnectionError { code: "unreachable", at_ms: 8 }));
        let closed = EngineSnapshot { connection: ConnectionInfo { state: ConnectionState::Closed, opens: 2 }, active: Vec::new(), ..snapshot };
        assert_eq!(view(&closed, Some("e1".into())).connection.entry_id, None);
    }
}
