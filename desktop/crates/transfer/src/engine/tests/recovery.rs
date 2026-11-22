//! A connection that drops or will not open: the transfers wait and go on by themselves (D5, D12), a
//! save from its bytes and an upload from zero; what no wait can mend fails them at once.
//!
//! The waits run on a frozen clock (`support::Frozen`) that a test moves by hand, so an hour of refusals
//! costs a second of real time.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use tokio::task::JoinHandle;
use tokio::time::Instant;

use super::support::{Control, Frozen, ProbeSink, Result, Step, engine_with, eventually, pattern, save, scripted, unreachable, upload};
use crate::Limits;
use crate::engine::TransferState::{Running, Waiting};
use crate::engine::{ConnectError, ConnectionState, Connector, Engine, FINAL_CODES, Failure};
use crate::testing::{After, Config, Direction, Fault, Features, StandInDaemon};
use crate::upload::{MemorySource, UploadSource};

/// A server that answers every upgrade 502, as a reverse proxy does while its daemon restarts.
async fn bad_gateway() -> (String, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        while let Ok((mut tcp, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut request = [0u8; 4096];
                let _ = tcp.read(&mut request).await;
                let _ = tcp.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                let _ = tcp.shutdown().await;
            });
        }
    });
    (url, task)
}

// ---- helpers ----

fn state_of<C: Connector>(engine: &Engine<C>) -> ConnectionState {
    engine.snapshot().connection.state
}

/// Waits until the engine is waiting to dial again.
async fn waits<C: Connector>(engine: &Engine<C>) {
    eventually("the engine to wait for its next attempt", || state_of(engine) == ConnectionState::Waiting).await;
}

/// The attempt number `k` has failed and the engine waits `delay` for the next: the wait does not end
/// a little early, and ends at its time, with attempt `k + 1`.
async fn next_attempt<C: Connector>(engine: &Engine<C>, control: &Control, clock: &Frozen, delay: Duration, k: usize) {
    waits(engine).await;
    assert_eq!(control.attempts(), k, "an attempt came before the wait of {delay:?} was over");
    clock.advance(delay - Duration::from_millis(50)).await;
    assert_eq!(control.attempts(), k, "the wait of {delay:?} ended early");
    clock.advance(Duration::from_millis(100)).await;
    eventually("the next attempt", || control.attempts() == k + 1).await;
}

/// Waits until a spawned call has answered, and returns the answer.
async fn answer(call: JoinHandle<Result>) -> Result {
    eventually("the call to answer", || call.is_finished()).await;
    call.await.unwrap()
}

/// A source that reads like memory, counts its rewinds, and blocks in each until a test releases it.
struct Restartable {
    data: Vec<u8>,
    at: usize,
    rewinds: Arc<AtomicUsize>,
    hold: Arc<Semaphore>,
}

impl Restartable {
    fn new(data: Vec<u8>) -> (Self, Arc<AtomicUsize>, Arc<Semaphore>) {
        let (rewinds, hold) = (Arc::new(AtomicUsize::new(0)), Arc::new(Semaphore::new(0)));
        (Self { data, at: 0, rewinds: Arc::clone(&rewinds), hold: Arc::clone(&hold) }, rewinds, hold)
    }
}

impl UploadSource for Restartable {
    fn size(&self) -> Option<u64> {
        u64::try_from(self.data.len()).ok()
    }

    async fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let rest = self.data.get(self.at..).unwrap_or_default();
        let count = rest.len().min(buf.len());
        if let (Some(from), Some(to)) = (rest.get(..count), buf.get_mut(..count)) {
            to.copy_from_slice(from);
        }
        self.at += count;
        Ok(count)
    }

    async fn rewind(&mut self) -> std::io::Result<()> {
        self.at = 0;
        self.rewinds.fetch_add(1, Ordering::SeqCst);
        self.hold.acquire().await.map_err(|_| std::io::Error::other("the hold closed"))?.forget();
        Ok(())
    }
}

// ---- a drop: a save resumes, an upload starts again ----

#[tokio::test]
async fn a_save_cut_in_the_middle_resumes_at_its_bytes_with_the_guard_of_its_first_answer() {
    let daemon = StandInDaemon::start().await.unwrap();
    let data = pattern(32 * 1024 * 8);
    let info = daemon.put_file("/f/a", data.clone());
    // The daemon closes after 100,000 bytes: three whole chunks and 1,696 bytes of the fourth.
    daemon.script(Fault::Close { after: After::Bytes(Direction::ToClient, 100_000), code: 1011 });
    let (connector, _) = scripted(&daemon, None);
    let (engine, seen) = engine_with(connector, Limits::default());
    let (sink, probe, gate) = ProbeSink::gated_keeping();
    gate.add_permits(4);
    let call = save(&engine, "s", "/f/a", sink);

    // The second attempt is held at its first write: the transfer runs again, and has restarted once.
    eventually("the save to run again", || engine.snapshot().active.first().is_some_and(|transfer| transfer.restarts == 1 && transfer.state == Running)).await;
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.active[0].done, snapshot.active[0].total), (100_000, Some(262_144)));
    assert_eq!(snapshot.connection.opens, 2);
    let requests = daemon.download_requests();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].get("offset").is_none() && requests[0].get("ifUnchanged").is_none(), "{}", requests[0]);
    assert_eq!(requests[1]["offset"], 100_000);
    assert_eq!(requests[1]["ifUnchanged"], json!({ "size": 262_144, "mtimeMs": info.mtime_ms }));
    assert!(requests[1].get("length").is_none());

    gate.add_permits(100);
    assert_eq!(answer(call).await, Ok(262_144));
    assert_eq!(probe.bytes(), data);
    assert!(probe.finished() && !probe.discarded());
    // The loss told `waiting` once, and the engine ran the save again by itself.
    assert_eq!(seen.states("s"), [Waiting, Running, Waiting, Running]);
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.totals.done, snapshot.totals.failed), (1, 0));
    assert_eq!(snapshot.last_error.map(|error| error.code), Some("connection_lost"));
    assert_eq!(daemon.accepted_connections(), 2);
}

#[tokio::test]
async fn an_upload_cut_in_the_middle_starts_again_from_byte_0_with_a_new_transfer_id() {
    let daemon = StandInDaemon::start().await.unwrap();
    let data = pattern(32 * 1024 * 20);
    daemon.script(Fault::Close { after: After::Frames(Direction::FromClient, 3), code: 1011 });
    let (connector, _) = scripted(&daemon, None);
    let (engine, seen) = engine_with(connector, Limits::default());
    let (source, rewinds, hold) = Restartable::new(data.clone());
    let call = upload(&engine, "u", "/srv/u", source);

    // The second attempt is held in the rewind: it runs, and shows no byte done and one restart.
    eventually("the upload to start again", || rewinds.load(Ordering::SeqCst) == 1).await;
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.active[0].state, snapshot.active[0].done, snapshot.active[0].restarts), (Running, 0, 1));
    assert_eq!(daemon.file("/srv/u"), None, "nothing of the first attempt is on the daemon");

    hold.add_permits(1);
    assert_eq!(answer(call).await, Ok(655_360));
    assert_eq!(daemon.file("/srv/u"), Some(data));
    // One upload ended, whole, and it was the second attempt: the first never ended and left nothing (R3).
    let records = daemon.uploads();
    assert_eq!(records.len(), 1, "{records:?}");
    assert_eq!((records[0].transfer_id.as_str(), records[0].bytes_received, records[0].error.clone()), ("client-1-1", 655_360, None));
    assert_eq!(rewinds.load(Ordering::SeqCst), 1);
    assert_eq!(seen.states("u"), [Waiting, Running, Waiting, Running]);
    assert_eq!(daemon.accepted_connections(), 2);
}

#[tokio::test]
async fn a_source_that_cannot_rewind_fails_the_upload() {
    struct Stuck(MemorySource);
    impl UploadSource for Stuck {
        fn size(&self) -> Option<u64> {
            self.0.size()
        }
        async fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            self.0.read(buf).await
        }
        async fn rewind(&mut self) -> std::io::Result<()> {
            Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
        }
    }
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::Close { after: After::Frames(Direction::FromClient, 3), code: 1011 });
    let (connector, _) = scripted(&daemon, None);
    let (engine, _) = engine_with(connector, Limits::default());
    let failure = engine.upload("u", "/srv/u", Stuck(MemorySource::new(pattern(32 * 1024 * 20)))).await.unwrap_err();
    assert_eq!(failure.code, "source_unreadable");
    assert_eq!(daemon.file("/srv/u"), None);
}

// ---- a daemon that is not there ----

#[tokio::test]
async fn a_daemon_that_refuses_for_an_hour_gets_attempts_after_1_2_4_8_16_then_30_seconds_and_the_transfers_complete() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f/a", pattern(100_000));
    let (connector, control) = scripted(&daemon, None);
    control.refuse(unreachable());
    let (engine, seen) = engine_with(connector, Limits::default());
    let upload = upload(&engine, "u", "/srv/u", MemorySource::new(pattern(50_000)));
    let (sink, probe) = ProbeSink::new();
    let save = save(&engine, "s", "/f/a", sink);

    eventually("the first attempt", || control.attempts() == 1).await;
    waits(&engine).await;
    let snapshot = engine.snapshot();
    assert_eq!(snapshot.active.iter().map(|transfer| transfer.state).collect::<Vec<_>>(), [Waiting, Waiting]);
    assert_eq!(snapshot.last_error.map(|error| error.code), Some("unreachable"));

    // The delays: 1, 2, 4, 8, 16, then 30 s, and 30 s again.
    let delays = [1, 2, 4, 8, 16, 30, 30];
    for (k, delay) in delays.iter().enumerate() {
        next_attempt(&engine, &control, &clock, Duration::from_secs(*delay), k + 1).await;
    }
    for (gap, delay) in control.gaps().iter().zip(delays) {
        let delay = Duration::from_secs(delay);
        assert!(*gap >= delay && *gap < delay + Duration::from_millis(100), "{gap:?} for a wait of {delay:?}");
    }

    // The daemon stays away: one attempt each 30 s, for an hour of the paused clock.
    let started = Instant::now();
    let mut attempts = control.attempts();
    while Instant::now().saturating_duration_since(started) < Duration::from_secs(3600) {
        waits(&engine).await;
        tokio::time::advance(Duration::from_secs(30) + Duration::from_millis(2)).await;
        attempts += 1;
        eventually("one attempt for each 30 s", || control.attempts() == attempts).await;
    }
    waits(&engine).await;
    assert_eq!(engine.snapshot().active.iter().map(|transfer| transfer.state).collect::<Vec<_>>(), [Waiting, Waiting]);
    assert!(!upload.is_finished() && !save.is_finished());

    // It is back: the next attempt opens, and both transfers go on.
    control.allow();
    clock.advance(Duration::from_secs(30)).await;
    assert_eq!(answer(upload).await, Ok(50_000));
    assert_eq!(answer(save).await, Ok(100_000));
    assert_eq!(daemon.file("/srv/u").map(|bytes| bytes.len()), Some(50_000));
    assert_eq!(probe.bytes(), pattern(100_000));
    // Each told `waiting` once, for the whole hour, and `running` when it moved.
    assert_eq!(seen.states("u"), [Waiting, Running]);
    assert_eq!(seen.states("s"), [Waiting, Running]);
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.connection.opens, snapshot.totals.done, snapshot.totals.failed), (1, 2, 0));
}

#[tokio::test]
async fn a_wake_ends_a_wait_of_30_seconds_at_once() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    let (connector, control) = scripted(&daemon, None);
    control.refuse(unreachable());
    let (engine, _) = engine_with(connector, Limits::default());
    let call = upload(&engine, "u", "/srv/u", MemorySource::new(pattern(1000)));
    eventually("the first attempt", || control.attempts() == 1).await;
    for (k, delay) in [1, 2, 4, 8, 16].iter().enumerate() {
        next_attempt(&engine, &control, &clock, Duration::from_secs(*delay), k + 1).await;
    }
    // Six attempts failed: the wait is 30 s now, and the daemon is back.
    waits(&engine).await;
    control.allow();
    clock.advance(Duration::from_secs(29)).await;
    assert_eq!((control.attempts(), state_of(&engine)), (6, ConnectionState::Waiting));

    let before = Instant::now();
    engine.wake();
    assert_eq!(answer(call).await, Ok(1000));
    assert_eq!(control.attempts(), 7);
    assert_eq!(Instant::now(), before, "the clock did not move");
    assert_eq!(daemon.file("/srv/u").map(|bytes| bytes.len()), Some(1000));
}

#[tokio::test]
async fn a_wake_when_nothing_waits_does_nothing() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (connector, control) = scripted(&daemon, None);
    let (engine, _) = engine_with(connector, Limits::default());
    engine.wake();
    assert_eq!((control.attempts(), state_of(&engine)), (0, ConnectionState::Closed));
    assert_eq!(engine.upload("u", "/srv/u", MemorySource::new(pattern(10))).await, Ok(10));
    engine.wake();
    assert_eq!((control.attempts(), state_of(&engine)), (1, ConnectionState::Open));
}

#[tokio::test]
async fn a_gateway_error_of_the_upgrade_is_retried() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    let (gateway, _server) = bad_gateway().await;
    let (connector, control) = scripted(&daemon, None);
    control.push(Step::Url(gateway.clone()));
    control.push(Step::Url(gateway));
    let (engine, _) = engine_with(connector, Limits::default());
    let call = upload(&engine, "u", "/srv/u", MemorySource::new(pattern(5000)));

    waits(&engine).await;
    assert_eq!(engine.snapshot().last_error.map(|error| error.code), Some("handshake"));
    next_attempt(&engine, &control, &clock, Duration::from_secs(1), 1).await;
    next_attempt(&engine, &control, &clock, Duration::from_secs(2), 2).await;
    assert_eq!(answer(call).await, Ok(5000));
    assert_eq!(control.attempts(), 3);
    assert_eq!(daemon.file("/srv/u").map(|bytes| bytes.len()), Some(5000));
}

// ---- what no wait can mend ----

#[tokio::test]
async fn a_password_refused_at_a_reopen_fails_every_transfer_and_no_attempt_follows() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start_with(Config { password: Some("pw".into()), ..Config::default() }).await.unwrap();
    daemon.script(Fault::Close { after: After::Frames(Direction::FromClient, 3), code: 1011 });
    let (connector, control) = scripted(&daemon, Some("pw"));
    control.push(Step::Dial);
    control.push(Step::Bare);
    let (engine, _) = engine_with(connector, Limits::default());
    // Three run and one is queued: the failure takes all four.
    let calls: Vec<_> = ["a", "b", "c", "d"].iter().map(|id| upload(&engine, id, &format!("/srv/{id}"), MemorySource::new(pattern(32 * 1024 * 20)))).collect();
    for call in calls {
        let failure = answer(call).await.unwrap_err();
        assert_eq!(failure.code, "unauthorized");
    }
    assert_eq!((control.attempts(), daemon.refused_upgrades()), (2, 1));

    clock.advance(Duration::from_secs(600)).await;
    assert_eq!(control.attempts(), 2, "an attempt followed the refusal");
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.connection.state, snapshot.active.len(), snapshot.queued), (ConnectionState::Closed, 0, 0));
    assert_eq!((snapshot.totals.done, snapshot.totals.failed), (0, 4));
    assert_eq!(snapshot.last_error.map(|error| error.code), Some("unauthorized"));
}

#[tokio::test]
async fn the_file_that_changed_between_the_drop_and_the_resume_is_changed_and_the_sink_is_discarded() {
    let clock = Frozen::start();
    let daemon = Arc::new(StandInDaemon::start().await.unwrap());
    daemon.put_file("/f/a", pattern(32 * 1024 * 8));
    daemon.script(Fault::Close { after: After::Bytes(Direction::ToClient, 100_000), code: 1011 });
    let (connector, control) = scripted(&daemon, None);
    control.push(Step::Dial);
    let changer = Arc::clone(&daemon);
    control.push(Step::Before(Box::new(move || {
        changer.put_file("/f/a", pattern(300_000));
    })));
    let (engine, _) = engine_with(connector, Limits::default());
    let (sink, probe) = ProbeSink::new();

    let failure = answer(save(&engine, "s", "/f/a", sink)).await.unwrap_err();
    assert_eq!(failure, Failure::new("changed", "The file changed on the daemon."));
    assert!(probe.discarded() && !probe.finished());
    assert_eq!(control.attempts(), 2);
    clock.advance(Duration::from_secs(300)).await;
    assert_eq!(control.attempts(), 2);
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.totals.failed, snapshot.active.len(), snapshot.connection.state), (1, 0, ConnectionState::Closed));
}

#[tokio::test]
async fn the_final_codes_fail_at_once_and_a_connector_that_says_not_to_retry_is_final_too() {
    let _clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    let mut finals: Vec<ConnectError> = FINAL_CODES.iter().map(|code| ConnectError::new(code, "No wait mends it.", true)).collect();
    finals.push(ConnectError::new("unreachable", "The connector says it is final.", false));
    finals.push(ConnectError::new("a_code_of_the_apps_own", "The connector says it is final.", false));
    for error in finals {
        let (connector, control) = scripted(&daemon, None);
        control.refuse(error.clone());
        let (engine, _) = engine_with(connector, Limits::default());
        let calls = [upload(&engine, "u", "/srv/u", MemorySource::new(pattern(10))), upload(&engine, "v", "/srv/v", MemorySource::new(pattern(10)))];
        for call in calls {
            let failure = answer(call).await.unwrap_err();
            assert_eq!((failure.code, failure.message.as_str()), (error.code, error.message.as_str()));
        }
        assert_eq!(control.attempts(), 1, "{}: an attempt followed", error.code);
        let snapshot = engine.snapshot();
        assert_eq!((snapshot.connection.state, snapshot.totals.failed), (ConnectionState::Closed, 2), "{}", error.code);
    }
}

#[tokio::test]
async fn every_other_code_is_retried_the_handshake_included() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    for code in ["unreachable", "timeout", "handshake", "daemon_starting", "connection_lost"] {
        let (connector, control) = scripted(&daemon, None);
        control.refuse(ConnectError::new(code, "Try again.", true));
        let (engine, _) = engine_with(connector, Limits::default());
        let call = upload(&engine, "u", "/srv/u", MemorySource::new(pattern(10)));
        eventually("the first attempt", || control.attempts() == 1).await;
        next_attempt(&engine, &control, &clock, Duration::from_secs(1), 1).await;
        assert!(!call.is_finished(), "{code} failed the transfer");
        assert_eq!(engine.snapshot().last_error.map(|error| error.code), Some(code));
    }
}

#[tokio::test]
async fn a_daemon_without_a_feature_is_not_retried_after_a_drop_either() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::Close { after: After::Frames(Direction::FromClient, 3), code: 1011 });
    let (connector, control) = scripted(&daemon, None);
    // The daemon was replaced by an older one while the connection was down.
    let older = Arc::new(
        StandInDaemon::start_with(Config { features: Features { file_transfer_ack: false, ..Features::default() }, ..Config::default() }).await.unwrap(),
    );
    let url = older.url();
    control.push(Step::Dial);
    control.push(Step::Url(url));
    let (engine, _) = engine_with(connector, Limits::default());
    let failure = answer(upload(&engine, "u", "/srv/u", MemorySource::new(pattern(32 * 1024 * 20)))).await.unwrap_err();
    assert_eq!(failure.code, "unsupported_daemon");
    clock.advance(Duration::from_secs(120)).await;
    assert_eq!(control.attempts(), 2);
    drop(older);
}

// ---- a cancel while waiting ----

#[tokio::test]
async fn a_cancel_while_the_connection_is_not_there_settles_at_once_and_the_engine_stops_trying() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f/a", pattern(1000));
    let (connector, control) = scripted(&daemon, None);
    control.refuse(unreachable());
    let (engine, _) = engine_with(connector, Limits::default());
    let upload = upload(&engine, "u", "/srv/u", MemorySource::new(pattern(10)));
    let (sink, probe) = ProbeSink::new();
    let save = save(&engine, "s", "/f/a", sink);
    waits(&engine).await;

    // One of two: the other still waits, and the wait goes on.
    assert!(engine.cancel("u"));
    assert_eq!(answer(upload).await.unwrap_err().code, "cancelled");
    assert_eq!((state_of(&engine), engine.snapshot().active.len()), (ConnectionState::Waiting, 1));
    assert!(!probe.discarded());

    // The last one: the sink goes, and nothing dials any more.
    assert!(engine.cancel("s"));
    assert_eq!(answer(save).await.unwrap_err().code, "cancelled");
    assert!(probe.discarded() && !probe.finished());
    let attempts = control.attempts();
    assert_eq!(state_of(&engine), ConnectionState::Closed);
    clock.advance(Duration::from_secs(300)).await;
    assert_eq!(control.attempts(), attempts, "an attempt followed the last cancel");
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.totals.cancelled, snapshot.totals.failed, snapshot.active.len()), (2, 0, 0));
}

#[tokio::test]
async fn a_save_cancelled_after_a_drop_while_it_waits_is_discarded() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f/a", pattern(32 * 1024 * 8));
    daemon.script(Fault::Close { after: After::Bytes(Direction::ToClient, 100_000), code: 1011 });
    let (connector, control) = scripted(&daemon, None);
    control.push(Step::Dial);
    control.push(Step::Refuse(unreachable()));
    let (engine, _) = engine_with(connector, Limits::default());
    let (sink, probe) = ProbeSink::new();
    let call = save(&engine, "s", "/f/a", sink);
    waits(&engine).await;
    assert_eq!(engine.snapshot().active[0].state, Waiting);
    assert!(!probe.discarded(), "the partial file is kept while the save waits");

    assert!(engine.cancel("s"));
    assert_eq!(answer(call).await.unwrap_err().code, "cancelled");
    assert!(probe.discarded() && !probe.finished());
    clock.advance(Duration::from_secs(60)).await;
    assert_eq!(control.attempts(), 2);
}
