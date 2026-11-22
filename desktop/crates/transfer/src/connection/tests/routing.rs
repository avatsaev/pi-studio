//! Routing: a `file_upload_complete` to its upload, a file-transfer frame to the download on its
//! stream, and everything else ignored. Also what goes out, and in which order.

use std::sync::Arc;

use serde_json::json;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;

use super::support::{ANSWERING, SILENT, Seen, answer, begin, chunk, connect, connect_with, end, error_frame, upload_complete};
use crate::Limits;
use crate::connection::{Connection, Download, Frame};
use crate::error::Error;
use crate::wire::inbound::UploadComplete;

/// A frame as a short string: `begin`, `chunk:<bytes>`, `end:<ok>`, `error:<message>`.
fn summary(frame: &Frame) -> String {
    match frame {
        Frame::Begin(meta) => format!("begin:{}", meta.total_bytes.unwrap_or(0)),
        Frame::Chunk(data) => format!("chunk:{}", String::from_utf8_lossy(data)),
        Frame::End { ok } => format!("end:{ok}"),
        Frame::Error { message } => format!("error:{message}"),
    }
}

/// The next `count` frames of a download, each released as soon as it is read.
async fn take(download: &mut Download, count: usize) -> Vec<String> {
    let mut frames = Vec::new();
    for _ in 0..count {
        frames.push(summary(download.next().await.unwrap().frame()));
    }
    frames
}

async fn is_open(connection: &Connection) -> bool {
    timeout(std::time::Duration::ZERO, connection.ended()).await.is_err()
}

#[tokio::test(start_paused = true)]
async fn file_upload_complete_goes_to_the_upload_with_that_transfer_id() {
    let (connection, daemon) = connect(ANSWERING).await;
    let first = connection.expect_upload("up-a").unwrap();
    let second = connection.expect_upload("up-b").unwrap();
    assert_eq!(first.transfer_id(), "up-a");

    daemon.send_json(&upload_complete("up-b", 2, true, 200));
    daemon.send_json(&json!({
        "type": "session",
        "message": { "type": "file_upload_complete", "transferId": "up-a", "stream": 1, "ok": false, "bytesWritten": 10, "error": "write_failed (ENOSPC)" },
    }));

    assert_eq!(second.complete().await.unwrap(), UploadComplete { transfer_id: "up-b".into(), stream: 2, ok: true, bytes_written: 200, error: None });
    assert_eq!(
        first.complete().await.unwrap(),
        UploadComplete { transfer_id: "up-a".into(), stream: 1, ok: false, bytes_written: 10, error: Some("write_failed (ENOSPC)".into()) }
    );
}

#[tokio::test(start_paused = true)]
async fn a_file_upload_complete_nobody_waits_for_is_ignored() {
    let (connection, daemon) = connect(ANSWERING).await;
    let kept = connection.expect_upload("kept").unwrap();
    drop(connection.expect_upload("cancelled").unwrap());

    // An upload that was cancelled (its confirmation is ignored), one never started, and a repeat.
    daemon.send_json(&upload_complete("cancelled", 1, true, 5));
    daemon.send_json(&upload_complete("ghost", 2, true, 5));
    daemon.send_json(&upload_complete("kept", 3, true, 9));
    daemon.send_json(&upload_complete("kept", 3, true, 9));
    assert_eq!(kept.complete().await.unwrap().bytes_written, 9);
    assert!(is_open(&connection).await);
}

#[tokio::test(start_paused = true)]
async fn a_transfer_id_is_registered_once_at_a_time() {
    let (connection, _daemon) = connect(ANSWERING).await;
    let first = connection.expect_upload("same").unwrap();
    assert!(matches!(connection.expect_upload("same").unwrap_err(), Error::Internal(_)));
    drop(first);
    assert!(connection.expect_upload("same").is_ok());
}

#[tokio::test(start_paused = true)]
async fn binary_frames_go_to_the_download_on_their_stream_in_order() {
    let (connection, daemon) = connect(ANSWERING).await;
    let mut first = connection.download().unwrap();
    let mut second = connection.download().unwrap();
    let (a, b) = (first.stream(), second.stream());
    assert_ne!(a, b);

    daemon.send_binary(begin(a, 4));
    daemon.send_binary(begin(b, 6));
    daemon.send_binary(chunk(b, b"B1"));
    daemon.send_binary(chunk(a, b"A1"));
    daemon.send_binary(chunk(b, b"B2"));
    daemon.send_binary(chunk(a, b"A2"));
    daemon.send_binary(end(b));
    daemon.send_binary(end(a));

    assert_eq!(take(&mut first, 4).await, ["begin:4", "chunk:A1", "chunk:A2", "end:true"]);
    assert_eq!(take(&mut second, 4).await, ["begin:6", "chunk:B1", "chunk:B2", "end:true"]);
}

#[tokio::test(start_paused = true)]
async fn the_begin_metadata_and_an_error_frame_reach_the_download_whole() {
    let (connection, daemon) = connect(ANSWERING).await;
    let mut download = connection.download().unwrap();
    let stream = download.stream();
    daemon.send_binary(begin(stream, 9));
    daemon.send_binary(error_frame(stream, "changed"));
    let delivery = download.next().await.unwrap();
    let Frame::Begin(meta) = delivery.frame() else { panic!("a Begin") };
    assert_eq!(
        (meta.transfer_id.as_str(), meta.file_name.as_deref(), meta.total_bytes, meta.mtime_ms, meta.offset, meta.length),
        ("d-1", Some("f"), Some(9), Some(7), Some(0), Some(9))
    );
    assert_eq!(summary(download.next().await.unwrap().frame()), "error:changed");
}

#[tokio::test(start_paused = true)]
async fn frames_that_are_not_a_running_downloads_are_ignored() {
    let (connection, daemon) = connect(ANSWERING).await;
    let mut download = connection.download().unwrap();
    let stream = download.stream();
    let other = stream.wrapping_add(1);

    daemon.send_binary(chunk(other, b"nobody"));
    daemon.send_binary(chunk(200, b"nobody"));
    daemon.send_binary(vec![0x11]);
    daemon.send_binary(vec![]);
    // Another protocol's opcodes on the same stream byte: the terminal's, and ones that mean nothing.
    for opcode in [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x0f, 0x14, 0x20, 0x80, 0xff] {
        daemon.send_binary(vec![opcode, stream, b'x', b'y']);
    }
    daemon.send_binary(chunk(stream, b"mine"));

    assert_eq!(take(&mut download, 1).await, ["chunk:mine"]);
    assert!(is_open(&connection).await);
}

#[tokio::test(start_paused = true)]
async fn everything_else_the_daemon_sends_is_ignored() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    for frame in [
        json!({ "type": "status", "payload": { "status": "agent_busy" } }),
        json!({ "type": "status", "payload": { "status": "server_info", "serverId": "again", "capabilities": {}, "features": {} } }),
        json!({ "type": "status", "payload": 5 }),
        json!({ "type": "agent_stream", "agentId": "a", "event": { "type": "turn_started" } }),
        json!({ "type": "pong", "requestId": "nobody-pinged" }),
        json!({ "type": "session", "message": { "type": "checkout_status_update", "cwd": "/repo" } }),
        answer("nobody-asked", "file_upload_response", &json!({ "ok": true, "stream": 1 })),
        json!({ "type": "a_type_from_the_future", "payload": [1, 2, 3] }),
    ] {
        daemon.send_json(&frame);
    }
    daemon.send(Message::Ping(vec![1, 2, 3].into()));
    daemon.send(Message::Pong(vec![].into()));

    let asked = {
        let connection = Arc::clone(&connection);
        tokio::spawn(async move { connection.request(|id| crate::wire::outbound::upload_request(id, "/tmp/a", "t-1")).await })
    };
    daemon.accept_upload(3).await;
    assert!(asked.await.unwrap().is_ok());
    assert!(is_open(&connection).await);
}

#[tokio::test(start_paused = true)]
async fn a_dropped_download_frees_its_stream_and_a_late_frame_on_it_is_ignored() {
    let (connection, daemon) = connect(ANSWERING).await;
    let download = connection.download().unwrap();
    let stream = download.stream();
    drop(download);
    daemon.send_binary(chunk(stream, b"late"));
    daemon.send_binary(end(stream));

    // The next download does not get the id of the one that just went: its late frames could be taken for its own.
    let mut next = connection.download().unwrap();
    assert_eq!(next.stream(), stream.wrapping_add(1));
    daemon.send_binary(chunk(next.stream(), b"fresh"));
    assert_eq!(take(&mut next, 1).await, ["chunk:fresh"]);
}

#[tokio::test(start_paused = true)]
async fn stream_ids_go_round_all_256_and_a_free_one_is_found_when_most_are_taken() {
    let (connection, _daemon) = connect(ANSWERING).await;
    let mut ids = Vec::new();
    for _ in 0..600 {
        let download = connection.download().unwrap();
        ids.push(download.stream());
    }
    assert!(ids.iter().enumerate().all(|(index, id)| usize::from(*id) == index % 256), "{ids:?}");

    let mut held: Vec<Download> = (0..256).map(|_| connection.download().unwrap()).collect();
    let mut streams: Vec<u8> = held.iter().map(Download::stream).collect();
    streams.sort_unstable();
    assert_eq!(streams, (0..=255).collect::<Vec<u8>>(), "all 256 are in use, each once");
    assert!(matches!(connection.download().unwrap_err(), Error::Internal(_)), "the 257th has no stream");

    let freed = held.swap_remove(100).stream();
    let also_freed = held.pop().map(|download| download.stream()).unwrap();
    let again = connection.download().unwrap();
    assert!([freed, also_freed].contains(&again.stream()), "the stream is one of the two that were let go");
}

#[tokio::test(start_paused = true)]
async fn what_the_callers_send_goes_out_in_each_callers_order_and_returns_when_written() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let mut senders = Vec::new();
    for sender in 0u8..3 {
        let connection = Arc::clone(&connection);
        senders.push(tokio::spawn(async move {
            for index in 0u8..10 {
                if index % 2 == 0 {
                    connection.send_binary(vec![0x11, sender, index]).await.unwrap();
                } else {
                    connection.send_text(json!({ "type": "probe", "sender": sender, "index": index }).to_string()).await.unwrap();
                }
            }
        }));
    }
    for sender in senders {
        sender.await.unwrap();
    }

    let mut per_sender: [Vec<u8>; 3] = Default::default();
    for _ in 0..30 {
        let seen = daemon.next().await.unwrap();
        let (sender, index) = match &seen.message {
            Message::Binary(frame) => (frame[1], frame[2]),
            Message::Text(_) => {
                let probe = seen.json();
                (u8::try_from(probe["sender"].as_u64().unwrap()).unwrap(), u8::try_from(probe["index"].as_u64().unwrap()).unwrap())
            }
            other => panic!("unexpected {other:?}"),
        };
        per_sender[usize::from(sender)].push(index);
    }
    for frames in per_sender {
        assert_eq!(frames, (0..10).collect::<Vec<u8>>());
    }
}

#[tokio::test(start_paused = true)]
async fn a_frame_above_the_message_limit_is_refused_before_it_is_queued() {
    let limits = Limits { max_message_bytes: 1024, ..Limits::default() };
    let (connection, mut daemon) = connect_with(limits, SILENT).await;
    assert!(matches!(connection.send_binary(vec![0x11; 1025]).await.unwrap_err(), Error::Internal(_)));
    assert!(matches!(connection.send_text("x".repeat(1025)).await.unwrap_err(), Error::Internal(_)));
    connection.send_binary(vec![0x11; 1024]).await.unwrap();
    let seen: Seen = daemon.next().await.unwrap();
    assert!(matches!(&seen.message, Message::Binary(frame) if frame.len() == 1024));
    assert!(is_open(&connection).await);
}
