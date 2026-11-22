//! A connection that ends tells every waiter, once, why.

use std::sync::Arc;
use std::time::Duration;

use tokio::time::{sleep, timeout};

use super::support::{ANSWERING, Daemon, begin, chunk, connect};
use crate::connection::{Connection, Download, Frame, UploadWait};
use crate::error::{Ended, Error};
use crate::wire::inbound::{Reply, UploadComplete};
use crate::wire::outbound;

/// Everything that can wait on a connection: a request, an upload's confirmation, a download.
struct Waiters {
    request: tokio::task::JoinHandle<Result<Reply, Error>>,
    upload: tokio::task::JoinHandle<Result<UploadComplete, Error>>,
    download: Download,
}

async fn wait(connection: &Arc<Connection>, daemon: &mut Daemon) -> Waiters {
    let request = {
        let connection = Arc::clone(connection);
        tokio::spawn(async move { connection.request(|id| outbound::upload_request(id, "/tmp/a", "t-1")).await })
    };
    daemon.request().await;
    let upload: UploadWait = connection.expect_upload("t-1").unwrap();
    let upload = tokio::spawn(upload.complete());
    Waiters { request, upload, download: connection.download().unwrap() }
}

#[tokio::test(start_paused = true)]
async fn when_the_daemon_closes_every_waiter_gets_its_code_and_a_download_gets_its_frames_first() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let mut waiters = wait(&connection, &mut daemon).await;
    let stream = waiters.download.stream();

    daemon.send_binary(begin(stream, 2));
    daemon.send_binary(chunk(stream, b"ab"));
    daemon.close(1011);

    let ended = Error::Closed(Ended::Remote(Some(1011)));
    assert_eq!(connection.ended().await, ended);
    assert_eq!(waiters.request.await.unwrap().unwrap_err(), ended);
    assert_eq!(waiters.upload.await.unwrap().unwrap_err(), ended);
    // What was queued before the end is read first; then the reason, and again if it is asked again.
    assert!(matches!(waiters.download.next().await.unwrap().frame(), Frame::Begin(_)));
    assert!(matches!(waiters.download.next().await.unwrap().frame(), Frame::Chunk(_)));
    assert_eq!(waiters.download.next().await.unwrap_err(), ended);
    assert_eq!(waiters.download.next().await.unwrap_err(), ended);
}

#[tokio::test(start_paused = true)]
async fn the_first_reason_stands() {
    let (connection, daemon) = connect(ANSWERING).await;
    daemon.close(1001);
    let reason = connection.ended().await;
    assert_eq!(reason, Error::Closed(Ended::Remote(Some(1001))));

    // The pipe ends after the close: that is not a second reason.
    daemon.vanish();
    sleep(Duration::from_secs(60)).await;
    assert_eq!(connection.ended().await, reason);
}

#[tokio::test(start_paused = true)]
async fn a_close_frame_without_a_code_is_the_daemon_closing() {
    let (connection, daemon) = connect(ANSWERING).await;
    daemon.send(tokio_tungstenite::tungstenite::Message::Close(None));
    assert_eq!(connection.ended().await, Error::Closed(Ended::Remote(None)));
}

#[tokio::test(start_paused = true)]
async fn a_pipe_that_ends_with_no_close_frame_is_a_failed_socket() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let waiters = wait(&connection, &mut daemon).await;
    daemon.vanish();
    let failed = Error::Closed(Ended::Socket);
    assert_eq!(connection.ended().await, failed);
    assert_eq!(waiters.request.await.unwrap().unwrap_err(), failed);
    assert_eq!(waiters.upload.await.unwrap().unwrap_err(), failed);
}

#[tokio::test(start_paused = true)]
async fn after_the_end_every_call_fails_with_the_same_reason() {
    let (connection, daemon) = connect(ANSWERING).await;
    daemon.close(1012);
    let ended = connection.ended().await;
    assert_eq!(ended, Error::Closed(Ended::Remote(Some(1012))));

    assert_eq!(connection.request(|id| outbound::upload_request(id, "/tmp/a", "t-2")).await.unwrap_err(), ended);
    assert_eq!(connection.send_text("{}".into()).await.unwrap_err(), ended);
    assert_eq!(connection.send_binary(vec![0x12, 0, 1]).await.unwrap_err(), ended);
    assert_eq!(connection.download().unwrap_err(), ended);
    assert_eq!(connection.expect_upload("t-3").unwrap_err(), ended);
}

#[tokio::test(start_paused = true)]
async fn a_frame_that_breaks_the_protocol_ends_it_with_that_error_for_every_waiter() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let mut waiters = wait(&connection, &mut daemon).await;
    daemon.send(tokio_tungstenite::tungstenite::Message::text("this is not JSON"));

    let Error::Protocol(text) = connection.ended().await else { panic!("a protocol error") };
    assert!(!text.contains("this is not JSON"), "the daemon's words are not repeated: {text}");
    let ended = Error::Protocol(text);
    assert_eq!(waiters.request.await.unwrap().unwrap_err(), ended);
    assert_eq!(waiters.upload.await.unwrap().unwrap_err(), ended);
    assert_eq!(waiters.download.next().await.unwrap_err(), ended);

    // The daemon was told: the last thing the connection sent is a close frame, 1002.
    let mut code = None;
    while let Some(seen) = daemon.next().await {
        if let tokio_tungstenite::tungstenite::Message::Close(Some(frame)) = seen.message {
            code = Some(u16::from(frame.code));
        }
    }
    assert_eq!(code, Some(1002));
    assert!(timeout(Duration::ZERO, connection.ended()).await.is_ok());
}
