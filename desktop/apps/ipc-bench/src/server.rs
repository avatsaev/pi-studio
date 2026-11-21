//! The benchmark's WebSocket server, on `127.0.0.1`. The path of the request picks the behaviour:
//!
//! | Path | Behaviour |
//! |---|---|
//! | `/echo` | sends back every text or binary message it receives, at once |
//! | `/flood?frames=N&size=S&kind=binary\|text` | waits for the text `go`, sends N frames of S bytes (the format of [`crate::frame`]), then `{"type":"done","frames":N,"bytes":B,"hash":"…"}` |
//! | `/sink` | checks every frame it receives; on the text `end` answers `{"type":"report",…}` ([`Report`]) |
//! | `/mixed?frames=N&size=S` | `/flood` (binary) that also echoes every binary or text message it receives, on the same socket, until the page closes (row B7: B1's echo while B4's download runs) |
//! | `/paced?rate=R&seconds=T&size=S` | waits for the text `go`, sends `R` binary frames of `S` bytes per second for `T` seconds (10 ms ticks; a tick that runs late sends what is due), then the closing message of a flood (row B8) |
//!
//! The switches (`--corrupt`, `--swap`) damage one frame of each stream, to prove that the page's
//! check (B6) notices: `corrupt` changes a byte of the frame with that counter (in `/echo` and
//! `/flood`: as sent; in `/sink`: as received, before the check), `swap` puts the frame with that
//! counter after the next one (`/flood` as sent, `/sink` as received; `/echo` answers one frame at a
//! time and cannot).

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use futures_util::{FutureExt as _, SinkExt as _, StreamExt as _};
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
/// A paced stream's tick (row B8: 1,000 frames a second is 10 frames a tick).
const PACE_TICK: Duration = Duration::from_millis(10);
const TICKS_PER_SECOND: u64 = 100;
/// The bounds of a paced stream: input is hostile even on loopback.
const MAX_RATE: u32 = 100_000;
const MAX_SECONDS: u32 = 3600;
/// How long a finished stream waits for the page to close before the server drops it, so that a page that never
/// closes cannot hold a server for long: a page that has not finished a stream in this long has stalled
/// (the page's own watchdog fails a run after 30 s without a frame).
const LINGER: Duration = Duration::from_secs(60);

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
pub struct PacedSpec {
    pub rate: u32,
    pub seconds: u32,
    pub size: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Echo,
    Flood(FloodSpec),
    /// A binary flood that also echoes.
    Mixed(FloodSpec),
    Paced(PacedSpec),
    Sink,
}

/// The behaviour a request path and query ask for, or what is wrong with them.
pub fn parse_route(path: &str, query: Option<&str>) -> Result<Route> {
    match path {
        "/echo" => Ok(Route::Echo),
        "/sink" => Ok(Route::Sink),
        "/flood" => parse_flood(query.unwrap_or("")).map(Route::Flood),
        "/mixed" => match parse_flood(query.unwrap_or("")) {
            Ok(spec) if spec.kind == Kind::Binary => Ok(Route::Mixed(spec)),
            Ok(_) => Err("/mixed floods binary frames only".into()),
            Err(e) => Err(e),
        },
        "/paced" => parse_paced(query.unwrap_or("")).map(Route::Paced),
        other => Err(format!("no such path: {other} (known: /echo, /flood, /mixed, /paced, /sink)")),
    }
}

fn parse_paced(query: &str) -> Result<PacedSpec> {
    let (mut rate, mut seconds, mut size) = (None, None, None);
    for pair in query.split('&').filter(|p| !p.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        match key {
            "rate" => rate = value.parse::<u32>().ok(),
            "seconds" => seconds = value.parse::<u32>().ok(),
            "size" => size = value.parse::<usize>().ok(),
            other => return Err(format!("unknown parameter {other:?}")),
        }
    }
    let rate = rate.filter(|r| (1..=MAX_RATE).contains(r)).ok_or_else(|| format!("rate=<frames per second, 1 to {MAX_RATE}> is required"))?;
    let seconds = seconds.filter(|s| (1..=MAX_SECONDS).contains(s)).ok_or_else(|| format!("seconds=<1 to {MAX_SECONDS}> is required"))?;
    let size = size.ok_or("size=<bytes> is required")?;
    frame::check_size(size, false)?;
    let frames = u64::from(rate) * u64::from(seconds);
    if frames > MAX_FRAMES || frames * size as u64 > MAX_STREAM_BYTES {
        return Err(format!("a paced stream is at most {MAX_FRAMES} frames and {MAX_STREAM_BYTES} bytes"));
    }
    Ok(PacedSpec { rate, seconds, size })
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

/// Bytes of flood frames the server has handed to a socket, over all floods: it stops growing when a
/// reader stops reading and the socket's buffers are full (the no-acknowledgement test reads it).
pub type Fed = Arc<AtomicU64>;

/// Accepts connections on `listener` for as long as the process runs.
pub async fn serve(listener: std::net::TcpListener, switches: Switches, fed: Fed) -> Result<()> {
    listener.set_nonblocking(true).map_err(|e| format!("cannot make the listener non-blocking: {e}"))?;
    let listener = TcpListener::from_std(listener).map_err(|e| format!("cannot use the listener: {e}"))?;
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let fed = fed.clone();
                tokio::spawn(async move {
                    if let Err(e) = connection(stream, switches, fed).await {
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
async fn connection(stream: TcpStream, switches: Switches, fed: Fed) -> Result<()> {
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
        Some(Route::Flood(spec)) => flood(&mut ws, spec, switches, &fed, false).await,
        Some(Route::Mixed(spec)) => flood(&mut ws, spec, switches, &fed, true).await,
        Some(Route::Paced(spec)) => paced(&mut ws, spec, switches, &fed).await,
        Some(Route::Sink) => sink(&mut ws, switches).await,
        None => Err("the handshake passed without a route".into()),
    }
}

fn send_err(e: impl std::fmt::Display) -> String {
    format!("send: {e}")
}

/// Answers one message of an echo: the same message back, damaged when the switches ask for it at
/// this `position`. `false` when the page is closing.
async fn echo_one(ws: &mut Ws, message: Message, position: &mut u64, switches: Switches) -> Result<bool> {
    let damage = switches.corrupt.is_some_and(|k| u64::from(k) == *position);
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
        Message::Close(_) => return Ok(false),
        _ => return Ok(true),
    };
    *position += 1;
    ws.send(reply).await.map_err(send_err)?;
    Ok(true)
}

async fn echo(ws: &mut Ws, switches: Switches) -> Result<()> {
    let mut position: u64 = 0;
    while let Some(message) = ws.next().await {
        if !echo_one(ws, message.map_err(|e| format!("receive: {e}"))?, &mut position, switches).await? {
            break;
        }
    }
    Ok(())
}

/// Answers every message that has already arrived, without waiting for another. `false` when the
/// page is closing.
async fn echo_ready(ws: &mut Ws, position: &mut u64, switches: Switches) -> Result<bool> {
    while let Some(next) = ws.next().now_or_never() {
        match next {
            Some(message) => {
                if !echo_one(ws, message.map_err(|e| format!("receive: {e}"))?, position, switches).await? {
                    return Ok(false);
                }
            }
            None => return Ok(false),
        }
    }
    Ok(true)
}

/// Echoes until the page closes (or [`LINGER`] passes): the answer of a request sent just before the
/// stream's end must still come.
async fn echo_until_closed(ws: &mut Ws, position: &mut u64, switches: Switches) -> Result<()> {
    let echoing = async {
        while let Some(message) = ws.next().await {
            if !echo_one(ws, message.map_err(|e| format!("receive: {e}"))?, position, switches).await? {
                break;
            }
        }
        Ok(())
    };
    tokio::time::timeout(LINGER, echoing).await.unwrap_or(Ok(()))
}

/// The page says when a stream starts (the text `go`), so that it is listening and its clock is running.
async fn wait_for_go(ws: &mut Ws, what: &str) -> Result<()> {
    match ws.next().await {
        Some(Ok(Message::Text(t))) if t.as_str() == "go" => Ok(()),
        other => Err(format!("{what} starts on the text `go`, got {other:?}")),
    }
}

/// Makes the frames of one stream, with what the switches do to them, and its closing message.
struct Maker {
    text: bool,
    template: Vec<u8>,
    total: u32,
    chain: u32,
    bytes: u64,
    held: Option<Message>,
    switches: Switches,
}

impl Maker {
    fn new(kind: Kind, size: usize, total: u32, switches: Switches) -> Result<Self> {
        let text = kind == Kind::Text;
        let template = if text { frame::text_template(size)? } else { frame::binary_template(size)? };
        Ok(Self { text, template, total, chain: BASIS, bytes: 0, held: None, switches })
    }

    /// Frame `counter`: what to send now. Nothing when the frame waits behind the next one (`swap`),
    /// and two messages when it brings the one it was swapped with.
    fn frame(&mut self, counter: u32) -> Result<[Option<Message>; 2]> {
        let (mut data, sum) = if self.text { frame::text_frame(&self.template, counter) } else { frame::binary_frame(&self.template, counter) };
        // The hash is of the frames as they should be: the page must find what the switches did.
        self.chain = frame::mix(self.chain, sum);
        self.bytes += data.len() as u64;
        if self.switches.corrupt == Some(counter) {
            frame::corrupt(&mut data, self.text);
        }
        let message = if self.text { Message::Text(Utf8Bytes::try_from(data).map_err(|e| format!("text frame: {e}"))?) } else { Message::binary(data) };
        if self.switches.swap == Some(counter) && counter + 1 < self.total {
            self.held = Some(message);
            return Ok([None, None]);
        }
        Ok([Some(message), self.held.take()])
    }

    fn closing(&self) -> Message {
        let done = serde_json::json!({ "type": "done", "frames": self.total, "bytes": self.bytes, "hash": format!("{:08x}", self.chain) });
        Message::text(done.to_string())
    }
}

/// Hands `messages` to the socket (not flushed) and counts their bytes in `fed`.
async fn feed_all(ws: &mut Ws, messages: [Option<Message>; 2], fed: &AtomicU64) -> Result<()> {
    for message in messages.into_iter().flatten() {
        let len = message.len() as u64;
        ws.feed(message).await.map_err(send_err)?;
        fed.fetch_add(len, Ordering::Relaxed);
    }
    Ok(())
}

/// A flood. With `echoing` (the `/mixed` route) it also answers, between two frames, every message
/// the page has sent, and goes on answering after the closing message until the page closes.
async fn flood(ws: &mut Ws, spec: FloodSpec, switches: Switches, fed: &AtomicU64, echoing: bool) -> Result<()> {
    wait_for_go(ws, "a flood").await?;
    let mut maker = Maker::new(spec.kind, spec.size, spec.frames, switches)?;
    let mut position: u64 = 0;
    for counter in 0..spec.frames {
        let messages = maker.frame(counter)?;
        feed_all(ws, messages, fed).await?;
        if counter % FLUSH_EVERY == FLUSH_EVERY - 1 {
            ws.flush().await.map_err(send_err)?;
        }
        if echoing && !echo_ready(ws, &mut position, switches).await? {
            return Ok(());
        }
    }
    ws.send(maker.closing()).await.map_err(send_err)?;
    if echoing {
        return echo_until_closed(ws, &mut position, switches).await;
    }
    linger(ws).await;
    Ok(())
}

/// A paced stream: every [`PACE_TICK`] the frames due by then, `rate` a second, for `seconds`. A tick
/// that runs late (or a write that blocks because the reader does not read) is made up for at the next.
async fn paced(ws: &mut Ws, spec: PacedSpec, switches: Switches, fed: &AtomicU64) -> Result<()> {
    wait_for_go(ws, "a paced stream").await?;
    let total = spec.rate * spec.seconds;
    let mut maker = Maker::new(Kind::Binary, spec.size, total, switches)?;
    let mut tick = tokio::time::interval(PACE_TICK);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Burst);
    let (mut ticks, mut sent) = (0u64, 0u32);
    while sent < total {
        tick.tick().await;
        ticks += 1;
        let due = u32::try_from((u64::from(spec.rate) * ticks / TICKS_PER_SECOND).min(u64::from(total))).unwrap_or(total);
        while sent < due {
            let messages = maker.frame(sent)?;
            feed_all(ws, messages, fed).await?;
            sent += 1;
        }
        ws.flush().await.map_err(send_err)?;
    }
    ws.send(maker.closing()).await.map_err(send_err)?;
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
    let waited = tokio::time::timeout(LINGER, async {
        while let Some(Ok(m)) = ws.next().await {
            if m.is_close() {
                break;
            }
        }
    })
    .await;
    if waited.is_err() {
        eprintln!("ipc-bench: the server dropped a finished stream after {} s: the page had not closed it", LINGER.as_secs());
    }
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
        tokio::spawn(serve(listener, switches, Fed::default()));
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

    #[test]
    fn mixed_and_paced_routes_are_parsed_and_bounded() {
        assert_eq!(parse_route("/mixed", Some("frames=10&size=4096")), Ok(Route::Mixed(FloodSpec { frames: 10, size: 4096, kind: Kind::Binary })));
        assert_eq!(parse_route("/paced", Some("rate=1000&seconds=30&size=4096")), Ok(Route::Paced(PacedSpec { rate: 1000, seconds: 30, size: 4096 })));
        for bad in [
            ("/mixed", Some("frames=10&size=4096&kind=text")),
            ("/mixed", None),
            ("/paced", None),
            ("/paced", Some("rate=0&seconds=3&size=64")),
            ("/paced", Some("rate=100001&seconds=3&size=64")),
            ("/paced", Some("rate=10&seconds=0&size=64")),
            ("/paced", Some("rate=10&seconds=3601&size=64")),
            ("/paced", Some("rate=10&seconds=3")),
            ("/paced", Some("rate=10&seconds=3&size=63")),
            ("/paced", Some("rate=100000&seconds=3600&size=64")),
            ("/paced", Some("rate=10&seconds=3&size=64&kind=text")),
        ] {
            assert!(parse_route(bad.0, bad.1).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn a_mixed_stream_floods_and_echoes_on_one_socket() {
        runtime().block_on(async {
            let port = start(Switches::default()).await;
            let mut ws = dial(port, "/mixed?frames=300&size=4096").await;
            ws.send(Message::text("go")).await.unwrap();
            let echo_template = frame::binary_template(32).unwrap();
            let mut sent_echo = StreamCheck::default();
            for i in 0..20 {
                let (data, _) = frame::binary_frame(&echo_template, i);
                sent_echo.accept_binary(&data);
                ws.send(Message::binary(data)).await.unwrap();
            }
            let (mut flood, mut echoed) = (StreamCheck::default(), StreamCheck::default());
            let done = loop {
                match ws.next().await.unwrap().unwrap() {
                    Message::Binary(b) if b.len() == 32 => echoed.accept_binary(&b),
                    Message::Binary(b) => flood.accept_binary(&b),
                    Message::Text(t) => break serde_json::from_str::<serde_json::Value>(t.as_str()).unwrap(),
                    _ => {}
                }
            };
            // A request sent after the flood is over is still answered; the first twenty may come
            // before the flood's end or after it (the flood is quick), the last one comes after.
            let (data, _) = frame::binary_frame(&echo_template, 20);
            ws.send(Message::binary(data)).await.unwrap();
            while echoed.report().frames < 21 {
                match ws.next().await.unwrap().unwrap() {
                    Message::Binary(b) if b.len() == 32 => echoed.accept_binary(&b),
                    other => panic!("not an echo: {other:?}"),
                }
            }
            let (flood, echoed) = (flood.report(), echoed.report());
            assert_eq!((flood.error_count, flood.frames), (0, 300));
            assert_eq!(done["hash"], flood.hash.as_str());
            assert_eq!((echoed.error_count, echoed.frames), (0, 21));
        });
    }

    #[test]
    fn a_paced_stream_arrives_whole_at_its_rate() {
        runtime().block_on(async {
            let port = start(Switches::default()).await;
            let mut ws = dial(port, "/paced?rate=500&seconds=1&size=128").await;
            ws.send(Message::text("go")).await.unwrap();
            let started = std::time::Instant::now();
            let mut check = StreamCheck::default();
            let done = loop {
                match ws.next().await.unwrap().unwrap() {
                    Message::Binary(b) => check.accept_binary(&b),
                    Message::Text(t) => break serde_json::from_str::<serde_json::Value>(t.as_str()).unwrap(),
                    _ => {}
                }
            };
            let report = check.report();
            assert_eq!((report.error_count, report.frames), (0, 500));
            assert_eq!(done["frames"], 500);
            assert_eq!(done["hash"], report.hash.as_str());
            // 500 frames a second for one second: not all at once, not much later.
            let elapsed = started.elapsed();
            assert!(elapsed >= Duration::from_millis(900) && elapsed < Duration::from_secs(5), "{elapsed:?}");
        });
    }

    #[test]
    fn a_paced_stream_with_a_corrupted_or_swapped_frame_is_caught() {
        runtime().block_on(async {
            for (switches, expected) in [(Switches { corrupt: Some(5), swap: None }, vec![5]), (Switches { corrupt: None, swap: Some(8) }, vec![8, 9])] {
                let port = start(switches).await;
                let mut ws = dial(port, "/paced?rate=100&seconds=1&size=64").await;
                ws.send(Message::text("go")).await.unwrap();
                let mut check = StreamCheck::default();
                let done = loop {
                    match ws.next().await.unwrap().unwrap() {
                        Message::Binary(b) => check.accept_binary(&b),
                        Message::Text(t) => break serde_json::from_str::<serde_json::Value>(t.as_str()).unwrap(),
                        _ => {}
                    }
                };
                let report = check.report();
                assert_eq!(report.errors.iter().map(|e| e.frame).collect::<Vec<_>>(), expected);
                assert_ne!(done["hash"], report.hash.as_str());
            }
        });
    }
}
