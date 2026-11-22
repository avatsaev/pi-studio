//! Closing the connection: 1000 and 1001, within the close wait, and what a drop does.

use std::time::Duration;

use pistudiodesktop_net::DaemonSocket;
use tokio::time::{Instant, timeout};
use tokio_tungstenite::tungstenite::Message;

use super::support::{ANSWERING, APP, Daemon, SILENT, assert_about, connect, pair};
use crate::Limits;
use crate::connection::{Close, Connection};
use crate::error::{Ended, Error};
use crate::wire::outbound;

/// The code of the first close frame the daemon reads, skipping the frames before it.
async fn close_code(daemon: &mut Daemon) -> Option<u16> {
    while let Some(seen) = daemon.next().await {
        if let Message::Close(frame) = seen.message {
            return frame.map(|frame| u16::from(frame.code));
        }
    }
    None
}

#[tokio::test(start_paused = true)]
async fn close_sends_1000_and_is_over_when_the_daemon_answers() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let upload = connection.expect_upload("t-1").unwrap();
    let mut download = connection.download().unwrap();
    let asked = {
        let connection = connection.clone();
        tokio::spawn(async move { connection.request(|id| outbound::upload_request(id, "/tmp/a", "t-1")).await })
    };
    daemon.request().await;

    let start = Instant::now();
    connection.close(Close::Normal).await;
    assert!(start.elapsed() < Duration::from_millis(5), "the daemon answered at once, so nothing waited for the close wait");

    assert_eq!(close_code(&mut daemon).await, Some(1000));
    let closed = Error::Closed(Ended::Local);
    assert_eq!(connection.ended().await, closed);
    assert_eq!(upload.complete().await.unwrap_err(), closed);
    assert_eq!(download.next().await.unwrap_err(), closed);
    assert_eq!(asked.await.unwrap().unwrap_err(), closed);

    // Nothing new is taken.
    assert_eq!(connection.request(|id| outbound::upload_request(id, "/tmp/a", "t-2")).await.unwrap_err(), closed);
    assert_eq!(connection.send_text("{}".into()).await.unwrap_err(), closed);
    assert_eq!(connection.send_binary(vec![0x11, 0]).await.unwrap_err(), closed);
    assert_eq!(connection.download().unwrap_err(), closed);
    assert_eq!(connection.expect_upload("t-3").unwrap_err(), closed);
}

#[tokio::test(start_paused = true)]
async fn going_away_is_1001() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    connection.close(Close::GoingAway).await;
    assert_eq!(close_code(&mut daemon).await, Some(1001));
    assert_eq!(connection.ended().await, Error::Closed(Ended::Local));
}

#[tokio::test(start_paused = true)]
async fn a_daemon_that_does_not_answer_the_close_is_given_the_close_wait_and_no_more() {
    let limits = Limits::default();
    let (socket, mut peer) = pair(&limits).await;
    let (opened, _) = tokio::join!(Connection::open(DaemonSocket::new(socket), &APP, limits), peer.accept());
    let connection = opened.unwrap();
    let upload = connection.expect_upload("t-1").unwrap();

    // The daemon's end is never read, so the close is never answered.
    let start = Instant::now();
    connection.close(Close::Normal).await;
    assert_about(start.elapsed(), Duration::from_secs(2));
    assert_eq!(upload.complete().await.unwrap_err(), Error::Closed(Ended::Local));
    assert_eq!(connection.ended().await, Error::Closed(Ended::Local));

    // The close frame went out all the same.
    match peer.next().await {
        Some(Message::Close(Some(frame))) => assert_eq!(u16::from(frame.code), 1000),
        other => panic!("expected the close frame, got {other:?}"),
    }
}

#[tokio::test(start_paused = true)]
async fn dropping_the_connection_sends_1001_and_ends_what_waits() {
    let (connection, mut daemon) = connect(SILENT).await;
    let upload = connection.expect_upload("t-1").unwrap();
    let mut download = connection.download().unwrap();
    drop(connection);

    assert_eq!(close_code(&mut daemon).await, Some(1001));
    assert_eq!(upload.complete().await.unwrap_err(), Error::Closed(Ended::Local));
    assert_eq!(download.next().await.unwrap_err(), Error::Closed(Ended::Local));
}

#[tokio::test(start_paused = true)]
async fn closing_twice_or_after_the_end_does_nothing() {
    let (connection, daemon) = connect(ANSWERING).await;
    connection.close(Close::Normal).await;
    connection.close(Close::GoingAway).await;
    assert_eq!(connection.ended().await, Error::Closed(Ended::Local));

    let (other, other_daemon) = connect(ANSWERING).await;
    other_daemon.close(1011);
    let reason = other.ended().await;
    let start = Instant::now();
    other.close(Close::Normal).await;
    assert!(start.elapsed() < Duration::from_millis(5), "a connection that ended is not waited for");
    assert_eq!(other.ended().await, reason, "the reason does not change");
    drop(daemon);
}

#[tokio::test(start_paused = true)]
async fn two_closes_at_once_end_it_once() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    let first = {
        let connection = connection.clone();
        tokio::spawn(async move { connection.close(Close::Normal).await })
    };
    let second = {
        let connection = connection.clone();
        tokio::spawn(async move { connection.close(Close::GoingAway).await })
    };
    first.await.unwrap();
    second.await.unwrap();
    assert_eq!(connection.ended().await, Error::Closed(Ended::Local));
    // One close frame, from whichever began it.
    let mut codes = Vec::new();
    while let Some(seen) = daemon.next().await {
        if let Message::Close(Some(frame)) = seen.message {
            codes.push(u16::from(frame.code));
        }
    }
    assert_eq!(codes.len(), 1, "{codes:?}");
    assert!(timeout(Duration::ZERO, connection.ended()).await.is_ok());
}
