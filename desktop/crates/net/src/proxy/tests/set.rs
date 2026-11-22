//! The set of connections: the limit, close all, the snapshot.

use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use tokio_tungstenite::tungstenite::Message;

use super::support::{PATIENCE, Rig, Seen, dial_for, eventually, next_seen, page, quiet_daemon};
use crate::proxy::{Proxies, Reservation, State};
use crate::{DaemonSocket, ErrorCode};

#[tokio::test]
async fn a_fifth_connection_is_refused_with_limit_and_a_place_is_given_back_when_one_goes() {
    let (port, _seen) = quiet_daemon().await;
    let rig = Rig::new();
    let mut urls = Vec::new();
    for n in 0..4 {
        urls.push(rig.open(&format!("entry-{n}"), port).await);
    }
    let error = rig.proxies.reserve("entry-4").err().expect("a fifth is refused");
    assert_eq!(error.code, ErrorCode::Limit);
    assert_eq!(error.code.as_str(), "limit");
    assert!(error.message.contains('4'), "{}", error.message);
    // One of them ends: the place is free.
    let mut first = page(&urls[0]).await;
    first.close(None).await.unwrap();
    while first.next().await.is_some() {}
    eventually(|| rig.proxies.reserve("entry-5").is_ok()).await;
}

#[tokio::test]
async fn a_reservation_counts_before_the_dial_and_gives_its_place_back_when_dropped() {
    let rig = Rig::new();
    let places: Vec<_> = (0..4).map(|n| rig.proxies.reserve(format!("entry-{n}")).unwrap()).collect();
    assert_eq!(rig.proxies.reserve("entry-4").err().map(|e| e.code), Some(ErrorCode::Limit));
    let snapshot = rig.proxies.snapshot();
    assert!(snapshot.connections.iter().all(|c| c.state == State::Connecting));
    drop(places);
    assert!(rig.proxies.snapshot().connections.is_empty());
    assert!(rig.proxies.reserve("again").is_ok());
}

#[tokio::test]
async fn closing_all_leaves_none_and_each_daemon_heard_1001() {
    let (port, mut seen) = quiet_daemon().await;
    let rig = Rig::new();
    let mut pages = Vec::new();
    // Two connections with a page, two still waiting for theirs.
    for n in 0..4 {
        let url = rig.open(&format!("entry-{n}"), port).await;
        if n < 2 {
            let mut client = page(&url).await;
            client.send(Message::text("hello")).await.unwrap();
            pages.push(client);
        }
    }
    eventually(|| rig.proxies.snapshot().connections.iter().filter(|c| c.state == State::Open).count() == 2).await;
    rig.proxies.close_all().await;
    assert!(rig.proxies.snapshot().connections.is_empty(), "none is left");
    let mut closed = Vec::new();
    while closed.len() < 4 {
        // Each daemon reports the close frame it got, then that its socket ended.
        match next_seen(&mut seen).await {
            (n, Seen::Close(Some((1001, _)))) => closed.push(n),
            (_, Seen::End) => {}
            (n, other) => panic!("daemon {n}: {other:?}"),
        }
    }
    closed.sort_unstable();
    assert_eq!(closed, [0, 1, 2, 3], "each daemon saw it");
    // The pages' sockets were dropped: no close frame reaches them.
    for client in &mut pages {
        loop {
            match tokio::time::timeout(PATIENCE, client.next()).await.unwrap() {
                Some(Ok(Message::Close(_))) => panic!("the page was sent a close frame"),
                Some(Ok(_)) => {}
                Some(Err(_)) | None => break,
            }
        }
    }
    assert_eq!(rig.proxies.snapshot().last_error, None, "closing all is not a fault");
    // And the places are free again.
    assert!(rig.proxies.reserve("after").is_ok());
}

#[tokio::test]
async fn a_reservation_that_was_dialling_when_everything_was_closed_closes_as_it_opens() {
    let (port, mut seen) = quiet_daemon().await;
    let rig = Rig::new();
    let reservation = rig.proxies.reserve("entry").unwrap();
    let daemon = dial_for(port).await;
    // `close_all` does not wait for a dial in progress.
    tokio::time::timeout(Duration::from_secs(5), rig.proxies.close_all()).await.unwrap();
    let url = reservation.open(daemon, super::support::ORIGIN).await.unwrap();
    let (_, event) = next_seen(&mut seen).await;
    assert!(matches!(event, Seen::Close(Some((1001, _)))), "{event:?}");
    rig.empty().await;
    drop(url);
}

#[tokio::test]
async fn the_snapshot_follows_a_connection_from_connecting_to_open_and_counts_both_ways() {
    let (port, _seen) = super::support::echo_daemon().await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let snapshot = rig.proxies.snapshot();
    assert_eq!(snapshot.connections.len(), 1);
    assert_eq!((snapshot.connections[0].id.as_str(), snapshot.connections[0].state), ("entry", State::Connecting));
    assert_eq!(snapshot.last_error, None);
    let mut client = page(&url).await;
    client.send(Message::text("12345")).await.unwrap();
    client.send(Message::binary(vec![0u8; 10])).await.unwrap();
    for _ in 0..2 {
        client.next().await.unwrap().unwrap();
    }
    let entry = rig.proxies.snapshot().connections[0].clone();
    assert_eq!(entry.state, State::Open);
    assert_eq!((entry.frames_out, entry.bytes_out, entry.frames_in, entry.bytes_in), (2, 15, 2, 15));
}

/// The app keeps the set in Tauri's managed state and awaits both calls in async commands: both need to be `Send`.
#[allow(dead_code)]
fn what_tauri_needs(proxies: Proxies, reservation: Reservation, daemon: DaemonSocket) {
    fn managed<T: Send + Sync + 'static>(_: &T) {}
    fn send<T: Send>(_: T) {}
    managed(&proxies);
    send(proxies.close_all());
    send(reservation.open(daemon, "tauri://localhost"));
}
