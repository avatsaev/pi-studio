//! The snapshot: what the control socket reads.

use std::sync::atomic::Ordering;
use std::time::Duration;

use super::support::{Frozen, GatedSource, ProbeSink, engine, eventually, pattern, save, upload};
use crate::engine::{ActiveTransfer, ConnectionInfo, ConnectionState, Kind, Snapshot, Totals, TransferState};
use crate::limits::{CHUNK_BYTES, DOWNLOAD_HOLD_BYTES};
use crate::testing::{Config, StandInDaemon};
use crate::upload::MemorySource;

#[tokio::test]
async fn a_new_engine_is_closed_and_empty() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    assert_eq!(
        engine.snapshot(),
        Snapshot {
            connection: ConnectionInfo { state: ConnectionState::Closed, opens: 0 },
            active: Vec::new(),
            queued: 0,
            totals: Totals::default(),
            peak_held: 0,
            last_error: None,
        }
    );
}

#[tokio::test]
async fn an_active_upload_and_an_active_save_show_their_kind_state_and_bytes() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start_with(Config { chunk_bytes: 100, chunk_delay: Duration::from_secs(1), ..Config::default() }).await.unwrap();
    daemon.put_file("/f/a", pattern(1000));
    let (engine, _) = engine(&daemon);
    let chunk = u64::try_from(CHUNK_BYTES).unwrap();
    let (source, gate) = GatedSource::new(pattern(CHUNK_BYTES * 3));
    let uploading = upload(&engine, "u", "/srv/u", source);
    let (sink, _probe) = ProbeSink::new();
    let saving = save(&engine, "s", "/f/a", sink);
    clock.settle().await;
    gate.add_permits(1);
    clock.settle().await;

    let snapshot = engine.snapshot();
    assert_eq!(snapshot.connection, ConnectionInfo { state: ConnectionState::Open, opens: 1 });
    assert_eq!(
        snapshot.active,
        [
            ActiveTransfer { id: "u".into(), kind: Kind::Upload, state: TransferState::Running, done: chunk, total: Some(chunk * 3), restarts: 0 },
            ActiveTransfer { id: "s".into(), kind: Kind::Save, state: TransferState::Running, done: 100, total: Some(1000), restarts: 0 },
        ]
    );

    gate.add_permits(100);
    for _ in 0..10 {
        clock.advance(Duration::from_secs(1)).await;
    }
    assert_eq!(uploading.await.unwrap(), Ok(chunk * 3));
    assert_eq!(saving.await.unwrap(), Ok(1000));
}

#[tokio::test]
async fn the_snapshot_holds_no_path() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    let (source, _gate) = GatedSource::new(pattern(10));
    let call = upload(&engine, "u", "/very/secret/place/file.txt", source);
    clock.settle().await;
    let text = format!("{:?}", engine.snapshot());
    assert!(!text.contains("secret") && !text.contains("file.txt") && !text.contains('/'), "{text}");
    assert!(engine.cancel("u"));
    let _ = call.await;
}

#[tokio::test]
async fn the_most_held_is_one_read_buffer_for_an_upload() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    assert_eq!(engine.upload("a", "/srv/a", MemorySource::new(pattern(CHUNK_BYTES * 40))).await, Ok(u64::try_from(CHUNK_BYTES * 40).unwrap()));
    assert_eq!(engine.snapshot().peak_held, u64::try_from(CHUNK_BYTES).unwrap());
}

#[tokio::test]
async fn the_most_held_of_a_save_is_the_hold_and_a_frame_whatever_the_size_of_the_file() {
    let daemon = StandInDaemon::start().await.unwrap();
    let size = 8 * 1024 * 1024;
    daemon.put_file("/f/big", pattern(size));
    let (engine, _) = engine(&daemon);
    let (sink, probe, gate) = ProbeSink::gated();
    let call = save(&engine, "a", "/f/big", sink);

    // The disk is stuck: the daemon sends until the hold is full, and the engine stops reading.
    let hold = u64::try_from(DOWNLOAD_HOLD_BYTES).unwrap();
    eventually("the hold fills", || engine.snapshot().peak_held >= hold - 64 * 1024).await;
    let frame = u64::try_from(CHUNK_BYTES).unwrap() + 64;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(engine.snapshot().peak_held <= hold + 2 * frame, "{}", engine.snapshot().peak_held);
    assert_eq!(probe.written.load(Ordering::SeqCst), 0);

    gate.add_permits(100_000);
    assert_eq!(call.await.unwrap(), Ok(u64::try_from(size).unwrap()));
    assert!(engine.snapshot().peak_held <= hold + 2 * frame, "{}", engine.snapshot().peak_held);
}

#[tokio::test]
async fn the_totals_count_each_outcome_once() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    assert!(engine.upload("done", "/srv/a", MemorySource::new(pattern(3))).await.is_ok());
    let (sink, _probe) = ProbeSink::new();
    assert!(engine.save("failed", "/f/missing", sink).await.is_err());
    let (source, _gate) = GatedSource::new(pattern(3));
    let call = upload(&engine, "cancelled", "/srv/c", source);
    eventually("it runs", || engine.snapshot().active.len() == 1).await;
    assert!(engine.cancel("cancelled"));
    let _ = call.await;
    let totals = engine.snapshot().totals;
    assert_eq!((totals.done, totals.failed, totals.cancelled), (1, 1, 1));
}
