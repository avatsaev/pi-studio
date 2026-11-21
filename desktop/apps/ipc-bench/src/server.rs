//! The benchmark's WebSocket server, on `127.0.0.1`. The path of the request picks the behaviour:
//!
//! | Path | Behaviour |
//! |---|---|
//! | `/echo` | sends back every text or binary message it receives, at once |
//! | `/flood?frames=N&size=S&kind=binary\|text` | waits for the text `go`, sends N frames of S bytes (the format of [`crate::frame`]), then `{"type":"done","frames":N,"bytes":B,"hash":"…"}` |
//! | `/sink` | checks every frame it receives; on the text `end` answers `{"type":"report",…}` ([`Report`]) |
//!
//! The switches (`--corrupt`, `--swap`) damage one frame of each stream, to prove that the page's
//! check (B6) notices: `corrupt` changes a byte of the frame with that counter (in `/echo` and
//! `/flood`: as sent; in `/sink`: as received, before the check), `swap` puts the frame with that
//! counter after the next one (`/flood` as sent, `/sink` as received; `/echo` answers one frame at a
//! time and cannot).

use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::Utf8Bytes;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::{WebSocketStream, accept_hdr_async_with_config};

use crate::frame::{self, BASIS, Report, StreamCheck};

/// A flood is at most this many frames and bytes: input is hostile even on loopback.
const MAX_FRAMES: u64 = 10_000_000;
const MAX_STREAM_BYTES: u64 = 8 << 30;
/// A flood flushes after this many frames, so a frame never waits long in the write buffer.
const FLUSH_EVERY: u32 = 64;
/// How long a finished stream waits for the page to close before the server drops it.
const LINGER: Duration = Duration::from_secs(30);

type Ws = WebSocketStream<TcpStream>;
type Result<T, E = String> = std::result::Result<T, E>;

/// Which frame of each stream to damage (by counter), if any.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Switches {
    pub corrupt: Option<u32>,
    pub swap: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Binary,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FloodSpec {
    pub frames: u32,
    pub size: usize,
    pub kind: Kind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Echo,
    Flood(FloodSpec),
    Sink,
}

/// The behaviour a request path and query ask for, or what is wrong with them.
pub fn parse_route(path: &str, query: Option<&str>) -> Result<Route> {
    match path {
        "/echo" => Ok(Route::Echo),
        "/sink" => Ok(Route::Sink),
        "/flood" => parse_flood(query.unwrap_or("")).map(Route::Flood),
        other => Err(format!("no such path: {other} (known: /echo, /flood, /sink)")),
    }
}

fn parse_flood(query: &str) -> Result<FloodSpec> {
    let (mut frames, mut size, mut kind) = (None, None, Kind::Binary);
    for pair in query.split('&').filter(|p| !p.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        match key {
            "frames" => frames = value.parse::<u32>().ok(),
            "size" => size = value.parse::<usize>().ok(),
            "kind" => {
                kind = match value {
                    "binary" => Kind::Binary,
                    "text" => Kind::Text,
                    other => return Err(format!("kind is binary or text, not {other:?}")),
                }
            }
            other => return Err(format!("unknown parameter {other:?}")),
        }
    }
    let frames = frames.ok_or("frames=<count> is required")?;
    let size = size.ok_or("size=<bytes> is required")?;
    frame::check_size(size, kind == Kind::Text)?;
    if u64::from(frames) > MAX_FRAMES || u64::from(frames) * size as u64 > MAX_STREAM_BYTES {
        return Err(format!("a flood is at most {MAX_FRAMES} frames and {MAX_STREAM_BYTES} bytes"));
    }
    Ok(FloodSpec { frames, size, kind })
}

/// Accepts connections on `listener` for as long as the process runs.
pub async fn serve(listener: std::net::TcpListener, switches: Switches) -> Result<()> {
    listener.set_nonblocking(true).map_err(|e| format!("cannot make the listener non-blocking: {e}"))?;
    let listener = TcpListener::from_std(listener).map_err(|e| format!("cannot use the listener: {e}"))?;
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                tokio::spawn(async move {
                    if let Err(e) = connection(stream, switches).await {
                        eprintln!("ipc-bench: connection ended: {e}");
                    }
                });
            }
            Err(e) => {
                eprintln!("ipc-bench: accept failed: {e}");
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    }
}

// The handshake callback's refusal is tungstenite's `ErrorResponse`, a whole HTTP response: its type, not ours.
#[allow(clippy::result_large_err)]
async fn connection(stream: TcpStream, switches: Switches) -> Result<()> {
    // Without this a 32-byte echo waits for the delayed-ACK timer: row B1 would measure Nagle.
    stream.set_nodelay(true).map_err(|e| format!("cannot set TCP_NODELAY: {e}"))?;
    let mut route = None;
    let callback = |req: &Request, response: Response| -> std::result::Result<Response, ErrorResponse> {
        match parse_route(req.uri().path(), req.uri().query()) {
            Ok(r) => {
                route = Some(r);
                Ok(response)
            }
            Err(message) => {
                let mut refused = ErrorResponse::new(Some(message));
                *refused.status_mut() = StatusCode::BAD_REQUEST;
                Err(refused)
            }
        }
    };
    let config = WebSocketConfig::default().max_message_size(Some(frame::MAX_FRAME * 2)).max_frame_size(Some(frame::MAX_FRAME * 2));
    let mut ws = accept_hdr_async_with_config(stream, callback, Some(config)).await.map_err(|e| format!("handshake: {e}"))?;
    match route {
        Some(Route::Echo) => echo(&mut ws, switches).await,
        Some(Route::Flood(spec)) => flood(&mut ws, spec, switches).await,
        Some(Route::Sink) => sink(&mut ws, switches).await,
        None => Err("the handshake passed without a route".into()),
    }
}

fn send_err(e: impl std::fmt::Display) -> String {
    format!("send: {e}")
}

async fn echo(ws: &mut Ws, switches: Switches) -> Result<()> {
    let mut position: u64 = 0;
    while let Some(message) = ws.next().await {
        let message = message.map_err(|e| format!("receive: {e}"))?;
        let damage = switches.corrupt.is_some_and(|k| u64::from(k) == position);
        let reply = match message {
            Message::Binary(bytes) if damage => {
                let mut copy = bytes.to_vec();
                frame::corrupt(&mut copy, false);
                Message::binary(copy)
            }
            Message::Text(text) if damage => {
                let mut copy = text.as_bytes().to_vec();
                frame::corrupt(&mut copy, true);
                Message::text(String::from_utf8(copy).map_err(|e| format!("corrupted text: {e}"))?)
            }
            m @ (Message::Binary(_) | Message::Text(_)) => m,
            Message::Close(_) => break,
            _ => continue,
        };
        position += 1;
        ws.send(reply).await.map_err(send_err)?;
    }
    Ok(())
}

async fn flood(ws: &mut Ws, spec: FloodSpec, switches: Switches) -> Result<()> {
    // The page says when to start, so that it is listening and its clock is running.
    match ws.next().await {
        Some(Ok(Message::Text(t))) if t.as_str() == "go" => {}
        other => return Err(format!("a flood starts on the text `go`, got {other:?}")),
    }
    let text = spec.kind == Kind::Text;
    let template = if text { frame::text_template(spec.size)? } else { frame::binary_template(spec.size)? };
    let mut chain = BASIS;
    let mut bytes: u64 = 0;
    let mut held: Option<Message> = None;
    for counter in 0..spec.frames {
        let (mut data, sum) = if text { frame::text_frame(&template, counter) } else { frame::binary_frame(&template, counter) };
        // The hash is of the frames as they should be: the page must find what the switches did.
        chain = frame::mix(chain, sum);
        bytes += data.len() as u64;
        if switches.corrupt == Some(counter) {
            frame::corrupt(&mut data, text);
        }
        let message = if text { Message::Text(Utf8Bytes::try_from(data).map_err(|e| format!("text frame: {e}"))?) } else { Message::binary(data) };
        if switches.swap == Some(counter) && counter + 1 < spec.frames {
            held = Some(message);
            continue;
        }
        ws.feed(message).await.map_err(send_err)?;
        if let Some(earlier) = held.take() {
            ws.feed(earlier).await.map_err(send_err)?;
        }
        if counter % FLUSH_EVERY == FLUSH_EVERY - 1 {
            ws.flush().await.map_err(send_err)?;
        }
    }
    let done = serde_json::json!({ "type": "done", "frames": spec.frames, "bytes": bytes, "hash": format!("{chain:08x}") });
    ws.send(Message::text(done.to_string())).await.map_err(send_err)?;
    linger(ws).await;
    Ok(())
}

/// A sink's state, apart from the socket: what it was given and what the switches do to it.
struct SinkState {
    check: StreamCheck,
    arrivals: u64,
    switches: Switches,
    held: Option<Message>,
}

impl SinkState {
    fn new(switches: Switches) -> Self {
        Self { check: StreamCheck::default(), arrivals: 0, switches, held: None }
    }

    /// One frame arrives; the switches may change it or put it after the next one.
    fn arrive(&mut self, mut message: Message) {
        let position = self.arrivals;
        self.arrivals += 1;
        if self.switches.corrupt.is_some_and(|k| u64::from(k) == position) {
            message = damage(message);
        }
        if self.switches.swap.is_some_and(|k| u64::from(k) == position) && self.held.is_none() {
            self.held = Some(message);
            return;
        }
        self.accept(&message);
        if let Some(earlier) = self.held.take() {
            self.accept(&earlier);
        }
    }

    /// The stream ended: a frame still held goes in now.
    fn finish(&mut self) -> Report {
        if let Some(earlier) = self.held.take() {
            self.accept(&earlier);
        }
        self.check.report()
    }

    fn accept(&mut self, message: &Message) {
        match message {
            Message::Binary(b) => self.check.accept_binary(b),
            Message::Text(t) => self.check.accept_text(t.as_str()),
            _ => {}
        }
    }
}

fn damage(message: Message) -> Message {
    match message {
        Message::Binary(b) => {
            let mut copy = b.to_vec();
            frame::corrupt(&mut copy, false);
            Message::binary(copy)
        }
        Message::Text(t) => {
            let mut copy = t.as_bytes().to_vec();
            frame::corrupt(&mut copy, true);
            match Utf8Bytes::try_from(copy) {
                Ok(text) => Message::Text(text),
                Err(_) => Message::Text(t),
            }
        }
        other => other,
    }
}

async fn sink(ws: &mut Ws, switches: Switches) -> Result<()> {
    let mut state = SinkState::new(switches);
    while let Some(message) = ws.next().await {
        match message.map_err(|e| format!("receive: {e}"))? {
            Message::Text(t) if t.as_str() == "end" => {
                let report = serde_json::json!({ "type": "report", "report": state.finish() });
                ws.send(Message::text(report.to_string())).await.map_err(send_err)?;
                linger(ws).await;
                return Ok(());
            }
            m @ (Message::Binary(_) | Message::Text(_)) => state.arrive(m),
            Message::Close(_) => break,
            _ => {}
        }
    }
    Ok(())
}

/// Reads until the page closes (or [`LINGER`] passes): closing first would cut what the page has
/// not read yet.
async fn linger(ws: &mut Ws) {
    let _ = tokio::time::timeout(LINGER, async {
        while let Some(Ok(m)) = ws.next().await {
            if m.is_close() {
                break;
            }
        }
    })
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::connect_async;

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap()
    }

    async fn start(switches: Switches) -> u16 {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(serve(listener, switches));
        port
    }

    async fn dial(port: u16, path: &str) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>> {
        connect_async(format!("ws://127.0.0.1:{port}{path}")).await.unwrap().0
    }

    #[test]
    fn routes_are_parsed_and_bounded() {
        assert_eq!(parse_route("/echo", None), Ok(Route::Echo));
        assert_eq!(parse_route("/sink", Some("x=1")), Ok(Route::Sink));
        assert_eq!(parse_route("/flood", Some("frames=10&size=4096&kind=text")), Ok(Route::Flood(FloodSpec { frames: 10, size: 4096, kind: Kind::Text })));
        assert_eq!(parse_route("/flood", Some("frames=3&size=32")), Ok(Route::Flood(FloodSpec { frames: 3, size: 32, kind: Kind::Binary })));
        for bad in [
            ("/nope", None),
            ("/flood", None),
            ("/flood", Some("frames=3")),
            ("/flood", Some("frames=3&size=33")),
            ("/flood", Some("frames=x&size=32")),
            ("/flood", Some("frames=3&size=32&kind=blob")),
            ("/flood", Some("frames=3&size=32&surprise=1")),
            ("/flood", Some("frames=10000001&size=32")),
            ("/flood", Some("frames=4000000&size=4194304")),
        ] {
            assert!(parse_route(bad.0, bad.1).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn echo_sends_back_what_it_gets_and_corrupts_the_chosen_frame() {
        runtime().block_on(async {
            let port = start(Switches { corrupt: Some(1), swap: None }).await;
            let mut ws = dial(port, "/echo").await;
            let template = frame::binary_template(32).unwrap();
            let mut check = StreamCheck::default();
            for i in 0..3 {
                let (data, _) = frame::binary_frame(&template, i);
                ws.send(Message::binary(data.clone())).await.unwrap();
                let Message::Binary(reply) = ws.next().await.unwrap().unwrap() else { panic!("not binary") };
                if i != 1 {
                    assert_eq!(reply.as_ref(), data.as_slice());
                }
                check.accept_binary(&reply);
            }
            let report = check.report();
            assert_eq!(report.errors.iter().map(|e| e.frame).collect::<Vec<_>>(), [1]);
        });
    }

    async fn read_flood(port: u16, query: &str) -> (StreamCheck, serde_json::Value) {
        let mut ws = dial(port, &format!("/flood?{query}")).await;
        ws.send(Message::text("go")).await.unwrap();
        let mut check = StreamCheck::default();
        loop {
            match ws.next().await.unwrap().unwrap() {
                Message::Binary(b) => check.accept_binary(&b),
                Message::Text(t) => match serde_json::from_str::<serde_json::Value>(t.as_str()) {
                    Ok(done) => return (check, done),
                    Err(_) => check.accept_text(t.as_str()),
                },
                _ => {}
            }
        }
    }

    #[test]
    fn a_flood_arrives_whole_and_its_hash_matches() {
        runtime().block_on(async {
            let port = start(Switches::default()).await;
            for query in ["frames=200&size=4096", "frames=300&size=200&kind=text"] {
                let (check, done) = read_flood(port, query).await;
                let report = check.report();
                assert_eq!(report.error_count, 0, "{query}");
                assert_eq!(done["frames"], report.frames, "{query}");
                assert_eq!(done["bytes"], report.bytes, "{query}");
                assert_eq!(done["hash"], report.hash.as_str(), "{query}");
            }
        });
    }

    #[test]
    fn a_flood_with_a_corrupted_or_swapped_frame_is_caught() {
        runtime().block_on(async {
            let port = start(Switches { corrupt: Some(7), swap: None }).await;
            let (check, done) = read_flood(port, "frames=20&size=64").await;
            let report = check.report();
            assert_eq!(report.errors.iter().map(|e| e.frame).collect::<Vec<_>>(), [7]);
            assert_ne!(done["hash"], report.hash.as_str());

            let port = start(Switches { corrupt: None, swap: Some(4) }).await;
            let (check, done) = read_flood(port, "frames=20&size=64").await;
            let report = check.report();
            assert_eq!(report.frames, 20);
            assert_eq!(report.errors.iter().map(|e| e.frame).collect::<Vec<_>>(), [4, 5]);
            assert_ne!(done["hash"], report.hash.as_str());

            // Text frames too.
            let port = start(Switches { corrupt: Some(2), swap: None }).await;
            let (check, _) = read_flood(port, "frames=5&size=200&kind=text").await;
            assert_eq!(check.report().errors.iter().map(|e| e.frame).collect::<Vec<_>>(), [2]);
        });
    }

    #[test]
    fn a_sink_reports_what_it_received() {
        runtime().block_on(async {
            let port = start(Switches::default()).await;
            let mut ws = dial(port, "/sink").await;
            let template = frame::binary_template(1024).unwrap();
            let mut mine = StreamCheck::default();
            for i in 0..40 {
                let (data, _) = frame::binary_frame(&template, i);
                mine.accept_binary(&data);
                ws.send(Message::binary(data)).await.unwrap();
            }
            ws.send(Message::text("end")).await.unwrap();
            let Message::Text(t) = ws.next().await.unwrap().unwrap() else { panic!("not text") };
            let answer: serde_json::Value = serde_json::from_str(t.as_str()).unwrap();
            assert_eq!(answer["type"], "report");
            assert_eq!(answer["report"]["frames"], 40);
            assert_eq!(answer["report"]["errorCount"], 0);
            assert_eq!(answer["report"]["hash"], mine.report().hash.as_str());
        });
    }

    #[test]
    fn a_sink_with_switches_finds_the_damaged_frame() {
        let template = frame::binary_template(64).unwrap();
        let frames: Vec<Message> = (0..10).map(|i| Message::binary(frame::binary_frame(&template, i).0)).collect();
        let run = |switches| {
            let mut sink = SinkState::new(switches);
            frames.iter().cloned().for_each(|m| sink.arrive(m));
            sink.finish()
        };
        assert_eq!(run(Switches::default()).error_count, 0);
        let corrupted = run(Switches { corrupt: Some(3), swap: None });
        assert_eq!(corrupted.errors.iter().map(|e| e.frame).collect::<Vec<_>>(), [3]);
        let swapped = run(Switches { corrupt: None, swap: Some(6) });
        assert_eq!(swapped.frames, 10);
        assert_eq!(swapped.errors.iter().map(|e| e.frame).collect::<Vec<_>>(), [6, 7]);
        // The last frame cannot be swapped with a next one; it is still checked.
        let last = run(Switches { corrupt: None, swap: Some(9) });
        assert_eq!((last.frames, last.error_count), (10, 0));
    }

    #[test]
    fn a_refused_path_answers_400() {
        runtime().block_on(async {
            let port = start(Switches::default()).await;
            let refused = connect_async(format!("ws://127.0.0.1:{port}/nope")).await;
            assert!(refused.is_err());
        });
    }
}
