//! A download is not read from the socket faster than its consumer takes it.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use pistudiodesktop_net::DaemonSocket;
use tokio::time::{sleep, timeout};
use tokio_tungstenite::tungstenite::Message;

use super::support::{APP, SILENT, begin, chunk, connect_with, pair_with_room, upload_complete};
use crate::Limits;
use crate::connection::{Connection, Delivery, Download, Frame};

const FRAME: usize = 16 * 1024;

/// What a chunk charges against the hold: its bytes, its two header bytes and 64 for the frame itself.
const COST: usize = FRAME + 2 + 64;

fn payload(index: usize) -> Vec<u8> {
    vec![u8::try_from(index % 251).unwrap(); FRAME]
}

fn limits(hold: usize) -> Limits {
    Limits { download_hold_bytes: hold, ..Limits::default() }
}

fn chunk_data(delivery: &Delivery) -> &[u8] {
    match delivery.frame() {
        Frame::Chunk(data) => data,
        other => panic!("expected a chunk, got {other:?}"),
    }
}

/// Waits up to a second of the paused clock for the next frame: `None` when the connection holds it back.
async fn next_within_a_second(download: &mut Download) -> Option<Delivery> {
    timeout(Duration::from_secs(1), download.next()).await.ok().map(|delivery| delivery.unwrap())
}

#[tokio::test(start_paused = true)]
async fn the_connection_reads_no_faster_than_the_consumer_takes_frames() {
    let limits = limits(64 * 1024);
    // A small pipe, so that what the connection does not read stops the daemon's writes.
    let (socket, mut peer) = pair_with_room(&limits, 64 * 1024).await;
    let (opened, _) = tokio::join!(Connection::open(DaemonSocket::new(socket), &APP, limits), peer.accept());
    let connection = opened.unwrap();
    let mut download = connection.download().unwrap();
    let stream = download.stream();

    let sent = Arc::new(AtomicUsize::new(0));
    let sender = {
        let sent = Arc::clone(&sent);
        tokio::spawn(async move {
            for index in 0..400 {
                peer.send(Message::binary(chunk(stream, &payload(index)))).await;
                sent.fetch_add(1, Ordering::SeqCst);
            }
        })
    };

    // The consumer takes nothing for a while: the daemon is stopped by the pipe long before 6.4 MiB are sent.
    sleep(Duration::from_secs(5)).await;
    let stopped_at = sent.load(Ordering::SeqCst);
    assert!(stopped_at < 60, "{stopped_at} of 400 frames were sent to a connection whose consumer took none");
    assert!(download.held() <= 64 * 1024);

    // The consumer catches up: every frame arrives, in order, intact.
    for index in 0..400 {
        let delivery = download.next().await.unwrap();
        assert_eq!(chunk_data(&delivery), payload(index), "frame {index}");
    }
    sender.await.unwrap();
    assert_eq!(sent.load(Ordering::SeqCst), 400);
}

#[tokio::test(start_paused = true)]
async fn what_the_consumer_has_not_released_never_exceeds_the_hold() {
    // A hold of 64 KiB takes three chunks of 16 KiB with what each costs besides its bytes.
    let (connection, daemon) = connect_with(limits(64 * 1024), SILENT).await;
    let mut download = connection.download().unwrap();
    let stream = download.stream();
    for index in 0..10 {
        daemon.send_binary(chunk(stream, &payload(index)));
    }

    let mut held = Vec::new();
    while let Some(delivery) = next_within_a_second(&mut download).await {
        held.push(delivery);
    }
    assert_eq!(held.len(), 64 * 1024 / COST, "as many as fit, and no more");
    assert!(download.held() <= 64 * 1024);

    // Releasing one lets the next in, and no more than one.
    held.remove(0);
    held.push(next_within_a_second(&mut download).await.expect("one more fits"));
    assert!(next_within_a_second(&mut download).await.is_none());
    assert_eq!(chunk_data(&held[0]), payload(1));
    assert_eq!(chunk_data(held.last().unwrap()), payload(3));
}

#[tokio::test(start_paused = true)]
async fn a_frame_larger_than_the_hold_is_taken_when_the_consumer_has_caught_up() {
    let (connection, daemon) = connect_with(limits(1024), SILENT).await;
    let mut download = connection.download().unwrap();
    let stream = download.stream();
    daemon.send_binary(chunk(stream, b"small"));
    daemon.send_binary(chunk(stream, &vec![9; 100 * 1024]));
    daemon.send_binary(chunk(stream, b"after"));

    let small = next_within_a_second(&mut download).await.expect("the first frame fits");
    assert!(next_within_a_second(&mut download).await.is_none(), "the big one waits for the small one to be released");
    drop(small);
    let big = next_within_a_second(&mut download).await.expect("the big frame takes the whole hold");
    assert_eq!(chunk_data(&big).len(), 100 * 1024);
    assert!(next_within_a_second(&mut download).await.is_none(), "and the next waits for it");
    drop(big);
    assert_eq!(chunk_data(&next_within_a_second(&mut download).await.unwrap()), b"after");
}

#[tokio::test(start_paused = true)]
async fn a_flood_of_empty_frames_is_bounded_as_well() {
    let (connection, daemon) = connect_with(limits(6400), SILENT).await;
    let mut download = connection.download().unwrap();
    let stream = download.stream();
    for _ in 0..1000 {
        daemon.send_binary(chunk(stream, b""));
    }
    let mut held = Vec::new();
    while let Some(delivery) = next_within_a_second(&mut download).await {
        held.push(delivery);
    }
    assert!((90..=100).contains(&held.len()), "{} empty frames queued of the 1000 sent", held.len());
}

#[tokio::test(start_paused = true)]
async fn a_slow_download_holds_the_other_transfers_back_and_they_go_on_when_it_catches_up() {
    // A hold of 100 bytes: the `Begin` takes all of it, so the chunk behind it waits for it to be released.
    let (connection, daemon) = connect_with(limits(100), SILENT).await;
    let mut slow = connection.download().unwrap();
    let stream = slow.stream();
    let upload = connection.expect_upload("t-1").unwrap();
    daemon.send_binary(begin(stream, 1));
    daemon.send_binary(chunk(stream, b"x"));
    // The confirmation of another transfer is behind the frame that waits.
    daemon.send_json(&upload_complete("t-1", 1, true, 7));

    let first = next_within_a_second(&mut slow).await.expect("the first frame fits");
    let confirmed = tokio::spawn(upload.complete());
    sleep(Duration::from_secs(60)).await;
    assert!(!confirmed.is_finished(), "the connection is not reading while the download's frame waits");

    drop(first);
    assert_eq!(confirmed.await.unwrap().unwrap().bytes_written, 7);
    assert_eq!(chunk_data(&slow.next().await.unwrap()), b"x");
}

#[tokio::test(start_paused = true)]
async fn dropping_the_download_frees_a_reader_that_waited_for_it() {
    // A hold of 100 bytes: the `Begin` takes all of it, so the chunk behind it waits for it to be released.
    let (connection, daemon) = connect_with(limits(100), SILENT).await;
    let mut download = connection.download().unwrap();
    let stream = download.stream();
    let upload = connection.expect_upload("t-1").unwrap();
    daemon.send_binary(begin(stream, 1));
    daemon.send_binary(chunk(stream, b"x"));
    daemon.send_json(&upload_complete("t-1", 1, true, 3));

    let first = next_within_a_second(&mut download).await.unwrap();
    let confirmed = tokio::spawn(upload.complete());
    sleep(Duration::from_secs(60)).await;
    assert!(!confirmed.is_finished());

    // The consumer gives up, still holding the first frame: the reader no longer waits for it.
    drop(download);
    assert_eq!(confirmed.await.unwrap().unwrap().bytes_written, 3);
    drop(first);
    assert!(timeout(Duration::ZERO, connection.ended()).await.is_err(), "the connection is open");
}

#[tokio::test(start_paused = true)]
async fn each_download_has_a_hold_of_its_own_and_the_reader_waits_for_whichever_is_full() {
    // A hold of 100 bytes: a one-byte chunk costs 67 of it.
    let (connection, daemon) = connect_with(limits(100), SILENT).await;
    let mut first = connection.download().unwrap();
    let mut second = connection.download().unwrap();
    let (a, b) = (first.stream(), second.stream());
    daemon.send_binary(chunk(a, b"1"));
    daemon.send_binary(chunk(b, b"2"));
    daemon.send_binary(chunk(a, b"3"));
    daemon.send_binary(chunk(b, b"4"));

    // The first download's second frame does not fit beside its first; the second download's first frame fits.
    let one = next_within_a_second(&mut first).await.unwrap();
    let two = next_within_a_second(&mut second).await.unwrap();
    assert_eq!((chunk_data(&one), chunk_data(&two)), (&b"1"[..], &b"2"[..]));
    assert!(next_within_a_second(&mut first).await.is_none());
    // The frame behind it, the second download's, waits too: one reader reads in the daemon's order.
    assert!(next_within_a_second(&mut second).await.is_none());

    drop(one);
    assert_eq!(chunk_data(&next_within_a_second(&mut first).await.unwrap()), b"3");
    // The second download's hold still has its first frame in it, so its second waits as the first's did.
    assert!(next_within_a_second(&mut second).await.is_none());
    drop(two);
    assert_eq!(chunk_data(&next_within_a_second(&mut second).await.unwrap()), b"4");
}
