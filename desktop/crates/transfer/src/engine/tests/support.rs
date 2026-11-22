//! What the engine's tests share: a connector to the stand-in daemon, an event collector, a frozen
//! clock, and sources and sinks that a test can hold still and let go.

use std::collections::VecDeque;
use std::io;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant as RealInstant};

use pistudiodesktop_net::{DaemonSocket, dial};
use tokio::sync::Semaphore;
use tokio::task::JoinHandle;
use tokio::time::Instant;

use crate::Limits;
use crate::download::Sink;
use crate::engine::{Config, ConnectError, Connector, Engine, Event, Failure, TransferState};
use crate::testing::StandInDaemon;
use crate::upload::UploadSource;

/// The engine the tests use, shared so that a call can run in a task of its own.
pub type Handle = Arc<Engine<Dialer>>;

pub type Result = std::result::Result<u64, Failure>;

/// Bytes that are not periodic within a chunk, the same for the same `len`.
pub fn pattern(len: usize) -> Vec<u8> {
    (0..len).map(|index| u8::try_from((index * 31 + index / 251) % 256).unwrap_or(0)).collect()
}

/// Lets real time pass without blocking the runtime, so that sockets and tasks move.
pub async fn real_pause(millis: u64) {
    tokio::task::spawn_blocking(move || std::thread::sleep(Duration::from_millis(millis))).await.unwrap();
}

/// Waits, in real time, until `done`; a test that waits more than ten seconds has failed.
pub async fn eventually(what: &str, mut done: impl FnMut() -> bool) {
    let start = RealInstant::now();
    while !done() {
        assert!(start.elapsed() < Duration::from_secs(10), "{what} did not happen within ten seconds");
        real_pause(5).await;
    }
}

/// A frozen clock: it moves only when [`Frozen::advance`] says so.
///
/// `tokio::time::pause` alone lets the runtime run the clock ahead whenever it waits, including while
/// it waits for a socket, so a 15 s dial limit would fire before the connection that is already on its
/// way. A blocking task that runs for the whole test stops that (tokio's documented behaviour:
/// blocking tasks inhibit auto-advance), and the test then moves time itself.
pub struct Frozen {
    _release: std::sync::mpsc::Sender<()>,
}

impl Frozen {
    pub fn start() -> Self {
        tokio::time::pause();
        let (release, held) = std::sync::mpsc::channel::<()>();
        tokio::task::spawn_blocking(move || {
            let _ = held.recv();
        });
        Self { _release: release }
    }

    /// Gives the tasks real time to start their timers and move their bytes.
    pub async fn settle(&self) {
        real_pause(30).await;
    }

    /// Moves the clock by `total` in steps of at most five seconds, giving the sockets and tasks real
    /// time to react after each: the connection pings after ten seconds of silence and drops after
    /// thirty, and a pong must come back before the clock has run past that.
    pub async fn run_for(&self, total: Duration) {
        let mut left = total;
        while !left.is_zero() {
            let step = left.min(Duration::from_secs(5));
            tokio::time::advance(step).await;
            real_pause(15).await;
            left = left.saturating_sub(step);
        }
    }

    /// Moves the clock, then gives the sockets and tasks real time to react. A timer's deadline is
    /// rounded up to the next millisecond, so the clock moves 2 ms more than asked.
    pub async fn advance(&self, by: Duration) {
        tokio::time::advance(by + Duration::from_millis(2)).await;
        real_pause(15).await;
    }
}

// ---- connectors ----

/// Dials the stand-in daemon.
pub struct Dialer {
    url: String,
    max_message_bytes: usize,
}

impl Dialer {
    pub fn new(daemon: &StandInDaemon) -> Self {
        Self { url: daemon.url(), max_message_bytes: Limits::default().max_message_bytes }
    }
}

impl Connector for Dialer {
    async fn connect(&self) -> std::result::Result<DaemonSocket, ConnectError> {
        Ok(dial(&self.url, None, Duration::from_secs(5), self.max_message_bytes).await?)
    }
}

/// Dials the stand-in once a test lets it: until then every transfer waits for the connection.
pub struct HeldConnector {
    dialer: Dialer,
    pub gate: Arc<Semaphore>,
}

impl HeldConnector {
    pub fn new(daemon: &StandInDaemon) -> Self {
        Self { dialer: Dialer::new(daemon), gate: Arc::new(Semaphore::new(0)) }
    }
}

impl Connector for HeldConnector {
    async fn connect(&self) -> std::result::Result<DaemonSocket, ConnectError> {
        self.gate.acquire().await.map_err(|_| ConnectError::new("internal", "the gate closed", false))?.forget();
        self.dialer.connect().await
    }
}

/// A connector that always fails with this error.
pub struct Failing(pub ConnectError);

impl Connector for Failing {
    async fn connect(&self) -> std::result::Result<DaemonSocket, ConnectError> {
        Err(self.0.clone())
    }
}

// ---- events and engines ----

/// The events the engine told, in order.
#[derive(Clone, Default)]
pub struct Seen(Arc<Mutex<Vec<Event>>>);

impl Seen {
    pub fn all(&self) -> Vec<Event> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// The `(state, done)` of each event of transfer `id`.
    pub fn of(&self, id: &str) -> Vec<(TransferState, u64)> {
        self.all().into_iter().filter(|event| event.id == id).map(|event| (event.state, event.done)).collect()
    }

    /// The states of transfer `id`, with consecutive repeats collapsed (progress events repeat `Running`).
    pub fn states(&self, id: &str) -> Vec<TransferState> {
        let mut states: Vec<TransferState> = self.of(id).into_iter().map(|(state, _)| state).collect();
        states.dedup();
        states
    }
}

pub fn engine_with<C: Connector>(connector: C, limits: Limits) -> (Arc<Engine<C>>, Seen) {
    let seen = Seen::default();
    let sink = seen.clone();
    let mut config = Config::new("client-1", "pistudiodesktop/test");
    config.limits = limits;
    let engine = Engine::new(connector, config, move |event| sink.0.lock().unwrap_or_else(PoisonError::into_inner).push(event));
    (Arc::new(engine), seen)
}

pub fn engine(daemon: &StandInDaemon) -> (Handle, Seen) {
    engine_with(Dialer::new(daemon), Limits::default())
}

/// Runs an upload in a task of its own.
pub fn upload<C: Connector, S: UploadSource + 'static>(engine: &Arc<Engine<C>>, id: &str, path: &str, source: S) -> JoinHandle<Result> {
    let (engine, id, path) = (Arc::clone(engine), id.to_owned(), path.to_owned());
    tokio::spawn(async move { engine.upload(&id, &path, source).await })
}

/// Runs a save in a task of its own.
pub fn save<C: Connector, S: Sink + 'static>(engine: &Arc<Engine<C>>, id: &str, path: &str, sink: S) -> JoinHandle<Result> {
    let (engine, id, path) = (Arc::clone(engine), id.to_owned(), path.to_owned());
    tokio::spawn(async move { engine.save(&id, &path, sink).await })
}

// ---- sources and sinks ----

/// An upload source that reads one piece for each permit its gate holds, so that a test decides when
/// the upload moves. It holds its bytes in memory.
pub struct GatedSource {
    data: Vec<u8>,
    at: usize,
    gate: Arc<Semaphore>,
}

impl GatedSource {
    pub fn new(data: Vec<u8>) -> (Self, Arc<Semaphore>) {
        let gate = Arc::new(Semaphore::new(0));
        (Self { data, at: 0, gate: Arc::clone(&gate) }, gate)
    }
}

impl UploadSource for GatedSource {
    fn size(&self) -> Option<u64> {
        u64::try_from(self.data.len()).ok()
    }

    async fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.gate.acquire().await.map_err(|_| io::Error::other("the gate closed"))?.forget();
        let rest = self.data.get(self.at..).unwrap_or_default();
        let count = rest.len().min(buf.len());
        if let (Some(from), Some(to)) = (rest.get(..count), buf.get_mut(..count)) {
            to.copy_from_slice(from);
        }
        self.at += count;
        Ok(count)
    }

    async fn rewind(&mut self) -> io::Result<()> {
        self.at = 0;
        Ok(())
    }
}

/// A source whose read panics.
pub struct PanickingSource;

impl UploadSource for PanickingSource {
    fn size(&self) -> Option<u64> {
        Some(10)
    }

    #[allow(clippy::panic)]
    async fn read(&mut self, _buf: &mut [u8]) -> io::Result<usize> {
        panic!("a source that fails in a way nobody planned for");
    }

    async fn rewind(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// What a test sees of a sink the engine owns.
#[derive(Default)]
pub struct Probe {
    pub bytes: Mutex<Vec<u8>>,
    pub written: AtomicU64,
    pub finished: AtomicBool,
    pub discarded: AtomicBool,
}

impl Probe {
    pub fn bytes(&self) -> Vec<u8> {
        self.bytes.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    pub fn finished(&self) -> bool {
        self.finished.load(Ordering::SeqCst)
    }

    pub fn discarded(&self) -> bool {
        self.discarded.load(Ordering::SeqCst)
    }
}

/// A sink that a [`Probe`] watches. With a gate it takes one write for each permit; with `counting`
/// it keeps no bytes, so that a file of any size needs no memory.
pub struct ProbeSink {
    probe: Arc<Probe>,
    gate: Option<Arc<Semaphore>>,
    keep: bool,
}

impl ProbeSink {
    pub fn new() -> (Self, Arc<Probe>) {
        let probe = Arc::new(Probe::default());
        (Self { probe: Arc::clone(&probe), gate: None, keep: true }, probe)
    }

    pub fn counting() -> (Self, Arc<Probe>) {
        let (mut sink, probe) = Self::new();
        sink.keep = false;
        (sink, probe)
    }

    /// Like [`gated`](Self::gated), and it keeps the bytes it takes.
    pub fn gated_keeping() -> (Self, Arc<Probe>, Arc<Semaphore>) {
        let (mut sink, probe, gate) = Self::gated();
        sink.keep = true;
        (sink, probe, gate)
    }

    pub fn gated() -> (Self, Arc<Probe>, Arc<Semaphore>) {
        let (mut sink, probe) = Self::counting();
        let gate = Arc::new(Semaphore::new(0));
        sink.gate = Some(Arc::clone(&gate));
        (sink, probe, gate)
    }
}

impl Sink for ProbeSink {
    fn written(&self) -> u64 {
        self.probe.written.load(Ordering::SeqCst)
    }

    async fn write(&mut self, data: &[u8]) -> io::Result<()> {
        if let Some(gate) = &self.gate {
            gate.acquire().await.map_err(|_| io::Error::other("the gate closed"))?.forget();
        }
        if self.keep {
            self.probe.bytes.lock().unwrap_or_else(PoisonError::into_inner).extend_from_slice(data);
        }
        self.probe.written.fetch_add(u64::try_from(data.len()).unwrap_or(u64::MAX), Ordering::SeqCst);
        Ok(())
    }

    async fn finish(&mut self) -> io::Result<()> {
        self.probe.finished.store(true, Ordering::SeqCst);
        Ok(())
    }

    async fn discard(&mut self) {
        self.probe.discarded.store(true, Ordering::SeqCst);
    }
}

// ---- a connector that a test steers ----

/// What one attempt to open does.
pub enum Step {
    /// Dials the stand-in with the password.
    Dial,
    /// Dials the stand-in without the password.
    Bare,
    /// Dials this address, with no password.
    Url(String),
    /// Fails with this error.
    Refuse(ConnectError),
    /// Runs this, then dials the stand-in with the password.
    Before(Box<dyn FnOnce() + Send>),
    /// Waits for a permit of this gate (the engine is connecting meanwhile), then dials the stand-in with the password.
    Held(Arc<Semaphore>),
}

struct Inner {
    url: String,
    password: Option<String>,
    steps: Mutex<VecDeque<Step>>,
    refusal: Mutex<Option<ConnectError>>,
    times: Mutex<Vec<Instant>>,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What a test holds of its connector: the attempts so far and how the next ones go.
#[derive(Clone)]
pub struct Control(Arc<Inner>);

/// Dials the stand-in as the steps say, then as `Step::Dial`; fails while a standing refusal is set.
pub struct Scripted(Arc<Inner>);

pub fn scripted(daemon: &StandInDaemon, password: Option<&str>) -> (Scripted, Control) {
    let inner = Arc::new(Inner {
        url: daemon.url(),
        password: password.map(str::to_owned),
        steps: Mutex::default(),
        refusal: Mutex::default(),
        times: Mutex::default(),
    });
    (Scripted(Arc::clone(&inner)), Control(inner))
}

impl Control {
    pub fn push(&self, step: Step) {
        locked(&self.0.steps).push_back(step);
    }

    pub fn refuse(&self, error: ConnectError) {
        *locked(&self.0.refusal) = Some(error);
    }

    pub fn allow(&self) {
        *locked(&self.0.refusal) = None;
    }

    pub fn attempts(&self) -> usize {
        locked(&self.0.times).len()
    }

    /// The time between each attempt and the one before it.
    pub fn gaps(&self) -> Vec<Duration> {
        locked(&self.0.times).windows(2).map(|pair| pair[1].saturating_duration_since(pair[0])).collect()
    }
}

impl Connector for Scripted {
    async fn connect(&self) -> std::result::Result<DaemonSocket, ConnectError> {
        let inner = &self.0;
        locked(&inner.times).push(Instant::now());
        if let Some(error) = locked(&inner.refusal).clone() {
            return Err(error);
        }
        let step = locked(&inner.steps).pop_front().unwrap_or(Step::Dial);
        let (url, password) = match step {
            Step::Refuse(error) => return Err(error),
            Step::Dial => (inner.url.clone(), inner.password.clone()),
            Step::Bare => (inner.url.clone(), None),
            Step::Url(url) => (url, None),
            Step::Before(action) => {
                action();
                (inner.url.clone(), inner.password.clone())
            }
            Step::Held(gate) => {
                gate.acquire().await.map_err(|_| ConnectError::new("internal", "the gate closed", false))?.forget();
                (inner.url.clone(), inner.password.clone())
            }
        };
        Ok(dial(&url, password.as_deref(), Duration::from_secs(5), Limits::default().max_message_bytes).await?)
    }
}

pub fn unreachable() -> ConnectError {
    ConnectError::new("unreachable", "The daemon cannot be reached.", true)
}
