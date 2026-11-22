//! Liveness: the ping after 10 seconds of silence, the drop after 30, and the answer to the daemon's ping.

use std::time::Duration;

use pistudiodesktop_net::DaemonSocket;
use serde_json::json;
use tokio::time::{sleep, timeout};
use tokio_tungstenite::tungstenite::Message;

use super::support::{ANSWERING, APP, SILENT, assert_about, begin, chunk, connect, connect_with, end, pair_with_room};
use crate::Limits;
use crate::connection::{Connection, Frame};
use crate::error::{Ended, Error};

#[tokio::test(start_paused = true)]
async fn a_daemon_that_stops_answering_is_pinged_at_10_seconds_and_dropped_at_30() {
    let (connection, mut daemon) = connect(SILENT).await;

    let ping = daemon.next_of("ping").await;
    assert_about(ping.at, Duration::from_secs(10));
    let frame = ping.json();
    assert!(frame["requestId"].as_str().is_some_and(|id| !id.is_empty()), "{frame}");
    assert!(frame["clientSentAt"].is_u64(), "{frame}");

    let reason = connection.ended().await;
    assert_eq!(reason, Error::Closed(Ended::Silent));
    assert_about(daemon.start.elapsed(), Duration::from_secs(30));

    // One ping only: after it nothing but the close the writer sends as it stops.
    while let Some(seen) = daemon.next().await {
        assert_eq!(seen.kind(), "close", "{seen:?}");
    }
}

#[tokio::test(start_paused = true)]
async fn an_answered_ping_keeps_the_connection_open_and_the_next_comes_10_seconds_later() {
    let (connection, mut daemon) = connect(ANSWERING).await;
    sleep(Duration::from_secs(305)).await;
    assert!(timeout(Duration::ZERO, connection.ended()).await.is_err(), "the connection is open after five minutes");

    let pings: Vec<Duration> = daemon.drain().iter().filter(|seen| seen.kind() == "ping").map(|seen| seen.at).collect();
    assert_eq!(pings.len(), 30, "{pings:?}");
    assert_about(pings[0], Duration::from_secs(10));
    for pair in pings.windows(2) {
        assert_about(pair[1] - pair[0], Duration::from_secs(10));
    }
}

#[tokio::test(start_paused = true)]
async fn a_daemon_that_keeps_sending_chunks_is_never_pinged() {
    let (connection, mut daemon) = connect(SILENT).await;
    let mut download = connection.download().unwrap();
    let stream = download.stream();
    let consumer = tokio::spawn(async move {
        let mut frames = 0;
        loop {
            let delivery = download.next().await.unwrap();
            frames += 1;
            if matches!(delivery.frame(), Frame::End { .. }) {
                return frames;
            }
        }
    });

    daemon.send_binary(begin(stream, 24));
    for _ in 0..24 {
        sleep(Duration::from_secs(5)).await;
        daemon.send_binary(chunk(stream, b"x"));
    }
    daemon.send_binary(end(stream));
    assert_eq!(consumer.await.unwrap(), 26);

    assert!(daemon.drain().iter().all(|seen| seen.kind() != "ping"), "two minutes of chunks, five seconds apart, and no ping");
    assert!(timeout(Duration::ZERO, connection.ended()).await.is_err());
}

#[tokio::test(start_paused = true)]
async fn any_frame_from_the_daemon_is_a_sign_of_life() {
    let (_connection, mut daemon) = connect(SILENT).await;
    sleep(Duration::from_secs(9)).await;
    daemon.send_json(&json!({ "type": "agent_status", "agentId": "a" }));
    let ping = daemon.next_of("ping").await;
    assert_about(ping.at, Duration::from_secs(19));

    // A binary frame of another protocol counts as well.
    sleep(Duration::from_secs(9)).await;
    daemon.send_binary(vec![0x01, 0x00, 0x00]);
    let ping = daemon.next_of("ping").await;
    assert_about(ping.at, Duration::from_secs(38));
}

#[tokio::test(start_paused = true)]
async fn the_daemons_ping_is_answered_with_a_pong_that_repeats_its_id_and_time() {
    let (_connection, mut daemon) = connect(SILENT).await;
    daemon.send_json(&json!({ "type": "ping", "requestId": "abc", "clientSentAt": 1234 }));
    let pong = daemon.next_of("pong").await.json();
    assert_eq!(pong["requestId"], "abc");
    assert_eq!(pong["clientSentAt"], 1234);
    assert!(pong["serverReceivedAt"].is_u64() && pong["serverSentAt"].is_u64(), "{pong}");

    daemon.send_json(&json!({ "type": "ping", "requestId": "no-time" }));
    let pong = daemon.next_of("pong").await.json();
    assert_eq!(pong["requestId"], "no-time");
    assert!(pong.get("clientSentAt").is_none(), "{pong}");
}

#[tokio::test(start_paused = true)]
async fn time_a_frame_waits_for_its_consumer_is_not_silence() {
    // A hold of 100 bytes: every frame costs all of it, so the second waits for the first to be released.
    let limits = Limits { download_hold_bytes: 100, ..Limits::default() };
    let (connection, mut daemon) = connect_with(limits, SILENT).await;
    let mut download = connection.download().unwrap();
    let stream = download.stream();
    daemon.send_binary(begin(stream, 50));
    daemon.send_binary(chunk(stream, &[7; 50]));

    let first = download.next().await.unwrap();
    // The consumer is slow: five minutes, with the daemon's second frame waiting in the socket.
    sleep(Duration::from_secs(300)).await;
    assert!(timeout(Duration::ZERO, connection.ended()).await.is_err(), "the connection is not dropped while it waits for its consumer");
    assert!(daemon.drain().iter().all(|seen| seen.kind() != "ping"), "no ping either: the connection is not reading");

    drop(first);
    let second = download.next().await.unwrap();
    assert!(matches!(second.frame(), Frame::Chunk(data) if **data == [7; 50]));
    // The silence starts again when the connection reads on.
    let ping = daemon.next_of("ping").await;
    assert_about(ping.at, Duration::from_secs(310));
}

#[tokio::test(start_paused = true)]
async fn a_write_that_does_not_finish_in_30_seconds_ends_the_connection() {
    let limits = Limits::default();
    // A pipe that holds 1 KiB, and a daemon that never reads but keeps talking: only the write is stuck.
    let (socket, mut peer) = pair_with_room(&limits, 1024).await;
    let (opened, _) = tokio::join!(Connection::open(DaemonSocket::new(socket), &APP, limits), peer.accept());
    let connection = opened.unwrap();
    tokio::spawn(async move {
        loop {
            sleep(Duration::from_secs(5)).await;
            if !peer.try_send(Message::text(json!({ "type": "agent_status" }).to_string())).await {
                return;
            }
        }
    });

    let start = tokio::time::Instant::now();
    let written = connection.send_binary(vec![0; 64 * 1024]).await;
    assert_eq!(written.unwrap_err(), Error::Closed(Ended::Silent));
    assert_about(start.elapsed(), Duration::from_secs(30));
    assert_eq!(connection.ended().await, Error::Closed(Ended::Silent));
}
