//! Messages through the pump: as they are, in order, bounded in what Rust holds.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use tokio::sync::oneshot;
use tokio_tungstenite::tungstenite::Message;

use super::support::{Digest, Mix, PATIENCE, Rig, Seen, daemon, echo_daemon, eventually, next_seen, page, raw_masked_text, raw_unmasked_text, write_raw};
use crate::proxy::{EndCode, State};
use crate::{Limits, dial_over};

#[tokio::test]
async fn text_and_binary_are_echoed_as_they_are() {
    let (port, _seen) = echo_daemon().await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;
    let binary: Vec<u8> = (0..=255u8).cycle().take(70_000).collect();
    let messages =
        [Message::text("héllo ✓ 🦀"), Message::binary(binary), Message::text(""), Message::binary(Vec::<u8>::new()), Message::text("{\"type\":\"ping\"}")];
    for message in &messages {
        client.send(message.clone()).await.unwrap();
        assert_eq!(&client.next().await.unwrap().unwrap(), message);
    }
    let snapshot = rig.proxies.snapshot();
    let entry = &snapshot.connections[0];
    assert_eq!((entry.id.as_str(), entry.state), ("entry", State::Open));
    assert_eq!((entry.frames_in, entry.frames_out), (5, 5));
    assert_eq!(entry.bytes_in, entry.bytes_out);
    assert_eq!(entry.bytes_in, messages.iter().map(|m| m.len() as u64).sum::<u64>());
}

/// 100,000 mixed messages each way, at the same time: the daemon's stream and the page's, each in
/// order and whole (equal digests at both ends).
#[tokio::test]
async fn a_hundred_thousand_mixed_messages_arrive_in_order_with_equal_hashes_in_both_directions() {
    const COUNT: usize = 100_000;
    const DAEMON_SEED: u64 = 7;
    const PAGE_SEED: u64 = 11;
    let (report, reported) = oneshot::channel();
    let report = Arc::new(std::sync::Mutex::new(Some(report)));
    let port = daemon(move |_, socket| {
        let report = report.clone();
        async move {
            let (mut sink, mut stream) = socket.split();
            let sending = async {
                let (mut mix, mut digest) = (Mix::new(DAEMON_SEED), Digest::new());
                for _ in 0..COUNT {
                    let message = mix.next();
                    digest.add(&message);
                    sink.send(message).await.unwrap();
                }
                digest.value()
            };
            let receiving = async {
                let mut digest = Digest::new();
                for _ in 0..COUNT {
                    digest.add(&stream.next().await.unwrap().unwrap());
                }
                digest.value()
            };
            let both = tokio::join!(sending, receiving);
            if let Some(report) = report.lock().unwrap().take() {
                let _ = report.send(both);
            }
            // Keep the socket until the test is done with it.
            let _ = stream.next().await;
        }
    })
    .await;

    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let (mut sink, mut stream) = page(&url).await.split();
    let sending = async {
        let (mut mix, mut digest) = (Mix::new(PAGE_SEED), Digest::new());
        for _ in 0..COUNT {
            let message = mix.next();
            digest.add(&message);
            sink.send(message).await.unwrap();
        }
        digest.value()
    };
    let receiving = async {
        let mut digest = Digest::new();
        for _ in 0..COUNT {
            digest.add(&stream.next().await.unwrap().unwrap());
        }
        digest.value()
    };
    let (page_sent, page_received) = tokio::time::timeout(Duration::from_secs(120), async { tokio::join!(sending, receiving) }).await.unwrap();
    let (daemon_sent, daemon_received) = reported.await.unwrap();
    assert_eq!(page_received, daemon_sent, "daemon to page");
    assert_eq!(daemon_received, page_sent, "page to daemon");

    let snapshot = rig.proxies.snapshot();
    let entry = &snapshot.connections[0];
    assert_eq!((entry.frames_in, entry.frames_out), (COUNT as u64, COUNT as u64));
    let batch_and_a_message = (Limits::default().flush_bytes + 100_000) as u64;
    assert!(entry.peak_held_in <= batch_and_a_message && entry.peak_held_out <= batch_and_a_message, "held {} and {}", entry.peak_held_in, entry.peak_held_out);
}

#[tokio::test]
async fn each_leg_answers_its_own_pings_and_none_is_passed_on() {
    let (port, mut seen) = echo_daemon().await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;

    // The page pings: Rust answers, the daemon never hears it.
    client.send(Message::Ping(b"are you there".to_vec().into())).await.unwrap();
    client.send(Message::text("marker")).await.unwrap();
    let mut answered = false;
    loop {
        match client.next().await.unwrap().unwrap() {
            Message::Pong(data) => {
                assert_eq!(data.as_ref(), b"are you there");
                answered = true;
            }
            Message::Text(text) => {
                assert_eq!(text.as_str(), "marker");
                break;
            }
            other => panic!("unexpected {other:?}"),
        }
    }
    assert!(answered, "Rust answered the page's ping");
    assert_eq!(next_seen(&mut seen).await, Seen::Data(6), "the daemon's first news is the message after the ping");
}

#[tokio::test]
async fn a_daemons_ping_is_answered_by_rust_and_does_not_reach_the_page() {
    let (pongs, mut pong_rx) = tokio::sync::mpsc::unbounded_channel();
    let port = daemon(move |_, mut socket| {
        let pongs = pongs.clone();
        async move {
            socket.send(Message::Ping(b"daemon ping".to_vec().into())).await.unwrap();
            socket.send(Message::text("after the ping")).await.unwrap();
            while let Some(Ok(message)) = socket.next().await {
                if let Message::Pong(data) = message {
                    let _ = pongs.send(data.to_vec());
                }
            }
        }
    })
    .await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;
    // The first message the page sees is the text: neither the ping nor a pong came through.
    assert_eq!(client.next().await.unwrap().unwrap(), Message::text("after the ping"));
    let pong = tokio::time::timeout(PATIENCE, pong_rx.recv()).await.unwrap().unwrap();
    assert_eq!(pong, b"daemon ping", "Rust's leg answered the daemon");
    assert_eq!(rig.proxies.snapshot().connections[0].frames_in, 1, "pings are not counted");
}

fn flood_frame(index: u64, size: usize) -> Message {
    let mut payload = vec![0u8; size];
    payload[..8].copy_from_slice(&index.to_be_bytes());
    Message::binary(payload)
}

#[tokio::test]
async fn a_client_that_does_not_read_stalls_a_flood_and_reading_again_loses_nothing() {
    const SIZE: usize = 64 * 1024;
    const FRAMES: u64 = 2048; // 128 MiB: more than the socket buffers of both hops can take
    let sent = Arc::new(AtomicU64::new(0));
    let counted = sent.clone();
    let port = daemon(move |_, socket| {
        let counted = counted.clone();
        async move {
            let (mut sink, mut stream) = socket.split();
            // Starts on the page's first message, as the daemon starts on its `hello`.
            let _ = stream.next().await;
            for index in 0..FRAMES {
                if sink.send(flood_frame(index, SIZE)).await.is_err() {
                    return;
                }
                counted.fetch_add(SIZE as u64, Relaxed);
            }
            let _ = stream.next().await;
        }
    })
    .await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;
    client.send(Message::text("go")).await.unwrap();

    // The page reads nothing. The daemon's send stalls well short of the whole flood.
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let first = sent.load(Relaxed);
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(sent.load(Relaxed), first, "the daemon's sending stopped");
    assert!(first < FRAMES * SIZE as u64 / 2, "{first} of {} bytes were sent into a page that reads nothing", FRAMES * SIZE as u64);
    let stalled = rig.proxies.snapshot().connections[0].clone();
    let bound = (Limits::default().flush_bytes + SIZE) as u64;
    assert!(stalled.peak_held_in <= bound, "Rust held {} bytes (bound {bound})", stalled.peak_held_in);

    // The page reads again: everything arrives, in order.
    for index in 0..FRAMES {
        let Message::Binary(bytes) = tokio::time::timeout(PATIENCE, client.next()).await.unwrap().unwrap().unwrap() else { panic!("not binary") };
        assert_eq!(bytes.len(), SIZE);
        assert_eq!(bytes[..8], index.to_be_bytes(), "frame {index} is the one that was sent");
    }
    assert_eq!(sent.load(Relaxed), FRAMES * SIZE as u64);
    let done = rig.proxies.snapshot().connections[0].clone();
    assert_eq!((done.frames_in, done.bytes_in), (FRAMES, FRAMES * SIZE as u64));
    assert!(done.peak_held_in <= bound, "Rust held {} bytes (bound {bound})", done.peak_held_in);
}

#[tokio::test]
async fn a_batch_is_what_the_limits_say() {
    // Tiny limits make the bound visible: two messages of a batch, and the one that ended it.
    const SIZE: usize = 1000;
    let limits = Limits { flush_bytes: 2500, flush_messages: 64, ..Limits::default() };
    let port = daemon(move |_, socket| async move {
        let (mut sink, mut stream) = socket.split();
        for index in 0..500 {
            sink.feed(flood_frame(index, SIZE)).await.unwrap();
        }
        sink.flush().await.unwrap();
        let _ = stream.next().await;
    })
    .await;
    let rig = Rig::with(limits);
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;
    for _ in 0..500 {
        client.next().await.unwrap().unwrap();
    }
    let entry = rig.proxies.snapshot().connections[0].clone();
    assert_eq!(entry.frames_in, 500);
    assert!(entry.peak_held_in <= 2500 + SIZE as u64, "{}", entry.peak_held_in);
    assert!(entry.peak_held_in >= SIZE as u64, "something was held: {}", entry.peak_held_in);
}

#[tokio::test]
async fn text_that_is_not_utf8_from_the_page_ends_the_connection_and_the_daemon_hears_1001() {
    let (port, mut seen) = echo_daemon().await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;
    client.send(Message::text("fine")).await.unwrap();
    assert_eq!(next_seen(&mut seen).await, Seen::Data(4));
    write_raw(&mut client, &raw_masked_text(&[0x66, 0xff, 0xfe, 0x67])).await;
    assert!(matches!(next_seen(&mut seen).await, Seen::Close(Some((1001, _)))));
    rig.empty().await;
    assert_eq!(rig.proxies.snapshot().last_error.map(|e| e.code), Some(EndCode::PageRefused));
}

#[tokio::test]
async fn text_that_is_not_utf8_from_the_daemon_drops_the_page_without_a_close_frame() {
    let port = daemon(|_, mut socket| async move {
        socket.send(Message::text("fine")).await.unwrap();
        write_raw(&mut socket, &raw_unmasked_text(&[0x66, 0xff, 0xfe, 0x67])).await;
        let _ = socket.next().await;
    })
    .await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;
    assert_eq!(client.next().await.unwrap().unwrap(), Message::text("fine"));
    loop {
        match tokio::time::timeout(PATIENCE, client.next()).await.unwrap() {
            Some(Ok(Message::Close(_))) => panic!("the page was sent a close frame"),
            Some(Ok(_)) => {}
            Some(Err(_)) | None => break,
        }
    }
    rig.empty().await;
    assert_eq!(rig.proxies.snapshot().last_error.map(|e| e.code), Some(EndCode::UpstreamLost));
}

#[tokio::test]
async fn a_frame_cut_in_the_middle_by_the_page_ends_the_connection_cleanly() {
    let (port, mut seen) = echo_daemon().await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;
    // The header of a 100-byte frame and ten bytes of it, then the socket goes.
    let mut partial = raw_masked_text(&[b'x'; 100]);
    partial[1] = 0x80 | 100;
    partial.truncate(6 + 10);
    write_raw(&mut client, &partial).await;
    drop(client);
    assert!(matches!(next_seen(&mut seen).await, Seen::Close(Some((1001, _)))));
    rig.empty().await;
    assert_eq!(rig.proxies.snapshot().last_error, None, "the page left, which is not a fault of the app");
    eventually(|| rig.log().iter().any(|line| line.contains("ended without a close frame"))).await;
}

#[tokio::test]
async fn shutting_down_works_while_the_page_reads_nothing_and_the_daemon_floods() {
    const SIZE: usize = 64 * 1024;
    let (seen_tx, mut seen) = tokio::sync::mpsc::unbounded_channel();
    let port = daemon(move |_, socket| {
        let seen = seen_tx.clone();
        async move {
            let (mut sink, mut stream) = socket.split();
            let _ = stream.next().await;
            // A flood that no page will read: it stalls in Rust's write to the page.
            let flooding = async {
                for index in 0..4096 {
                    if sink.send(flood_frame(index, SIZE)).await.is_err() {
                        return;
                    }
                }
            };
            let reading = async {
                while let Some(Ok(message)) = stream.next().await {
                    if let Message::Close(frame) = message {
                        let _ = seen.send(super::support::close_of(frame));
                    }
                }
            };
            tokio::join!(flooding, reading);
        }
    })
    .await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;
    client.send(Message::text("go")).await.unwrap();
    tokio::time::sleep(Duration::from_millis(1000)).await;
    tokio::time::timeout(Duration::from_secs(10), rig.proxies.close_all()).await.expect("close_all returned");
    assert!(rig.proxies.snapshot().connections.is_empty());
    assert!(matches!(next_seen(&mut seen).await, Seen::Close(Some((1001, _)))));
}

/// A daemon socket opened with `dial_over` on a pipe, not a network socket, is pumped as any other.
#[tokio::test]
async fn a_socket_opened_over_a_pipe_is_pumped_in_order() {
    let (near, far) = tokio::io::duplex(64 * 1024);
    let server = tokio::spawn(async move {
        let mut ws = tokio_tungstenite::accept_async(far).await.unwrap();
        while let Some(Ok(message)) = ws.next().await {
            if matches!(message, Message::Text(_) | Message::Binary(_)) && ws.send(message).await.is_err() {
                break;
            }
        }
    });
    let daemon = dial_over(near, "ws://daemon.test:9", None, PATIENCE, crate::limits::MAX_MESSAGE_BYTES).await.unwrap();
    let rig = Rig::new();
    let url = rig.proxies.reserve("entry").unwrap().open(daemon, super::support::ORIGIN).await.unwrap();
    let mut client = page(&url).await;
    for index in 0..50u8 {
        let message = if index % 2 == 0 { Message::text(format!("m{index}")) } else { Message::binary(vec![index; 1000]) };
        client.send(message.clone()).await.unwrap();
        assert_eq!(client.next().await.unwrap().unwrap(), message);
    }
    rig.proxies.close_all().await;
    server.abort();
}
