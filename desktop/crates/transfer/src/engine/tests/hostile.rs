//! A daemon that misbehaves, through the engine: every fault the stand-in can produce, and a server of
//! the test's own that sends what no daemon should. Each ends the connection with `protocol`, or the
//! transfer with its code; nothing panics, nothing hangs (a daemon that goes quiet is retried without
//! end, so the test cancels that transfer and expects `cancelled`), and what the engine holds stays
//! within the limits: the download hold and one frame.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use pistudiodesktop_net::{DaemonSocket, dial};
use serde_json::{Value, json};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::{JoinHandle, JoinSet};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};

use super::rigs::{Calls, RigSink, library_panics};
use super::support::{Dialer, Result, Step, engine_with, pattern, save, scripted, upload};
use crate::Limits;
use crate::connection::Close;
use crate::engine::{ConnectError, Connector, Engine};
use crate::limits::{CHUNK_BYTES, DOWNLOAD_HOLD_BYTES, MAX_MESSAGE_BYTES};
use crate::testing::{After, Asked, Direction, Disorder, Fault, Request, StandInDaemon, StreamFault};
use crate::upload::MemorySource;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Way {
    Upload,
    Save,
}

/// Short waits: a daemon that goes quiet is noticed in a fraction of a second.
fn limits() -> Limits {
    Limits {
        answer_wait: Duration::from_millis(150),
        close_wait: Duration::from_millis(100),
        ping_after: Duration::from_millis(80),
        dropped_after: Duration::from_millis(250),
        backoff_start: Duration::from_millis(10),
        backoff_max: Duration::from_millis(40),
        ..Limits::default()
    }
}

/// How long a transfer gets to end by itself when it must, and when it will not (a daemon that never
/// answers is retried without end).
const MUST_SETTLE: Duration = Duration::from_secs(8);
const LOOPS: Duration = Duration::from_millis(250);

const DATA_BYTES: usize = 100_000;

/// The most the engine may hold for a transfer whose daemon sent a frame of `biggest_frame` bytes: the
/// download hold, that frame, and a chunk of slack.
fn held_bound(biggest_frame: usize) -> u64 {
    (DOWNLOAD_HOLD_BYTES + biggest_frame + CHUNK_BYTES) as u64
}

/// How one transfer ended.
struct Driven {
    /// The failure's code, or `ok`.
    code: &'static str,
    /// The transfer did not end by itself in `patience`: the test cancelled it.
    cancelled_by_the_test: bool,
    /// The save's sink.
    calls: Option<Arc<Calls>>,
}

async fn settled<T>(mut call: JoinHandle<T>, within: Duration) -> std::result::Result<T, JoinHandle<T>> {
    match tokio::time::timeout(within, &mut call).await {
        Ok(done) => Ok(done.unwrap()),
        Err(_) => Err(call),
    }
}

/// Whether `condition` holds within `limit` of real time.
async fn within(limit: Duration, mut condition: impl FnMut() -> bool) -> bool {
    tokio::time::timeout(limit, async {
        while !condition() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .is_ok()
}

fn code_of(result: &Result) -> &'static str {
    match result {
        Ok(_) => "ok",
        Err(failure) => failure.code,
    }
}

/// Runs one transfer of `data` through `engine` (an upload to `/srv/t`, a save of `/f/a`) and says how it
/// ended: by itself within `patience`, or cancelled by the test.
async fn drive<C: Connector>(engine: &Arc<Engine<C>>, way: Way, data: &[u8], patience: Duration) -> Driven {
    let (call, calls) = match way {
        Way::Upload => (upload(engine, "t", "/srv/t", MemorySource::new(data.to_vec())), None),
        Way::Save => {
            let (sink, calls) = RigSink::keeping();
            (save(engine, "t", "/f/a", sink), Some(calls))
        }
    };
    match settled(call, patience).await {
        Ok(result) => Driven { code: code_of(&result), cancelled_by_the_test: false, calls },
        Err(call) => {
            let _ = engine.cancel("t");
            let result = settled(call, MUST_SETTLE).await.unwrap_or_else(|_| panic!("a cancel did not settle the transfer within {MUST_SETTLE:?}"));
            Driven { code: code_of(&result), cancelled_by_the_test: true, calls }
        }
    }
}

/// The engine ends without waiting for anything that will not come, and holds nothing afterwards.
async fn wind_up<C: Connector>(engine: &Arc<Engine<C>>, label: &str) {
    tokio::time::timeout(MUST_SETTLE, engine.cancel_all_and_close(Close::GoingAway)).await.unwrap_or_else(|_| panic!("{label}: the engine did not close"));
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.active.len(), snapshot.queued), (0, 0), "{label}: nothing is left");
}

// ---- the stand-in's faults ----

/// What a fault does to the transfer that meets it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ends {
    /// The transfer fails with this code.
    With(&'static str),
    /// The transfer completes, after a retry or because the fault does not touch it.
    Completes,
}

use Ends::{Completes, With};

fn stream(fault: StreamFault) -> Fault {
    Fault::DownloadStream(fault)
}

fn refuse(request: Request, error: &str) -> Fault {
    Fault::Refuse { request, error: error.to_owned() }
}

fn rpc_error(request: Request) -> Fault {
    Fault::RpcError { request, code: "handler_error".to_owned(), message: "the handler failed".to_owned() }
}

fn error_after(bytes: u64, message: &str) -> StreamFault {
    StreamFault::ErrorAfter { bytes, message: message.to_owned() }
}

/// The biggest frame a fault makes the stand-in send, beyond a chunk.
fn biggest(fault: &Fault) -> usize {
    match fault {
        Fault::DownloadStream(StreamFault::Oversized(bytes)) => *bytes,
        _ => 0,
    }
}

/// Every fault of the stand-in that touches a save, and how the save ends.
fn save_faults() -> Vec<(Fault, Ends)> {
    let ordered = |disorder| stream(StreamFault::OutOfOrder(disorder));
    vec![
        (stream(StreamFault::ErrorFirst("boom".into())), With("daemon_refused")),
        (stream(StreamFault::ErrorFirst("changed".into())), With("changed")),
        (stream(StreamFault::ErrorFirst("cancelled".into())), With("daemon_refused")),
        (ordered(Disorder::ChunkBeforeBegin), With("protocol")),
        (ordered(Disorder::EndBeforeChunks), With("protocol")),
        (ordered(Disorder::ChunkAfterEnd), Completes),
        (ordered(Disorder::ChunkOnOtherStream), Completes),
        (stream(StreamFault::Oversized(2 * 1024 * 1024)), With("protocol")),
        (stream(StreamFault::Oversized(MAX_MESSAGE_BYTES + 1)), With("protocol")),
        (stream(StreamFault::ExtraBytes(1)), With("protocol")),
        (stream(StreamFault::ExtraBytes(1024 * 1024)), With("protocol")),
        (stream(error_after(40_000, "read_failed")), With("daemon_refused")),
        (stream(error_after(40_000, "changed")), With("changed")),
        (refuse(Request::Download, "not_found"), With("daemon_refused")),
        (refuse(Request::Download, "no_free_stream"), With("daemon_refused")),
        (refuse(Request::Download, "range_not_satisfiable"), With("daemon_refused")),
        (rpc_error(Request::Download), With("daemon_refused")),
        // A daemon that goes quiet is dropped, and the save asks again.
        (Fault::Silence { request: Asked::Download }, Completes),
        (Fault::StopAnswering { after: After::TextFrames(Direction::FromClient, 1) }, Completes),
        (Fault::StopAnswering { after: After::Bytes(Direction::ToClient, 40_000) }, Completes),
        (Fault::Reset { after: After::Bytes(Direction::ToClient, 40_000) }, Completes),
        (Fault::Close { after: After::Start, code: 1013 }, Completes),
    ]
}

/// Every fault of the stand-in that touches an upload, and how the upload ends.
fn upload_faults() -> Vec<(Fault, Ends)> {
    let from = Direction::FromClient;
    vec![
        (refuse(Request::Upload, "no_free_stream"), With("daemon_refused")),
        (refuse(Request::Upload, "missing_fields"), With("daemon_refused")),
        (rpc_error(Request::Upload), With("daemon_refused")),
        (Fault::UploadFails { error: "rename_failed (EACCES)".into() }, With("daemon_refused")),
        (Fault::WrongBytesWritten { reported: 1 }, With("size_mismatch")),
        (Fault::WrongBytesWritten { reported: (1 << 53) - 1 }, With("size_mismatch")),
        (Fault::Silence { request: Asked::Upload }, Completes),
        (Fault::StopAnswering { after: After::TextFrames(from, 1) }, Completes),
        (Fault::StopReading { after: After::Frames(from, 3) }, Completes),
        (Fault::Reset { after: After::Frames(from, 3) }, Completes),
        (Fault::Close { after: After::Start, code: 1013 }, Completes),
    ]
}

/// What a row saw, to be judged on the test's task.
struct Observed {
    label: String,
    driven: Driven,
    peak_held: u64,
    bound: u64,
    /// The daemon's side is right: a completed transfer is whole, a failed one left nothing or the whole file.
    exact: bool,
    streams_free: bool,
}

async fn fault_row(way: Way, fault: Fault, ends: Ends) -> Observed {
    let label = format!("{way:?} {fault:?}");
    let daemon = StandInDaemon::start().await.unwrap();
    let data = pattern(DATA_BYTES);
    daemon.put_file("/f/a", data.clone());
    let bound = held_bound(biggest(&fault));
    daemon.script(fault);
    let (engine, _) = engine_with(Dialer::new(&daemon), limits());

    let driven = drive(&engine, way, &data, MUST_SETTLE).await;
    let exact = match (way, ends) {
        (Way::Upload, Completes) => daemon.file("/srv/t") == Some(data.clone()),
        // A refused or failed upload keeps nothing; one the daemon wrote and counted wrongly keeps the whole file.
        (Way::Upload, With(_)) => daemon.file("/srv/t").is_none_or(|kept| kept == data),
        (Way::Save, Completes) => driven.calls.as_ref().is_some_and(|calls| calls.bytes() == data && calls.finishes() == 1 && calls.discards() == 0),
        (Way::Save, With(_)) => driven.calls.as_ref().is_some_and(|calls| calls.bytes().is_empty() && calls.finishes() == 0 && calls.discards() == 1),
    };
    let peak_held = engine.snapshot().peak_held;
    wind_up(&engine, &label).await;
    // A daemon that stopped reading ends its connection when it reads the close.
    daemon.resume_reading();
    let streams_free = within(Duration::from_secs(5), || daemon.streams_in_use() == 0).await;
    Observed { label, driven, peak_held, bound, exact, streams_free }
}

fn judge(seen: &Observed, ends: Ends) {
    let label = &seen.label;
    match ends {
        With(code) => assert_eq!(seen.driven.code, code, "{label}: how it ended"),
        Completes => assert_eq!(seen.driven.code, "ok", "{label}: how it ended"),
    }
    assert!(!seen.driven.cancelled_by_the_test, "{label}: it did not end by itself");
    assert!(seen.exact, "{label}: the daemon's side and the sink are right");
    assert!(seen.streams_free, "{label}: a stream is still in use on the daemon");
    assert!(seen.peak_held <= seen.bound, "{label}: held {} bytes, more than {}", seen.peak_held, seen.bound);
}

#[tokio::test]
async fn every_fault_of_the_stand_in_ends_the_transfer_with_its_code_and_nothing_else_breaks() {
    let panics = library_panics();
    let mut rows = JoinSet::new();
    let mut expected = std::collections::HashMap::new();
    for (fault, ends) in save_faults() {
        expected.insert(format!("{:?} {fault:?}", Way::Save), ends);
        rows.spawn(fault_row(Way::Save, fault, ends));
    }
    for (fault, ends) in upload_faults() {
        expected.insert(format!("{:?} {fault:?}", Way::Upload), ends);
        rows.spawn(fault_row(Way::Upload, fault, ends));
    }
    let total = expected.len();
    let mut judged = 0;
    while let Some(seen) = rows.join_next().await {
        let seen = seen.unwrap();
        let ends = *expected.get(&seen.label).unwrap_or_else(|| panic!("{}: no such row", seen.label));
        judge(&seen, ends);
        judged += 1;
    }
    assert_eq!(judged, total);
    assert_eq!(library_panics(), panics, "the engine or the stand-in panicked");
}

// ---- a server of the test's own ----

/// What the hostile server does. Each is one way a daemon can be wrong that the stand-in cannot be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Behavior {
    /// The `status` of the handshake never comes.
    NoStatus,
    /// The `status` is not JSON.
    StatusGarbage,
    /// The `status` lists none of the features the engine needs.
    StatusNoFeatures,
    /// A close with 1008 right after the `status`.
    Close1008,
    /// The socket is dropped right after the `status`.
    DropAfterHello,
    /// The answer to the request is not JSON.
    NotJson,
    /// The answer is a JSON object with no `type`.
    NoType,
    /// The answer is of the right kind and the wrong shape.
    WrongShape,
    /// The answer names a stream that does not exist.
    StreamOutOfRange,
    /// The answer has sizes that are floats of 1e30.
    HugeNumbers,
    /// The answer's range is not the end of the file.
    RangeLies,
    /// An `rpc_error` for the request.
    RpcError,
    /// An answer for a request that was never made.
    AnswerForAnother,
    /// A binary frame of 16 MiB and a byte.
    OversizedBinary,
    /// A text frame of 16 MiB and a byte.
    OversizedText,
    /// The request is accepted, then come eight frames of random bytes.
    JunkAfterAnswer,
    /// The request goes unanswered while 3,000 `ping`s come.
    PingFlood,
    /// An upload is accepted and `file_upload_complete` comes at once with another size.
    CompleteTooEarly,
    /// An upload is accepted and its `file_upload_complete` names another stream.
    CompleteForAnotherStream,
    /// Frames of random kinds, from this seed, after the `status`.
    Storm(u64),
}

use Behavior::{
    AnswerForAnother, Close1008, CompleteForAnotherStream, CompleteTooEarly, DropAfterHello, HugeNumbers, JunkAfterAnswer, NoStatus, NoType, NotJson,
    OversizedBinary, OversizedText, PingFlood, RangeLies, RpcError, StatusGarbage, StatusNoFeatures, Storm, StreamOutOfRange, WrongShape,
};

/// How the transfer ends, and whether it does so by itself.
struct Expect {
    codes: &'static [&'static str],
    /// The daemon leaves the transfer retrying: the test must cancel it.
    loops: bool,
}

fn expect(behavior: Behavior) -> Expect {
    let ends = |codes| Expect { codes, loops: false };
    let loops = Expect { codes: &["cancelled"], loops: true };
    match behavior {
        NoStatus | Close1008 | DropAfterHello | PingFlood | AnswerForAnother => loops,
        StatusGarbage | NotJson | NoType | WrongShape | StreamOutOfRange | HugeNumbers | OversizedBinary | OversizedText | CompleteForAnotherStream => {
            ends(&["protocol"])
        }
        StatusNoFeatures => ends(&["unsupported_daemon"]),
        RpcError => ends(&["daemon_refused"]),
        CompleteTooEarly => ends(&["size_mismatch"]),
        // The daemon answers, and then says nothing or something broken: the transfer is cancelled or
        // meets the break.
        // An `Error` frame among the junk is a refusal.
        RangeLies | JunkAfterAnswer => Expect { codes: &["protocol", "daemon_refused", "cancelled"], loops: true },
        Storm(_) => Expect { codes: &["protocol", "daemon_refused", "size_mismatch", "changed", "cancelled"], loops: true },
    }
}

/// The behaviors, and the ways they apply to.
fn hostile_rows() -> Vec<(Way, Behavior)> {
    let both = [
        NoStatus,
        StatusGarbage,
        StatusNoFeatures,
        Close1008,
        DropAfterHello,
        NotJson,
        NoType,
        WrongShape,
        StreamOutOfRange,
        HugeNumbers,
        RangeLies,
        RpcError,
        AnswerForAnother,
        OversizedBinary,
        OversizedText,
        JunkAfterAnswer,
        PingFlood,
    ];
    let mut rows: Vec<(Way, Behavior)> = both.iter().flat_map(|behavior| [(Way::Upload, *behavior), (Way::Save, *behavior)]).collect();
    rows.push((Way::Upload, CompleteTooEarly));
    rows.push((Way::Upload, CompleteForAnotherStream));
    rows.extend((0..24).flat_map(|seed| [(Way::Upload, Storm(seed)), (Way::Save, Storm(seed))]));
    rows
}

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
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

    fn bytes(&mut self, most: u64) -> Vec<u8> {
        let len = self.below(most + 1);
        (0..len).map(|_| self.next().to_le_bytes()[0]).collect()
    }
}

/// A request the client made.
struct Req {
    kind: String,
    id: String,
    transfer_id: Option<String>,
    stream: Option<u64>,
}

fn parse_request(text: &str) -> Option<Req> {
    let frame: Value = serde_json::from_str(text).ok()?;
    let message = frame.get("message")?;
    Some(Req {
        kind: message.get("type")?.as_str()?.to_owned(),
        id: message.get("requestId")?.as_str()?.to_owned(),
        transfer_id: message.get("transferId").and_then(Value::as_str).map(str::to_owned),
        stream: message.get("stream").and_then(Value::as_u64),
    })
}

fn session(message: &Value) -> Message {
    Message::text(json!({ "type": "session", "message": message }).to_string())
}

fn response_kind(request: &Req) -> &'static str {
    if request.kind == "file_upload_request" { "file_upload_response" } else { "file_download_response" }
}

/// A well-formed acceptance of `request`.
fn accepted(request: &Req) -> Value {
    if request.kind == "file_upload_request" {
        json!({ "type": "file_upload_response", "requestId": request.id, "ok": true, "stream": 3 })
    } else {
        json!({
            "type": "file_download_response", "requestId": request.id, "ok": true, "stream": request.stream.unwrap_or(0),
            "transferId": "d-1", "totalBytes": 100, "mtimeMs": 1, "offset": 0, "length": 100,
        })
    }
}

fn frame(opcode: u8, stream: u8, payload: &[u8]) -> Message {
    let mut bytes = vec![opcode, stream];
    bytes.extend_from_slice(payload);
    Message::binary(bytes)
}

/// What the server sends in answer to the client's request.
fn replies(behavior: Behavior, request: &Req) -> Vec<Message> {
    let kind = response_kind(request);
    match behavior {
        NotJson => vec![Message::text("}{ not json")],
        NoType => vec![Message::text(json!({ "unrelated": 1 }).to_string())],
        WrongShape => vec![session(&json!({ "type": kind, "requestId": request.id, "ok": "yes", "stream": "x" }))],
        StreamOutOfRange => vec![session(&json!({ "type": kind, "requestId": request.id, "ok": true, "stream": 300 }))],
        HugeNumbers if request.kind == "file_upload_request" => {
            vec![session(&json!({ "type": kind, "requestId": request.id, "ok": true, "stream": 1e30 }))]
        }
        HugeNumbers => {
            let big = json!(1e30);
            vec![session(&json!({
                "type": kind, "requestId": request.id, "ok": true, "stream": request.stream.unwrap_or(0),
                "transferId": "d", "totalBytes": big, "mtimeMs": big, "offset": 0, "length": big,
            }))]
        }
        RangeLies if request.kind == "file_download_request" => {
            vec![session(&json!({
                "type": kind, "requestId": request.id, "ok": true, "stream": request.stream.unwrap_or(0),
                "transferId": "d", "totalBytes": 5, "mtimeMs": 1, "offset": 0, "length": 10,
            }))]
        }
        RangeLies | CompleteForAnotherStream => vec![session(&accepted(request))],
        RpcError => vec![session(&json!({ "type": "rpc_error", "requestId": request.id, "code": "handler_error", "message": "nope" }))],
        AnswerForAnother => {
            let mut other = accepted(request);
            other["requestId"] = json!("nobody-asked");
            vec![session(&other)]
        }
        OversizedBinary => vec![Message::binary(vec![0x11; MAX_MESSAGE_BYTES + 1])],
        OversizedText => vec![Message::text("x".repeat(MAX_MESSAGE_BYTES + 1))],
        JunkAfterAnswer => junk_after(request),
        PingFlood => (0..3000).map(|n| Message::text(json!({ "type": "ping", "requestId": format!("p-{n}"), "clientSentAt": n }).to_string())).collect(),
        CompleteTooEarly => vec![
            session(&accepted(request)),
            session(&json!({ "type": "file_upload_complete", "transferId": request.transfer_id, "stream": 3, "ok": true, "bytesWritten": 5 })),
        ],
        Storm(seed) => storm(seed, request),
        NoStatus | StatusGarbage | StatusNoFeatures | Close1008 | DropAfterHello => Vec::new(),
    }
}

fn junk_after(request: &Req) -> Vec<Message> {
    let mut rng = Rng::new(7);
    let mut out = vec![session(&accepted(request))];
    for _ in 0..8 {
        let opcode = [0x10, 0x11, 0x12, 0x13, 0x00, 0xFF, 0x20][rng.below(7) as usize];
        let stream = u8::try_from(rng.below(4)).unwrap_or(0);
        out.push(frame(opcode, stream, &rng.bytes(64)));
    }
    out
}

/// Frames of random kinds, from `seed`: acceptances, errors, completions, binary frames, and now and then text that is no JSON.
fn storm(seed: u64, request: &Req) -> Vec<Message> {
    let mut rng = Rng::new(seed);
    (0..16)
        .map(|_| match rng.below(12) {
            0..=2 => Message::binary(rng.bytes(300)),
            3..=5 => frame(0x10 + u8::try_from(rng.below(4)).unwrap_or(0), u8::try_from(rng.below(4)).unwrap_or(0), &rng.bytes(200)),
            6 | 7 => session(&accepted(request)),
            8 => session(&json!({ "type": "rpc_error", "requestId": request.id, "code": "x", "message": "y" })),
            9 => session(&json!({ "type": "file_upload_complete", "transferId": "t", "stream": rng.below(5), "ok": rng.below(2) == 0, "bytesWritten": rng.below(200_000) })),
            10 => session(&json!({ "type": "file_download_response", "requestId": request.id, "ok": false, "error": "not_found" })),
            _ => Message::text(String::from_utf8_lossy(&rng.bytes(40)).into_owned()),
        })
        .collect()
}

const STATUS: &str = r#"{"type":"status","payload":{"status":"server_info","serverId":"x","hostname":"h","version":"0","homeDir":"/","capabilities":{},"features":{"fileDownloadRanges":true,"fileTransferAck":true,"agentStreamsMode":true}}}"#;
const STATUS_NO_FEATURES: &str =
    r#"{"type":"status","payload":{"status":"server_info","serverId":"x","hostname":"h","version":"0","homeDir":"/","capabilities":{},"features":{}}}"#;

type Ws = WebSocketStream<TcpStream>;

/// Answers the `hello`. False when the server is not to go on.
async fn greet(ws: &mut Ws, behavior: Behavior) -> bool {
    let sent = match behavior {
        NoStatus => return false,
        StatusGarbage => ws.send(Message::text("{{{")).await,
        StatusNoFeatures => ws.send(Message::text(STATUS_NO_FEATURES)).await,
        _ => ws.send(Message::text(STATUS)).await,
    };
    if sent.is_err() {
        return false;
    }
    match behavior {
        DropAfterHello => false,
        Close1008 => {
            let _ = ws.close(Some(CloseFrame { code: CloseCode::Policy, reason: "no".into() })).await;
            false
        }
        _ => true,
    }
}

async fn serve(tcp: TcpStream, behavior: Behavior) {
    let config = WebSocketConfig::default().max_message_size(Some(64 << 20)).max_frame_size(Some(64 << 20));
    let Ok(mut ws) = tokio_tungstenite::accept_async_with_config(tcp, Some(config)).await else { return };
    if ws.next().await.is_none() {
        return;
    }
    if !greet(&mut ws, behavior).await {
        // The server that says nothing, or has hung up, still reads until the client goes.
        while ws.next().await.is_some_and(|message| message.is_ok()) {}
        return;
    }
    let mut upload: Option<(String, u8)> = None;
    while let Some(Ok(message)) = ws.next().await {
        let out = match &message {
            Message::Text(text) => parse_request(text.as_str()).map(|request| {
                upload = request.transfer_id.clone().map(|id| (id, 3));
                replies(behavior, &request)
            }),
            // The upload's `End`: the one frame that a daemon answers with `file_upload_complete`.
            Message::Binary(bytes) if behavior == CompleteForAnotherStream && bytes.first() == Some(&0x12) => upload.take().map(|(id, stream)| {
                vec![session(&json!({ "type": "file_upload_complete", "transferId": id, "stream": stream + 1, "ok": true, "bytesWritten": 0 }))]
            }),
            _ => None,
        };
        for reply in out.unwrap_or_default() {
            if ws.send(reply).await.is_err() {
                return;
            }
        }
    }
}

struct Hostile {
    url: String,
    task: JoinHandle<()>,
}

impl Hostile {
    async fn start(behavior: Behavior) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            while let Ok((tcp, _)) = listener.accept().await {
                tokio::spawn(serve(tcp, behavior));
            }
        });
        Self { url, task }
    }
}

impl Drop for Hostile {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Dials the hostile server.
struct ToHostile(String);

impl Connector for ToHostile {
    async fn connect(&self) -> std::result::Result<DaemonSocket, ConnectError> {
        Ok(dial(&self.0, None, Duration::from_secs(5), MAX_MESSAGE_BYTES).await?)
    }
}

async fn hostile_row(way: Way, behavior: Behavior) -> (String, Driven, u64) {
    let label = format!("{way:?} {behavior:?}");
    let server = Hostile::start(behavior).await;
    let (engine, _) = engine_with(ToHostile(server.url.clone()), limits());
    let patience = if expect(behavior).loops { LOOPS } else { MUST_SETTLE };
    let driven = drive(&engine, way, &pattern(DATA_BYTES), patience).await;
    let peak = engine.snapshot().peak_held;
    wind_up(&engine, &label).await;
    (label, driven, peak)
}

#[tokio::test]
async fn a_daemon_that_sends_what_no_daemon_should_ends_each_transfer_with_protocol_or_its_code() {
    let panics = library_panics();
    let mut rows = JoinSet::new();
    let table = hostile_rows();
    let total = table.len();
    for (way, behavior) in table {
        rows.spawn(async move { (behavior, hostile_row(way, behavior).await) });
    }
    let mut judged = 0;
    while let Some(done) = rows.join_next().await {
        let (behavior, (label, driven, peak)) = done.unwrap();
        let want = expect(behavior);
        assert!(want.codes.contains(&driven.code), "{label}: it ended with `{}`, not one of {:?}", driven.code, want.codes);
        if !want.loops {
            assert!(!driven.cancelled_by_the_test, "{label}: it should have ended by itself");
        }
        if let Some(calls) = &driven.calls {
            assert_eq!((calls.finishes(), calls.discards()), (0, 1), "{label}: the sink is discarded once and never finished");
        }
        assert!(peak <= held_bound(MAX_MESSAGE_BYTES), "{label}: held {peak} bytes");
        judged += 1;
    }
    assert_eq!(judged, total);
    assert_eq!(library_panics(), panics, "the engine panicked");
}

#[tokio::test]
async fn a_transfer_that_met_a_hostile_server_leaves_the_engine_as_usable_as_it_found_it() {
    let daemon = StandInDaemon::start().await.unwrap();
    let server = Hostile::start(NotJson).await;
    let (connector, control) = scripted(&daemon, None);
    control.push(Step::Url(server.url.clone()));
    let (engine, _) = engine_with(connector, limits());

    // The first connection is the hostile server's: the transfer fails with `protocol`, and is not retried.
    let failure = engine.upload("a", "/srv/a", MemorySource::new(pattern(10))).await.unwrap_err();
    assert_eq!(failure.code, "protocol");
    assert_eq!(control.attempts(), 1);
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.totals.failed, snapshot.totals.done, snapshot.active.len()), (1, 0, 0));
    assert_eq!(snapshot.last_error.map(|error| error.code), Some("protocol"));

    // The next transfer dials the real daemon and completes.
    assert_eq!(engine.upload("b", "/srv/b", MemorySource::new(pattern(5000))).await, Ok(5000));
    assert_eq!(daemon.file("/srv/b"), Some(pattern(5000)));
    assert_eq!(engine.snapshot().totals.done, 1);
}
