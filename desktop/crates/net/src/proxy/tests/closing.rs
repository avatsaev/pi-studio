//! How a connection ends: a close frame from either leg, a leg that vanishes, a message that is too large.

use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;

use super::support::{PATIENCE, Rig, Seen, daemon, echo_daemon, eventually, next_seen, page, quiet_daemon, reset_on_close};
use crate::Limits;
use crate::proxy::{EndCode, State};

fn close(code: u16, reason: &str) -> Message {
    Message::Close(Some(CloseFrame { code: code.into(), reason: reason.to_owned().into() }))
}

/// Reads until the stream ends, answering what the library asks for; the close frame it was
/// sent, if any, and whether the end was a clean one.
async fn until_closed<S>(stream: &mut S) -> (Option<(u16, String)>, bool)
where
    S: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    let mut frame = None;
    loop {
        match tokio::time::timeout(PATIENCE, stream.next()).await.expect("the connection did not end") {
            Some(Ok(Message::Close(f))) => frame = f.map(|f| (u16::from(f.code), f.reason.to_string())),
            Some(Ok(_)) => {}
            Some(Err(_)) => return (frame, false),
            None => return (frame, true),
        }
    }
}

#[tokio::test]
async fn the_daemons_close_code_and_reason_reach_the_page_and_the_daemon_is_answered() {
    let (seen_tx, mut seen) = tokio::sync::mpsc::unbounded_channel();
    let port = daemon(move |_, mut socket| {
        let seen = seen_tx.clone();
        async move {
            socket.send(close(4002, "the daemon closed")).await.unwrap();
            // The answer to its close: what the daemon reads next.
            while let Some(item) = socket.next().await {
                match item {
                    Ok(Message::Close(frame)) => {
                        let _ = seen.send(super::support::close_of(frame));
                    }
                    Ok(_) => {}
                    Err(_) => break,
                }
            }
            let _ = seen.send(Seen::End);
        }
    })
    .await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;
    let (frame, _) = until_closed(&mut client).await;
    assert_eq!(frame, Some((4002, "the daemon closed".into())));
    assert_eq!(next_seen(&mut seen).await, Seen::Close(Some((4002, "the daemon closed".into()))), "the daemon got its answer");
    rig.empty().await;
    assert_eq!(rig.proxies.snapshot().last_error, None, "a close is not a fault");
}

#[tokio::test]
async fn the_pages_close_code_and_reason_reach_the_daemon_and_the_page_is_answered() {
    let (port, mut seen) = echo_daemon().await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;
    client.send(Message::text("one")).await.unwrap();
    assert_eq!(client.next().await.unwrap().unwrap(), Message::text("one"));
    client.send(close(4001, "page bye")).await.unwrap();
    assert_eq!(next_seen(&mut seen).await, Seen::Data(3));
    assert_eq!(next_seen(&mut seen).await, Seen::Close(Some((4001, "page bye".into()))));
    // The page's close completes: its stream ends after the answer.
    let (answer, clean) = until_closed(&mut client).await;
    assert!(clean, "the page's close handshake completed");
    assert_eq!(answer.map(|(code, _)| code), Some(4001));
    rig.empty().await;
    assert_eq!(rig.proxies.snapshot().last_error, None);
}

#[tokio::test]
async fn a_daemon_that_resets_ends_the_page_without_a_close_frame() {
    let port = daemon(|_, mut socket| async move {
        socket.send(Message::text("before")).await.unwrap();
        // A reset: no close frame, no orderly end.
        reset_on_close(socket.get_mut());
    })
    .await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;
    assert_eq!(client.next().await.unwrap().unwrap(), Message::text("before"));
    let (frame, _) = until_closed(&mut client).await;
    assert_eq!(frame, None, "no close frame reached the page");
    rig.empty().await;
    assert_eq!(rig.proxies.snapshot().last_error.map(|e| e.code), Some(EndCode::UpstreamLost));
}

#[tokio::test]
async fn a_daemon_that_just_closes_its_socket_ends_the_page_without_a_close_frame() {
    let port = daemon(|_, socket| async move { drop(socket) }).await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;
    let (frame, _) = until_closed(&mut client).await;
    assert_eq!(frame, None);
    rig.empty().await;
    assert_eq!(rig.proxies.snapshot().last_error.map(|e| e.code), Some(EndCode::UpstreamLost));
}

#[tokio::test]
async fn a_page_that_vanishes_gives_the_daemon_1001() {
    let (port, mut seen) = quiet_daemon().await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;
    client.send(Message::text("hello")).await.unwrap();
    // A reload or a crash: the socket goes, no close frame.
    reset_on_close(client.get_mut());
    drop(client);
    let (n, event) = next_seen(&mut seen).await;
    assert_eq!(n, 0);
    assert!(matches!(event, Seen::Close(Some((1001, _)))), "{event:?}");
    rig.empty().await;
    assert_eq!(rig.proxies.snapshot().last_error, None, "a page that leaves is not a fault");
}

/// A message above the limit: both legs hear 1009 and the ending is recorded. The limit is lowered
/// to 64 KiB for the test, on both legs.
const CAP: usize = 64 * 1024;

fn capped() -> Limits {
    Limits { max_message_bytes: CAP, ..Limits::default() }
}

#[tokio::test]
async fn a_message_from_the_page_above_the_limit_closes_both_legs_with_1009() {
    let (port, mut seen) = quiet_daemon().await;
    let rig = Rig::with(capped());
    let url = rig.open_capped("entry", port, CAP).await;
    let mut client = page(&url).await;
    client.send(Message::binary(vec![7u8; CAP])).await.unwrap(); // exactly the limit: passes
    client.send(Message::binary(vec![7u8; CAP + 1])).await.unwrap();
    let (frame, _) = until_closed(&mut client).await;
    assert_eq!(frame.map(|(code, _)| code), Some(1009), "the page");
    let (_, event) = next_seen(&mut seen).await;
    assert!(matches!(event, Seen::Close(Some((1009, _)))), "the daemon: {event:?}");
    rig.empty().await;
    let snapshot = rig.proxies.snapshot();
    assert_eq!(snapshot.last_error.map(|e| e.code), Some(EndCode::TooLarge));
}

#[tokio::test]
async fn a_message_from_the_daemon_above_the_limit_closes_both_legs_with_1009() {
    let (seen_tx, mut seen) = tokio::sync::mpsc::unbounded_channel();
    let port = daemon(move |_, mut socket| {
        let seen = seen_tx.clone();
        async move {
            socket.send(Message::binary(vec![1u8; CAP + 1])).await.unwrap();
            while let Some(item) = socket.next().await {
                if let Ok(Message::Close(frame)) = item {
                    let _ = seen.send(super::support::close_of(frame));
                }
            }
        }
    })
    .await;
    let rig = Rig::with(capped());
    let url = rig.open_capped("entry", port, CAP).await;
    let mut client = page(&url).await;
    let (frame, _) = until_closed(&mut client).await;
    assert_eq!(frame.map(|(code, _)| code), Some(1009), "the page");
    let event = next_seen(&mut seen).await;
    assert!(matches!(event, Seen::Close(Some((1009, _)))), "the daemon: {event:?}");
    rig.empty().await;
    assert_eq!(rig.proxies.snapshot().last_error.map(|e| e.code), Some(EndCode::TooLarge));
}

#[tokio::test]
async fn a_daemon_socket_without_a_message_limit_is_not_accepted() {
    let (port, _seen) = echo_daemon().await;
    let rig = Rig::with(capped());
    let reservation = rig.proxies.reserve("entry").unwrap();
    let too_big = super::support::upstream(port, CAP * 2).await;
    let error = reservation.open(too_big, super::support::ORIGIN).await.unwrap_err();
    assert_eq!(error.code, crate::ErrorCode::ProxyFailed);
    assert!(rig.proxies.snapshot().connections.is_empty(), "the place was given back");
}

#[tokio::test]
async fn a_peer_that_does_not_answer_a_close_is_dropped_after_the_close_wait() {
    // The daemon never reads again after the page's close: the answer does not come.
    let port = daemon(|_, socket| async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        drop(socket);
    })
    .await;
    let limits = Limits { close_wait: Duration::from_millis(400), ..Limits::default() };
    let rig = Rig::with(limits);
    let url = rig.open("entry", port).await;
    let mut client = page(&url).await;
    client.send(close(1000, "bye")).await.unwrap();
    eventually(|| rig.proxies.snapshot().connections.first().is_some_and(|c| c.state == State::Closing)).await;
    let started = tokio::time::Instant::now();
    rig.empty().await;
    assert!(started.elapsed() < Duration::from_secs(5), "dropped after the close wait, not kept");
    assert_eq!(rig.proxies.snapshot().last_error, None);
}

/// The daemon closes while the page is sending: whichever direction notices first, the page must
/// hear the daemon's close code, not a bare drop.
#[tokio::test]
async fn a_close_from_the_daemon_wins_over_a_page_that_is_still_sending() {
    let port = daemon(|_, mut socket| async move {
        for _ in 0..5 {
            let _ = socket.send(Message::text("tick")).await;
        }
        let _ = socket.send(close(4003, "the daemon closed")).await;
        while let Some(Ok(_)) = socket.next().await {}
    })
    .await;
    let rig = Rig::new();
    for round in 0..25 {
        let url = rig.open("entry", port).await;
        let (mut sink, mut stream) = page(&url).await.split();
        let sending = async {
            // Until the connection refuses: the page cannot know where the close is.
            while sink.send(Message::text("x".repeat(100 + round))).await.is_ok() {
                tokio::task::yield_now().await;
            }
        };
        let reading = async {
            let mut code = None;
            while let Some(Ok(message)) = stream.next().await {
                if let Message::Close(Some(frame)) = message {
                    code = Some(u16::from(frame.code));
                }
            }
            code
        };
        let (_, code) = tokio::time::timeout(PATIENCE, async { tokio::join!(sending, reading) }).await.expect("the round did not end");
        assert_eq!(code, Some(4003), "round {round}: the page heard the daemon's code");
        rig.empty().await;
        assert_eq!(rig.proxies.snapshot().last_error, None, "round {round}");
    }
}

/// The shipped limit, not a lowered one: 128 MiB and a byte is refused as the frame's header is read.
#[tokio::test]
async fn a_message_one_byte_over_128_mib_closes_both_legs_with_1009() {
    const OVER: usize = 128 * 1024 * 1024 + 1;
    let (port, mut seen) = quiet_daemon().await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let (mut sink, mut stream) = page(&url).await.split();
    // The send may fail when the connection is dropped: the page hears the close on its own half.
    let sending = async {
        let _ = sink.send(Message::binary(vec![1u8; OVER])).await;
    };
    let reading = until_closed(&mut stream);
    let ((), (frame, _)) = tokio::time::timeout(Duration::from_secs(60), async { tokio::join!(sending, reading) }).await.expect("the connection did not end");
    assert_eq!(frame.map(|(code, _)| code), Some(1009), "the page");
    let (_, event) = next_seen(&mut seen).await;
    assert!(matches!(event, Seen::Close(Some((1009, _)))), "the daemon: {event:?}");
    rig.empty().await;
    assert_eq!(rig.proxies.snapshot().last_error.map(|e| e.code), Some(EndCode::TooLarge));
}
