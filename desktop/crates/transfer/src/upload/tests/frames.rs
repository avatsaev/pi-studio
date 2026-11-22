//! The frames an upload sends, in order, and what it holds while the daemon is slow, against a
//! scripted daemon over an in-memory pipe.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use serde_json::json;

use super::support::{DEFAULTS, Generated, Overfull, fake_connection, pattern};
use crate::Limits;
use crate::error::Error;
use crate::limits::CHUNK_BYTES;
use crate::upload::{MemorySource, Target, UploadError, UploadSource, Uploaded, upload};
use crate::wire::binary::{self, FileFrame};

const TARGET: Target<'static> = Target { path: "/srv/frames", transfer_id: "t-frames" };
const STREAM: u8 = 7;
const PIPE: usize = 8 * 1024 * 1024;

/// The frames the daemon reads for an upload of `data`, in order, as (opcode, stream, payload length).
async fn flow(
    limits: Limits,
    source: &mut impl UploadSource,
    data_len: usize,
) -> (Result<Uploaded, UploadError>, Vec<(u8, u8, usize)>, serde_json::Value, Vec<u64>) {
    let (connection, mut fake) = fake_connection(limits, PIPE).await;
    let mut progress = Vec::new();
    let daemon = async {
        let request = fake.accept_upload(STREAM).await;
        let mut frames = Vec::new();
        loop {
            let frame = fake.binary().await;
            let opcode = frame[0];
            frames.push((opcode, frame[1], frame.len() - 2));
            if opcode == 0x12 {
                break;
            }
        }
        fake.complete(TARGET.transfer_id, STREAM, true, u64::try_from(data_len).unwrap()).await;
        (request, frames)
    };
    let client = upload(&connection, TARGET, source, |done| progress.push(done), std::future::pending(), &limits);
    let (result, (request, frames)) = tokio::join!(client, daemon);
    (result, frames, request, progress)
}

#[tokio::test]
async fn the_request_then_begin_chunks_and_end_in_order() {
    let data = pattern(CHUNK_BYTES + 1);
    let (result, frames, request, progress) = flow(Limits::default(), &mut MemorySource::new(data.clone()), data.len()).await;
    assert_eq!(result, Ok(Uploaded { bytes: 32_769 }));
    assert_eq!(request["path"], "/srv/frames");
    assert_eq!(request["transferId"], "t-frames");
    assert_eq!(request["ack"], true);
    assert!(request["requestId"].is_string());
    // Begin (with a transferId), a full chunk, a chunk of one byte, End; all on the daemon's stream.
    assert_eq!(
        frames,
        vec![(0x10, STREAM, json!({ "transferId": "t-frames" }).to_string().len()), (0x11, STREAM, 32_768), (0x11, STREAM, 1), (0x12, STREAM, 1)]
    );
    assert_eq!(progress, vec![32_768, 32_769]);
}

#[tokio::test]
async fn the_begin_carries_only_the_transfer_id_and_the_end_says_ok() {
    let (connection, mut fake) = fake_connection(Limits::default(), PIPE).await;
    let mut source = MemorySource::new(pattern(3));
    let client = upload(&connection, TARGET, &mut source, |_| {}, std::future::pending(), &DEFAULTS);
    let daemon = async {
        fake.accept_upload(STREAM).await;
        let begin = fake.binary().await;
        let chunk = fake.binary().await;
        let end = fake.binary().await;
        fake.complete("t-frames", STREAM, true, 3).await;
        (begin, chunk, end)
    };
    let (result, (begin, chunk, end)) = tokio::join!(client, daemon);
    assert_eq!(result, Ok(Uploaded { bytes: 3 }));
    let FileFrame::Begin { stream, meta } = binary::decode(&begin).unwrap() else { panic!("a Begin first") };
    assert_eq!((stream, meta.transfer_id.as_str(), meta.total_bytes, meta.file_name), (STREAM, "t-frames", None, None));
    assert_eq!(chunk, [0x11, STREAM, byte(0), byte(1), byte(2)]);
    assert_eq!(end, [0x12, STREAM, 1]);
}

fn byte(index: usize) -> u8 {
    super::support::byte_at(index)
}

#[tokio::test]
async fn an_empty_source_is_begin_and_end() {
    let (result, frames, _, progress) = flow(Limits::default(), &mut MemorySource::new(Vec::new()), 0).await;
    assert_eq!(result, Ok(Uploaded { bytes: 0 }));
    assert_eq!(frames.iter().map(|frame| frame.0).collect::<Vec<_>>(), vec![0x10, 0x12]);
    assert!(progress.is_empty());
}

#[tokio::test]
async fn an_exact_multiple_of_a_chunk_has_no_empty_chunk() {
    let (result, frames, _, _) = flow(Limits::default(), &mut MemorySource::new(pattern(2 * CHUNK_BYTES)), 2 * CHUNK_BYTES).await;
    assert!(result.is_ok());
    let chunks: Vec<usize> = frames.iter().filter(|frame| frame.0 == 0x11).map(|frame| frame.2).collect();
    assert_eq!(chunks, vec![CHUNK_BYTES, CHUNK_BYTES]);
}

#[tokio::test]
async fn no_chunk_is_larger_than_32_kib_whatever_the_limit_says() {
    let limits = Limits { chunk_bytes: 1024 * 1024, ..Limits::default() };
    let (result, frames, _, _) = flow(limits, &mut MemorySource::new(pattern(100_000)), 100_000).await;
    assert!(result.is_ok());
    let chunks: Vec<usize> = frames.iter().filter(|frame| frame.0 == 0x11).map(|frame| frame.2).collect();
    assert_eq!(chunks, vec![32_768, 32_768, 32_768, 1_696]);
}

#[tokio::test]
async fn a_smaller_chunk_limit_is_used() {
    let limits = Limits { chunk_bytes: 1000, ..Limits::default() };
    let (result, frames, _, _) = flow(limits, &mut MemorySource::new(pattern(2500)), 2500).await;
    assert!(result.is_ok());
    let chunks: Vec<usize> = frames.iter().filter(|frame| frame.0 == 0x11).map(|frame| frame.2).collect();
    assert_eq!(chunks, vec![1000, 1000, 500]);
}

#[tokio::test]
async fn an_answer_without_a_stream_is_a_protocol_error() {
    let (connection, mut fake) = fake_connection(Limits::default(), PIPE).await;
    let mut source = MemorySource::new(pattern(3));
    let client = upload(&connection, TARGET, &mut source, |_| {}, std::future::pending(), &DEFAULTS);
    let daemon = fake.answer_upload(|id| json!({ "type": "file_upload_response", "requestId": id, "ok": true }));
    let (result, _) = tokio::join!(client, daemon);
    assert!(matches!(result, Err(UploadError::Protocol(Error::Protocol(_)))), "{result:?}");
}

#[tokio::test]
async fn an_answer_of_the_wrong_kind_is_a_protocol_error() {
    let (connection, mut fake) = fake_connection(Limits::default(), PIPE).await;
    let mut source = MemorySource::new(pattern(3));
    let client = upload(&connection, TARGET, &mut source, |_| {}, std::future::pending(), &DEFAULTS);
    let daemon = fake.answer_upload(|id| json!({ "type": "file_download_response", "requestId": id, "ok": true, "stream": 1 }));
    let (result, _) = tokio::join!(client, daemon);
    assert!(matches!(result, Err(UploadError::Protocol(_))), "{result:?}");
}

#[tokio::test]
async fn a_completion_that_names_another_stream_is_a_protocol_error() {
    let (connection, mut fake) = fake_connection(Limits::default(), PIPE).await;
    let mut source = MemorySource::new(pattern(3));
    let client = upload(&connection, TARGET, &mut source, |_| {}, std::future::pending(), &DEFAULTS);
    let daemon = async {
        fake.accept_upload(STREAM).await;
        for _ in 0..3 {
            fake.binary().await;
        }
        fake.complete("t-frames", STREAM + 1, true, 3).await;
    };
    let (result, ()) = tokio::join!(client, daemon);
    assert!(matches!(result, Err(UploadError::Protocol(_))), "{result:?}");
}

#[tokio::test]
async fn a_completion_that_is_not_ok_without_a_reason_is_still_a_refusal() {
    let (connection, mut fake) = fake_connection(Limits::default(), PIPE).await;
    let mut source = MemorySource::new(pattern(3));
    let client = upload(&connection, TARGET, &mut source, |_| {}, std::future::pending(), &DEFAULTS);
    let daemon = async {
        fake.accept_upload(STREAM).await;
        for _ in 0..3 {
            fake.binary().await;
        }
        fake.complete("t-frames", STREAM, false, 0).await;
    };
    let (result, ()) = tokio::join!(client, daemon);
    assert!(matches!(result, Err(UploadError::DaemonRefused { .. })), "{result:?}");
}

#[tokio::test]
async fn a_stream_of_a_hundred_thousand_calls_by_the_source_is_not_a_frame_per_call() {
    // A source that gives one byte per read: the chunk is still full before it is sent.
    let mut source = super::support::Trickle { data: pattern(CHUNK_BYTES * 2), at: 0, most: 1 };
    let (result, frames, _, _) = flow(Limits::default(), &mut source, CHUNK_BYTES * 2).await;
    assert!(result.is_ok());
    assert_eq!(frames.iter().filter(|frame| frame.0 == 0x11).count(), 2);
}

#[tokio::test]
async fn a_source_that_overfills_its_buffer_is_unreadable_and_the_daemon_is_told() {
    let (connection, mut fake) = fake_connection(Limits::default(), PIPE).await;
    let mut overfull = Overfull;
    let client = upload(&connection, TARGET, &mut overfull, |_| {}, std::future::pending(), &DEFAULTS);
    let daemon = async {
        fake.accept_upload(STREAM).await;
        let begin = fake.binary().await;
        let error = fake.binary().await;
        (begin[0], error)
    };
    let (result, (begin, error)) = tokio::join!(client, daemon);
    assert!(matches!(result, Err(UploadError::SourceUnreadable { .. })));
    assert_eq!(begin, 0x10);
    assert_eq!(error, [&[0x13, STREAM][..], b"client_error"].concat());
}

// ---- what the upload holds while the daemon is slow ----

/// The daemon reads the request and the `Begin`, then nothing. The source is read only as far as the
/// pipe and one frame allow; when the daemon reads again the upload goes on and every byte arrives.
#[tokio::test]
async fn a_slow_daemon_holds_the_upload_to_a_chunk_and_the_pipe_and_it_goes_on_when_the_daemon_reads() {
    const FILE: usize = 16 * 1024 * 1024;
    const ROOM: usize = 64 * 1024;
    let limits = Limits::default();
    let (connection, mut fake) = fake_connection(limits, ROOM).await;
    let mut source = Generated::new(FILE);
    let read = std::sync::Arc::clone(&source.read);
    let client = upload(&connection, TARGET, &mut source, |_| {}, std::future::pending(), &limits);
    let daemon = async {
        fake.accept_upload(STREAM).await;
        fake.binary().await; // the Begin; then the daemon reads nothing
        // Wait until the source stops being read.
        let mut last = 0;
        let mut steady = 0;
        let start = Instant::now();
        while steady < 10 {
            tokio::time::sleep(Duration::from_millis(20)).await;
            let now = read.load(Ordering::SeqCst);
            steady = if now == last && now > 0 { steady + 1 } else { 0 };
            last = now;
            assert!(start.elapsed() < Duration::from_secs(10), "the read count never settled");
        }
        // The pipe's room, a frame being written and the chunk behind it: nothing more.
        let held = last;
        assert!(held <= u64::try_from(ROOM + 4 * CHUNK_BYTES).unwrap(), "{held} bytes were read ahead of a daemon that reads nothing");
        assert!(held < u64::try_from(FILE).unwrap() / 8);

        // The daemon reads again: the rest of the file arrives, whole and in order.
        let mut received = 0u64;
        loop {
            let frame = fake.binary().await;
            match frame[0] {
                0x11 => received += u64::try_from(frame.len() - 2).unwrap(),
                0x12 => break,
                other => panic!("unexpected opcode {other:#x}"),
            }
        }
        fake.complete("t-frames", STREAM, true, received).await;
        received
    };
    let (result, received) = tokio::join!(client, daemon);
    assert_eq!(received, u64::try_from(FILE).unwrap());
    assert_eq!(result, Ok(Uploaded { bytes: u64::try_from(FILE).unwrap() }));
}

// ---- a cancel before the answer ----

const STREAM_CHOSEN_LATE: u8 = 9;

#[tokio::test]
async fn a_cancel_before_the_answer_frees_the_stream_the_daemon_then_chooses() {
    let (connection, mut fake) = fake_connection(Limits::default(), PIPE).await;
    let cancel = super::support::Trigger::default();
    let mut source = MemorySource::new(pattern(100));
    let client = upload(&connection, TARGET, &mut source, |_| {}, cancel.clone().cancelled(), &DEFAULTS);
    let daemon = async {
        let frame = fake.text().await;
        let request = frame["message"].clone();
        assert_eq!(request["type"], "file_upload_request");
        // The cancel comes after the request went out and before the daemon answers it.
        cancel.cancel();
        tokio::time::sleep(Duration::from_millis(50)).await;
        let id = request["requestId"].as_str().unwrap().to_owned();
        fake.send_json(&json!({ "type": "session", "message": { "type": "file_upload_response", "requestId": id, "ok": true, "stream": STREAM_CHOSEN_LATE } }))
            .await;
        fake.binary().await
    };
    let (result, frame) = tokio::join!(client, daemon);
    assert_eq!(result, Err(UploadError::Cancelled));
    // The daemon holds a stream for an upload that will never begin: the client frees it.
    assert_eq!(binary::decode(&frame).unwrap(), FileFrame::Error { stream: STREAM_CHOSEN_LATE, message: "client_aborted".to_owned() });
}

#[tokio::test]
async fn a_cancel_before_an_answer_that_never_comes_returns_after_the_close_wait_and_sends_nothing_more() {
    let limits = Limits { close_wait: Duration::from_millis(60), ..Limits::default() };
    let (connection, mut fake) = fake_connection(limits, PIPE).await;
    let cancel = super::support::Trigger::default();
    let mut source = MemorySource::new(pattern(100));
    let client = upload(&connection, TARGET, &mut source, |_| {}, cancel.clone().cancelled(), &limits);
    let daemon = async {
        let frame = fake.text().await;
        assert_eq!(frame["message"]["type"], "file_upload_request");
        cancel.cancel();
    };
    let started = Instant::now();
    let (result, ()) = tokio::join!(client, daemon);
    assert_eq!(result, Err(UploadError::Cancelled));
    assert!(started.elapsed() >= Duration::from_millis(60), "it did not wait for the answer");
    assert!(started.elapsed() < Duration::from_secs(5));
}
