//! The connection against the stand-in daemon, over a real socket.
//!
//! Most of these run on the real clock: they wait for sockets, never for a timer. The few that
//! need 10 or 30 seconds freeze the clock (`Frozen`) and move it by hand.

use std::sync::Arc;
use std::time::{Duration, Instant as RealInstant};

use pistudiodesktop_net::dial;
use tokio::task::JoinHandle;

use super::support::APP;
use crate::Limits;
use crate::connection::{Close, Connection, Frame};
use crate::error::{Ended, Error};
use crate::limits::{CHUNK_BYTES, MAX_MESSAGE_BYTES};
use crate::testing::{After, Asked, Config, Direction, Fault, Features, Request, StandInDaemon, StreamFault};
use crate::wire::binary;
use crate::wire::inbound::{DownloadAccepted, DownloadResponse, UploadComplete, UploadResponse};
use crate::wire::outbound::{self, DownloadRequest};

async fn open(daemon: &StandInDaemon, limits: Limits) -> Result<Connection, Error> {
    let socket = dial(&daemon.url(), None, Duration::from_secs(5), limits.max_message_bytes).await.expect("the stand-in accepts the dial");
    Connection::open(socket, &APP, limits).await
}

async fn connect(daemon: &StandInDaemon) -> Arc<Connection> {
    Arc::new(open(daemon, Limits::default()).await.expect("the handshake succeeds"))
}

/// A file's bytes: the same for the same `seed`, and not periodic within a chunk.
fn content(len: usize, seed: u8) -> Vec<u8> {
    (0..len).map(|index| u8::try_from((index * 31 + index / 251 + usize::from(seed)) % 256).unwrap()).collect()
}

/// Lets real time pass without blocking the runtime, so that sockets and tasks move.
async fn real_pause(millis: u64) {
    tokio::task::spawn_blocking(move || std::thread::sleep(Duration::from_millis(millis))).await.unwrap();
}

/// Waits for `done`, in real time, for at most ten seconds.
async fn eventually(mut done: impl FnMut() -> bool) {
    let start = RealInstant::now();
    while !done() {
        assert!(start.elapsed() < Duration::from_secs(10), "it did not happen within ten seconds");
        real_pause(5).await;
    }
}

/// A frozen clock: it moves only when [`Frozen::advance`] says so.
///
/// `pause` alone lets the runtime run the clock ahead whenever it waits, including while it waits for
/// a socket, so a timer would fire before the answer that is already on its way. A blocking task that
/// runs for the whole test stops that (documented tokio behaviour: blocking tasks inhibit
/// auto-advance), and the test then moves time itself.
struct Frozen {
    _release: std::sync::mpsc::Sender<()>,
}

impl Frozen {
    fn start() -> Self {
        tokio::time::pause();
        let (release, held) = std::sync::mpsc::channel::<()>();
        tokio::task::spawn_blocking(move || {
            let _ = held.recv();
        });
        Self { _release: release }
    }

    /// Gives the tasks real time to start their timers. A test calls it after it spawns a task and
    /// before it moves the clock: a timer started after the clock had moved would be late by that much.
    async fn settle(&self) {
        real_pause(20).await;
    }

    /// Moves the clock, then gives the sockets and tasks real time to react. A timer's deadline is
    /// rounded up to the next millisecond, so the clock moves 2 ms more than asked: a timer due in
    /// exactly `by` has then fired.
    async fn advance(&self, by: Duration) {
        tokio::time::advance(by + Duration::from_millis(2)).await;
        real_pause(10).await;
    }
}

async fn upload(connection: &Connection, path: &str, transfer_id: &str, data: &[u8]) -> UploadComplete {
    let wait = connection.expect_upload(transfer_id).unwrap();
    let reply = connection.request(|id| outbound::upload_request(id, path, transfer_id)).await.unwrap();
    let UploadResponse::Accepted { stream } = reply.upload_response().unwrap() else { panic!("the upload is accepted") };
    connection.send_binary(binary::encode_begin(stream, transfer_id)).await.unwrap();
    for piece in data.chunks(CHUNK_BYTES) {
        connection.send_binary(binary::encode_chunk(stream, piece).unwrap()).await.unwrap();
    }
    connection.send_binary(binary::encode_end(stream, true)).await.unwrap();
    wait.complete().await.unwrap()
}

/// Asks for a file and reads its frames up to `End`.
async fn download(connection: &Connection, path: &str, offset: Option<u64>) -> (DownloadAccepted, Vec<u8>) {
    let mut download = connection.download().unwrap();
    let reply = connection
        .request(|id| {
            outbound::download_request(&DownloadRequest { request_id: id, path, stream: Some(download.stream()), offset, length: None, if_unchanged: None })
        })
        .await
        .unwrap();
    let DownloadResponse::Accepted(accepted) = reply.download_response().unwrap() else { panic!("the download is accepted") };
    let mut bytes = Vec::new();
    loop {
        let delivery = download.next().await.unwrap();
        match delivery.frame() {
            Frame::Begin(_) => {}
            Frame::Chunk(data) => bytes.extend_from_slice(data),
            Frame::End { ok } => {
                assert!(ok);
                return (accepted, bytes);
            }
            Frame::Error { message } => panic!("the download failed: {message}"),
        }
    }
}

// ---- handshake and requests ----

#[tokio::test]
async fn the_hello_the_stand_in_reads_is_the_one_the_engine_sends() {
    let daemon = StandInDaemon::start().await.unwrap();
    let _connection = connect(&daemon).await;
    let hellos = daemon.hellos();
    assert_eq!(hellos.len(), 1);
    assert_eq!(hellos[0]["clientId"], "client-1");
    assert_eq!(hellos[0]["clientType"], "browser");
    assert_eq!(hellos[0]["platform"], "desktop");
    assert_eq!(hellos[0]["agentStreams"], "none");
    assert_eq!(hellos[0]["protocolVersion"], 1);
    assert_eq!(hellos[0]["appVersion"], "pistudiodesktop/test");
    assert!(hellos[0].get("capabilities").is_none());
}

#[tokio::test]
async fn a_stand_in_without_one_of_the_three_flags_is_unsupported_and_the_connection_is_closed() {
    for (missing, features) in [
        ("fileDownloadRanges", Features { file_download_ranges: false, ..Features::default() }),
        ("fileTransferAck", Features { file_transfer_ack: false, ..Features::default() }),
        ("agentStreamsMode", Features { agent_streams_mode: false, ..Features::default() }),
    ] {
        let daemon = StandInDaemon::start_with(Config { features, ..Config::default() }).await.unwrap();
        assert_eq!(open(&daemon, Limits::default()).await.unwrap_err(), Error::UnsupportedDaemon { missing });
        eventually(|| daemon.open_connections() == 0).await;
    }
}

#[tokio::test]
async fn a_request_and_its_answer() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/srv/a.txt", b"hello".to_vec());
    let connection = connect(&daemon).await;

    let reply = connection.request(|id| outbound::upload_request(id, "/srv/new.txt", "t-1")).await.unwrap();
    assert!(matches!(reply.upload_response().unwrap(), UploadResponse::Accepted { .. }));

    let reply = connection
        .request(|id| {
            outbound::download_request(&DownloadRequest { request_id: id, path: "/srv/a.txt", stream: Some(9), offset: None, length: None, if_unchanged: None })
        })
        .await
        .unwrap();
    let DownloadResponse::Accepted(accepted) = reply.download_response().unwrap() else { panic!("accepted") };
    assert_eq!((accepted.stream, accepted.total_bytes, accepted.offset, accepted.length), (9, 5, 0, 5));
}

#[tokio::test]
async fn an_rpc_error_is_that_requests_error_and_the_connection_goes_on() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::RpcError { request: Request::Upload, code: "handler_error".into(), message: "the disk is on fire".into() });
    let connection = connect(&daemon).await;

    let refused = connection.request(|id| outbound::upload_request(id, "/srv/a", "t-1")).await.unwrap_err();
    assert_eq!(refused, Error::Rpc { code: "handler_error".into(), message: "the disk is on fire".into() });
    let reply = connection.request(|id| outbound::upload_request(id, "/srv/a", "t-2")).await.unwrap();
    assert!(matches!(reply.upload_response().unwrap(), UploadResponse::Accepted { .. }));
}

// ---- transfers ----

#[tokio::test]
async fn an_upload_end_to_end_is_confirmed_by_the_daemon_with_the_bytes_it_got() {
    let daemon = StandInDaemon::start().await.unwrap();
    let connection = connect(&daemon).await;
    for (index, len) in [0, 1, CHUNK_BYTES, CHUNK_BYTES + 1, 1024 * 1024 + 5].into_iter().enumerate() {
        let data = content(len, 3);
        let path = format!("/srv/up-{index}");
        let complete = upload(&connection, &path, &format!("t-{index}"), &data).await;
        assert!(complete.ok, "{complete:?}");
        assert_eq!(complete.bytes_written, len as u64);
        assert_eq!(daemon.file(&path), Some(data));
    }
}

#[tokio::test]
async fn a_download_end_to_end_with_a_hold_far_smaller_than_the_file() {
    let daemon = StandInDaemon::start().await.unwrap();
    let data = content(3 * 1024 * 1024 + 123, 9);
    daemon.put_file("/srv/big", data.clone());
    // 64 KiB: about two chunks may wait to be written; the other 98 come as the consumer takes them.
    let limits = Limits { download_hold_bytes: 64 * 1024, ..Limits::default() };
    let connection = Arc::new(open(&daemon, limits).await.unwrap());

    let (accepted, bytes) = download(&connection, "/srv/big", None).await;
    assert_eq!(accepted.total_bytes, data.len() as u64);
    assert_eq!(bytes, data);
}

#[tokio::test]
async fn a_download_from_an_offset_continues_the_file() {
    let daemon = StandInDaemon::start().await.unwrap();
    let data = content(200_000, 1);
    daemon.put_file("/srv/f", data.clone());
    let connection = connect(&daemon).await;

    let (first, tail) = download(&connection, "/srv/f", Some(77_777)).await;
    assert_eq!((first.offset, first.length), (77_777, 200_000 - 77_777));
    assert_eq!(tail, data[77_777..]);
}

#[tokio::test]
async fn three_transfers_share_the_connection() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (a, b, c) = (content(2 * 1024 * 1024 + 7, 1), content(1024 * 1024 + 99, 2), content(1024 * 1024 + 1, 3));
    daemon.put_file("/srv/a", a.clone());
    daemon.put_file("/srv/b", b.clone());
    let limits = Limits { download_hold_bytes: 128 * 1024, ..Limits::default() };
    let connection = Arc::new(open(&daemon, limits).await.unwrap());

    let first: JoinHandle<Vec<u8>> = {
        let connection = Arc::clone(&connection);
        tokio::spawn(async move { download(&connection, "/srv/a", None).await.1 })
    };
    let second: JoinHandle<Vec<u8>> = {
        let connection = Arc::clone(&connection);
        tokio::spawn(async move { download(&connection, "/srv/b", None).await.1 })
    };
    let third = {
        let connection = Arc::clone(&connection);
        let c = c.clone();
        tokio::spawn(async move { upload(&connection, "/srv/c", "t-c", &c).await })
    };

    assert_eq!(first.await.unwrap(), a);
    assert_eq!(second.await.unwrap(), b);
    assert!(third.await.unwrap().ok);
    assert_eq!(daemon.file("/srv/c"), Some(c));
}

// ---- how it ends ----

#[tokio::test]
async fn a_chunk_above_16_mib_from_the_stand_in_ends_the_connection_with_protocol() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/srv/f", content(10, 1));
    daemon.script(Fault::DownloadStream(StreamFault::Oversized(MAX_MESSAGE_BYTES + 1)));
    let connection = connect(&daemon).await;
    let mut download = connection.download().unwrap();
    connection
        .request(|id| {
            outbound::download_request(&DownloadRequest {
                request_id: id,
                path: "/srv/f",
                stream: Some(download.stream()),
                offset: None,
                length: None,
                if_unchanged: None,
            })
        })
        .await
        .unwrap();

    assert!(matches!(download.next().await.unwrap().frame(), Frame::Begin(_)));
    assert!(matches!(download.next().await.unwrap_err(), Error::Protocol(_)));
    assert!(matches!(connection.ended().await, Error::Protocol(_)));
}

#[tokio::test]
async fn the_stand_in_closing_mid_download_ends_the_connection_with_its_code() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/srv/f", content(1024 * 1024, 1));
    daemon.script(Fault::Close { after: After::Bytes(Direction::ToClient, 100_000), code: 4001 });
    let connection = connect(&daemon).await;
    let mut download = connection.download().unwrap();
    connection
        .request(|id| {
            outbound::download_request(&DownloadRequest {
                request_id: id,
                path: "/srv/f",
                stream: Some(download.stream()),
                offset: None,
                length: None,
                if_unchanged: None,
            })
        })
        .await
        .unwrap();

    let mut received = 0;
    let reason = loop {
        match download.next().await {
            Ok(delivery) => {
                if let Frame::Chunk(data) = delivery.frame() {
                    received += data.len();
                }
            }
            Err(reason) => break reason,
        }
    };
    assert_eq!(reason, Error::Closed(Ended::Remote(Some(4001))));
    assert_eq!(received, 100_000, "the bytes the daemon cut off at are the bytes that arrived");
}

#[tokio::test]
async fn a_reset_is_a_failed_socket() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/srv/f", content(1024 * 1024, 1));
    daemon.script(Fault::Reset { after: After::Bytes(Direction::ToClient, 50_000) });
    let connection = connect(&daemon).await;
    let mut download = connection.download().unwrap();
    connection
        .request(|id| {
            outbound::download_request(&DownloadRequest {
                request_id: id,
                path: "/srv/f",
                stream: Some(download.stream()),
                offset: None,
                length: None,
                if_unchanged: None,
            })
        })
        .await
        .unwrap();
    let reason = loop {
        if let Err(reason) = download.next().await {
            break reason;
        }
    };
    assert_eq!(reason, Error::Closed(Ended::Socket));
}

#[tokio::test]
async fn close_is_seen_by_the_daemon_and_ends_the_waiters() {
    let daemon = StandInDaemon::start().await.unwrap();
    let connection = connect(&daemon).await;
    let upload = connection.expect_upload("t-1").unwrap();
    assert_eq!(daemon.open_connections(), 1);
    connection.close(Close::Normal).await;
    eventually(|| daemon.open_connections() == 0).await;
    assert_eq!(upload.complete().await.unwrap_err(), Error::Closed(Ended::Local));
}

// ---- time: the clock is frozen and moved by hand ----

#[tokio::test]
async fn server_info_that_never_comes_is_a_timeout_after_30_seconds() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::Silence { request: Asked::Hello });
    let frozen = Frozen::start();
    let opening = tokio::spawn({
        let url = daemon.url();
        async move {
            let socket = dial(&url, None, Duration::from_secs(5), MAX_MESSAGE_BYTES).await.unwrap();
            Connection::open(socket, &APP, Limits::default()).await
        }
    });
    // The timer starts once the daemon has the hello; the dial before it takes real time.
    eventually(|| !daemon.hellos().is_empty()).await;
    frozen.settle().await;
    frozen.advance(Duration::from_secs(29)).await;
    assert!(!opening.is_finished());
    frozen.advance(Duration::from_secs(1)).await;
    eventually(|| opening.is_finished()).await;
    assert_eq!(opening.await.unwrap().unwrap_err(), Error::Timeout);
}

#[tokio::test]
async fn an_answer_that_never_comes_fails_that_request_after_30_seconds_and_leaves_the_connection_open() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/srv/f", content(10, 1));
    daemon.script(Fault::Silence { request: Asked::Download });
    let frozen = Frozen::start();
    let connection = connect(&daemon).await;

    let asked = tokio::spawn({
        let connection = Arc::clone(&connection);
        async move {
            connection
                .request(|id| {
                    outbound::download_request(&DownloadRequest {
                        request_id: id,
                        path: "/srv/f",
                        stream: Some(1),
                        offset: None,
                        length: None,
                        if_unchanged: None,
                    })
                })
                .await
        }
    });
    frozen.settle().await;
    frozen.advance(Duration::from_secs(29)).await;
    assert!(!asked.is_finished(), "the answer is awaited for 30 seconds");
    frozen.advance(Duration::from_secs(1)).await;
    eventually(|| asked.is_finished()).await;
    assert_eq!(asked.await.unwrap().unwrap_err(), Error::Timeout);

    // The connection is open: the next request is answered.
    let reply = connection.request(|id| outbound::upload_request(id, "/srv/a", "t-1")).await.unwrap();
    assert!(matches!(reply.upload_response().unwrap(), UploadResponse::Accepted { .. }));
    assert_eq!(daemon.open_connections(), 1);
}

#[tokio::test]
async fn a_daemon_that_stops_answering_is_pinged_at_10_seconds_and_dropped_after_30() {
    let daemon = StandInDaemon::start().await.unwrap();
    // Reads, and sends nothing more, from the end of the handshake on.
    daemon.script(Fault::StopAnswering { after: After::TextFrames(Direction::FromClient, 1) });
    let frozen = Frozen::start();
    let connection = connect(&daemon).await;
    let ended = tokio::spawn({
        let connection = Arc::clone(&connection);
        async move { connection.ended().await }
    });
    frozen.settle().await;

    for seconds in [9, 1, 19] {
        frozen.advance(Duration::from_secs(seconds)).await;
        assert!(!ended.is_finished(), "open until 30 seconds, after {seconds} more");
    }
    frozen.advance(Duration::from_secs(1)).await;
    eventually(|| ended.is_finished()).await;
    assert_eq!(ended.await.unwrap(), Error::Closed(Ended::Silent));
}

#[tokio::test]
async fn the_ping_goes_out_at_10_seconds() {
    let daemon = StandInDaemon::start().await.unwrap();
    // The second text frame the daemon reads is the ping (the first was `hello`): it closes on it.
    daemon.script(Fault::Close { after: After::TextFrames(Direction::FromClient, 2), code: 4000 });
    let frozen = Frozen::start();
    let connection = connect(&daemon).await;
    let ended = tokio::spawn({
        let connection = Arc::clone(&connection);
        async move { connection.ended().await }
    });
    frozen.settle().await;

    frozen.advance(Duration::from_secs(9)).await;
    assert!(!ended.is_finished(), "nothing was sent in nine seconds");
    frozen.advance(Duration::from_secs(1)).await;
    eventually(|| ended.is_finished()).await;
    assert_eq!(ended.await.unwrap(), Error::Closed(Ended::Remote(Some(4000))));
}

#[tokio::test]
async fn a_daemon_that_keeps_sending_chunks_is_never_pinged() {
    // One 32 KiB chunk a second for 25 seconds. The stand-in closes on the third text frame it reads:
    // `hello`, the download request, and a ping if one were sent.
    let daemon = StandInDaemon::start_with(Config { chunk_delay: Duration::from_secs(1), ..Config::default() }).await.unwrap();
    let data = content(25 * CHUNK_BYTES, 5);
    daemon.put_file("/srv/slow", data.clone());
    daemon.script(Fault::Close { after: After::TextFrames(Direction::FromClient, 3), code: 4000 });
    let frozen = Frozen::start();
    let connection = connect(&daemon).await;

    let reading = tokio::spawn({
        let connection = Arc::clone(&connection);
        async move { download(&connection, "/srv/slow", None).await.1 }
    });
    frozen.settle().await;
    for _ in 0..30 {
        frozen.advance(Duration::from_secs(1)).await;
    }
    eventually(|| reading.is_finished()).await;
    assert_eq!(reading.await.unwrap(), data, "25 seconds of chunks, and no ping closed it");
}
