//! What a daemon that lies or breaks the protocol can make a save do: nothing but fail with
//! `protocol`, leave the sink discarded and the stream free. Sizes are 64-bit and checked; nothing
//! is reserved from a number the daemon sent.
//!
//! The daemon is scripted over an in-memory pipe. After its frames it answers every cancel
//! `not_found`, as the real daemon does for a download that has finished.

use std::future::pending;
use std::sync::Arc;

use serde_json::{Value, json};

use super::support::{Range, TestSink, accepted, all_streams_free, answer, begin, cancel_answer, chunk, end, error_frame, request_id, scripted, stream_of};
use crate::Limits;
use crate::connection::Connection;
use crate::download::{Progress, Request, SaveError, Saved, Sink, Version, save};
use crate::error::Error;

/// How a daemon answers a download request: from its `requestId` and its stream.
type Reply = Box<dyn Fn(&str, u8) -> Value>;

/// How a daemon continues after its answer: the frames it sends on the stream.
type Frames = Box<dyn Fn(u8) -> Vec<Vec<u8>>>;

/// What `play` saw.
struct Played {
    result: Result<Saved, SaveError>,
    sink: TestSink,
    connection: Arc<Connection>,
    progress: Vec<Progress>,
    /// The `file_download_request` the save sent.
    request: Value,
}

/// Runs a save against a daemon that answers its request with `reply` and then sends `frames`.
async fn play(resume: Option<Version>, sink: TestSink, reply: impl FnOnce(&str, u8) -> Value, frames: impl FnOnce(u8) -> Vec<Vec<u8>>) -> Played {
    let (connection, mut daemon) = scripted().await;
    let mut sink = sink;
    let mut progress = Vec::new();
    let mut requests = Vec::new();
    let result = {
        let script = async {
            let request = daemon.request().await;
            let stream = stream_of(&request);
            daemon.send_json(&reply(&request_id(&request), stream));
            for frame in frames(stream) {
                daemon.send_binary(frame);
            }
            requests.push(request);
            loop {
                let next = daemon.request().await;
                if next["type"] == "file_download_cancel_request" {
                    daemon.send_json(&cancel_answer(&request_id(&next), false));
                }
            }
        };
        let limits = Limits::default();
        let saving = save(&connection, Request { path: "/srv/f", resume }, &mut sink, |step| progress.push(step), pending(), &limits);
        tokio::select! {
            result = saving => result,
            () = script => unreachable!("the daemon's script has no end"),
        }
    };
    let request = requests.pop().unwrap_or(Value::Null);
    Played { result, sink, connection, progress, request }
}

#[track_caller]
fn assert_protocol(played: &Played) {
    match &played.result {
        Err(SaveError::Protocol(Error::Protocol(_))) => {}
        other => panic!("expected a protocol error, got {other:?}"),
    }
    assert!(played.sink.inner.is_discarded() && !played.sink.inner.is_finished(), "the sink was not discarded");
    assert!(played.sink.bytes().is_empty());
    assert!(all_streams_free(&played.connection), "a stream stays reserved");
}

fn begin_with(stream: u8, meta: &Value) -> Vec<u8> {
    let mut frame = vec![0x10, stream];
    frame.extend(meta.to_string().as_bytes());
    frame
}

/// The `Begin` of a file of `total` bytes with one field changed.
fn begin_changed(range: Range, field: &str, value: Value) -> Vec<u8> {
    let mut meta = json!({ "transferId": "d-1", "totalBytes": range.total, "mtimeMs": range.mtime, "offset": range.offset, "length": range.length });
    meta[field] = value;
    begin_with(range.stream, &meta)
}

// ---- the answer ----

#[tokio::test(start_paused = true)]
async fn an_answer_that_does_not_say_what_was_asked_is_protocol() {
    // An answer that accepts is followed by the frame that ends the stream, as a daemon's always is.
    let ending = |stream: u8| vec![error_frame(stream, "read_failed")];
    let cases: Vec<(&str, Reply)> = vec![
        ("another stream", Box::new(|id, stream| accepted(id, Range::whole(stream.wrapping_add(1), 10)))),
        ("another offset", Box::new(|id, stream| accepted(id, Range::whole(stream, 10).from(5)))),
        ("a range that stops short of the end", Box::new(|id, stream| accepted(id, Range { length: 50, ..Range::whole(stream, 100) }))),
        ("a range that runs past the end", Box::new(|id, stream| accepted(id, Range { length: 101, ..Range::whole(stream, 100) }))),
        ("fields missing", Box::new(|id, stream| answer(id, "file_download_response", &json!({ "ok": true, "stream": stream })))),
        ("another kind of answer", Box::new(|id, stream| answer(id, "file_upload_response", &json!({ "ok": true, "stream": stream })))),
        (
            "a size that is not a number",
            Box::new(|id, stream| {
                answer(
                    id,
                    "file_download_response",
                    &json!({ "ok": true, "stream": stream, "transferId": "d", "totalBytes": "10", "mtimeMs": 1, "offset": 0, "length": 10 }),
                )
            }),
        ),
    ];
    for (name, reply) in cases {
        let played = play(None, TestSink::new(), |id, stream| reply(id, stream), ending).await;
        assert_protocol(&played);
        assert!(played.progress.is_empty(), "{name}: nothing is reported for an answer that is refused");
    }
}

#[tokio::test(start_paused = true)]
async fn an_answer_that_describes_another_file_than_the_one_guarded_is_protocol() {
    let guard = Version { total_bytes: 100, mtime_ms: 5 };
    let sink = TestSink::holding(vec![1; 10]);
    let reply = |id: &str, stream| accepted(id, Range { mtime: 6, ..Range::whole(stream, 100).from(10) });

    let played = play(Some(guard), sink, reply, |stream| vec![error_frame(stream, "read_failed")]).await;

    assert_protocol(&played);
    assert_eq!(played.request["offset"], 10);
}

#[tokio::test(start_paused = true)]
async fn the_request_of_a_first_save_has_a_stream_and_neither_offset_nor_guard_nor_length() {
    let played =
        play(None, TestSink::new(), |id, stream| accepted(id, Range::whole(stream, 0)), |stream| vec![begin(Range::whole(stream, 0)), end(stream)]).await;

    played.result.unwrap();
    let request = &played.request;
    assert_eq!(request["type"], "file_download_request");
    assert_eq!(request["path"], "/srv/f");
    assert!(request["stream"].as_u64().is_some_and(|stream| stream <= 255));
    for field in ["offset", "ifUnchanged", "length"] {
        assert!(request.get(field).is_none(), "a first request carries no `{field}`: {request}");
    }
}

#[tokio::test(start_paused = true)]
async fn an_offset_and_a_size_beyond_4_gib_are_sent_and_kept_exactly() {
    const GIB: u64 = 1024 * 1024 * 1024;
    let total = 5 * GIB + 10;
    let guard = Version { total_bytes: total, mtime_ms: 1_700_000_000_123 };
    // The sink counts 5 GiB it does not hold: the resume point of a very large file.
    let sink = TestSink { before: 5 * GIB, ..TestSink::new() };
    let range = |stream| Range { mtime: 1_700_000_000_123, ..Range::whole(stream, total).from(5 * GIB) };

    let played =
        play(Some(guard), sink, |id, stream| accepted(id, range(stream)), |stream| vec![begin(range(stream)), chunk(stream, &[9; 10]), end(stream)]).await;

    let saved = played.result.unwrap();
    assert_eq!(played.request["offset"].as_u64(), Some(5 * GIB));
    assert_eq!(played.request["ifUnchanged"]["size"].as_u64(), Some(total));
    assert_eq!(played.request["ifUnchanged"]["mtimeMs"].as_u64(), Some(1_700_000_000_123));
    assert_eq!(saved.bytes, 10);
    assert_eq!(saved.version, guard);
    assert_eq!(played.progress, [Progress { done: 5 * GIB, total }, Progress { done: total, total }]);
}

// ---- the frames ----

#[tokio::test(start_paused = true)]
async fn frames_out_of_order_or_beyond_the_announced_bytes_are_protocol() {
    let range = |stream| Range::whole(stream, 10);
    let cases: Vec<(&str, Frames, usize)> = vec![
        ("a chunk before Begin", Box::new(move |s| vec![chunk(s, &[1]), begin(range(s)), error_frame(s, "x")]), 0),
        ("a second Begin", Box::new(move |s| vec![begin(range(s)), begin(range(s)), error_frame(s, "x")]), 0),
        ("an End before Begin", Box::new(move |s| vec![end(s)]), 0),
        ("an End before all the bytes", Box::new(move |s| vec![begin(range(s)), chunk(s, &[1; 4]), end(s)]), 1),
        ("an End with no byte", Box::new(move |s| vec![begin(range(s)), end(s)]), 0),
        ("one byte too many", Box::new(move |s| vec![begin(range(s)), chunk(s, &[1; 6]), chunk(s, &[2; 5]), error_frame(s, "x")]), 1),
        ("a chunk longer than the file", Box::new(move |s| vec![begin(range(s)), chunk(s, &vec![1; 1024 * 1024]), error_frame(s, "x")]), 0),
        ("a Begin that says another length", Box::new(move |s| vec![begin_changed(range(s), "length", json!(9)), error_frame(s, "x")]), 0),
        ("a Begin that says another size", Box::new(move |s| vec![begin_changed(range(s), "totalBytes", json!(11)), error_frame(s, "x")]), 0),
        ("a Begin that says another offset", Box::new(move |s| vec![begin_changed(range(s), "offset", json!(1)), error_frame(s, "x")]), 0),
        ("a Begin that says another time", Box::new(move |s| vec![begin_changed(range(s), "mtimeMs", json!(8)), error_frame(s, "x")]), 0),
        ("a Begin of another transfer", Box::new(move |s| vec![begin_changed(range(s), "transferId", json!("other")), error_frame(s, "x")]), 0),
    ];
    for (name, frames, writes) in cases {
        let played = play(None, TestSink::new(), |id, stream| accepted(id, range(stream)), frames).await;
        assert_protocol(&played);
        assert_eq!(played.sink.writes, writes, "{name}: only what fitted was written");
    }
}

#[tokio::test(start_paused = true)]
async fn a_5_gib_announcement_that_ends_after_3_bytes_is_protocol_and_reserves_nothing() {
    for total in [5 * 1024 * 1024 * 1024, (1 << 53) - 1] {
        let range = move |stream| Range::whole(stream, total);
        let played =
            play(None, TestSink::new(), |id, stream| accepted(id, range(stream)), |stream| vec![begin(range(stream)), chunk(stream, &[1; 3]), end(stream)])
                .await;
        assert_protocol(&played);
        assert_eq!(played.sink.writes, 1);
    }
}

#[tokio::test(start_paused = true)]
async fn an_end_that_says_it_was_aborted_is_a_refusal_not_a_save() {
    let range = |stream| Range::whole(stream, 10);
    let played = play(
        None,
        TestSink::new(),
        |id, stream| accepted(id, range(stream)),
        |stream| vec![begin(range(stream)), chunk(stream, &[1; 10]), vec![0x12, stream, 0]],
    )
    .await;

    assert_eq!(played.result.unwrap_err(), SaveError::DaemonRefused { reason: "the transfer was aborted".into() });
    assert!(played.sink.inner.is_discarded() && !played.sink.inner.is_finished());
}

#[tokio::test(start_paused = true)]
async fn empty_chunks_are_not_written_and_do_not_count() {
    let range = |stream| Range::whole(stream, 10);
    let mut frames = vec![];
    let played = play(
        None,
        TestSink::new(),
        |id, stream| accepted(id, range(stream)),
        |stream| {
            frames.push(begin(range(stream)));
            frames.extend((0..2_000).map(|_| chunk(stream, &[])));
            frames.push(chunk(stream, &[5; 10]));
            frames.extend((0..2_000).map(|_| chunk(stream, &[])));
            frames.push(end(stream));
            std::mem::take(&mut frames)
        },
    )
    .await;

    let saved = played.result.unwrap();
    assert_eq!(saved.bytes, 10);
    assert_eq!(played.sink.writes, 1);
    assert_eq!(played.sink.bytes(), [5; 10]);
}

// ---- a seeded loop ----

/// A small deterministic generator: the same sequence on every run.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, bound: u64) -> u64 {
        self.next() % bound
    }
}

/// One frame of a generated scene.
#[derive(Clone)]
enum Piece {
    Begin,
    /// A `Begin` that announces one byte more than the answer did.
    Longer,
    Chunk(Vec<u8>),
    End,
    Error,
}

impl Piece {
    fn render(&self, range: Range) -> Vec<u8> {
        match self {
            Self::Begin => begin(range),
            Self::Longer => begin_changed(range, "length", json!(range.total + 1)),
            Self::Chunk(data) => chunk(range.stream, data),
            Self::End => end(range.stream),
            Self::Error => error_frame(range.stream, "read_failed"),
        }
    }

    fn is_terminal(&self) -> bool {
        matches!(self, Self::End | Self::Error)
    }
}

/// A scene that is a whole, valid save of `total` bytes: `Begin`, the bytes in pieces, `End`.
fn valid_scene(rng: &mut Rng, total: u64, fill: u8) -> Vec<Piece> {
    let mut scene = vec![Piece::Begin];
    let mut left = total;
    while left > 0 {
        let piece = rng.below(left + 1).max(1).min(left);
        scene.push(Piece::Chunk(vec![fill; usize::try_from(piece).unwrap_or(0)]));
        left -= piece;
    }
    scene.push(Piece::End);
    scene
}

/// Breaks a scene a few times: drops, repeats and adds frames, or ends it with an `Error`.
fn mutate(rng: &mut Rng, scene: &mut Vec<Piece>, total: u64, fill: u8) {
    for _ in 0..rng.below(4) {
        let at = usize::try_from(rng.below(scene.len() as u64 + 1)).unwrap_or(0).min(scene.len());
        match rng.below(5) {
            0 if at < scene.len() => {
                scene.remove(at);
            }
            1 if at < scene.len() => scene.insert(at, scene[at].clone()),
            2 => scene.insert(at, Piece::Chunk(vec![fill; usize::try_from(rng.below(total + 3)).unwrap_or(0)])),
            3 => scene.insert(at, if rng.below(2) == 0 { Piece::Begin } else { Piece::Longer }),
            _ => scene.insert(at, if rng.below(2) == 0 { Piece::End } else { Piece::Error }),
        }
    }
    // A daemon's stream always ends with a frame of its own, so that a stop finds the end of it.
    if !scene.iter().any(Piece::is_terminal) {
        scene.push(Piece::Error);
    }
}

#[tokio::test(start_paused = true)]
async fn random_frame_sequences_never_panic_and_a_save_that_completes_holds_exactly_what_was_sent() {
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    let (mut completed, mut failed) = (0, 0);
    for round in 0..300_u32 {
        let total = rng.below(40);
        let fill = u8::try_from(round % 251).unwrap_or(0);
        let mut scene = valid_scene(&mut rng, total, fill);
        mutate(&mut rng, &mut scene, total, fill);
        // What a save can have written: the chunks before the first frame that ends the stream.
        let sent: Vec<u8> = scene
            .iter()
            .take_while(|piece| !piece.is_terminal())
            .filter_map(|piece| if let Piece::Chunk(data) = piece { Some(data.clone()) } else { None })
            .flatten()
            .collect();

        let played = play(
            None,
            TestSink::new(),
            |id, stream| accepted(id, Range::whole(stream, total)),
            |stream| scene.iter().map(|piece| piece.render(Range::whole(stream, total))).collect(),
        )
        .await;

        match &played.result {
            Ok(saved) => {
                completed += 1;
                assert_eq!(played.sink.bytes(), sent.as_slice(), "round {round}");
                assert_eq!(saved.bytes, total, "round {round}");
                assert!(played.sink.inner.is_finished());
            }
            Err(error) => {
                failed += 1;
                assert!(!matches!(error, SaveError::ConnectionLost { .. } | SaveError::Internal(_)), "round {round}: {error:?}");
                assert!(played.sink.inner.is_discarded() && !played.sink.inner.is_finished(), "round {round}");
            }
        }
        assert!(played.sink.written() <= total, "round {round}: never more than the announced bytes");
        assert!(all_streams_free(&played.connection), "round {round}: a stream stays reserved");
    }
    assert!(completed > 20 && failed > 20, "the generator reaches both outcomes ({completed} completed, {failed} failed)");
}
