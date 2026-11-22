//! What a test can ask of the stand-in about its streams and its files: how many streams are in use,
//! a connection that stopped reading and starts again, a file that is counted and not held, and an
//! upload that is counted and not kept.

use std::time::Duration;

use super::client::{Client, Event, Got};
use super::eventually;
use crate::testing::{After, Config, Direction, Fault, StandInDaemon};
use crate::wire::inbound::{DownloadResponse, UploadResponse};
use crate::wire::outbound;

const GIB: u64 = 1024 * 1024 * 1024;

fn sample(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i % 249) as u8).collect()
}

#[tokio::test]
async fn an_upload_holds_its_stream_until_it_ends() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut client = Client::connect(&daemon).await;
    assert_eq!(daemon.streams_in_use(), 0);

    let stream = client.accepted_upload("/a", "t-1").await;
    assert_eq!(daemon.streams_in_use(), 1);
    client.send_upload(stream, "t-1", &sample(1000), 400).await;
    assert!(client.upload_complete().await.ok);
    assert_eq!(daemon.streams_in_use(), 0);

    // One that the client aborts is free as well.
    let stream = client.accepted_upload("/b", "t-2").await;
    assert_eq!(daemon.streams_in_use(), 1);
    client.send_binary(crate::wire::binary::encode_error(stream, "client_aborted").expect("a short message")).await;
    assert!(!client.upload_complete().await.ok);
    assert_eq!(daemon.streams_in_use(), 0);
}

#[tokio::test]
async fn a_connection_that_ends_frees_the_streams_of_its_uploads() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut client = Client::connect(&daemon).await;
    client.accepted_upload("/a", "t-1").await;
    client.accepted_upload("/b", "t-2").await;
    assert_eq!(daemon.streams_in_use(), 2);

    drop(client);
    eventually("the streams to be freed", || daemon.streams_in_use() == 0).await;
}

#[tokio::test]
async fn a_download_holds_its_stream_until_its_last_frame_and_a_dropped_connection_frees_it() {
    let daemon = StandInDaemon::start_with(Config { chunk_bytes: 100, chunk_delay: Duration::from_millis(40), ..Config::default() }).await.unwrap();
    daemon.put_file("/f", sample(1000));
    let mut client = Client::connect(&daemon).await;
    assert!(matches!(client.request_download("/f", None, None, None, None).await, DownloadResponse::Accepted(_)));
    assert_eq!(daemon.streams_in_use(), 1);
    let frames = client.stream_frames().await;
    assert!(matches!(frames.last(), Some(Got::End { .. })));
    eventually("the stream to be freed after the End", || daemon.streams_in_use() == 0).await;

    assert!(matches!(client.request_download("/f", None, None, None, None).await, DownloadResponse::Accepted(_)));
    assert_eq!(daemon.streams_in_use(), 1);
    drop(client);
    eventually("the stream to be freed with the connection", || daemon.streams_in_use() == 0).await;
}

#[tokio::test]
async fn a_download_that_a_fault_cuts_off_as_it_is_answered_holds_no_stream() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f", sample(1000));
    // The hang-up comes with the answer, before the download's task starts.
    daemon.script(Fault::Close { after: After::TextFrames(Direction::FromClient, 2), code: 1011 });
    let mut client = Client::connect(&daemon).await;
    assert!(matches!(client.request_download("/f", None, None, None, None).await, DownloadResponse::Accepted(_)));
    assert!(matches!(client.event().await, Event::Closed(Some(1011))));
    eventually("the stream to be freed with the connection", || daemon.streams_in_use() == 0).await;
}

#[tokio::test]
async fn a_connection_that_stopped_reading_reads_again_after_resume_reading() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::StopReading { after: After::TextFrames(Direction::FromClient, 1) });
    let mut client = Client::connect(&daemon).await;
    let id = client.id();
    client.send(outbound::upload_request(&id, "/a", "t-1")).await;
    client.assert_silent().await;
    assert_eq!(daemon.streams_in_use(), 0, "the request has not been read");

    daemon.resume_reading();
    let reply = client.reply().await;
    assert_eq!(reply.request_id, id);
    assert!(matches!(reply.upload_response(), Ok(UploadResponse::Accepted { .. })));
    assert_eq!(daemon.streams_in_use(), 1);
}

#[tokio::test]
async fn resume_reading_does_not_start_a_connection_that_stops_afterwards() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.resume_reading();
    daemon.script(Fault::StopReading { after: After::TextFrames(Direction::FromClient, 1) });
    let mut client = Client::connect(&daemon).await;
    let id = client.id();
    client.send(outbound::upload_request(&id, "/a", "t-1")).await;
    client.assert_silent().await;
}

#[tokio::test]
async fn a_counted_file_is_sent_as_zeros_and_is_not_held() {
    let daemon = StandInDaemon::start_with(Config { chunk_bytes: 1000, ..Config::default() }).await.unwrap();
    let info = daemon.put_counted_file("/big", 5000);
    assert_eq!(info.size, 5000);
    assert_eq!(daemon.file("/big"), None, "it is not held");
    assert_eq!(daemon.file_info("/big"), Some(info));

    let mut client = Client::connect(&daemon).await;
    let downloaded = client.download("/big", None, None).await.unwrap();
    assert_eq!(downloaded.kinds(), ["Begin", "Chunk", "Chunk", "Chunk", "Chunk", "Chunk", "End"]);
    assert_eq!(downloaded.bytes(), vec![0; 5000]);
    assert_eq!((downloaded.accepted.total_bytes, downloaded.accepted.mtime_ms), (5000, info.mtime_ms));

    let tail = client.download("/big", Some(4990), None).await.unwrap();
    assert_eq!((tail.accepted.offset, tail.accepted.length, tail.bytes()), (4990, 10, vec![0; 10]));
}

#[tokio::test]
async fn a_counted_file_of_more_than_4_gib_is_announced_whole_and_read_from_an_offset_past_4_gib() {
    let daemon = StandInDaemon::start().await.unwrap();
    let size = 5 * GIB + 17;
    let info = daemon.put_counted_file("/huge", size);
    assert_eq!(info.size, size);

    let mut client = Client::connect(&daemon).await;
    let tail = client.download("/huge", Some(5 * GIB + 7), None).await.unwrap();
    assert_eq!((tail.accepted.total_bytes, tail.accepted.offset, tail.accepted.length), (size, 5 * GIB + 7, 10));
    assert_eq!(tail.bytes(), vec![0; 10]);
    let Some(Got::Begin { meta, .. }) = tail.frames.first() else { panic!("no Begin") };
    assert_eq!((meta.total_bytes, meta.offset, meta.length), (Some(size), Some(5 * GIB + 7), Some(10)));

    // An offset past the end is refused, as for any file.
    assert!(client.download("/huge", Some(size + 1), None).await.is_err());
}

#[tokio::test]
async fn an_upload_to_a_daemon_that_does_not_store_is_counted_and_acknowledged_and_kept_nowhere() {
    let daemon = StandInDaemon::start_with(Config { store_uploads: false, ..Config::default() }).await.unwrap();
    let mut client = Client::connect(&daemon).await;
    let stream = client.accepted_upload("/a", "t-1").await;
    client.send_upload(stream, "t-1", &sample(100_000), 32 * 1024).await;
    let complete = client.upload_complete().await;
    assert_eq!((complete.ok, complete.bytes_written), (true, 100_000));
    assert_eq!(daemon.file("/a"), None);
    assert_eq!(daemon.file_info("/a"), None);
    let records = daemon.uploads();
    assert_eq!(records.len(), 1);
    assert_eq!((records[0].bytes_received, records[0].error.as_deref()), (100_000, None));
    assert_eq!(daemon.streams_in_use(), 0);

    // Nothing was kept, so nothing is held either: a second upload is counted the same way.
    let stream = client.accepted_upload("/a", "t-2").await;
    client.send_upload(stream, "t-2", &[], 1024).await;
    assert!(matches!(client.event().await, Event::Text(_)));
    assert_eq!(daemon.uploads()[1].bytes_received, 0);
}
