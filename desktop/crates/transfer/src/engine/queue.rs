//! The queue, the bulk connection's life and the settlement of transfers: everything the engine
//! decides, in one place.
//!
//! All state sits under one lock and every decision is a short, synchronous step on it; what takes
//! time (dialling, a transfer's bytes, the close handshake, the discard of a save) runs in tasks that
//! come back to the lock with their result. A transfer is in exactly one place:
//!
//! * `queue`: waiting for a turn, in the order it was started;
//! * `active`, `Waiting`: it has a turn and the connection is not open yet;
//! * `active`, `Running`: a task runs it over the open connection.
//!
//! The connection is `Closed`, `Connecting` or `Open`. It is dialled when a transfer gets a turn and
//! there is none. It ends in three ways: the idle timer (30 s after nothing is active or queued), a
//! close from the caller, or the connection itself ending. Every change goes through [`Inner::pump`], so
//! that the rules of the queue (at most `max_transfers` active, first in first out, connection on
//! demand, idle timer) hold after any of them.

use std::collections::VecDeque;
use std::mem;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::FutureExt;
use tokio::runtime::Handle;
use tokio::sync::{oneshot, watch};
use tokio::task::AbortHandle;
use tokio::time::Instant;

use super::connector::Connector;
use super::event::{Events, Reporter, TransferState};
use super::failure::Failure;
use super::snapshot::{ActiveTransfer, ConnectionInfo, ConnectionState, Kind, LastError, Snapshot, Totals};
use super::work::{Cancel, Ended, Run, Work};
use crate::connection::{Close, Connection, Hello};
use crate::held::Held;
use crate::limits::{Limits, MAX_PATH_BYTES};

/// The longest id the page may give a transfer.
const MAX_ID_BYTES: usize = 64;

/// What a start resolves with: the bytes, or why not.
pub(super) type Outcome = Result<u64, Failure>;

/// A start that was refused, and the work that was not taken: the caller discards it.
pub(super) struct Rejected {
    pub failure: Failure,
    pub work: Box<dyn Work>,
}

struct Transfer {
    id: String,
    kind: Kind,
    /// Held here while the transfer waits, and by its task while it runs.
    work: Option<Box<dyn Work>>,
    reply: oneshot::Sender<Outcome>,
    reporter: Arc<Reporter>,
    cancel: watch::Sender<bool>,
    state: TransferState,
    restarts: u32,
}

#[derive(Default)]
enum Conn {
    #[default]
    Closed,
    Connecting {
        generation: u64,
        task: AbortHandle,
    },
    Open {
        generation: u64,
        connection: Arc<Connection>,
    },
}

#[derive(Default)]
struct State {
    queue: VecDeque<Transfer>,
    active: Vec<Transfer>,
    conn: Conn,
    /// Counts the connections made, so that a late result about an old one is not taken for the current one.
    generation: u64,
    idle: Option<AbortHandle>,
    /// Counts the starts and stops of the idle timer, so that a timer that has already fired is told it is stale.
    idle_epoch: u64,
    opens: u64,
    totals: Totals,
    last_error: Option<LastError>,
    /// Transfers whose start has not been answered yet.
    pending: usize,
}

pub(super) struct Inner<C> {
    connector: C,
    client_id: String,
    app_version: String,
    limits: Limits,
    events: Events,
    held: Held,
    /// The engine's clock: tokio's, from the wall time at which the engine was made.
    started: Instant,
    started_ms: u64,
    attempts: AtomicU64,
    state: Mutex<State>,
    busy: watch::Sender<usize>,
}

/// Whether `id` and `path` are acceptable: the id is 1 to 64 characters of `A-Z a-z 0-9 -`, the path is
/// not empty and not longer than the daemon's.
fn invalid(id: &str, path: &str) -> Option<Failure> {
    if id.is_empty() || id.len() > MAX_ID_BYTES || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-') {
        return Some(Failure::invalid_request("the id must be 1 to 64 letters, digits or hyphens"));
    }
    if path.is_empty() || path.len() > MAX_PATH_BYTES {
        return Some(Failure::invalid_request("the path must be 1 to 4096 bytes"));
    }
    None
}

impl<C: Connector> Inner<C> {
    pub fn new(connector: C, client_id: String, app_version: String, limits: Limits, events: Events) -> Arc<Self> {
        let started_ms = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| u64::try_from(since.as_millis()).unwrap_or(u64::MAX));
        Arc::new(Self {
            connector,
            client_id,
            app_version,
            limits,
            events,
            held: Held::new(),
            started: Instant::now(),
            started_ms,
            attempts: AtomicU64::new(0),
            state: Mutex::new(State::default()),
            busy: watch::channel(0).0,
        })
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // Nothing under the lock can panic; if a callback did, the state is as it was.
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn slots(&self) -> usize {
        self.limits.max_transfers.max(1)
    }

    fn now_ms(&self) -> u64 {
        let elapsed = Instant::now().saturating_duration_since(self.started);
        self.started_ms.saturating_add(u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
    }

    // ---- the calls ----

    /// Puts a transfer in the queue. The answer arrives when it has settled.
    pub fn submit(self: &Arc<Self>, id: &str, path: &str, work: Box<dyn Work>, total: Option<u64>) -> Result<oneshot::Receiver<Outcome>, Rejected> {
        let mut st = self.lock();
        let refusal = invalid(id, path).or_else(|| (st.queue.iter().chain(&st.active).any(|transfer| transfer.id == id)).then(Failure::duplicate_id));
        if let Some(failure) = refusal {
            return Err(Rejected { failure, work });
        }
        let (reply, answer) = oneshot::channel();
        let reporter = Arc::new(Reporter::new(id, total, Arc::clone(&self.events), self.limits.progress_interval));
        let waits = st.active.len() >= self.slots();
        if waits {
            reporter.state_changed(TransferState::Queued);
        }
        st.pending = st.pending.saturating_add(1);
        self.busy.send_replace(st.pending);
        st.queue.push_back(Transfer {
            id: id.to_owned(),
            kind: work.kind(),
            work: Some(work),
            reply,
            reporter,
            cancel: watch::channel(false).0,
            state: TransferState::Queued,
            restarts: 0,
        });
        self.pump(&mut st);
        Ok(answer)
    }

    /// Cancels one transfer, queued or active. False when there is none with this id.
    pub fn cancel(self: &Arc<Self>, id: &str) -> bool {
        let mut st = self.lock();
        if let Some(position) = st.queue.iter().position(|transfer| transfer.id == id)
            && let Some(transfer) = st.queue.remove(position)
        {
            self.cancel_unstarted(&mut st, transfer);
            self.pump(&mut st);
            return true;
        }
        let Some(position) = st.active.iter().position(|transfer| transfer.id == id) else { return false };
        if st.active.get(position).is_some_and(|transfer| transfer.work.is_some()) {
            // It has a turn but no connection yet: nothing runs, so nothing needs to stop.
            let transfer = st.active.remove(position);
            self.cancel_unstarted(&mut st, transfer);
            self.pump(&mut st);
        } else if let Some(transfer) = st.active.get(position) {
            // Its task stops, tells the daemon, and settles it.
            transfer.cancel.send_replace(true);
        }
        true
    }

    /// Cancels every transfer, waits until each has settled, and closes the connection.
    pub async fn close(self: &Arc<Self>, how: Close) {
        {
            let mut st = self.lock();
            self.cancel_everything(&mut st);
            self.stop_connecting(&mut st);
            self.stop_idle(&mut st);
        }
        let _ = self.busy.subscribe().wait_for(|pending| *pending == 0).await;
        let connection = {
            let mut st = self.lock();
            self.take_open(&mut st)
        };
        if let Some(connection) = connection {
            connection.close(how).await;
        }
    }

    /// The engine is going away without waiting: everything stops, and the connection is hung up.
    pub fn shut_down(self: &Arc<Self>) {
        let connection = {
            let mut st = self.lock();
            self.cancel_everything(&mut st);
            self.stop_connecting(&mut st);
            self.take_open(&mut st)
        };
        if let Some(connection) = connection {
            connection.hang_up();
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        let st = self.lock();
        let state = match st.conn {
            Conn::Closed => ConnectionState::Closed,
            Conn::Connecting { .. } => ConnectionState::Connecting,
            Conn::Open { .. } => ConnectionState::Open,
        };
        let active = st
            .active
            .iter()
            .map(|transfer| {
                let (done, total) = transfer.reporter.counts();
                ActiveTransfer { id: transfer.id.clone(), kind: transfer.kind, state: transfer.state, done, total, restarts: transfer.restarts }
            })
            .collect();
        Snapshot {
            connection: ConnectionInfo { state, opens: st.opens },
            active,
            queued: st.queue.len(),
            totals: st.totals,
            peak_held: self.held.peak(),
            last_error: st.last_error,
        }
    }

    // ---- the queue ----

    /// Brings the queue and the connection in line with what the transfers need. Called after every
    /// change, with the lock held.
    fn pump(self: &Arc<Self>, st: &mut State) {
        if !st.queue.is_empty() || !st.active.is_empty() {
            self.stop_idle(st);
        }
        while st.active.len() < self.slots() {
            let Some(transfer) = st.queue.pop_front() else { break };
            self.activate(st, transfer);
        }
        if !st.active.is_empty() && matches!(st.conn, Conn::Closed) {
            self.open(st);
        }
        self.rest(st);
    }

    /// Gives `transfer` its turn: it runs when the connection is open, and waits for it otherwise.
    fn activate(self: &Arc<Self>, st: &mut State, mut transfer: Transfer) {
        let open = match &st.conn {
            Conn::Open { generation, connection } => Some((*generation, Arc::clone(connection))),
            Conn::Closed | Conn::Connecting { .. } => None,
        };
        if let Some((generation, connection)) = open {
            transfer.state = TransferState::Running;
            transfer.reporter.state_changed(TransferState::Running);
            self.launch(&mut transfer, connection, generation);
        } else {
            transfer.state = TransferState::Waiting;
            transfer.reporter.state_changed(TransferState::Waiting);
        }
        st.active.push(transfer);
    }

    /// Runs `transfer`'s work in a task of its own, over `connection`. The task settles the transfer
    /// when the attempt ends, and a panic in it is a failure, not a hang.
    fn launch(self: &Arc<Self>, transfer: &mut Transfer, connection: Arc<Connection>, generation: u64) {
        let Some(mut work) = transfer.work.take() else { return };
        let inner = Arc::clone(self);
        let id = transfer.id.clone();
        let reporter = Arc::clone(&transfer.reporter);
        let cancel = Cancel::new(transfer.cancel.subscribe());
        let transfer_id = format!("{}-{}", self.client_id, self.attempts.fetch_add(1, Ordering::Relaxed));
        tokio::spawn(async move {
            let run = Run { connection: &connection, cancel, reporter: &reporter, limits: &inner.limits, held: &inner.held, transfer_id };
            let ended = match AssertUnwindSafe(work.run(run)).catch_unwind().await {
                Ok(ended) => ended,
                Err(_) => Ended::Failed(Failure::internal("a transfer stopped unexpectedly")),
            };
            inner.finish(&id, generation, work, ended);
        });
    }

    /// A transfer's attempt ended.
    fn finish(self: &Arc<Self>, id: &str, generation: u64, work: Box<dyn Work>, ended: Ended) {
        let mut st = self.lock();
        let Some(position) = st.active.iter().position(|transfer| transfer.id == id) else { return };
        let transfer = st.active.remove(position);
        let lost = matches!(ended, Ended::Lost(_));
        self.conclude(&mut st, transfer, work, ended);
        if lost {
            self.forget(&mut st, generation);
        }
        self.pump(&mut st);
    }

    /// Counts a transfer's end and answers its start.
    fn conclude(self: &Arc<Self>, st: &mut State, transfer: Transfer, work: Box<dyn Work>, ended: Ended) {
        let reply = transfer.reply;
        match ended {
            Ended::Done(bytes) => {
                st.totals.done = st.totals.done.saturating_add(1);
                self.answer(st, reply, Ok(bytes));
            }
            Ended::Cancelled => {
                st.totals.cancelled = st.totals.cancelled.saturating_add(1);
                self.answer(st, reply, Err(Failure::cancelled()));
            }
            Ended::Failed(failure) => {
                self.count_failure(st, &failure);
                self.answer(st, reply, Err(failure));
            }
            Ended::Lost(failure) => {
                // The attempt left a save's temporary file for a resume; nothing resumes it yet.
                self.count_failure(st, &failure);
                self.retire(st, Some(work), reply, Err(failure));
            }
        }
    }

    /// A transfer that never ran, or that will not run again: cancelled before its turn or while it
    /// waited for the connection.
    fn cancel_unstarted(self: &Arc<Self>, st: &mut State, mut transfer: Transfer) {
        st.totals.cancelled = st.totals.cancelled.saturating_add(1);
        self.retire(st, transfer.work.take(), transfer.reply, Err(Failure::cancelled()));
    }

    fn count_failure(&self, st: &mut State, failure: &Failure) {
        st.totals.failed = st.totals.failed.saturating_add(1);
        st.last_error = Some(LastError { code: failure.code, at_ms: self.now_ms() });
    }

    /// Answers a start: the transfer is no longer the engine's.
    fn answer(&self, st: &mut State, reply: oneshot::Sender<Outcome>, outcome: Outcome) {
        let _ = reply.send(outcome);
        st.pending = st.pending.saturating_sub(1);
        self.busy.send_replace(st.pending);
    }

    /// Releases what `work` holds (a save's temporary file), then answers the start: the answer says
    /// the file is gone.
    fn retire(self: &Arc<Self>, st: &mut State, work: Option<Box<dyn Work>>, reply: oneshot::Sender<Outcome>, outcome: Outcome) {
        let (Some(mut work), Ok(runtime)) = (work, Handle::try_current()) else {
            self.answer(st, reply, outcome);
            return;
        };
        let inner = Arc::clone(self);
        runtime.spawn(async move {
            work.discard().await;
            let mut st = inner.lock();
            inner.answer(&mut st, reply, outcome);
        });
    }

    /// Cancels every transfer: those that have not started settle at once, the others are told to stop.
    fn cancel_everything(self: &Arc<Self>, st: &mut State) {
        for transfer in mem::take(&mut st.queue) {
            self.cancel_unstarted(st, transfer);
        }
        for transfer in mem::take(&mut st.active) {
            if transfer.work.is_some() {
                self.cancel_unstarted(st, transfer);
            } else {
                transfer.cancel.send_replace(true);
                st.active.push(transfer);
            }
        }
    }

    // ---- the connection ----

    /// Dials a connection for the transfers that wait.
    fn open(self: &Arc<Self>, st: &mut State) {
        st.generation = st.generation.saturating_add(1);
        let generation = st.generation;
        let inner = Arc::clone(self);
        let task = tokio::spawn(async move {
            let opened = inner.dial().await;
            inner.opened(generation, opened);
        });
        st.conn = Conn::Connecting { generation, task: task.abort_handle() };
    }

    async fn dial(&self) -> Result<Connection, Failure> {
        let socket = self.connector.connect().await.map_err(Failure::from)?;
        let hello = Hello { client_id: &self.client_id, app_version: &self.app_version };
        Ok(Connection::open_counting(socket, &hello, self.limits, self.held.clone()).await?)
    }

    /// The dial of `generation` is over.
    fn opened(self: &Arc<Self>, generation: u64, opened: Result<Connection, Failure>) {
        let mut st = self.lock();
        if !matches!(st.conn, Conn::Connecting { generation: current, .. } if current == generation) {
            return;
        }
        match opened {
            Ok(connection) => {
                let connection = Arc::new(connection);
                st.opens = st.opens.saturating_add(1);
                st.conn = Conn::Open { generation, connection: Arc::clone(&connection) };
                self.watch(&connection, generation);
                for transfer in &mut st.active {
                    transfer.state = TransferState::Running;
                    transfer.reporter.state_changed(TransferState::Running);
                    self.launch(transfer, Arc::clone(&connection), generation);
                }
                self.rest(&mut st);
            }
            Err(failure) => {
                st.conn = Conn::Closed;
                self.fail_all(&mut st, &failure);
            }
        }
    }

    /// The connection cannot open: every transfer that waits for it, or for its turn, fails.
    fn fail_all(self: &Arc<Self>, st: &mut State, failure: &Failure) {
        let transfers: Vec<Transfer> = mem::take(&mut st.active).into_iter().chain(mem::take(&mut st.queue)).collect();
        for mut transfer in transfers {
            self.count_failure(st, failure);
            self.retire(st, transfer.work.take(), transfer.reply, Err(failure.clone()));
        }
    }

    /// Tells the engine when `connection` ends, however it does.
    fn watch(self: &Arc<Self>, connection: &Arc<Connection>, generation: u64) {
        let inner = Arc::clone(self);
        let connection = Arc::clone(connection);
        tokio::spawn(async move {
            connection.ended().await;
            inner.dropped(generation);
        });
    }

    /// The open connection of `generation` ended. The transfers on it fail by themselves.
    fn dropped(self: &Arc<Self>, generation: u64) {
        let mut st = self.lock();
        if matches!(st.conn, Conn::Open { generation: current, .. } if current == generation) {
            st.conn = Conn::Closed;
            self.stop_idle(&mut st);
        }
    }

    /// A transfer lost its connection: close it, so that the next transfer dials another.
    fn forget(self: &Arc<Self>, st: &mut State, generation: u64) {
        if !matches!(st.conn, Conn::Open { generation: current, .. } if current == generation) {
            return;
        }
        if let Some(connection) = self.take_open(st) {
            // An ended connection closes at once; one that only stopped answering gets its close frame.
            tokio::spawn(async move { connection.close(Close::Normal).await });
        }
    }

    fn take_open(&self, st: &mut State) -> Option<Arc<Connection>> {
        self.stop_idle(st);
        match mem::take(&mut st.conn) {
            Conn::Open { connection, .. } => Some(connection),
            other => {
                st.conn = other;
                None
            }
        }
    }

    fn stop_connecting(&self, st: &mut State) {
        if let Conn::Connecting { task, .. } = &st.conn {
            task.abort();
            st.conn = Conn::Closed;
        }
    }

    // ---- the idle timer ----

    /// With nothing active or queued: a connection that is being dialled is not needed, and one that is
    /// open gets the idle timer.
    fn rest(self: &Arc<Self>, st: &mut State) {
        if !st.active.is_empty() || !st.queue.is_empty() {
            return;
        }
        match &st.conn {
            Conn::Connecting { .. } => self.stop_connecting(st),
            Conn::Open { generation, .. } if st.idle.is_none() => {
                let generation = *generation;
                self.start_idle(st, generation);
            }
            Conn::Open { .. } | Conn::Closed => {}
        }
    }

    fn start_idle(self: &Arc<Self>, st: &mut State, generation: u64) {
        st.idle_epoch = st.idle_epoch.saturating_add(1);
        let epoch = st.idle_epoch;
        let inner = Arc::clone(self);
        let task = tokio::spawn(async move {
            tokio::time::sleep(inner.limits.idle_close).await;
            inner.idle_elapsed(epoch, generation).await;
        });
        st.idle = Some(task.abort_handle());
    }

    fn stop_idle(&self, st: &mut State) {
        if let Some(timer) = st.idle.take() {
            timer.abort();
        }
        st.idle_epoch = st.idle_epoch.saturating_add(1);
    }

    /// The idle time has passed: close the connection, unless something started in the meantime.
    async fn idle_elapsed(self: &Arc<Self>, epoch: u64, generation: u64) {
        let connection = {
            let mut st = self.lock();
            let current = matches!(st.conn, Conn::Open { generation: open, .. } if open == generation);
            if st.idle_epoch != epoch || !current || !st.active.is_empty() || !st.queue.is_empty() {
                return;
            }
            // The timer is this task: it must not abort itself while it closes.
            st.idle = None;
            self.take_open(&mut st)
        };
        if let Some(connection) = connection {
            connection.close(Close::Normal).await;
        }
    }
}
