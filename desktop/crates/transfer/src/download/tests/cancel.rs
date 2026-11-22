//! Stopping a save: the cancel racing the daemon's answer in the orders it may arrive in, the stream
//! id kept reserved until the daemon is done with it, and a daemon that never is.
//!
//! The daemon is scripted over an in-memory pipe on a paused clock, so that the order of its answers
//! is the test's and a stalled daemon costs no real time.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::Semaphore;
use tokio::time::Instant;

use super::support::{
    Range, TestSink, Trigger, accepted, all_streams_free, begin, cancel_answer, chunk, end, error_frame, free_streams, refused, request_id, scripted,
    settle_until, spin, start, stream_of,
};
use crate::Limits;
use crate::download::{Request, SaveError, Version, save};
use crate::error::Error;

#[track_caller]
fn assert_kind(request: &Value, kind: &str) {
    assert_eq!(request["type"], kind, "{request}");
}

#[track_caller]
fn assert_discarded(sink: &TestSink) {
    assert!(sink.inner.is_discarded() && !sink.inner.is_finished());
    assert!(sink.bytes().is_empty());
}

// ---- the cancel races the answer ----

#[tokio::test(start_paused = true)]
async fn the_cancel_is_answered_before_the_request_which_is_accepted_and_sends_only_an_error_frame() {
    let (connection, mut daemon) = scripted().await;
    let saving = start(&connection, TestSink::new(), None);
    let download = daemon.request().await;
    assert_kind(&download, "file_download_request");
    let stream = stream_of(&download);

    saving.trigger.cancel();
    let cancel = daemon.request().await;
    assert_kind(&cancel, "file_download_cancel_request");
    assert_eq!(stream_of(&cancel), stream, "the cancel names the stream of the request");

    // The daemon reserved the stream when the request arrived, so it answers the cancel first; then the
    // request is answered `ok` and an `Error` frame `cancelled` follows with no `Begin`.
    daemon.send_json(&cancel_answer(&request_id(&cancel), true));
    daemon.send_json(&accepted(&request_id(&download), Range::whole(stream, 10)));
    daemon.send_binary(error_frame(stream, "cancelled"));
    let (result, sink) = saving.task.await.unwrap();

    assert_eq!(result.unwrap_err(), SaveError::Cancelled);
    assert_discarded(&sink);
    assert_eq!(sink.writes, 0);
    assert!(all_streams_free(&connection), "the stream id is free after the Error frame");
}

#[tokio::test(start_paused = true)]
async fn the_cancel_is_answered_before_the_request_which_is_refused_and_no_frame_follows() {
    let (connection, mut daemon) = scripted().await;
    let saving = start(&connection, TestSink::new(), None);
    let download = daemon.request().await;
    let stream = stream_of(&download);

    saving.trigger.cancel();
    let cancel = daemon.request().await;
    // The open failed: the request is answered `ok: false`, and there is nothing else to wait for.
    daemon.send_json(&cancel_answer(&request_id(&cancel), true));
    daemon.send_json(&refused(&request_id(&download), "not_found"));
    let (result, sink) = saving.task.await.unwrap();

    assert_eq!(result.unwrap_err(), SaveError::Cancelled);
    assert_discarded(&sink);
    assert!(all_streams_free(&connection), "the stream id of stream {stream} is free after a refusal");
}

#[tokio::test(start_paused = true)]
async fn the_request_is_answered_before_the_cancel_and_the_error_frame_follows() {
    let (connection, mut daemon) = scripted().await;
    let saving = start(&connection, TestSink::new(), None);
    let download = daemon.request().await;
    let stream = stream_of(&download);

    saving.trigger.cancel();
    let cancel = daemon.request().await;
    // The other order: the daemon had answered the request when the cancel reached it.
    daemon.send_json(&accepted(&request_id(&download), Range::whole(stream, 10)));
    daemon.send_json(&cancel_answer(&request_id(&cancel), true));
    daemon.send_binary(error_frame(stream, "cancelled"));
    let (result, sink) = saving.task.await.unwrap();

    assert_eq!(result.unwrap_err(), SaveError::Cancelled);
    assert_discarded(&sink);
    assert!(all_streams_free(&connection));
}

#[tokio::test(start_paused = true)]
async fn the_request_is_refused_and_the_cancel_finds_nothing_to_stop() {
    let (connection, mut daemon) = scripted().await;
    let saving = start(&connection, TestSink::new(), None);
    let download = daemon.request().await;

    saving.trigger.cancel();
    let cancel = daemon.request().await;
    daemon.send_json(&refused(&request_id(&download), "not_a_file"));
    daemon.send_json(&cancel_answer(&request_id(&cancel), false));
    let (result, sink) = saving.task.await.unwrap();

    assert_eq!(result.unwrap_err(), SaveError::Cancelled, "the user's cancel is the outcome, not the refusal");
    assert_discarded(&sink);
    assert!(all_streams_free(&connection));
}

#[tokio::test(start_paused = true)]
async fn a_download_that_finished_before_the_cancel_arrived_ends_with_its_end_frame() {
    let (connection, mut daemon) = scripted().await;
    let saving = start(&connection, TestSink::new(), None);
    let download = daemon.request().await;
    let stream = stream_of(&download);

    saving.trigger.cancel();
    let cancel = daemon.request().await;
    // An empty file: the daemon had sent `Begin` and `End` before it read the cancel, which finds nothing running.
    daemon.send_json(&accepted(&request_id(&download), Range::whole(stream, 0)));
    daemon.send_binary(begin(Range::whole(stream, 0)));
    daemon.send_binary(end(stream));
    daemon.send_json(&cancel_answer(&request_id(&cancel), false));
    let (result, sink) = saving.task.await.unwrap();

    assert_eq!(result.unwrap_err(), SaveError::Cancelled);
    assert_discarded(&sink);
    assert!(all_streams_free(&connection));
}

#[tokio::test(start_paused = true)]
async fn a_cancel_that_finds_nothing_running_does_not_free_a_stream_the_daemon_accepted_until_its_terminal_frame() {
    let (connection, mut daemon) = scripted().await;
    let saving = start(&connection, TestSink::new(), None);
    let download = daemon.request().await;
    let stream = stream_of(&download);
    daemon.send_json(&accepted(&request_id(&download), Range::whole(stream, 10)));
    daemon.send_binary(begin(Range::whole(stream, 10)));
    spin().await;

    saving.trigger.cancel();
    let cancel = daemon.request().await;
    // `not_found`: the download has finished on the daemon; its `End` is on its way.
    daemon.send_json(&cancel_answer(&request_id(&cancel), false));
    spin().await;
    assert!(!saving.task.is_finished(), "the daemon accepted the download, so its last frame is awaited");
    assert_eq!(free_streams(&connection), 255);

    daemon.send_binary(end(stream));
    let (result, sink) = saving.task.await.unwrap();

    assert_eq!(result.unwrap_err(), SaveError::Cancelled);
    assert_discarded(&sink);
    assert!(all_streams_free(&connection));
}

// ---- a cancel mid-transfer ----

#[tokio::test(start_paused = true)]
async fn a_cancel_during_a_slow_write_drops_the_write_and_a_queued_end_frees_the_stream() {
    let (connection, mut daemon) = scripted().await;
    let writes = Arc::new(AtomicUsize::new(0));
    let sink = TestSink {
        gate: Some(Arc::new(Semaphore::new(0))),
        on_write: Some(Box::new({
            let writes = Arc::clone(&writes);
            move |_| {
                writes.fetch_add(1, Ordering::SeqCst);
            }
        })),
        ..TestSink::new()
    };
    let saving = start(&connection, sink, None);
    let download = daemon.request().await;
    let stream = stream_of(&download);
    let range = Range::whole(stream, 20);
    daemon.send_json(&accepted(&request_id(&download), range));
    daemon.send_binary(begin(range));
    daemon.send_binary(chunk(stream, &[1; 10]));
    daemon.send_binary(chunk(stream, &[2; 10]));
    daemon.send_binary(end(stream));
    settle_until("the first write starts", || writes.load(Ordering::SeqCst) == 1).await;

    let before = Instant::now();
    saving.trigger.cancel();
    // The cancel is never answered: the `End` that is already queued is what frees the stream.
    let (result, sink) = saving.task.await.unwrap();

    assert_eq!(result.unwrap_err(), SaveError::Cancelled);
    assert!(before.elapsed() < Duration::from_secs(1), "the save did not wait for an answer that never came");
    assert_eq!(writes.load(Ordering::SeqCst), 1, "no write started after the cancel");
    assert_discarded(&sink);
    assert!(all_streams_free(&connection));
    let cancel = daemon.request().await;
    assert_kind(&cancel, "file_download_cancel_request");
}

#[tokio::test(start_paused = true)]
async fn a_cancel_mid_stream_is_answered_and_the_error_frame_frees_the_stream() {
    let (connection, mut daemon) = scripted().await;
    let saving = start(&connection, TestSink::new(), None);
    let download = daemon.request().await;
    let stream = stream_of(&download);
    let range = Range::whole(stream, 100);
    daemon.send_json(&accepted(&request_id(&download), range));
    daemon.send_binary(begin(range));
    daemon.send_binary(chunk(stream, &[7; 40]));
    spin().await;

    saving.trigger.cancel();
    let cancel = daemon.request().await;
    assert_eq!(stream_of(&cancel), stream);
    daemon.send_json(&cancel_answer(&request_id(&cancel), true));
    // Chunks that were already on the wire are dropped, not written.
    daemon.send_binary(chunk(stream, &[7; 10]));
    daemon.send_binary(error_frame(stream, "cancelled"));
    let (result, sink) = saving.task.await.unwrap();

    assert_eq!(result.unwrap_err(), SaveError::Cancelled);
    assert_eq!(sink.writes, 1);
    assert_discarded(&sink);
    assert!(all_streams_free(&connection));
}

#[tokio::test(start_paused = true)]
async fn a_connection_that_ends_while_the_stop_waits_ends_it_and_the_save_is_still_cancelled() {
    let (connection, mut daemon) = scripted().await;
    let saving = start(&connection, TestSink::new(), None);
    let download = daemon.request().await;
    saving.trigger.cancel();
    let _cancel = daemon.request().await;
    let _ = download;

    daemon.vanish();
    let (result, sink) = saving.task.await.unwrap();

    assert_eq!(result.unwrap_err(), SaveError::Cancelled, "the user's cancel is the outcome, whatever the connection did next");
    assert_discarded(&sink);
}

#[tokio::test(start_paused = true)]
async fn a_cancel_that_is_already_complete_sends_no_request() {
    let (connection, mut daemon) = scripted().await;
    let trigger = Trigger::default();
    trigger.cancel();
    let mut sink = TestSink::new();

    let result = save(&connection, Request { path: "/srv/f", resume: None }, &mut sink, |_| {}, trigger.cancelled(), &Limits::default()).await;

    assert_eq!(result.unwrap_err(), SaveError::Cancelled);
    assert_discarded(&sink);
    spin().await;
    assert!(daemon.requests_so_far().is_empty(), "nothing was sent");
    assert!(all_streams_free(&connection));
}

// ---- a daemon that does not answer ----

#[tokio::test(start_paused = true)]
async fn a_request_the_daemon_never_answers_is_lost_after_30_seconds_and_stopped_with_a_cancel() {
    let (connection, mut daemon) = scripted().await;
    let known = Version { total_bytes: 50, mtime_ms: 9 };
    let saving = start(&connection, TestSink::holding(vec![1; 20]), Some(known));
    let download = daemon.request().await;
    // It carries the resume's offset and guard, never a length.
    assert_eq!(download["offset"], 20);
    assert_eq!(download["ifUnchanged"]["size"], 50);
    assert_eq!(download["ifUnchanged"]["mtimeMs"], 9);
    assert!(download.get("length").is_none());

    let started = Instant::now();
    let cancel = daemon.request().await;
    assert_kind(&cancel, "file_download_cancel_request");
    assert!(started.elapsed() >= Duration::from_secs(30), "the answer was awaited for 30 seconds");
    // The daemon has no download on the stream: the lost request was never served.
    daemon.send_json(&cancel_answer(&request_id(&cancel), false));
    let (result, sink) = saving.task.await.unwrap();

    assert_eq!(result.unwrap_err(), SaveError::ConnectionLost { reason: Error::Timeout, version: Some(known) });
    assert_eq!(sink.bytes(), [1; 20], "a lost connection leaves the sink to resume into");
    assert!(!sink.inner.is_discarded());
    assert!(all_streams_free(&connection));
}

#[tokio::test(start_paused = true)]
async fn a_cancel_nobody_answers_returns_after_30_seconds_and_the_stream_stays_reserved_until_the_daemon_is_done() {
    let (connection, mut daemon) = scripted().await;
    let saving = start(&connection, TestSink::new(), None);
    let download = daemon.request().await;
    let stream = stream_of(&download);
    let range = Range::whole(stream, 100);
    daemon.send_json(&accepted(&request_id(&download), range));
    daemon.send_binary(begin(range));
    spin().await;

    let before = Instant::now();
    saving.trigger.cancel();
    let _cancel = daemon.request().await;
    // Neither the cancel nor the download is answered: the daemon may still send on the stream.
    let (result, sink) = saving.task.await.unwrap();

    assert_eq!(result.unwrap_err(), SaveError::Cancelled);
    assert!(before.elapsed() >= Duration::from_secs(30), "the stop waited the answer time");
    assert_discarded(&sink);
    assert_eq!(free_streams(&connection), 255, "the stream id is not handed out again while the daemon may send on it");
    // Frames of the reserved stream are still taken, so the connection does not stall behind them.
    for _ in 0..50 {
        daemon.send_binary(chunk(stream, &[3; 1000]));
    }
    spin().await;
    assert_eq!(free_streams(&connection), 255);

    daemon.send_binary(error_frame(stream, "cancelled"));
    settle_until("the daemon's last frame frees the stream", || free_streams(&connection) == 256).await;
}
