//! What the engine says must hold no secret and no local path (D19, D20, S10): not in a failure's
//! code or message, not in an event, not in a snapshot. The test plants markers: a password in the
//! connector and the daemon, a local path and a handle-like string in a source and a sink (also in the
//! `Debug` of each, and in what a source panics with), and a path of the daemon's; then it makes the
//! engine succeed, fail and cancel in a dozen ways, and searches everything it said for them.
//!
//! The engine never holds a password (the connector does) nor a local path (the source or the sink does):
//! the test is the guard against the day it starts to print one.

use std::collections::BTreeSet;
use std::io;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Semaphore;
use tokio::task::JoinHandle;

use super::rigs::{Calls, RigSink};
use super::support::{Control, Result, Scripted, Seen, Step, engine_with, eventually, pattern, save, scripted, upload};
use crate::Limits;
use crate::download::Sink;
use crate::engine::{Engine, Failure};
use crate::testing::{After, Config, Direction, Fault, Request, StandInDaemon, StreamFault};
use crate::upload::UploadSource;

const PASSWORD: &str = "hunter2-PASSWORD-MARKER";
const WRONG_PASSWORD: &str = "guess-PASSWORD-MARKER";
const LOCAL_PATH: &str = "/home/someone/PATH-MARKER/private/photo.jpg";
const HANDLE: &str = "0123456789abcdef0123456789abcdef";
const DAEMON_PATH: &str = "/srv/DAEMON-PATH-MARKER/file.bin";

/// Everything that must never appear.
const MARKERS: [&str; 7] = [PASSWORD, WRONG_PASSWORD, "PASSWORD-MARKER", LOCAL_PATH, "PATH-MARKER", HANDLE, "DAEMON-PATH-MARKER"];

fn limits() -> Limits {
    Limits { backoff_start: Duration::from_millis(5), backoff_max: Duration::from_millis(20), answer_wait: Duration::from_millis(500), ..Limits::default() }
}

// ---- what the engine said ----

#[derive(Default)]
struct Said(BTreeSet<String>);

impl Said {
    fn add(&mut self, line: String) {
        self.0.insert(line);
    }

    fn failure(&mut self, failure: &Failure) {
        self.add(format!("{failure:?}"));
        self.add(failure.to_string());
        self.add(format!("{} {}", failure.code, failure.message));
    }

    fn events(&mut self, seen: &Seen) {
        for event in seen.all() {
            self.add(format!("{event:?}"));
        }
    }

    fn snapshot<C: crate::engine::Connector>(&mut self, engine: &Engine<C>) {
        self.add(format!("{:?}", engine.snapshot()));
    }

    /// Whether a line says `needle`.
    fn says(&self, needle: &str) -> bool {
        self.0.iter().any(|line| line.contains(needle))
    }

    /// The lines that hold a marker.
    fn leaks(&self) -> Vec<String> {
        self.0.iter().filter(|line| MARKERS.iter().any(|marker| line.contains(marker))).cloned().collect()
    }
}

/// Waits for a call to settle, taking a snapshot of the engine each millisecond meanwhile.
async fn finished<C: crate::engine::Connector>(said: &mut Said, engine: &Engine<C>, call: JoinHandle<Result>) -> Result {
    let started = std::time::Instant::now();
    while !call.is_finished() {
        said.snapshot(engine);
        assert!(started.elapsed() < Duration::from_secs(10), "a transfer did not settle");
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    said.snapshot(engine);
    let result = call.await.unwrap();
    if let Err(failure) = &result {
        said.failure(failure);
    }
    result
}

fn code(result: &Result) -> &'static str {
    match result {
        Ok(_) => "ok",
        Err(failure) => failure.code,
    }
}

// ---- a source and a sink that hold the markers ----

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum How {
    Fine,
    ReadError,
    RewindError,
    Panic,
    /// The source reports a size that is not its length.
    Claims,
}

/// A source that knows the local path and the handle it was made from, as the app's does.
#[derive(Debug)]
struct MarkedSource {
    local_path: String,
    handle: String,
    data: Vec<u8>,
    at: usize,
    how: How,
    /// A read waits for a permit.
    gate: Option<Arc<Semaphore>>,
}

impl MarkedSource {
    fn new(len: usize, how: How) -> Self {
        Self { local_path: LOCAL_PATH.to_owned(), handle: HANDLE.to_owned(), data: pattern(len), at: 0, how, gate: None }
    }

    /// A source that reads when the gate lets it.
    fn gated(len: usize) -> (Self, Arc<Semaphore>) {
        let gate = Arc::new(Semaphore::new(0));
        (Self { gate: Some(Arc::clone(&gate)), ..Self::new(len, How::Fine) }, gate)
    }
}

impl UploadSource for MarkedSource {
    fn size(&self) -> Option<u64> {
        let len = u64::try_from(self.data.len()).ok()?;
        Some(if self.how == How::Claims { len + 1 } else { len })
    }

    async fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if let Some(gate) = &self.gate {
            gate.acquire().await.map_err(|_| io::Error::other("the gate closed"))?.forget();
        }
        match self.how {
            // A source that fails in a way nobody planned for, with what it knows in its words.
            How::Panic => panic!("could not read {} (handle {})", self.local_path, self.handle),
            How::ReadError => return Err(io::Error::other("the disk failed")),
            _ => {}
        }
        let rest = self.data.get(self.at..).unwrap_or_default();
        let count = rest.len().min(buf.len());
        if let (Some(from), Some(to)) = (rest.get(..count), buf.get_mut(..count)) {
            to.copy_from_slice(from);
        }
        self.at += count;
        Ok(count)
    }

    async fn rewind(&mut self) -> io::Result<()> {
        if self.how == How::RewindError {
            return Err(io::Error::other("the disk failed"));
        }
        self.at = 0;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SinkHow {
    Fine,
    WriteError,
    FinishError,
}

/// A sink that knows the local path and the handle it was made from. It never reads them: they are there to
/// be found, in its `Debug`, if the engine ever prints the sink.
#[derive(Debug)]
#[allow(dead_code)]
struct MarkedSink {
    local_path: String,
    handle: String,
    inner: RigSink,
    how: SinkHow,
}

impl MarkedSink {
    fn new(how: SinkHow) -> (Self, Arc<Calls>) {
        let (inner, calls) = RigSink::keeping();
        (Self { local_path: LOCAL_PATH.to_owned(), handle: HANDLE.to_owned(), inner, how }, calls)
    }
}

impl Sink for MarkedSink {
    fn written(&self) -> u64 {
        self.inner.written()
    }

    async fn write(&mut self, data: &[u8]) -> io::Result<()> {
        if self.how == SinkHow::WriteError {
            return Err(io::Error::other("no space left on the device"));
        }
        self.inner.write(data).await
    }

    async fn finish(&mut self) -> io::Result<()> {
        if self.how == SinkHow::FinishError {
            return Err(io::Error::other("the file could not be put in place"));
        }
        self.inner.finish().await
    }

    async fn discard(&mut self) {
        self.inner.discard().await;
    }
}

// ---- the scene ----

struct Scene {
    daemon: Arc<StandInDaemon>,
    engine: Arc<Engine<Scripted>>,
    control: Control,
    seen: Seen,
}

/// A daemon that wants the password, and an engine whose connector offers `offered`.
async fn scene_for(offered: &str) -> Scene {
    let daemon = Arc::new(StandInDaemon::start_with(Config { password: Some(PASSWORD.to_owned()), ..Config::default() }).await.unwrap());
    daemon.put_file(DAEMON_PATH, pattern(100_000));
    let (connector, control) = scripted(&daemon, Some(offered));
    let (engine, seen) = engine_with(connector, limits());
    Scene { daemon, engine, control, seen }
}

fn spawn_upload(scene: &Scene, id: &str, source: MarkedSource) -> JoinHandle<Result> {
    upload(&scene.engine, id, DAEMON_PATH, source)
}

fn spawn_save(scene: &Scene, id: &str, sink: MarkedSink) -> JoinHandle<Result> {
    save(&scene.engine, id, DAEMON_PATH, sink)
}

// ---- the rows ----

async fn uploads(said: &mut Said) {
    for (how, want) in [(How::Fine, "ok"), (How::ReadError, "source_unreadable"), (How::Panic, "internal"), (How::Claims, "source_changed")] {
        let scene = scene_for(PASSWORD).await;
        let call = spawn_upload(&scene, "u", MarkedSource::new(70_000, how));
        assert_eq!(code(&finished(said, &scene.engine, call).await), want, "an upload with {how:?}");
        said.events(&scene.seen);
    }
    // A source that cannot rewind after the connection dropped.
    let scene = scene_for(PASSWORD).await;
    scene.daemon.script(Fault::Close { after: After::Frames(Direction::FromClient, 3), code: 1011 });
    let call = spawn_upload(&scene, "u", MarkedSource::new(200_000, How::RewindError));
    assert_eq!(code(&finished(said, &scene.engine, call).await), "source_unreadable", "a source that cannot rewind");
    said.events(&scene.seen);
    // A daemon that refuses it.
    let scene = scene_for(PASSWORD).await;
    scene.daemon.script(Fault::Refuse { request: Request::Upload, error: "no_free_stream".to_owned() });
    let call = spawn_upload(&scene, "u", MarkedSource::new(1000, How::Fine));
    assert_eq!(code(&finished(said, &scene.engine, call).await), "daemon_refused");
    said.events(&scene.seen);
}

async fn saves(said: &mut Said) {
    for (how, want) in [(SinkHow::Fine, "ok"), (SinkHow::WriteError, "disk"), (SinkHow::FinishError, "disk")] {
        let scene = scene_for(PASSWORD).await;
        let (sink, _) = MarkedSink::new(how);
        let call = spawn_save(&scene, "s", sink);
        assert_eq!(code(&finished(said, &scene.engine, call).await), want, "a save with {how:?}");
        said.events(&scene.seen);
    }
    // A file that is not there, and one that changed.
    let scene = scene_for(PASSWORD).await;
    let (sink, _) = MarkedSink::new(SinkHow::Fine);
    let missing = save(&scene.engine, "s", "/srv/DAEMON-PATH-MARKER/missing", sink);
    assert_eq!(code(&finished(said, &scene.engine, missing).await), "daemon_refused");
    scene.daemon.script(Fault::DownloadStream(StreamFault::ErrorFirst("changed".to_owned())));
    let (sink, _) = MarkedSink::new(SinkHow::Fine);
    let call = spawn_save(&scene, "s2", sink);
    assert_eq!(code(&finished(said, &scene.engine, call).await), "changed");
    said.events(&scene.seen);
}

/// A password the daemon refuses, and one it takes; a daemon without a feature.
async fn connections(said: &mut Said) {
    let scene = scene_for(WRONG_PASSWORD).await;
    let call = spawn_upload(&scene, "u", MarkedSource::new(10, How::Fine));
    assert_eq!(code(&finished(said, &scene.engine, call).await), "unauthorized");
    said.events(&scene.seen);
    // The same engine, then with a connector that does not fail.
    scene.control.push(Step::Dial);
    let call = spawn_upload(&scene, "u2", MarkedSource::new(10, How::Fine));
    assert_eq!(code(&finished(said, &scene.engine, call).await), "unauthorized", "the connector still offers the wrong password");
    said.events(&scene.seen);
}

/// A queue: one that is cancelled while it waits, one that is cancelled while it runs, and refusals before a start.
async fn queue(said: &mut Said) {
    let scene = scene_for(PASSWORD).await;
    let mut calls = Vec::new();
    let mut gates = Vec::new();
    for id in ["a", "b", "c", "d"] {
        let (source, gate) = MarkedSource::gated(2_000_000);
        gates.push(gate);
        calls.push(spawn_upload(&scene, id, source));
    }
    eventually("a transfer to wait", || scene.engine.snapshot().queued == 1 && scene.engine.snapshot().active.len() == 3).await;
    said.snapshot(&scene.engine);
    assert!(scene.engine.cancel("d"));
    assert!(scene.engine.cancel("a"));
    said.snapshot(&scene.engine);
    for gate in &gates {
        gate.add_permits(1000);
    }
    for call in calls {
        let result = finished(said, &scene.engine, call).await;
        assert!(matches!(code(&result), "ok" | "cancelled"));
    }
    said.events(&scene.seen);
    // Refused before it starts: a path that is too long (it is the daemon's, and has the marker), an id in use, a bad id.
    let long = format!("{}{}", DAEMON_PATH, "x".repeat(5000));
    let failure = scene.engine.upload("v", &long, MarkedSource::new(1, How::Fine)).await.unwrap_err();
    assert_eq!(failure.code, "invalid_request");
    said.failure(&failure);
    let failure = scene.engine.upload("bad id with a space", DAEMON_PATH, MarkedSource::new(1, How::Fine)).await.unwrap_err();
    assert_eq!(failure.code, "invalid_request");
    said.failure(&failure);
    let (sink, _) = MarkedSink::new(SinkHow::Fine);
    let failure = scene.engine.save("w", "", sink).await.unwrap_err();
    said.failure(&failure);
    said.snapshot(&scene.engine);
}

#[test]
fn the_search_finds_a_marker_where_there_is_one() {
    // The sources and the sinks do carry the markers in their `Debug`: a leak by `{:?}` would be found.
    let source = format!("{:?}", MarkedSource::new(1, How::Fine));
    let (sink, _) = MarkedSink::new(SinkHow::Fine);
    let sink = format!("{sink:?}");
    let mut said = Said::default();
    said.add("a line with no secret in it".to_owned());
    assert!(said.leaks().is_empty());
    said.add(source);
    said.add(sink);
    said.add(format!("the daemon refused the password {PASSWORD}"));
    said.add(format!("{} (daemon path)", DAEMON_PATH));
    assert_eq!(said.leaks().len(), 4, "{:?}", said.leaks());
}

#[tokio::test]
async fn no_password_no_local_path_and_no_handle_appears_in_an_error_an_event_or_a_snapshot() {
    let mut said = Said::default();
    uploads(&mut said).await;
    saves(&mut said).await;
    connections(&mut said).await;
    queue(&mut said).await;

    // The search is not empty-handed: it saw the words the engine does say.
    for words in
        ["source_unreadable", "the disk failed", "no space left on the device", "unauthorized", "invalid_request", "Running", "Waiting", "Queued", "peak_held"]
    {
        assert!(said.says(words), "the engine never said `{words}`; the search read {} lines", said.0.len());
    }
    assert_eq!(said.leaks(), Vec::<String>::new());
}
