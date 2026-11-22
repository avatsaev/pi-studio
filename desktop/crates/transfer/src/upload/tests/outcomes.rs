//! Every way an upload ends, with the frame the stand-in daemon received for it.
//!
//! The stand-in records each upload that ended: the bytes of its `Chunk`s and the `error` its push
//! carried (the message of an `Error` frame when the client sent one, `None` when `End` was kept).

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use super::support::{DEFAULTS, Failing, Overfull, Trigger, connect, eventually, pattern};
use crate::Limits;
use crate::error::{Ended, Error};
use crate::limits::CHUNK_BYTES;
use crate::testing::{After, Direction, Fault, Request, StandInDaemon};
use crate::upload::{MemorySource, Target, UploadError, Uploaded, upload};

const TARGET: Target<'static> = Target { path: "/srv/out", transfer_id: "t-out" };

async fn run(daemon: &StandInDaemon, source: &mut MemorySource, limits: Limits) -> Result<Uploaded, UploadError> {
    let connection = connect(daemon, limits).await;
    upload(&connection, TARGET, source, |_| {}, std::future::pending(), &limits).await
}

/// What the stand-in recorded for the one upload that ended: its bytes and its error.
fn recorded(daemon: &StandInDaemon) -> (u64, Option<String>) {
    let records = daemon.uploads();
    assert_eq!(records.len(), 1, "{records:?}");
    assert_eq!((records[0].transfer_id.as_str(), records[0].path.as_str()), ("t-out", "/srv/out"));
    (records[0].bytes_received, records[0].error.clone())
}

// ---- the daemon refuses ----

#[tokio::test]
async fn a_refused_request_is_daemon_refused_with_its_reason() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::no_free_stream(Request::Upload));
    let result = run(&daemon, &mut MemorySource::new(pattern(100)), Limits::default()).await;
    assert_eq!(result, Err(UploadError::DaemonRefused { reason: "no_free_stream".into() }));
    // The daemon saw a request and no stream: nothing was begun.
    assert!(daemon.uploads().is_empty());
    assert_eq!(daemon.file("/srv/out"), None);
}

#[tokio::test]
async fn a_request_the_daemon_finds_incomplete_is_daemon_refused() {
    let daemon = StandInDaemon::start().await.unwrap();
    let connection = connect(&daemon, Limits::default()).await;
    let mut source = MemorySource::new(pattern(10));
    let result = upload(&connection, Target { path: "", transfer_id: "t-empty" }, &mut source, |_| {}, std::future::pending(), &Limits::default()).await;
    assert_eq!(result, Err(UploadError::DaemonRefused { reason: "missing_fields".into() }));
}

#[tokio::test]
async fn an_rpc_error_is_daemon_refused_with_its_words() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::RpcError { request: Request::Upload, code: "handler_error".into(), message: "no space left".into() });
    let result = run(&daemon, &mut MemorySource::new(pattern(100)), Limits::default()).await;
    assert_eq!(result, Err(UploadError::DaemonRefused { reason: "no space left (handler_error)".into() }));
    assert!(daemon.uploads().is_empty());
}

#[tokio::test]
async fn a_failed_write_reported_in_the_completion_is_daemon_refused() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::UploadFails { error: "write_failed (ENOSPC)".into() });
    let data = pattern(100_000);
    let result = run(&daemon, &mut MemorySource::new(data), Limits::default()).await;
    assert_eq!(result, Err(UploadError::DaemonRefused { reason: "write_failed (ENOSPC)".into() }));
    // The daemon got every byte and the `End`; it did not keep the file.
    assert_eq!(recorded(&daemon), (100_000, Some("write_failed (ENOSPC)".into())));
    assert_eq!(daemon.file("/srv/out"), None);
}

// ---- the byte counts differ ----

#[tokio::test]
async fn another_byte_count_in_the_completion_is_a_size_mismatch() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::WrongBytesWritten { reported: 99_999 });
    let result = run(&daemon, &mut MemorySource::new(pattern(100_000)), Limits::default()).await;
    assert_eq!(result, Err(UploadError::SizeMismatch { sent: 100_000, reported: 99_999 }));
    // The daemon received everything and `End`; its push lied about the count.
    assert_eq!(recorded(&daemon), (100_000, None));
}

// ---- the source ----

#[tokio::test]
async fn an_unreadable_source_is_source_unreadable_and_the_daemon_gets_client_error() {
    let daemon = StandInDaemon::start().await.unwrap();
    let connection = connect(&daemon, Limits::default()).await;
    let mut source = Failing { data: pattern(40_000), at: 0 };
    let result = upload(&connection, TARGET, &mut source, |_| {}, std::future::pending(), &Limits::default()).await;
    assert_eq!(result, Err(UploadError::SourceUnreadable { reason: "permission denied".into() }));
    eventually("the daemon to see the Error frame", || !daemon.uploads().is_empty()).await;
    // One whole chunk went before the failure; the rest of the buffer was not sent. Nothing is kept.
    assert_eq!(recorded(&daemon), (CHUNK_BYTES as u64, Some("client_error".into())));
    assert_eq!(daemon.file("/srv/out"), None);

    // The connection and the daemon's stream are usable after it.
    let mut again = MemorySource::new(pattern(10));
    let next = upload(&connection, Target { path: "/srv/next", transfer_id: "t-next" }, &mut again, |_| {}, std::future::pending(), &Limits::default()).await;
    assert_eq!(next, Ok(Uploaded { bytes: 10 }));
}

#[tokio::test]
async fn a_source_that_returns_more_than_it_was_given_is_unreadable() {
    let daemon = StandInDaemon::start().await.unwrap();
    let connection = connect(&daemon, Limits::default()).await;
    let result = upload(&connection, TARGET, &mut Overfull, |_| {}, std::future::pending(), &Limits::default()).await;
    assert!(matches!(result, Err(UploadError::SourceUnreadable { .. })), "{result:?}");
    eventually("the daemon to see the Error frame", || !daemon.uploads().is_empty()).await;
    assert_eq!(recorded(&daemon), (0, Some("client_error".into())));
}

#[tokio::test]
async fn a_source_that_grew_is_source_changed_and_the_daemon_gets_client_error() {
    let daemon = StandInDaemon::start().await.unwrap();
    // Its size at the start was 40,000; it then gives 100,000.
    let mut source = MemorySource::new(pattern(100_000)).claiming(Some(40_000));
    let result = run(&daemon, &mut source, Limits::default()).await;
    assert_eq!(result, Err(UploadError::SourceChanged));
    eventually("the daemon to see the Error frame", || !daemon.uploads().is_empty()).await;
    // The first chunk fits the size; the second would not, and is not sent.
    assert_eq!(recorded(&daemon), (CHUNK_BYTES as u64, Some("client_error".into())));
    assert_eq!(daemon.file("/srv/out"), None);
}

#[tokio::test]
async fn a_source_that_shrank_is_source_changed_and_nothing_is_kept() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut source = MemorySource::new(pattern(50_000)).claiming(Some(100_000));
    let result = run(&daemon, &mut source, Limits::default()).await;
    assert_eq!(result, Err(UploadError::SourceChanged));
    eventually("the daemon to see the Error frame", || !daemon.uploads().is_empty()).await;
    // Every byte there was went; `End` did not, so the daemon kept nothing.
    assert_eq!(recorded(&daemon), (50_000, Some("client_error".into())));
    assert_eq!(daemon.file("/srv/out"), None);
}

#[tokio::test]
async fn a_source_of_unknown_size_is_not_checked() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut source = MemorySource::new(pattern(70_000)).claiming(None);
    assert_eq!(run(&daemon, &mut source, Limits::default()).await, Ok(Uploaded { bytes: 70_000 }));
    assert_eq!(daemon.file("/srv/out").map(|bytes| bytes.len()), Some(70_000));
}

// ---- cancel ----

#[tokio::test]
async fn a_cancel_during_the_upload_sends_client_aborted() {
    let daemon = StandInDaemon::start().await.unwrap();
    let connection = connect(&daemon, Limits::default()).await;
    let mut source = MemorySource::new(pattern(10 * 1024 * 1024));
    let cancel = Trigger::default();
    let last = AtomicU64::new(0);
    let progress = |done| {
        last.store(done, Ordering::SeqCst);
        if done >= 100_000 {
            cancel.cancel();
        }
    };
    let result = upload(&connection, TARGET, &mut source, progress, cancel.clone().cancelled(), &Limits::default()).await;
    assert_eq!(result, Err(UploadError::Cancelled));
    eventually("the daemon to see the Error frame", || !daemon.uploads().is_empty()).await;
    // Every chunk that was written arrived before the `Error`, and the daemon kept nothing.
    assert_eq!(recorded(&daemon), (last.load(Ordering::SeqCst), Some("client_aborted".into())));
    assert!(last.load(Ordering::SeqCst) >= 100_000);
    assert_eq!(daemon.file("/srv/out"), None);
}

#[tokio::test]
async fn a_cancel_before_anything_is_sent_sends_nothing() {
    let daemon = StandInDaemon::start().await.unwrap();
    let connection = connect(&daemon, Limits::default()).await;
    let mut source = MemorySource::new(pattern(10));
    let result = upload(&connection, TARGET, &mut source, |_| {}, std::future::ready(()), &Limits::default()).await;
    assert_eq!(result, Err(UploadError::Cancelled));
    assert!(daemon.uploads().is_empty());
}

#[tokio::test]
async fn a_cancel_while_waiting_for_the_completion_returns_at_once() {
    let daemon = StandInDaemon::start().await.unwrap();
    // The daemon takes the whole upload and never says it is complete.
    daemon.script(Fault::StopAnswering { after: After::Frames(Direction::FromClient, 1) });
    let connection = connect(&daemon, Limits::default()).await;
    let mut source = MemorySource::new(pattern(1000));
    let cancel = Trigger::default();
    let firing = {
        let cancel = cancel.clone();
        let daemon = &daemon;
        async move {
            eventually("the daemon to take the End frame", || !daemon.uploads().is_empty()).await;
            cancel.cancel();
        }
    };
    let (result, ()) = tokio::join!(upload(&connection, TARGET, &mut source, |_| {}, cancel.clone().cancelled(), &DEFAULTS), firing);
    assert_eq!(result, Err(UploadError::Cancelled));
    // `End` had gone: the daemon finishes by itself, and no `Error` follows it.
    assert_eq!(recorded(&daemon), (1000, None));
}

// ---- the connection goes away ----

#[tokio::test]
async fn a_connection_reset_during_the_upload_is_a_lost_connection() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::Reset { after: After::Frames(Direction::FromClient, 3) });
    let result = run(&daemon, &mut MemorySource::new(pattern(4 * 1024 * 1024)), Limits::default()).await;
    assert!(matches!(result, Err(UploadError::ConnectionLost(Error::Closed(_)))), "{result:?}");
    // The daemon never saw an `End`: nothing was kept.
    assert_eq!(daemon.file("/srv/out"), None);
}

#[tokio::test]
async fn a_close_while_waiting_for_the_completion_is_a_lost_connection() {
    let daemon = StandInDaemon::start().await.unwrap();
    // 1 chunk: Begin, one Chunk, End are three frames; the daemon never answers and then closes (1011).
    daemon.script(Fault::StopAnswering { after: After::Frames(Direction::FromClient, 1) });
    daemon.script(Fault::Close { after: After::Frames(Direction::FromClient, 3), code: 1011 });
    let result = run(&daemon, &mut MemorySource::new(pattern(100)), Limits::default()).await;
    assert_eq!(result, Err(UploadError::ConnectionLost(Error::Closed(Ended::Remote(Some(1011))))));
}

#[tokio::test]
async fn a_request_the_daemon_never_answers_is_a_lost_connection_after_the_answer_time() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::Silence { request: crate::testing::Asked::Upload });
    let limits = Limits { answer_wait: Duration::from_millis(50), ..Limits::default() };
    let result = run(&daemon, &mut MemorySource::new(pattern(100)), limits).await;
    assert_eq!(result, Err(UploadError::ConnectionLost(Error::Timeout)));
    assert!(daemon.uploads().is_empty());
}

#[tokio::test]
async fn a_connection_that_was_closed_before_the_upload_is_a_lost_connection() {
    let daemon = StandInDaemon::start().await.unwrap();
    let connection = connect(&daemon, Limits::default()).await;
    connection.close(crate::connection::Close::Normal).await;
    let mut source = MemorySource::new(pattern(10));
    let result = upload(&connection, TARGET, &mut source, |_| {}, std::future::pending(), &Limits::default()).await;
    assert_eq!(result, Err(UploadError::ConnectionLost(Error::Closed(Ended::Local))));
}
