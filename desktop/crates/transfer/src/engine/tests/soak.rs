//! A soak: for a fixed number of rounds, three transfers at once (uploads and saves of random sizes)
//! against a daemon that gets random faults and transfers that get random cancels. Every transfer
//! settles; what completed is byte-exact; what did not left nothing but a whole file; and when the rounds
//! are over the engine and the daemon hold nothing.
//!
//! The plan (sizes, faults, cancels, their times) comes from one seed and is the same on every run; the
//! interleaving is the scheduler's. Run on one thread (`--test-threads=1`) it is the harshest case.

use std::sync::Arc;
use std::time::Duration;

use tokio::task::JoinSet;

use super::rigs::{Calls, RigSink, library_panics};
use super::support::{Dialer, engine_with, eventually, pattern};
use crate::Limits;
use crate::connection::Close;
use crate::engine::{Engine, Failure};
use crate::limits::{CHUNK_BYTES, DOWNLOAD_HOLD_BYTES};
use crate::testing::{After, Asked, Direction, Disorder, Fault, Request, StandInDaemon, StreamFault};
use crate::upload::MemorySource;

const SEED: u64 = 0x5EED_2026_1122;
const ROUNDS: usize = 60;
const AT_ONCE: usize = 3;
/// Faults waiting on the daemon at most: a pile of unused ones would only slow the rounds that follow.
const MOST_PENDING: usize = 4;
/// The codes a transfer may end with here: everything the faults can cause but a bug (`internal`).
const CODES: [&str; 6] = ["ok", "cancelled", "daemon_refused", "size_mismatch", "protocol", "changed"];

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed | 1)
    }

    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }

    fn pick<T: Copy>(&mut self, items: &[T]) -> T {
        items[usize::try_from(self.below(items.len() as u64)).unwrap_or(0)]
    }
}

/// Short waits, so that a daemon that goes quiet costs a fraction of a second, not 30 s.
fn limits() -> Limits {
    Limits {
        answer_wait: Duration::from_millis(100),
        close_wait: Duration::from_millis(60),
        ping_after: Duration::from_millis(40),
        dropped_after: Duration::from_millis(120),
        backoff_start: Duration::from_millis(5),
        backoff_max: Duration::from_millis(20),
        ..Limits::default()
    }
}

/// A fault from the whole range of the stand-in's, with random parameters.
fn random_fault(rng: &mut Rng) -> Fault {
    let from = Direction::FromClient;
    let to = Direction::ToClient;
    let n = rng.below(8);
    let after = match rng.below(5) {
        0 => After::Start,
        1 => After::Frames(from, 1 + n),
        2 => After::Frames(to, 1 + n),
        3 => After::Bytes(to, 1 + rng.below(150_000)),
        _ => After::TextFrames(from, 1 + n % 4),
    };
    let request = rng.pick(&[Request::Upload, Request::Download]);
    let stream = |fault| Fault::DownloadStream(fault);
    match rng.below(18) {
        0 | 1 => Fault::Close { after, code: 1011 },
        2 | 3 => Fault::Reset { after },
        4 => Fault::Refuse { request, error: "no_free_stream".to_owned() },
        5 => Fault::RpcError { request, code: "handler_error".to_owned(), message: "the handler failed".to_owned() },
        6 => Fault::UploadFails { error: "rename_failed (EACCES)".to_owned() },
        7 => Fault::WrongBytesWritten { reported: rng.below(1000) },
        8 => stream(StreamFault::ErrorFirst("read_failed".to_owned())),
        9 => stream(StreamFault::ErrorAfter { bytes: rng.below(100_000), message: "read_failed".to_owned() }),
        10 => stream(StreamFault::OutOfOrder(rng.pick(&[
            Disorder::ChunkBeforeBegin,
            Disorder::EndBeforeChunks,
            Disorder::ChunkAfterEnd,
            Disorder::ChunkOnOtherStream,
        ]))),
        11 => stream(StreamFault::ExtraBytes(1 + rng.below(5000))),
        // The daemon that goes quiet: dropped by the engine's liveness, and the transfer goes on elsewhere.
        12 => Fault::StopAnswering { after },
        13 => Fault::StopReading { after },
        14 => Fault::Silence { request: rng.pick(&[Asked::Upload, Asked::Download, Asked::Cancel]) },
        _ => Fault::Close { after, code: 1001 },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Upload,
    Save,
}

/// One transfer of a round.
struct Plan {
    id: String,
    kind: Kind,
    path: String,
    data: Vec<u8>,
    /// Cancelled after this long, when it is cancelled at all.
    cancel_after: Option<Duration>,
}

/// How a transfer ended, with what its sink saw.
struct Done {
    plan: Plan,
    result: Result<u64, Failure>,
    calls: Option<Arc<Calls>>,
}

fn plan_round(rng: &mut Rng, round: usize, daemon: &StandInDaemon) -> Vec<Plan> {
    const SIZES: [usize; 8] = [0, 1, 1000, CHUNK_BYTES, CHUNK_BYTES + 1, 100_000, 300_000, 1_000_000];
    (0..AT_ONCE)
        .map(|slot| {
            let kind = if rng.below(2) == 0 { Kind::Upload } else { Kind::Save };
            let salt = u8::try_from(rng.below(256)).unwrap_or(0);
            let data: Vec<u8> = pattern(rng.pick(&SIZES)).into_iter().map(|byte| byte.wrapping_add(salt)).collect();
            let path = match kind {
                Kind::Upload => format!("/srv/r{round}-{slot}"),
                Kind::Save => format!("/f/r{round}-{slot}"),
            };
            if kind == Kind::Save {
                daemon.put_file(&path, data.clone());
            }
            let cancel_after = (rng.below(4) == 0).then(|| Duration::from_micros(rng.below(8000)));
            Plan { id: format!("t-{round}-{slot}"), kind, path, data, cancel_after }
        })
        .collect()
}

async fn run(engine: Arc<Engine<Dialer>>, plan: Plan) -> Done {
    let canceller = plan.cancel_after.map(|after| {
        let (engine, id) = (Arc::clone(&engine), plan.id.clone());
        tokio::spawn(async move {
            tokio::time::sleep(after).await;
            let _ = engine.cancel(&id);
        })
    });
    let (result, calls) = match plan.kind {
        Kind::Upload => (engine.upload(&plan.id, &plan.path, MemorySource::new(plan.data.clone())).await, None),
        Kind::Save => {
            let (sink, calls) = RigSink::keeping();
            (engine.save(&plan.id, &plan.path, sink).await, Some(calls))
        }
    };
    if let Some(canceller) = canceller {
        canceller.abort();
    }
    Done { plan, result, calls }
}

/// What a transfer that ended must have left behind.
fn check(done: &Done, daemon: &StandInDaemon) {
    let Plan { id, kind, path, data, .. } = &done.plan;
    let code = match &done.result {
        Ok(_) => "ok",
        Err(failure) => failure.code,
    };
    assert!(CODES.contains(&code), "{id}: ended with `{code}`: {:?}", done.result);
    match (kind, &done.result) {
        (Kind::Upload, Ok(bytes)) => {
            assert_eq!(*bytes, data.len() as u64, "{id}: the bytes the daemon confirmed");
            assert_eq!(daemon.file(path).as_ref(), Some(data), "{id}: the uploaded file is exact");
        }
        // A failed or cancelled upload left no file, or (End arrived, the confirmation did not) a whole one: never a part.
        (Kind::Upload, Err(_)) => assert!(daemon.file(path).is_none_or(|kept| &kept == data), "{id}: a part of a file was kept"),
        (Kind::Save, Ok(bytes)) => {
            let calls = done.calls.as_ref().expect("a save has a sink");
            assert_eq!(*bytes, data.len() as u64, "{id}: the bytes saved");
            assert_eq!(&calls.bytes(), data, "{id}: the saved file is exact");
            assert_eq!((calls.finishes(), calls.discards()), (1, 0), "{id}: finished once");
        }
        (Kind::Save, Err(_)) => {
            let calls = done.calls.as_ref().expect("a save has a sink");
            assert_eq!((calls.finishes(), calls.discards()), (0, 1), "{id}: discarded once and not finished");
            assert!(calls.bytes().is_empty(), "{id}: nothing of it is kept");
        }
    }
}

#[tokio::test]
async fn three_transfers_at_once_with_random_faults_all_settle_and_what_completed_is_exact() {
    let panics = library_panics();
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine_with(Dialer::new(&daemon), limits());
    let mut rng = Rng::new(SEED);

    for round in 0..ROUNDS {
        for _ in 0..rng.below(3) {
            if daemon.pending_faults() < MOST_PENDING {
                daemon.script(random_fault(&mut rng));
            }
        }
        let mut transfers = JoinSet::new();
        for plan in plan_round(&mut rng, round, &daemon) {
            transfers.spawn(run(Arc::clone(&engine), plan));
        }
        let settled = tokio::time::timeout(Duration::from_secs(20), async {
            let mut done = Vec::new();
            while let Some(finished) = transfers.join_next().await {
                done.push(finished.unwrap());
            }
            done
        })
        .await
        .unwrap_or_else(|_| panic!("round {round}: a transfer did not settle"));
        assert_eq!(settled.len(), AT_ONCE);
        for done in &settled {
            check(done, &daemon);
        }
        let snapshot = engine.snapshot();
        assert_eq!((snapshot.active.len(), snapshot.queued), (0, 0), "round {round}: nothing is left running");
    }

    let snapshot = engine.snapshot();
    let totals = snapshot.totals;
    assert_eq!(totals.done + totals.failed + totals.cancelled, (ROUNDS * AT_ONCE) as u64, "every transfer is counted once");
    assert!(totals.done >= 40, "the soak completed {} transfers of {}", totals.done, ROUNDS * AT_ONCE);
    // Each of the three may hold the download hold and a frame or two.
    let bound = (AT_ONCE * (DOWNLOAD_HOLD_BYTES + 2 * CHUNK_BYTES)) as u64;
    assert!(snapshot.peak_held <= bound, "held {} bytes, more than {bound}", snapshot.peak_held);

    // A daemon that stopped reading ends its connection when it reads the close.
    engine.cancel_all_and_close(Close::Normal).await;
    daemon.resume_reading();
    eventually("every connection to close", || daemon.open_connections() == 0).await;
    eventually("every stream to be free", || daemon.streams_in_use() == 0).await;
    assert_eq!(library_panics(), panics, "the engine or the stand-in panicked");
}
