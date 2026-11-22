//! The save against the stand-in daemon, over a real socket: the sizes, a resume, a slow sink and
//! every outcome. Nothing here waits for real seconds.

use std::future::pending;
use std::time::Duration;

use super::support::{TestSink, Trigger, all_streams_free, connect, content, eventually};
use crate::Limits;
use crate::connection::{Close, Connection};
use crate::download::{Progress, Request, SaveError, Saved, Version, save};
use crate::error::{Ended, Error};
use crate::limits::MAX_MESSAGE_BYTES;
use crate::testing::{After, Config, Direction, Disorder, Fault, Request as Kind, StandInDaemon, StreamFault};

const PATH: &str = "/srv/file";

fn first(path: &str) -> Request<'_> {
    Request { path, resume: None }
}

fn resume(path: &str, total_bytes: u64, mtime_ms: u64) -> Request<'_> {
    Request { path, resume: Some(Version { total_bytes, mtime_ms }) }
}

async fn run(connection: &Connection, request: Request<'_>, sink: &mut TestSink) -> Result<Saved, SaveError> {
    save(connection, request, sink, |_| {}, pending(), &Limits::default()).await
}

/// The sink of a save that did not complete for good: nothing is left in it.
#[track_caller]
fn assert_discarded(sink: &TestSink) {
    assert!(sink.inner.is_discarded() && !sink.inner.is_finished(), "the sink was not discarded");
    assert!(sink.bytes().is_empty());
}

// ---- sizes ----

#[tokio::test]
async fn an_empty_file_is_a_begin_an_end_and_an_empty_finished_sink() {
    let daemon = StandInDaemon::start().await.unwrap();
    let info = daemon.put_file(PATH, Vec::new());
    let connection = connect(&daemon, Limits::default()).await;
    let mut sink = TestSink::new();
    let mut progress = Vec::new();

    let saved = save(&connection, first(PATH), &mut sink, |step| progress.push(step), pending(), &Limits::default()).await.unwrap();

    assert_eq!(saved, Saved { version: Version { total_bytes: 0, mtime_ms: info.mtime_ms }, bytes: 0 });
    assert!(sink.inner.is_finished() && !sink.inner.is_discarded());
    assert!(sink.bytes().is_empty());
    assert_eq!(progress, [Progress { done: 0, total: 0 }], "the answer is reported, and no write follows");
    assert!(all_streams_free(&connection));
}

#[tokio::test]
async fn one_byte_arrives_and_the_sink_is_finished() {
    let daemon = StandInDaemon::start().await.unwrap();
    let info = daemon.put_file(PATH, vec![0xAB]);
    let connection = connect(&daemon, Limits::default()).await;
    let mut sink = TestSink::new();
    let mut progress = Vec::new();

    let saved = save(&connection, first(PATH), &mut sink, |step| progress.push(step), pending(), &Limits::default()).await.unwrap();

    assert_eq!(saved, Saved { version: Version { total_bytes: 1, mtime_ms: info.mtime_ms }, bytes: 1 });
    assert_eq!(sink.bytes(), [0xAB]);
    assert!(sink.inner.is_finished());
    assert_eq!(progress, [Progress { done: 0, total: 1 }, Progress { done: 1, total: 1 }]);
    assert!(all_streams_free(&connection));
}

#[tokio::test]
async fn files_around_the_chunk_size_arrive_whole_and_the_progress_only_grows() {
    let daemon = StandInDaemon::start().await.unwrap();
    let connection = connect(&daemon, Limits::default()).await;
    for (index, len) in [2, 32 * 1024 - 1, 32 * 1024, 32 * 1024 + 1, 5 * 32 * 1024 + 17].into_iter().enumerate() {
        let data = content(len, 4);
        let path = format!("/srv/f-{index}");
        daemon.put_file(&path, data.clone());
        let mut sink = TestSink::new();
        let mut progress = Vec::new();

        let saved = save(&connection, first(&path), &mut sink, |step| progress.push(step), pending(), &Limits::default()).await.unwrap();

        assert_eq!(saved.bytes, len as u64);
        assert_eq!(sink.bytes(), data);
        assert!(progress.windows(2).all(|pair| pair[0].done < pair[1].done), "{progress:?}");
        assert_eq!(progress.last(), Some(&Progress { done: len as u64, total: len as u64 }));
    }
    assert!(all_streams_free(&connection));
}

#[tokio::test]
async fn a_file_of_64_mib_arrives_whole() {
    let daemon = StandInDaemon::start().await.unwrap();
    let data = content(64 * 1024 * 1024, 9);
    daemon.put_file(PATH, data.clone());
    let connection = connect(&daemon, Limits::default()).await;
    let mut sink = TestSink::new();

    let saved = run(&connection, first(PATH), &mut sink).await.unwrap();

    assert_eq!(saved.bytes, data.len() as u64);
    assert!(sink.bytes() == data.as_slice(), "the 64 MiB differ");
    assert!(sink.inner.is_finished());
    assert!(all_streams_free(&connection));
}

// ---- a resume ----

#[tokio::test]
async fn a_save_from_an_offset_appended_to_the_first_part_is_the_file() {
    let daemon = StandInDaemon::start().await.unwrap();
    let data = content(300_000, 1);
    let info = daemon.put_file(PATH, data.clone());
    let connection = connect(&daemon, Limits::default()).await;
    for offset in [0, 1, 100_000, 299_999, 300_000] {
        let mut sink = TestSink::holding(data[..offset].to_vec());
        let mut progress = Vec::new();
        let request = resume(PATH, info.size, info.mtime_ms);

        let saved = save(&connection, request, &mut sink, |step| progress.push(step), pending(), &Limits::default()).await.unwrap();

        assert_eq!(saved.bytes, (data.len() - offset) as u64, "the bytes of this call, from {offset}");
        assert_eq!(saved.version, Version { total_bytes: info.size, mtime_ms: info.mtime_ms });
        assert_eq!(sink.bytes(), data, "the first {offset} bytes and the rest");
        assert_eq!(progress.first(), Some(&Progress { done: offset as u64, total: 300_000 }), "a resume starts from the bytes on disk");
    }
    assert!(all_streams_free(&connection));
}

#[tokio::test]
async fn a_connection_lost_mid_save_leaves_the_sink_to_resume_into() {
    let data = content(1024 * 1024, 2);
    for (fault, reason) in [
        (Fault::Close { after: After::Bytes(Direction::ToClient, 100_000), code: 4001 }, Error::Closed(Ended::Remote(Some(4001)))),
        (Fault::Reset { after: After::Bytes(Direction::ToClient, 100_000) }, Error::Closed(Ended::Socket)),
    ] {
        let daemon = StandInDaemon::start().await.unwrap();
        let info = daemon.put_file(PATH, data.clone());
        daemon.script(fault);
        let mut sink = TestSink::new();
        let lost = {
            let connection = connect(&daemon, Limits::default()).await;
            run(&connection, first(PATH), &mut sink).await.unwrap_err()
        };

        let version = Version { total_bytes: info.size, mtime_ms: info.mtime_ms };
        assert_eq!(lost, SaveError::ConnectionLost { reason, version: Some(version) });
        assert_eq!(lost.code(), "connection_lost");
        assert!(!sink.inner.is_finished() && !sink.inner.is_discarded(), "the sink is left open");
        // A close frame comes after every byte before it; a reset may cut what the socket still held.
        let kept = sink.bytes().len();
        assert!(data.starts_with(sink.bytes()), "what arrived before the connection ended is the file's start");
        if matches!(lost, SaveError::ConnectionLost { reason: Error::Closed(Ended::Remote(_)), .. }) {
            assert_eq!(kept, 100_000);
        }

        // Another connection, the same sink, the version the loss reported.
        let connection = connect(&daemon, Limits::default()).await;
        let saved = run(&connection, resume(PATH, version.total_bytes, version.mtime_ms), &mut sink).await.unwrap();
        assert_eq!(saved.bytes, (1024 * 1024 - kept) as u64);
        assert!(sink.bytes() == data.as_slice());
        assert!(sink.inner.is_finished());
    }
}

#[tokio::test]
async fn a_connection_already_closed_loses_the_save_before_anything_is_written() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file(PATH, content(100, 1));
    let connection = connect(&daemon, Limits::default()).await;
    connection.close(Close::Normal).await;
    let mut sink = TestSink::holding(vec![1, 2, 3]);
    let guard = Version { total_bytes: 100, mtime_ms: 5 };

    let lost = run(&connection, Request { path: PATH, resume: Some(guard) }, &mut sink).await.unwrap_err();

    assert_eq!(lost, SaveError::ConnectionLost { reason: Error::Closed(Ended::Local), version: Some(guard) });
    assert_eq!(sink.bytes(), [1, 2, 3]);
    assert!(!sink.inner.is_discarded());
}

// ---- a slow sink ----

#[tokio::test]
async fn a_slow_sink_gets_every_byte_in_order_with_a_hold_far_smaller_than_the_file() {
    let daemon = StandInDaemon::start().await.unwrap();
    let data = content(2 * 1024 * 1024 + 5, 6);
    daemon.put_file(PATH, data.clone());
    // 64 KiB: about two chunks may wait to be written; the other 62 come as the sink takes them.
    let limits = Limits { download_hold_bytes: 64 * 1024, ..Limits::default() };
    let connection = connect(&daemon, limits).await;
    let mut sink = TestSink { delay: Duration::from_millis(1), ..TestSink::new() };

    let saved = save(&connection, first(PATH), &mut sink, |_| {}, pending(), &limits).await.unwrap();

    assert_eq!(saved.bytes, data.len() as u64);
    assert!(sink.bytes() == data.as_slice());
    assert!(sink.writes >= 64);
}

// ---- the daemon refuses ----

#[tokio::test]
async fn a_refusal_is_daemon_refused_with_the_daemons_reason_and_the_sink_is_discarded() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file(PATH, content(100, 1));
    let connection = connect(&daemon, Limits::default()).await;
    let cases = [
        ("/srv/missing", None, "not_found"),
        (PATH, Some(Fault::Refuse { request: Kind::Download, error: "not_a_file".into() }), "not_a_file"),
        (PATH, Some(Fault::Refuse { request: Kind::Download, error: "unreadable".into() }), "unreadable"),
        (PATH, Some(Fault::no_free_stream(Kind::Download)), "no_free_stream"),
        (PATH, Some(Fault::Refuse { request: Kind::Download, error: "range_not_satisfiable".into() }), "range_not_satisfiable"),
        (PATH, Some(Fault::DownloadStream(StreamFault::ErrorFirst("read_failed".into()))), "read_failed"),
    ];
    for (path, fault, reason) in cases {
        if let Some(fault) = fault {
            daemon.script(fault);
        }
        let mut sink = TestSink::new();

        let refused = run(&connection, first(path), &mut sink).await.unwrap_err();

        assert_eq!(refused, SaveError::DaemonRefused { reason: reason.to_owned() });
        assert_eq!(refused.code(), "daemon_refused");
        assert_discarded(&sink);
    }
    assert!(all_streams_free(&connection), "no stream stays reserved after a refusal");
    assert!(run(&connection, first(PATH), &mut TestSink::new()).await.is_ok(), "the connection goes on");
}

#[tokio::test]
async fn an_rpc_error_is_a_refusal_with_the_daemons_words() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file(PATH, content(10, 1));
    daemon.script(Fault::RpcError { request: Kind::Download, code: "handler_error".into(), message: "the disk is on fire".into() });
    let connection = connect(&daemon, Limits::default()).await;
    let mut sink = TestSink::new();

    let refused = run(&connection, first(PATH), &mut sink).await.unwrap_err();

    assert_eq!(refused, SaveError::DaemonRefused { reason: "the disk is on fire (handler_error)".into() });
    assert_discarded(&sink);
    assert!(all_streams_free(&connection));
}

#[tokio::test]
async fn an_error_frame_mid_file_is_a_refusal_with_its_message() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file(PATH, content(200_000, 1));
    daemon.script(Fault::DownloadStream(StreamFault::ErrorAfter { bytes: 50_000, message: "read_failed".into() }));
    let connection = connect(&daemon, Limits::default()).await;
    let mut sink = TestSink::new();

    let refused = run(&connection, first(PATH), &mut sink).await.unwrap_err();

    assert_eq!(refused, SaveError::DaemonRefused { reason: "read_failed".into() });
    assert!(sink.writes > 0, "bytes had been written before the Error frame");
    assert_discarded(&sink);
    assert!(all_streams_free(&connection));
}

// ---- changed ----

#[tokio::test]
async fn a_resume_onto_a_changed_file_is_changed_and_the_sink_is_discarded() {
    let daemon = StandInDaemon::start().await.unwrap();
    let data = content(10_000, 1);
    let info = daemon.put_file(PATH, data.clone());
    let connection = connect(&daemon, Limits::default()).await;
    // The file grows between the first answer and the resume.
    daemon.put_file(PATH, content(10_500, 2));
    let mut sink = TestSink::holding(data[..4_000].to_vec());

    let changed = run(&connection, resume(PATH, info.size, info.mtime_ms), &mut sink).await.unwrap_err();

    assert_eq!(changed, SaveError::Changed);
    assert_eq!(changed.code(), "changed");
    assert_eq!(changed.to_string(), "The file changed on the daemon.");
    assert_discarded(&sink);
    assert!(all_streams_free(&connection));
}

#[tokio::test]
async fn an_error_frame_changed_is_changed_and_so_is_a_refusal_changed() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file(PATH, content(200_000, 1));
    let connection = connect(&daemon, Limits::default()).await;
    for fault in [
        // The file shrank while it was read.
        Fault::DownloadStream(StreamFault::ErrorAfter { bytes: 40_000, message: "changed".into() }),
        Fault::Refuse { request: Kind::Download, error: "changed".into() },
    ] {
        daemon.script(fault);
        let mut sink = TestSink::new();

        assert_eq!(run(&connection, first(PATH), &mut sink).await.unwrap_err(), SaveError::Changed);
        assert_discarded(&sink);
    }
    assert!(all_streams_free(&connection));
}

// ---- the sink fails ----

#[tokio::test]
async fn a_failed_write_is_disk_with_the_systems_reason_and_the_daemon_is_told_to_stop() {
    let daemon = StandInDaemon::start_with(Config { chunk_delay: Duration::from_millis(2), ..Config::default() }).await.unwrap();
    daemon.put_file(PATH, content(4 * 1024 * 1024, 1));
    daemon.put_file("/srv/small", content(1000, 2));
    let connection = connect(&daemon, Limits::default()).await;
    let mut sink = TestSink { fail_write_at: Some(2), ..TestSink::new() };

    let failed = run(&connection, first(PATH), &mut sink).await.unwrap_err();

    assert_eq!(failed, SaveError::Disk { reason: "the disk is full".into() });
    assert_eq!(failed.code(), "disk");
    assert_eq!(sink.writes, 3, "nothing was written after the failure");
    assert_discarded(&sink);
    // The daemon stopped streaming, so the stream is free again and the connection serves the next save.
    assert!(all_streams_free(&connection));
    let mut next = TestSink::new();
    assert_eq!(run(&connection, first("/srv/small"), &mut next).await.unwrap().bytes, 1000);
}

#[tokio::test]
async fn a_sink_that_cannot_finish_is_disk_and_discarded() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file(PATH, content(5_000, 1));
    let connection = connect(&daemon, Limits::default()).await;
    let mut sink = TestSink { fail_finish: true, ..TestSink::new() };

    let failed = run(&connection, first(PATH), &mut sink).await.unwrap_err();

    assert_eq!(failed, SaveError::Disk { reason: "the file could not be put in place".into() });
    assert_discarded(&sink);
    assert!(all_streams_free(&connection));
}

#[tokio::test]
async fn a_sink_whose_count_is_not_the_files_size_is_an_internal_error() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file(PATH, content(5_000, 1));
    let connection = connect(&daemon, Limits::default()).await;
    let mut sink = TestSink { lie: Some(4_999), ..TestSink::new() };

    let failed = run(&connection, first(PATH), &mut sink).await.unwrap_err();

    assert_eq!(failed, SaveError::Internal("the sink's byte count is not the file's size"));
    assert_discarded(&sink);
}

#[tokio::test]
async fn a_first_save_into_a_sink_that_holds_bytes_is_an_internal_error_and_sends_nothing() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file(PATH, content(100, 1));
    let connection = connect(&daemon, Limits::default()).await;
    let mut sink = TestSink::holding(vec![1]);

    let failed = run(&connection, first(PATH), &mut sink).await.unwrap_err();

    assert_eq!(failed, SaveError::Internal("a save without a resume point needs an empty sink"));
    assert_discarded(&sink);
    assert!(all_streams_free(&connection));
}

// ---- cancelled ----

#[tokio::test]
async fn a_cancel_mid_download_is_cancelled_the_daemon_stops_and_the_stream_is_free() {
    let daemon = StandInDaemon::start_with(Config { chunk_delay: Duration::from_millis(2), ..Config::default() }).await.unwrap();
    daemon.put_file(PATH, content(8 * 1024 * 1024, 1));
    daemon.put_file("/srv/small", content(1000, 2));
    let connection = connect(&daemon, Limits::default()).await;
    let trigger = Trigger::default();
    let mut sink = TestSink::new();
    sink.on_write = Some(Box::new({
        let trigger = trigger.clone();
        move |index| {
            if index == 3 {
                trigger.cancel();
            }
        }
    }));

    let cancelled = save(&connection, first(PATH), &mut sink, |_| {}, trigger.cancelled(), &Limits::default()).await.unwrap_err();

    assert_eq!(cancelled, SaveError::Cancelled);
    assert_eq!(cancelled.code(), "cancelled");
    assert!(sink.writes <= 4, "the write that was running when the cancel came was the last");
    assert_discarded(&sink);
    assert!(all_streams_free(&connection));
    let mut next = TestSink::new();
    assert_eq!(run(&connection, first("/srv/small"), &mut next).await.unwrap().bytes, 1000);
}

#[tokio::test]
async fn a_cancel_that_is_already_complete_sends_nothing() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file(PATH, content(100, 1));
    let connection = connect(&daemon, Limits::default()).await;
    let trigger = Trigger::default();
    trigger.cancel();
    let mut sink = TestSink::new();

    let cancelled = save(&connection, first(PATH), &mut sink, |_| {}, trigger.cancelled(), &Limits::default()).await.unwrap_err();

    assert_eq!(cancelled, SaveError::Cancelled);
    assert_discarded(&sink);
    assert_eq!(sink.writes, 0);
    assert!(all_streams_free(&connection));
    assert!(run(&connection, first(PATH), &mut TestSink::new()).await.is_ok());
}

#[tokio::test]
async fn a_cancel_while_the_daemon_never_answers_ends_when_the_daemon_has_no_download_there() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file(PATH, content(100, 1));
    daemon.script(Fault::Silence { request: crate::testing::Asked::Download });
    let connection = connect(&daemon, Limits::default()).await;
    let trigger = Trigger::default();
    let mut sink = TestSink::new();
    let task = {
        let trigger = trigger.clone();
        let mut sink = std::mem::take(&mut sink);
        let connection = &connection;
        async move {
            let result = save(connection, first(PATH), &mut sink, |_| {}, trigger.cancelled(), &Limits::default()).await;
            (result, sink)
        }
    };
    let canceller = async {
        tokio::time::sleep(Duration::from_millis(100)).await;
        trigger.cancel();
    };

    let ((result, sink), ()) = tokio::join!(task, canceller);

    // The request was ignored whole; the daemon says it has no download on the stream, so it is free.
    assert_eq!(result.unwrap_err(), SaveError::Cancelled);
    assert_discarded(&sink);
    assert!(all_streams_free(&connection));
}

#[tokio::test]
async fn an_error_frame_cancelled_that_the_user_did_not_ask_for_is_a_refusal() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file(PATH, content(100, 1));
    daemon.script(Fault::DownloadStream(StreamFault::ErrorFirst("cancelled".into())));
    let connection = connect(&daemon, Limits::default()).await;
    let mut sink = TestSink::new();

    let refused = run(&connection, first(PATH), &mut sink).await.unwrap_err();

    assert_eq!(refused, SaveError::DaemonRefused { reason: "cancelled".into() });
    assert_discarded(&sink);
    assert!(all_streams_free(&connection));
}

// ---- the protocol ----

#[tokio::test]
async fn frames_out_of_order_and_bytes_past_the_length_are_protocol_and_the_connection_goes_on() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file(PATH, content(100_000, 1));
    daemon.put_file("/srv/small", content(1000, 2));
    let connection = connect(&daemon, Limits::default()).await;
    for fault in [Disorder::ChunkBeforeBegin, Disorder::EndBeforeChunks] {
        daemon.script(Fault::DownloadStream(StreamFault::OutOfOrder(fault)));
        let mut sink = TestSink::new();

        let broken = run(&connection, first(PATH), &mut sink).await.unwrap_err();

        assert!(matches!(broken, SaveError::Protocol(Error::Protocol(_))), "{fault:?}: {broken:?}");
        assert_eq!(broken.code(), "protocol");
        assert_eq!(sink.writes, 0, "{fault:?}: nothing was written");
        assert_discarded(&sink);
    }
    daemon.script(Fault::DownloadStream(StreamFault::ExtraBytes(1)));
    let mut sink = TestSink::new();
    let broken = run(&connection, first(PATH), &mut sink).await.unwrap_err();
    assert!(matches!(broken, SaveError::Protocol(Error::Protocol(_))), "{broken:?}");
    assert_discarded(&sink);

    assert!(all_streams_free(&connection));
    let mut next = TestSink::new();
    assert_eq!(run(&connection, first("/srv/small"), &mut next).await.unwrap().bytes, 1000);
}

#[tokio::test]
async fn a_chunk_after_the_end_or_on_another_stream_does_not_spoil_a_complete_save() {
    let daemon = StandInDaemon::start().await.unwrap();
    let data = content(50_000, 1);
    daemon.put_file(PATH, data.clone());
    let connection = connect(&daemon, Limits::default()).await;
    for fault in [Disorder::ChunkAfterEnd, Disorder::ChunkOnOtherStream] {
        daemon.script(Fault::DownloadStream(StreamFault::OutOfOrder(fault)));
        let mut sink = TestSink::new();

        run(&connection, first(PATH), &mut sink).await.unwrap_or_else(|error| panic!("{fault:?}: {error}"));

        assert!(sink.bytes() == data.as_slice(), "{fault:?}");
        assert!(sink.inner.is_finished());
    }
}

#[tokio::test]
async fn a_message_above_16_mib_ends_the_connection_and_the_save_is_protocol() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file(PATH, content(10, 1));
    daemon.script(Fault::DownloadStream(StreamFault::Oversized(MAX_MESSAGE_BYTES + 1)));
    let connection = connect(&daemon, Limits::default()).await;
    let mut sink = TestSink::new();

    let broken = run(&connection, first(PATH), &mut sink).await.unwrap_err();

    assert!(matches!(broken, SaveError::Protocol(Error::Protocol(_))), "{broken:?}");
    assert_discarded(&sink);
    eventually("the daemon sees the connection closed", || daemon.open_connections() == 0).await;
}
