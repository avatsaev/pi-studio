//! The flow against the stand-in daemon over a real socket: files of every size arrive whole, and a
//! daemon that stops reading holds the upload back.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::support::{Generated, Trigger, connect, pattern};
use crate::Limits;
use crate::limits::CHUNK_BYTES;
use crate::testing::{After, Direction, Fault, StandInDaemon};
use crate::upload::{MemorySource, Target, UploadError, Uploaded, upload};

/// Uploads `data` to `/srv/file` and returns the progress calls with the result.
async fn upload_memory(daemon: &StandInDaemon, data: &[u8], transfer_id: &str) -> (Result<Uploaded, UploadError>, Vec<u64>) {
    let connection = connect(daemon, Limits::default()).await;
    let mut source = MemorySource::new(data);
    let mut seen = Vec::new();
    let result =
        upload(&connection, Target { path: "/srv/file", transfer_id }, &mut source, |done| seen.push(done), std::future::pending(), &Limits::default()).await;
    (result, seen)
}

async fn arrives_whole(len: usize) {
    let daemon = StandInDaemon::start().await.unwrap();
    let data = pattern(len);
    let (result, progress) = upload_memory(&daemon, &data, "t-size").await;
    assert_eq!(result, Ok(Uploaded { bytes: len as u64 }));
    assert!(daemon.file("/srv/file").as_deref() == Some(data.as_slice()), "the daemon's copy is not the source");
    let records = daemon.uploads();
    assert_eq!(records.len(), 1);
    assert_eq!(
        (records[0].transfer_id.as_str(), records[0].path.as_str(), records[0].bytes_received, records[0].error.as_deref()),
        ("t-size", "/srv/file", len as u64, None)
    );
    // Progress counts written bytes, never goes back and ends at the size; an empty file has none.
    assert!(progress.windows(2).all(|pair| pair[0] < pair[1]), "{progress:?}");
    assert_eq!(progress.last().copied().unwrap_or(0), len as u64);
    assert_eq!(progress.len(), len.div_ceil(CHUNK_BYTES));
}

#[tokio::test]
async fn an_empty_source_arrives_whole() {
    arrives_whole(0).await;
}

#[tokio::test]
async fn one_byte_arrives_whole() {
    arrives_whole(1).await;
}

#[tokio::test]
async fn one_chunk_and_one_byte_arrives_whole() {
    arrives_whole(CHUNK_BYTES + 1).await;
}

#[tokio::test]
async fn exactly_one_chunk_arrives_whole() {
    arrives_whole(CHUNK_BYTES).await;
}

#[tokio::test]
async fn sixty_four_mebibytes_arrive_whole() {
    arrives_whole(64 * 1024 * 1024).await;
}

#[tokio::test]
async fn an_upload_over_an_existing_file_replaces_it() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/srv/file", b"old content".to_vec());
    let (result, _) = upload_memory(&daemon, b"new", "t-over").await;
    assert_eq!(result, Ok(Uploaded { bytes: 3 }));
    assert_eq!(daemon.file("/srv/file"), Some(b"new".to_vec()));
}

#[tokio::test]
async fn two_uploads_one_after_the_other_use_one_connection() {
    let daemon = StandInDaemon::start().await.unwrap();
    let connection = connect(&daemon, Limits::default()).await;
    for (index, data) in [pattern(70_000), pattern(5)].into_iter().enumerate() {
        let path = format!("/srv/{index}");
        let id = format!("t-{index}");
        let mut source = MemorySource::new(data.clone());
        let result = upload(&connection, Target { path: &path, transfer_id: &id }, &mut source, |_| {}, std::future::pending(), &Limits::default()).await;
        assert_eq!(result.map(|done| done.bytes), Ok(data.len() as u64));
        assert_eq!(daemon.file(&path), Some(data));
    }
    assert_eq!(daemon.accepted_connections(), 1);
}

/// A stand-in that stops reading after the `Begin`: the kernel's buffers fill, the socket write
/// stops, and so does the source. The amount read ahead is measured, and is a small part of the file.
#[tokio::test]
async fn a_daemon_that_does_not_read_holds_the_upload_to_the_socket_buffers() {
    const FILE: usize = 256 * 1024 * 1024;
    // The socket buffers of the two ends, with a generous margin: loopback buffers grow to a few MiB.
    const BOUND: u64 = 16 * 1024 * 1024;
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::StopReading { after: After::Frames(Direction::FromClient, 1) });
    let limits = Limits { close_wait: Duration::from_millis(50), ..Limits::default() };
    let connection = connect(&daemon, limits).await;
    let mut source = Generated::new(FILE);
    let read = Arc::clone(&source.read);
    let written = Arc::new(AtomicU64::new(0));
    let cancel = Trigger::default();
    let run = {
        let written = Arc::clone(&written);
        let cancel = cancel.clone();
        async move {
            let progress = |done| written.store(done, Ordering::SeqCst);
            upload(&connection, Target { path: "/srv/big", transfer_id: "t-stall" }, &mut source, progress, cancel.cancelled(), &limits).await
        }
    };
    let task = tokio::spawn(run);

    // Wait until the number of bytes read stops growing.
    let mut last = 0;
    let mut steady = 0;
    while steady < 20 {
        tokio::time::sleep(Duration::from_millis(25)).await;
        let now = read.load(Ordering::SeqCst);
        steady = if now == last && now > 0 { steady + 1 } else { 0 };
        last = now;
    }
    assert!(last <= BOUND, "the upload read {last} bytes of {FILE} from a daemon that reads nothing");
    assert!(last < u64::try_from(FILE).unwrap() / 4);
    // What was read but not written is at most one chunk (and what the writer holds): one frame.
    let written_now = written.load(Ordering::SeqCst);
    assert!(last - written_now <= 2 * CHUNK_BYTES as u64, "read {last}, written {written_now}");

    // A cancel still works with the socket stuck: the Error frame is not waited for beyond the close wait.
    cancel.cancel();
    let result = tokio::time::timeout(Duration::from_secs(5), task).await.expect("the cancel returns").unwrap();
    assert_eq!(result, Err(UploadError::Cancelled));
    assert_eq!(daemon.file("/srv/big"), None);
}

#[tokio::test]
async fn a_source_that_trickles_still_fills_whole_chunks() {
    let daemon = StandInDaemon::start().await.unwrap();
    let connection = connect(&daemon, Limits::default()).await;
    let data = pattern(3 * CHUNK_BYTES + 17);
    let mut source = super::support::Trickle { data: data.clone(), at: 0, most: 7 };
    let calls = Mutex::new(Vec::new());
    let result = upload(
        &connection,
        Target { path: "/srv/t", transfer_id: "t-trickle" },
        &mut source,
        |done| calls.lock().unwrap().push(done),
        std::future::pending(),
        &Limits::default(),
    )
    .await;
    assert_eq!(result.map(|done| done.bytes), Ok(data.len() as u64));
    assert_eq!(daemon.file("/srv/t"), Some(data));
    // Four chunks, three full: a trickling source does not make a frame per read.
    let sizes = calls.lock().unwrap().clone();
    assert_eq!(sizes, vec![32768, 65536, 98304, 98321]);
}
