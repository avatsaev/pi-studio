//! A drop and a cancel at every stage of an upload and of a save, through the engine: one row for each
//! way, stage and action, and the stand-in's state after each (nothing half-written kept, no stream
//! still in use, the sink finished or discarded once).
//!
//! The stages, in the order a transfer goes through them:
//!
//! 1. **Before the request:** the engine has no connection yet (a drop: the daemon hangs up right after
//!    `hello`; a cancel: the dial is held).
//! 2. **Before its answer:** the request reached the daemon, which does not answer it (`Silence`).
//! 3. **Before `Begin`:** the answer is on its way, or has come, and no byte has (a drop: the daemon
//!    hangs up as it answers; a cancel: the daemon has not read the request when the cancel comes, and
//!    reads it afterwards).
//! 4. **In the middle:** some bytes have gone.
//! 5. **After `End`, before the confirmation:** an upload's `End` is sent and `file_upload_complete`
//!    has not come; a save has read its `End` and its sink is in `finish`.
//! 6. **While waiting to reconnect:** a drop that came first, and a connector that refuses.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Semaphore;
use tokio::task::JoinHandle;

use super::rigs::{Calls, RigSink};
use super::support::{Control, GatedSource, Result, Scripted, Seen, Step, engine_with, eventually, pattern, real_pause, save, scripted, unreachable, upload};
use crate::Limits;
use crate::connection::Close;
use crate::engine::TransferState::{Running, Waiting};
use crate::engine::{ActiveTransfer, ConnectionState, Engine, TransferState};
use crate::testing::{After, Asked, Config, Direction, Fault, StandInDaemon};
use crate::upload::MemorySource;

const CHUNK: usize = 32 * 1024;
const LEN: usize = 8 * CHUNK;
/// Where the daemon cuts a save in the middle: three whole chunks and 1,696 bytes of the fourth.
const CUT: u64 = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Way {
    Upload,
    Save,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    BeforeRequest,
    BeforeAnswer,
    BeforeBegin,
    Middle,
    AfterEnd,
    WaitingToReconnect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Act {
    Drop,
    Cancel,
}

/// How a row ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    /// It completed on the connection it began on.
    Completed,
    /// It completed after its connection was lost: a save from its bytes, an upload from byte 0.
    CompletedAfterARestart,
    Cancelled,
    /// Anything else, with its code: a row that ends so has failed.
    Failed(&'static str),
}

use Act::{Cancel, Drop as Cut};
use Outcome::{Cancelled, Completed, CompletedAfterARestart as Restarted};
use Stage::{AfterEnd, BeforeAnswer, BeforeBegin, BeforeRequest, Middle, WaitingToReconnect as Waits};
use Way::{Save, Upload};

/// Every row, and how it must end. A cancel after `End` cannot stop an upload from being kept, and it
/// cannot stop a save that has its whole file: that save completes.
const TABLE: [(Way, Stage, Act, Outcome); 24] = [
    (Upload, BeforeRequest, Cut, Restarted),
    (Upload, BeforeRequest, Cancel, Cancelled),
    (Upload, BeforeAnswer, Cut, Restarted),
    (Upload, BeforeAnswer, Cancel, Cancelled),
    (Upload, BeforeBegin, Cut, Restarted),
    (Upload, BeforeBegin, Cancel, Cancelled),
    (Upload, Middle, Cut, Restarted),
    (Upload, Middle, Cancel, Cancelled),
    (Upload, AfterEnd, Cut, Restarted),
    (Upload, AfterEnd, Cancel, Cancelled),
    (Upload, Waits, Cut, Restarted),
    (Upload, Waits, Cancel, Cancelled),
    (Save, BeforeRequest, Cut, Restarted),
    (Save, BeforeRequest, Cancel, Cancelled),
    (Save, BeforeAnswer, Cut, Restarted),
    (Save, BeforeAnswer, Cancel, Cancelled),
    (Save, BeforeBegin, Cut, Restarted),
    (Save, BeforeBegin, Cancel, Cancelled),
    (Save, Middle, Cut, Restarted),
    (Save, Middle, Cancel, Cancelled),
    (Save, AfterEnd, Cut, Completed),
    (Save, AfterEnd, Cancel, Completed),
    (Save, Waits, Cut, Restarted),
    (Save, Waits, Cancel, Cancelled),
];

#[test]
fn the_table_has_a_row_for_each_stage_and_action_in_both_directions() {
    for way in [Upload, Save] {
        for stage in [BeforeRequest, BeforeAnswer, BeforeBegin, Middle, AfterEnd, Waits] {
            for act in [Cut, Cancel] {
                let rows = TABLE.iter().filter(|row| (row.0, row.1, row.2) == (way, stage, act)).count();
                assert_eq!(rows, 1, "{way:?} {stage:?} {act:?}");
            }
        }
    }
}

#[tokio::test]
async fn every_row_ends_as_the_table_says_and_leaves_the_daemon_right() {
    for (way, stage, act, want) in TABLE {
        let got = match way {
            Upload => upload_row(stage, act).await,
            Save => save_row(stage, act).await,
        };
        assert_eq!(got, want, "{way:?} {stage:?} {act:?}");
    }
}

// ---- the scene ----

/// Short waits, so that a row that waits for the end of one costs a fraction of a second. A cancel before
/// the answer is held waits for the answer longer: the test lets it come.
fn limits(stage: Stage, act: Act) -> Limits {
    let (close_wait, answer_wait) = if (stage, act) == (BeforeBegin, Cancel) {
        (Duration::from_secs(5), Duration::from_secs(5))
    } else {
        (Duration::from_millis(150), Duration::from_millis(500))
    };
    Limits { backoff_start: Duration::from_millis(10), backoff_max: Duration::from_millis(40), close_wait, answer_wait, ..Limits::default() }
}

struct Scene {
    daemon: Arc<StandInDaemon>,
    control: Control,
    engine: Arc<Engine<Scripted>>,
    seen: Seen,
    /// What a held dial waits for.
    gate: Arc<Semaphore>,
}

impl Scene {
    async fn new(stage: Stage, act: Act) -> Self {
        let daemon = Arc::new(StandInDaemon::start_with(Config::default()).await.unwrap());
        let (connector, control) = scripted(&daemon, None);
        let (engine, seen) = engine_with(connector, limits(stage, act));
        Self { daemon, control, engine, seen, gate: Arc::new(Semaphore::new(0)) }
    }

    fn state(&self) -> ConnectionState {
        self.engine.snapshot().connection.state
    }

    fn transfer(&self) -> Option<ActiveTransfer> {
        self.engine.snapshot().active.into_iter().next()
    }

    fn script(&self, fault: Fault) {
        self.daemon.script(fault);
    }

    /// The daemon hangs up (1011) after `after`.
    fn hang_up(&self, after: After) {
        self.script(Fault::Close { after, code: 1011 });
    }

    /// The first dial goes through; then the connector refuses twice (a drop of the reconnect), or for good
    /// (the first dial sets the refusal that the second finds).
    fn refuse_after_the_first_dial(&self, act: Act) {
        if act == Act::Drop {
            self.control.push(Step::Dial);
            self.control.push(Step::Refuse(unreachable()));
            self.control.push(Step::Refuse(unreachable()));
        } else {
            let control = self.control.clone();
            self.control.push(Step::Before(Box::new(move || control.refuse(unreachable()))));
        }
    }

    /// Everything that is left is closed, and the daemon sees every connection end.
    async fn end(&self) {
        self.engine.cancel_all_and_close(Close::Normal).await;
        eventually("every connection to close", || self.daemon.open_connections() == 0).await;
    }
}

async fn settled(call: JoinHandle<Result>) -> Result {
    tokio::time::timeout(Duration::from_secs(10), call).await.expect("the transfer settled within ten seconds").unwrap()
}

fn classify(result: &Result, states: &[TransferState]) -> Outcome {
    match result {
        Ok(_) if states.iter().filter(|state| **state == Running).count() > 1 => Outcome::CompletedAfterARestart,
        Ok(_) => Completed,
        Err(failure) if failure.code == "cancelled" => Cancelled,
        Err(failure) => Outcome::Failed(failure.code),
    }
}

/// The states a transfer tells (repeats collapsed): `waiting` for the connection, `running`, and again
/// after a drop.
fn states_of(way: Way, stage: Stage, act: Act) -> Vec<TransferState> {
    match (way, stage, act) {
        (_, BeforeRequest, Cancel) => vec![Waiting],
        (_, Waits, Cancel) => vec![Waiting, Running, Waiting],
        (Save, AfterEnd, _) => vec![Waiting, Running],
        (_, _, Cut) => vec![Waiting, Running, Waiting, Running],
        (_, _, Cancel) => vec![Waiting, Running],
    }
}

/// The connections the daemon accepted before the probe, and after it: a connection that is open and
/// sound is reused, one that was dropped is not.
fn connections(way: Way, stage: Stage, act: Act) -> (usize, usize) {
    match (way, stage, act) {
        (_, BeforeRequest, Cancel) => (0, 1),
        (Upload, AfterEnd, Cancel) | (_, Waits, Cancel) | (Save, AfterEnd, Cut) => (1, 2),
        (Save, AfterEnd, Cancel) | (_, _, Cancel) => (1, 1),
        (_, _, Cut) => (2, 2),
    }
}

/// Brings the row to the point where the cancel comes: the transfer is held there. A drop needs nothing.
async fn bring_to_the_cancel(scene: &Scene, stage: Stage) {
    match stage {
        BeforeRequest => eventually("the engine to be connecting", || scene.state() == ConnectionState::Connecting).await,
        BeforeAnswer => eventually("the daemon to read the request", || scene.daemon.pending_faults() == 0).await,
        BeforeBegin => {
            eventually("the daemon to stop reading", || scene.daemon.pending_faults() == 0).await;
            eventually("the transfer to run", || scene.transfer().is_some_and(|transfer| transfer.state == Running)).await;
            // The request is on the socket, unread.
            real_pause(100).await;
        }
        Waits => eventually("the engine to wait for its next dial", || scene.state() == ConnectionState::Waiting).await,
        Middle | AfterEnd => {}
    }
}

/// The cancel, and for a request that the daemon has not read, the daemon reading it afterwards.
async fn cancel_then_release(scene: &Scene, id: &str, call: &JoinHandle<Result>, stage: Stage) {
    assert!(scene.engine.cancel(id));
    if stage == BeforeBegin {
        real_pause(150).await;
        assert!(!call.is_finished(), "the transfer settled before the daemon answered");
        scene.daemon.resume_reading();
    }
}

/// The probe: the engine takes another transfer after the row, and the daemon holds no stream.
async fn probe_upload(scene: &Scene) {
    scene.control.allow();
    assert_eq!(scene.engine.upload("probe", "/srv/probe", MemorySource::new(pattern(100))).await, Ok(100));
    assert_eq!(scene.daemon.file("/srv/probe"), Some(pattern(100)));
}

fn expect_totals(scene: &Scene, label: &str, outcome: Outcome) {
    let totals = scene.engine.snapshot().totals;
    let want = match outcome {
        Cancelled => (0, 0, 1),
        _ => (1, 0, 0),
    };
    assert_eq!((totals.done, totals.failed, totals.cancelled), want, "{label}: the totals");
    let snapshot = scene.engine.snapshot();
    assert_eq!((snapshot.active.len(), snapshot.queued), (0, 0), "{label}: nothing is left");
}

// ---- uploads ----

async fn upload_row(stage: Stage, act: Act) -> Outcome {
    let label = format!("upload {stage:?} {act:?}");
    let scene = Scene::new(stage, act).await;
    let data = pattern(LEN);
    let (source, gate) = GatedSource::new(data.clone());
    // A cancel in the middle needs the source to stop after two chunks.
    gate.add_permits(if (stage, act) == (Middle, Cancel) { 2 } else { 1000 });
    arrange_upload(&scene, stage, act);
    let call = upload(&scene.engine, "u", "/srv/u", source);
    if act == Cancel {
        bring_to_the_cancel(&scene, stage).await;
        if stage == Middle {
            eventually("two chunks to be sent", || scene.transfer().is_some_and(|transfer| transfer.done == 2 * CHUNK as u64)).await;
        }
        if stage == AfterEnd {
            eventually("the daemon to read the End", || scene.daemon.uploads().len() == 1).await;
        }
        cancel_then_release(&scene, "u", &call, stage).await;
    }
    let result = settled(call).await;
    let outcome = classify(&result, &scene.seen.states("u"));

    assert_eq!(scene.seen.states("u"), states_of(Upload, stage, act), "{label}: the states");
    check_upload_records(&scene, stage, act, &label).await;
    let kept = matches!(outcome, Completed | Restarted) || (stage, act) == (AfterEnd, Cancel);
    assert_eq!(scene.daemon.file("/srv/u"), kept.then(|| data.clone()), "{label}: what the daemon keeps is the whole file or nothing");
    eventually(&format!("{label}: the streams to be free"), || scene.daemon.streams_in_use() == 0).await;
    assert_eq!(scene.daemon.accepted_connections(), connections(Upload, stage, act).0, "{label}: the connections");
    expect_totals(&scene, &label, outcome);

    probe_upload(&scene).await;
    assert_eq!(scene.daemon.accepted_connections(), connections(Upload, stage, act).1, "{label}: the connections after the probe");
    scene.end().await;
    assert_eq!(scene.daemon.streams_in_use(), 0, "{label}: the streams after the end");
    outcome
}

fn arrange_upload(scene: &Scene, stage: Stage, act: Act) {
    let (from, to) = (Direction::FromClient, Direction::ToClient);
    match (stage, act) {
        (BeforeRequest, Cut) => scene.hang_up(After::TextFrames(to, 1)),
        (BeforeRequest, Cancel) => scene.control.push(Step::Held(Arc::clone(&scene.gate))),
        (BeforeAnswer, Cut) => {
            scene.script(Fault::Silence { request: Asked::Upload });
            scene.hang_up(After::TextFrames(from, 2));
        }
        (BeforeAnswer, Cancel) => scene.script(Fault::Silence { request: Asked::Upload }),
        (BeforeBegin, Cut) => scene.hang_up(After::TextFrames(from, 2)),
        (BeforeBegin, Cancel) => scene.script(Fault::StopReading { after: After::TextFrames(from, 1) }),
        (Middle, Cut) => scene.hang_up(After::Frames(from, 3)),
        (AfterEnd, Cut) => {
            // Begin, eight chunks and the End are ten frames: the daemon keeps the file, says nothing, and hangs up.
            scene.script(Fault::StopAnswering { after: After::Frames(from, 9) });
            scene.hang_up(After::Frames(from, 10));
        }
        (AfterEnd, Cancel) => scene.script(Fault::StopAnswering { after: After::Frames(from, 9) }),
        (Waits, _) => {
            scene.hang_up(After::Frames(from, 3));
            scene.refuse_after_the_first_dial(act);
        }
        (Middle, Cancel) => {}
    }
}

/// What the daemon says it received, one record for each upload that ended there.
async fn check_upload_records(scene: &Scene, stage: Stage, act: Act, label: &str) {
    let len = LEN as u64;
    let aborted = Some("client_aborted");
    let expected: Vec<(u64, Option<&str>)> = match (stage, act) {
        (BeforeRequest | BeforeAnswer | Waits, Cancel) => vec![],
        (BeforeBegin, Cancel) => vec![(0, aborted)],
        (Middle, Cancel) => vec![(2 * CHUNK as u64, aborted)],
        // The first attempt's End arrived, so the file was kept; the restart sends it again.
        (AfterEnd, Cut) => vec![(len, None), (len, None)],
        _ => vec![(len, None)],
    };
    eventually("the daemon's records", || scene.daemon.uploads().len() >= expected.len()).await;
    let records = scene.daemon.uploads();
    let got: Vec<(u64, Option<&str>)> = records.iter().map(|record| (record.bytes_received, record.error.as_deref())).collect();
    assert_eq!(got, expected, "{label}: the daemon's records");
}

// ---- saves ----

async fn save_row(stage: Stage, act: Act) -> Outcome {
    let label = format!("save {stage:?} {act:?}");
    let scene = Scene::new(stage, act).await;
    let data = pattern(LEN);
    scene.daemon.put_file("/f/a", data.clone());
    let (sink, calls, finish) = save_rig(stage, act);
    arrange_save(&scene, stage, act);
    let call = save(&scene.engine, "s", "/f/a", sink);
    bring_save_to_the_stage(&scene, &calls, finish.as_deref(), &call, stage, act).await;
    let result = settled(call).await;
    let outcome = classify(&result, &scene.seen.states("s"));

    assert_eq!(scene.seen.states("s"), states_of(Save, stage, act), "{label}: the states");
    check_sink(&calls, &data, outcome, &label);
    eventually(&format!("{label}: the streams to be free"), || scene.daemon.streams_in_use() == 0).await;
    assert_eq!(scene.daemon.accepted_connections(), connections(Save, stage, act).0, "{label}: the connections");
    check_resume(&scene, stage, act, &label);
    expect_totals(&scene, &label, outcome);

    scene.control.allow();
    let (probe, probe_calls) = RigSink::keeping();
    assert_eq!(scene.engine.save("probe", "/f/a", probe).await, Ok(LEN as u64));
    assert_eq!(probe_calls.bytes(), data, "{label}: the probe");
    assert_eq!(scene.daemon.accepted_connections(), connections(Save, stage, act).1, "{label}: the connections after the probe");
    scene.end().await;
    assert_eq!(scene.daemon.streams_in_use(), 0, "{label}: the streams after the end");
    outcome
}

/// The sink of a row, and the gate on its `finish` when the row is held there.
fn save_rig(stage: Stage, act: Act) -> (RigSink, Arc<Calls>, Option<Arc<Semaphore>>) {
    let (sink, calls) = RigSink::keeping();
    match (stage, act) {
        (Middle, Cancel) => {
            // Two writes go through, and the third waits: the save is in the middle of its file.
            let (sink, gate) = sink.with_write_gate();
            gate.add_permits(2);
            (sink, calls, None)
        }
        (AfterEnd, _) => {
            let (sink, gate) = sink.with_finish_gate();
            (sink, calls, Some(gate))
        }
        _ => (sink, calls, None),
    }
}

fn arrange_save(scene: &Scene, stage: Stage, act: Act) {
    let (from, to) = (Direction::FromClient, Direction::ToClient);
    match (stage, act) {
        (BeforeRequest, Cut) => scene.hang_up(After::TextFrames(to, 1)),
        (BeforeRequest, Cancel) => scene.control.push(Step::Held(Arc::clone(&scene.gate))),
        (BeforeAnswer, Cut) => {
            scene.script(Fault::Silence { request: Asked::Download });
            scene.hang_up(After::TextFrames(from, 2));
        }
        (BeforeAnswer, Cancel) => scene.script(Fault::Silence { request: Asked::Download }),
        // The daemon answers and hangs up before it sends `Begin`.
        (BeforeBegin, Cut) => scene.hang_up(After::TextFrames(from, 2)),
        (BeforeBegin, Cancel) => scene.script(Fault::StopReading { after: After::TextFrames(from, 1) }),
        (Middle, Cut) => scene.hang_up(After::Bytes(to, CUT)),
        // Begin, eight chunks and the End are ten frames: the daemon hangs up after the End.
        (AfterEnd, Cut) => scene.hang_up(After::Frames(to, 10)),
        (Waits, _) => {
            scene.hang_up(After::Bytes(to, CUT));
            scene.refuse_after_the_first_dial(act);
        }
        (Middle, Cancel) | (AfterEnd, Cancel) => {}
    }
}

/// Brings a save to its stage, and for a cancel makes it. The save in `finish` is let go at the end.
async fn bring_save_to_the_stage(scene: &Scene, calls: &Calls, finish: Option<&Semaphore>, call: &JoinHandle<Result>, stage: Stage, act: Act) {
    if stage == AfterEnd {
        eventually("the sink to be finishing", || calls.finish_started() == 1).await;
        if act == Cut {
            // The daemon has sent the End and hangs up: the save is complete all the same.
            eventually("the daemon to hang up", || scene.daemon.open_connections() == 0).await;
        } else {
            assert!(scene.engine.cancel("s"), "the save is still the engine's");
            real_pause(50).await;
        }
        if let Some(gate) = finish {
            gate.add_permits(1);
        }
        return;
    }
    if act == Act::Drop {
        return;
    }
    bring_to_the_cancel(scene, stage).await;
    if stage == Middle {
        eventually("two chunks to be written", || calls.written() == 2 * CHUNK as u64).await;
        // The third write is waiting for its permit.
        real_pause(50).await;
    }
    cancel_then_release(scene, "s", call, stage).await;
}

/// A save that completes has its file, finished once; one that does not has nothing, discarded once.
fn check_sink(calls: &Calls, data: &[u8], outcome: Outcome, label: &str) {
    match outcome {
        Completed | Restarted => {
            assert_eq!(calls.bytes(), data, "{label}: the file");
            assert_eq!((calls.finishes(), calls.discards()), (1, 0), "{label}: finished once, not discarded");
        }
        _ => {
            assert_eq!(calls.bytes(), Vec::<u8>::new(), "{label}: nothing is kept");
            assert_eq!((calls.finishes(), calls.discards()), (0, 1), "{label}: discarded once, not finished");
        }
    }
}

/// A save cut in the middle asks again from the bytes it has, guarded by the file it first saw.
fn check_resume(scene: &Scene, stage: Stage, act: Act, label: &str) {
    if act != Cut || !matches!(stage, Middle | Waits) {
        return;
    }
    let requests = scene.daemon.download_requests();
    assert_eq!(requests.len(), 2, "{label}: two requests");
    assert_eq!(requests[1]["offset"], CUT, "{label}: it resumes at its bytes");
    assert!(requests[1].get("ifUnchanged").is_some(), "{label}: it names the file it saw");
}
