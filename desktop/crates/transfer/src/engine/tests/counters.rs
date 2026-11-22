//! Counters past 4 GiB: sizes, offsets and progress are 64-bit all the way. The upload reads a source that
//! makes its bytes as they are asked for, and the save reads a file the stand-in makes as it sends it, so
//! that no byte of either is held: what is sent and what is counted are the whole of it.
//!
//! These move more than 4 GiB through a socket each, so they take seconds even in an optimized build.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use pistudiodesktop_net::dial;
use serde_json::json;

use super::rigs::{CountingSource, RigSink};
use super::support::{Dialer, engine_with};
use crate::Limits;
use crate::connection::{Connection, Hello};
use crate::download::{Request, Version, save};
use crate::engine::{Engine, TransferState};
use crate::limits::{CHUNK_BYTES, DOWNLOAD_HOLD_BYTES};
use crate::testing::{Config, StandInDaemon};

const GIB: u64 = 1024 * 1024 * 1024;
/// 5 GiB and a part of a chunk: well past 4 GiB (`u32::MAX` is 4 GiB - 1), so that a sampler sees progress
/// beyond it for a while, and not a multiple of any chunk.
const SIZE: u64 = 5 * GIB + 12_345;

/// What a sampler saw of one transfer's progress while it ran.
#[derive(Default)]
struct Progress {
    most: AtomicU64,
    went_back: AtomicBool,
    total: AtomicU64,
    stop: AtomicBool,
}

/// Reads the engine's snapshot every few milliseconds until told to stop.
fn sample(engine: &Arc<Engine<Dialer>>, progress: &Arc<Progress>) -> tokio::task::JoinHandle<()> {
    let (engine, progress) = (Arc::clone(engine), Arc::clone(progress));
    tokio::spawn(async move {
        while !progress.stop.load(Ordering::SeqCst) {
            if let Some(transfer) = engine.snapshot().active.first() {
                if transfer.done < progress.most.load(Ordering::SeqCst) {
                    progress.went_back.store(true, Ordering::SeqCst);
                }
                progress.most.fetch_max(transfer.done, Ordering::SeqCst);
                progress.total.store(transfer.total.unwrap_or(0), Ordering::SeqCst);
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
}

fn check_progress(progress: &Progress, label: &str) {
    assert!(!progress.went_back.load(Ordering::SeqCst), "{label}: the bytes done went back");
    assert!(progress.most.load(Ordering::SeqCst) > u64::from(u32::MAX), "{label}: the sampler never saw more than 4 GiB done");
    assert!(progress.most.load(Ordering::SeqCst) <= SIZE, "{label}: more bytes done than there are");
    assert_eq!(progress.total.load(Ordering::SeqCst), SIZE, "{label}: the total is the exact size");
}

fn check_events(seen: &super::support::Seen, id: &str, label: &str) {
    let events = seen.of(id);
    let mut last = 0;
    for (state, done) in &events {
        if *state == TransferState::Running {
            assert!(*done >= last && *done <= SIZE, "{label}: an event says {done} done of {SIZE} after {last}");
            last = *done;
        }
    }
    assert!(last > u64::from(u32::MAX), "{label}: no event passed 4 GiB; the last said {last}");
    assert!(seen.all().iter().all(|event| event.total.is_none_or(|total| total == SIZE)), "{label}: an event has another total");
}

/// The most the engine may hold: the read buffer of an upload, or the download hold and a frame or two.
const HELD: u64 = (DOWNLOAD_HOLD_BYTES + 4 * CHUNK_BYTES) as u64;

#[tokio::test]
async fn an_upload_of_more_than_4_gib_reports_exact_totals_and_holds_no_more_than_a_chunk() {
    let daemon = StandInDaemon::start_with(Config { store_uploads: false, ..Config::default() }).await.unwrap();
    let (engine, seen) = engine_with(Dialer::new(&daemon), Limits::default());
    let progress = Arc::new(Progress::default());
    let sampler = sample(&engine, &progress);
    let source = CountingSource::new(SIZE);
    let read = Arc::clone(&source.read);

    let result = engine.upload("big", "/srv/big", source).await;
    progress.stop.store(true, Ordering::SeqCst);
    sampler.await.unwrap();

    assert_eq!(result, Ok(SIZE), "the bytes the daemon confirmed");
    assert_eq!(read.load(Ordering::Relaxed), SIZE, "the bytes the source made");
    let records = daemon.uploads();
    assert_eq!(records.len(), 1);
    assert_eq!((records[0].bytes_received, records[0].error.as_deref()), (SIZE, None), "the bytes the daemon counted");
    check_progress(&progress, "upload");
    check_events(&seen, "big", "upload");
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.totals.done, snapshot.totals.failed, snapshot.active.len()), (1, 0, 0));
    assert!(snapshot.peak_held <= HELD, "held {} bytes", snapshot.peak_held);
}

#[tokio::test]
async fn a_save_of_more_than_4_gib_reports_exact_totals_and_holds_no_more_than_the_hold() {
    let daemon = StandInDaemon::start_with(Config { chunk_bytes: 128 * 1024, ..Config::default() }).await.unwrap();
    daemon.put_counted_file("/f/big", SIZE);
    let (engine, seen) = engine_with(Dialer::new(&daemon), Limits::default());
    let progress = Arc::new(Progress::default());
    let sampler = sample(&engine, &progress);
    let (sink, calls) = RigSink::counting();

    let result = engine.save("big", "/f/big", sink).await;
    progress.stop.store(true, Ordering::SeqCst);
    sampler.await.unwrap();

    assert_eq!(result, Ok(SIZE), "the file's size");
    assert_eq!((calls.written(), calls.finishes(), calls.discards()), (SIZE, 1, 0), "the bytes the sink took");
    check_progress(&progress, "save");
    check_events(&seen, "big", "save");
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.totals.done, snapshot.totals.failed, snapshot.active.len()), (1, 0, 0));
    // The hold is the download's one chunk of the stand-in's (128 KiB) and the frame in hand.
    assert!(snapshot.peak_held <= HELD + 2 * 128 * 1024, "held {} bytes", snapshot.peak_held);
}

#[tokio::test]
async fn a_save_resumed_past_4_gib_asks_for_that_offset_and_gets_the_rest() {
    let daemon = StandInDaemon::start().await.unwrap();
    let size = 5 * GIB + 17;
    let info = daemon.put_counted_file("/f/huge", size);
    let limits = Limits::default();
    let socket = dial(&daemon.url(), None, Duration::from_secs(5), limits.max_message_bytes).await.unwrap();
    let connection = Connection::open(socket, &Hello { client_id: "client-1", app_version: "pistudiodesktop/test" }, limits).await.unwrap();
    // A sink that has 5 GiB + 7 bytes already (it counts them and holds none).
    let have = 5 * GIB + 7;
    let (mut sink, calls) = RigSink::counting();
    sink.start = have;
    let request = Request { path: "/f/huge", resume: Some(Version { total_bytes: size, mtime_ms: info.mtime_ms }) };

    let saved = save(&connection, request, &mut sink, |_| {}, std::future::pending(), &limits).await.unwrap();

    assert_eq!((saved.bytes, saved.version.total_bytes), (size - have, size));
    assert_eq!(calls.written(), size - have, "only the rest was written");
    assert_eq!(crate::download::Sink::written(&sink), size, "the sink's count is the whole file");
    let requests = daemon.download_requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0]["offset"], json!(have), "the offset is past 4 GiB");
    assert_eq!(requests[0]["ifUnchanged"], json!({ "size": size, "mtimeMs": info.mtime_ms }));
}
