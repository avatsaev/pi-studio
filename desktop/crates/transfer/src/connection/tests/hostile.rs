//! What a hostile daemon cannot do: end the engine with a panic, grow its memory, or be believed.

use std::time::Duration;

use serde_json::json;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::frame::Frame as RawFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::{Data, OpCode};

use super::support::{ANSWERING, Daemon, chunk, connect};
use crate::connection::Connection;
use crate::error::Error;
use crate::limits::MAX_MESSAGE_BYTES;

async fn is_open(connection: &Connection) -> bool {
    timeout(Duration::ZERO, connection.ended()).await.is_err()
}

/// The code of the close frame the daemon is sent last, if any.
async fn closed_with(daemon: &mut Daemon) -> Option<u16> {
    let mut code = None;
    while let Some(seen) = daemon.next().await {
        if let Message::Close(Some(frame)) = seen.message {
            code = Some(u16::from(frame.code));
        }
    }
    code
}

fn protocol(reason: Error) -> String {
    match reason {
        Error::Protocol(text) => text,
        other => panic!("expected a protocol error, got {other:?}"),
    }
}

#[tokio::test(start_paused = true)]
async fn a_message_of_exactly_16_mib_is_taken_and_one_byte_more_ends_the_connection_with_protocol() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    // A binary frame of another protocol, the limit exactly: ignored.
    daemon.send_binary(vec![0x01; MAX_MESSAGE_BYTES]);
    daemon.send_json(&json!({ "type": "ping", "requestId": "after" }));
    assert_eq!(daemon.next_of("pong").await.json()["requestId"], "after");
    assert!(is_open(&connection).await);

    daemon.send_binary(vec![0x01; MAX_MESSAGE_BYTES + 1]);
    protocol(connection.ended().await);
    assert_eq!(closed_with(&mut daemon).await, Some(1002));
}

#[tokio::test(start_paused = true)]
async fn a_text_message_above_16_mib_ends_the_connection_with_protocol() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    daemon.send(Message::text("x".repeat(MAX_MESSAGE_BYTES + 1)));
    protocol(connection.ended().await);
    assert_eq!(closed_with(&mut daemon).await, Some(1002));
}

#[tokio::test(start_paused = true)]
async fn text_that_is_not_utf8_ends_the_connection_with_protocol() {
    for bytes in [vec![0xff, 0xfe, 0xfd], vec![b'{', 0xc3, 0x28, b'}'], vec![0xf0, 0x28, 0x8c, 0xbc], vec![0xed, 0xa0, 0x80]] {
        let (connection, mut daemon) = connect(ANSWERING).await;
        daemon.send(Message::Frame(RawFrame::message(bytes.clone(), OpCode::Data(Data::Text), true)));
        let text = protocol(connection.ended().await);
        assert!(!text.is_empty());
        assert_eq!(closed_with(&mut daemon).await, Some(1002), "{bytes:?}");
    }
}

#[tokio::test(start_paused = true)]
async fn a_text_frame_that_is_not_one_the_protocol_has_ends_the_connection_with_protocol() {
    for text in [
        "not json at all",
        "",
        "null",
        "[1, 2, 3]",
        "\"a string\"",
        "{}",
        "{\"type\": 5}",
        "{\"type\": null}",
        "{\"type\":\"session\"}",
        "{\"type\":\"session\",\"message\":5}",
        "{\"type\":\"session\",\"message\":{}}",
        "{\"type\":\"ping\"}",
        "{\"type\":\"ping\",\"requestId\":7}",
        "{\"type\":\"ping\",\"requestId\":\"x\",\"clientSentAt\":-1}",
        "{\"type\":\"pong\"}",
        "{\"type\":\"session\",\"message\":{\"type\":\"file_upload_complete\"}}",
        "{\"type\":\"session\",\"message\":{\"type\":\"file_upload_complete\",\"transferId\":\"t\",\"stream\":999,\"ok\":true,\"bytesWritten\":1}}",
        "{\"type\":\"session\",\"message\":{\"type\":\"file_upload_complete\",\"transferId\":\"t\",\"stream\":1,\"ok\":true,\"bytesWritten\":9007199254740992}}",
        "{\"type\":\"session\",\"message\":{\"type\":\"file_upload_complete\",\"transferId\":\"t\",\"stream\":1,\"ok\":true,\"bytesWritten\":-5}}",
        "{\"type\":\"session\",\"message\":{\"type\":\"rpc_error\",\"code\":1}}",
        "{\"type\":\"status\",\"payload\":{\"status\":\"server_info\",\"features\":\"yes\"}}",
        "{\"type\":\"status\",\"payload\":{\"status\":\"server_info\",\"features\":[true]}}",
    ] {
        let (connection, daemon) = connect(ANSWERING).await;
        daemon.send(Message::text(text));
        let words = protocol(connection.ended().await);
        assert!(text.is_empty() || !words.contains(text), "the daemon's words are repeated: {words}");
    }
}

#[tokio::test(start_paused = true)]
async fn a_frame_of_a_running_download_that_wire_cannot_read_ends_the_connection_and_the_same_frame_elsewhere_is_ignored() {
    let broken_begins: Vec<Vec<u8>> = vec![
        b"{".to_vec(),
        b"not json".to_vec(),
        b"[]".to_vec(),
        b"{}".to_vec(),
        br#"{"transferId": 5}"#.to_vec(),
        br#"{"transferId": "t", "totalBytes": -1}"#.to_vec(),
        br#"{"transferId": "t", "totalBytes": 1.5}"#.to_vec(),
        br#"{"transferId": "t", "totalBytes": 9007199254740992}"#.to_vec(),
        vec![b' '; 70 * 1024],
        vec![0xff, 0xfe],
    ];
    for payload in broken_begins {
        let mut frame = vec![0x10, 0];
        frame.extend_from_slice(&payload);

        // On a stream nobody downloads on: ignored.
        let (connection, mut daemon) = connect(ANSWERING).await;
        let mut unused = frame.clone();
        unused[1] = 77;
        daemon.send_binary(unused);
        daemon.send_json(&json!({ "type": "ping", "requestId": "alive" }));
        daemon.next_of("pong").await;
        assert!(is_open(&connection).await);

        // On a running download: the connection ends.
        let download = connection.download().unwrap();
        assert_eq!(download.stream(), 0);
        daemon.send_binary(frame);
        protocol(connection.ended().await);
        assert_eq!(closed_with(&mut daemon).await, Some(1002));
    }
}

/// A seeded xorshift: the same frames on every run.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, bound: usize) -> usize {
        usize::try_from(self.next() % u64::try_from(bound).unwrap()).unwrap()
    }

    /// Up to `bound` random bytes (fewer than `bound`).
    fn bytes_up_to(&mut self, bound: usize) -> Vec<u8> {
        let count = self.below(bound);
        (0..count).map(|_| u8::try_from(self.next() & 0xff).unwrap()).collect()
    }
}

/// A frame made to look like what the daemon sends, then broken in one place.
fn hostile_frame(rng: &mut Rng, stream: u8) -> Message {
    const TEXTS: [&str; 8] = [
        r#"{"type":"status","payload":{"status":"server_info","features":{}}}"#,
        r#"{"type":"ping","requestId":"p","clientSentAt":1}"#,
        r#"{"type":"pong","requestId":"p"}"#,
        r#"{"type":"session","message":{"type":"file_upload_complete","transferId":"t","stream":1,"ok":true,"bytesWritten":3}}"#,
        r#"{"type":"session","message":{"type":"rpc_error","requestId":"r1","code":"handler_error","message":"m"}}"#,
        r#"{"type":"session","message":{"type":"file_download_response","requestId":"r1","ok":true,"stream":0}}"#,
        r#"{"type":"agent_stream","agentId":"a"}"#,
        r#"{"type":"session","message":{"type":"anything","requestId":"nobody"}}"#,
    ];
    let mut bytes = match rng.below(4) {
        0 => TEXTS[rng.below(TEXTS.len())].as_bytes().to_vec(),
        1 => rng.bytes_up_to(64),
        2 => {
            let mut frame = vec![0x10 + u8::try_from(rng.below(4)).unwrap(), if rng.below(4) == 0 { u8::try_from(rng.below(256)).unwrap() } else { stream }];
            if rng.below(2) == 0 {
                frame.extend_from_slice(br#"{"transferId":"t","fileName":"f","totalBytes":10,"mtimeMs":1,"offset":0,"length":10}"#);
            } else {
                frame.extend(rng.bytes_up_to(40));
            }
            frame
        }
        _ => {
            let mut frame = vec![u8::try_from(rng.below(256)).unwrap(), stream];
            frame.extend(rng.bytes_up_to(48));
            frame
        }
    };
    // One byte changed, one cut off, or nothing: three times in four.
    if !bytes.is_empty() {
        match rng.below(4) {
            0 => {
                let at = rng.below(bytes.len());
                bytes[at] = u8::try_from(rng.next() & 0xff).unwrap();
            }
            1 => bytes.truncate(rng.below(bytes.len())),
            _ => {}
        }
    }
    let as_text = bytes.first().is_some_and(|first| *first == b'{') || bytes.is_empty() && rng.below(2) == 0;
    if as_text { Message::Frame(RawFrame::message(bytes, OpCode::Data(Data::Text), true)) } else { Message::binary(bytes) }
}

#[tokio::test(start_paused = true)]
async fn random_and_broken_frames_never_panic_and_leave_a_protocol_end_or_a_working_connection() {
    let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
    let mut survived = 0;
    let mut ended = 0;
    for round in 0..1500 {
        let (connection, mut daemon) = connect(ANSWERING).await;
        let download = connection.download().unwrap();
        let stream = download.stream();
        daemon.send(hostile_frame(&mut rng, stream));
        daemon.send_json(&json!({ "type": "ping", "requestId": "probe" }));

        // Either the probe is answered, or the connection ended with a protocol error: nothing else, and no hang.
        loop {
            let seen = daemon.next().await;
            match seen {
                Some(seen) if seen.kind() == "pong" && seen.json()["requestId"] == "probe" => {
                    assert!(is_open(&connection).await, "round {round}");
                    survived += 1;
                    break;
                }
                Some(seen) if seen.kind() == "close" => {
                    protocol(connection.ended().await);
                    ended += 1;
                    break;
                }
                Some(_) => {}
                None => panic!("round {round}: the pipe ended with no answer and no protocol error"),
            }
        }
        drop(download);
    }
    assert!(survived > 100 && ended > 100, "the generator reaches both outcomes: {survived} survived, {ended} ended");
}

#[tokio::test(start_paused = true)]
async fn valid_frames_for_a_running_download_arrive_whatever_comes_before_them() {
    let (connection, daemon) = connect(ANSWERING).await;
    let mut download = connection.download().unwrap();
    let stream = download.stream();
    for _ in 0..1000 {
        daemon.send_binary(vec![0x01, stream, 1, 2, 3]);
        daemon.send_json(&json!({ "type": "agent_stream", "agentId": "a" }));
    }
    daemon.send_binary(chunk(stream, b"here"));
    let delivery = download.next().await.unwrap();
    assert!(matches!(delivery.frame(), crate::connection::Frame::Chunk(data) if **data == *b"here"));
}
