//! What the two tasks and the callers of a connection share: who waits for what, and how every
//! waiter is told that the connection ended, once.

use std::collections::HashMap;
use std::mem;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::{Semaphore, mpsc, oneshot, watch};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

use super::download::Delivery;
use crate::error::{Ended, Error};
use crate::limits::Limits;
use crate::wire::inbound::{Ping, Reply, UploadComplete};
use crate::wire::outbound;

/// The frames each queue to the writer holds before a sender waits. Every sender waits for its own
/// frame to be written before it sends the next, so the queue is never longer than the number of
/// senders: a few transfers, the pings and the close.
const QUEUED_FRAMES: usize = 16;

/// What a request is answered with.
pub(super) type Answer = Result<Reply, Error>;

/// A frame for the writer, and the way to tell its sender that it has been written.
pub(super) struct Outgoing {
    pub message: Message,
    pub written: Option<oneshot::Sender<()>>,
}

/// The queues the writer task reads: `control` (pings, pongs and the farewell) is served before `outbox`
/// (the callers' frames), so that a ping is not stuck behind a long upload.
pub(super) struct Mailboxes {
    pub control: mpsc::Receiver<Outgoing>,
    pub outbox: mpsc::Receiver<Outgoing>,
}

/// Where a registered download's frames go.
#[derive(Clone)]
pub(super) struct StreamSlot {
    pub frames: mpsc::UnboundedSender<Delivery>,
    pub hold: Arc<Semaphore>,
}

#[derive(Default)]
struct State {
    /// Why the connection ended; set once.
    ended: Option<Error>,
    /// `close` was asked: nothing new is accepted, and the end counts as the engine's own.
    closing: bool,
    /// The counter the connection's own ids (requests, pings) come from.
    last_id: u64,
    requests: HashMap<String, oneshot::Sender<Answer>>,
    uploads: HashMap<String, oneshot::Sender<Result<UploadComplete, Error>>>,
    streams: HashMap<u8, StreamSlot>,
    /// Where the search for a free stream starts: after the one given last, so that an id is not
    /// handed out again while the daemon may still be sending the last frames of its previous user.
    next_stream: u8,
}

impl State {
    /// An error unless the connection is open and not being closed.
    fn usable(&self) -> Result<(), Error> {
        match &self.ended {
            Some(reason) => Err(reason.clone()),
            None if self.closing => Err(Error::Closed(Ended::Local)),
            None => Ok(()),
        }
    }

    fn free_stream(&mut self) -> Option<u8> {
        let first = self.next_stream;
        (0..=u8::MAX).map(|step| first.wrapping_add(step)).find(|id| !self.streams.contains_key(id)).inspect(|id| self.next_stream = id.wrapping_add(1))
    }
}

pub(super) struct Shared {
    pub limits: Limits,
    state: Mutex<State>,
    outbox: mpsc::Sender<Outgoing>,
    control: mpsc::Sender<Outgoing>,
    /// Turns true once, when the connection has ended: the tasks stop and `ended()` returns.
    stop: watch::Sender<bool>,
}

impl std::fmt::Debug for Shared {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Shared").finish_non_exhaustive()
    }
}

/// Completes once the connection has ended. A function of its own, with no value, so that a
/// `select!` branch does not keep the receiver borrowed through the value the receiver lends.
pub(super) async fn stopped(stop: &mut watch::Receiver<bool>) {
    let _ = stop.wait_for(|ended| *ended).await;
}

/// A close frame with `code` and no reason.
pub(super) fn close_message(code: CloseCode) -> Message {
    Message::Close(Some(CloseFrame { code, reason: "".into() }))
}

/// The `ping` that asks the daemon whether it is there.
pub(super) fn ping_message(request_id: &str) -> Message {
    Message::text(outbound::ping(request_id, epoch_ms()))
}

/// The answer to the daemon's `ping`.
pub(super) fn pong_message(ping: &Ping) -> Message {
    let now = epoch_ms();
    Message::text(outbound::pong(&ping.request_id, ping.client_sent_at, now, now))
}

/// Milliseconds since the epoch, for the timestamps of `ping` and `pong`; 0 on a clock set before 1970.
fn epoch_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
}

impl Shared {
    pub fn new(limits: Limits) -> (Arc<Self>, Mailboxes) {
        let (outbox, outbox_rx) = mpsc::channel(QUEUED_FRAMES);
        let (control, control_rx) = mpsc::channel(QUEUED_FRAMES);
        let (stop, _) = watch::channel(false);
        let shared = Arc::new(Self { limits, state: Mutex::new(State::default()), outbox, control, stop });
        (shared, Mailboxes { control: control_rx, outbox: outbox_rx })
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // Nothing in here can panic while it holds the lock; if a test did, the state is as it was.
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// A receiver that sees true once the connection has ended.
    pub fn subscribe(&self) -> watch::Receiver<bool> {
        self.stop.subscribe()
    }

    /// Why the connection ended, or [`Ended::Socket`] if it has not: a waiter whose answer never
    /// came is only ever left that way by an end.
    pub fn ended_error(&self) -> Error {
        self.lock().ended.clone().unwrap_or(Error::Closed(Ended::Socket))
    }

    /// An id of the connection's own, `r1`, `p2`, …: never repeated on one connection.
    fn fresh_id(state: &mut State, prefix: char) -> String {
        state.last_id = state.last_id.wrapping_add(1);
        format!("{prefix}{}", state.last_id)
    }

    pub fn ping_id(&self) -> String {
        Self::fresh_id(&mut self.lock(), 'p')
    }

    /// Ends the connection with `reason`, once: every request, upload and download that waits is told
    /// (a download after the frames already queued for it), the tasks stop, and `farewell` is sent as
    /// the last frame. Later calls do nothing. A connection that was being closed here ends as
    /// [`Ended::Local`] whatever the cause was.
    pub fn end(&self, reason: Error, farewell: Option<CloseCode>) {
        let (reason, requests, uploads, streams, goodbye) = {
            let mut state = self.lock();
            if state.ended.is_some() {
                return;
            }
            let reason = if state.closing { Error::Closed(Ended::Local) } else { reason };
            state.ended = Some(reason.clone());
            (reason, mem::take(&mut state.requests), mem::take(&mut state.uploads), mem::take(&mut state.streams), farewell.filter(|_| !state.closing))
        };
        for (_, waiter) in requests {
            let _ = waiter.send(Err(reason.clone()));
        }
        for (_, waiter) in uploads {
            let _ = waiter.send(Err(reason.clone()));
        }
        // Dropping the streams' senders lets a download read what is queued and then learn the reason.
        drop(streams);
        if let Some(code) = goodbye {
            self.try_control(close_message(code));
        }
        self.stop.send_replace(true);
    }

    /// Starts closing: false when the connection has ended or is being closed already.
    pub fn begin_close(&self) -> bool {
        let mut state = self.lock();
        if state.ended.is_some() || state.closing {
            return false;
        }
        state.closing = true;
        true
    }

    // ---- writing ----

    /// Writes a caller's frame and returns when it is on the socket.
    pub async fn send(&self, message: Message) -> Result<(), Error> {
        self.lock().usable()?;
        self.write(&self.outbox, message).await
    }

    /// Writes the close frame of a close the caller began, ahead of the callers' frames.
    pub async fn send_close(&self, message: Message) -> Result<(), Error> {
        self.write(&self.control, message).await
    }

    async fn write(&self, queue: &mpsc::Sender<Outgoing>, message: Message) -> Result<(), Error> {
        let (written, done) = oneshot::channel();
        queue.send(Outgoing { message, written: Some(written) }).await.map_err(|_| self.ended_error())?;
        // The writer drops the sender instead of answering when it stopped: the connection ended.
        done.await.map_err(|_| self.ended_error())
    }

    /// Queues a frame for the writer without waiting; dropped when the queue is full, as a `pong`
    /// the daemon will ask for again is worth less than a stalled reader.
    pub fn try_control(&self, message: Message) {
        let _ = self.control.try_send(Outgoing { message, written: None });
    }

    // ---- requests ----

    pub fn register_request(&self) -> Result<(String, oneshot::Receiver<Answer>), Error> {
        let mut state = self.lock();
        state.usable()?;
        let id = Self::fresh_id(&mut state, 'r');
        let (answer, waiting) = oneshot::channel();
        state.requests.insert(id.clone(), answer);
        Ok((id, waiting))
    }

    pub fn forget_request(&self, id: &str) {
        self.lock().requests.remove(id);
    }

    /// Hands an answer to its request; one nobody waits for (late, or never asked for) is dropped.
    pub fn answer(&self, id: &str, answer: Answer) {
        let waiter = self.lock().requests.remove(id);
        if let Some(waiter) = waiter {
            let _ = waiter.send(answer);
        }
    }

    // ---- uploads ----

    pub fn register_upload(&self, transfer_id: &str) -> Result<oneshot::Receiver<Result<UploadComplete, Error>>, Error> {
        let mut state = self.lock();
        state.usable()?;
        if state.uploads.contains_key(transfer_id) {
            return Err(Error::Internal("a transfer id is already waiting for its `file_upload_complete`"));
        }
        let (complete, waiting) = oneshot::channel();
        state.uploads.insert(transfer_id.to_owned(), complete);
        Ok(waiting)
    }

    pub fn forget_upload(&self, transfer_id: &str) {
        self.lock().uploads.remove(transfer_id);
    }

    /// Hands a `file_upload_complete` to its upload; one nobody waits for (the upload was cancelled)
    /// is dropped.
    pub fn complete_upload(&self, complete: UploadComplete) {
        let waiter = self.lock().uploads.remove(&complete.transfer_id);
        if let Some(waiter) = waiter {
            let _ = waiter.send(Ok(complete));
        }
    }

    // ---- downloads ----

    /// Takes a free stream id, 0 to 255, and routes its binary frames to `slot`.
    pub fn register_stream(&self, slot: StreamSlot) -> Result<u8, Error> {
        let mut state = self.lock();
        state.usable()?;
        let stream = state.free_stream().ok_or(Error::Internal("all 256 streams are in use"))?;
        state.streams.insert(stream, slot);
        Ok(stream)
    }

    pub fn release_stream(&self, stream: u8) {
        self.lock().streams.remove(&stream);
    }

    /// Where the frames of `stream` go, when a download is registered on it.
    pub fn stream_slot(&self, stream: u8) -> Option<StreamSlot> {
        self.lock().streams.get(&stream).cloned()
    }
}
