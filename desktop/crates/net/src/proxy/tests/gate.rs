//! The page's leg: who gets in, the time it waits, and what the token is kept out of.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::client_async;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tokio_tungstenite::tungstenite::http::HeaderValue;

use super::support::{ORIGIN, PATIENCE, Rig, Seen, close_of, echo_daemon, next_seen, page, page_request, parts, quiet_daemon, status_of};
use crate::proxy::EndCode;
use crate::proxy::accept::accept_page;
use crate::proxy::conn::Conn;
use crate::proxy::gate::{Gate, Refusal};
use crate::{ErrorCode, Limits};

#[tokio::test]
async fn a_wrong_token_origin_or_host_is_refused_with_403_and_the_right_client_still_gets_in() {
    let (port, _seen) = echo_daemon().await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let (local, token) = parts(&url);
    let right_host = format!("127.0.0.1:{local}");
    let path = format!("/{token}");
    let wrong_token = format!("/{}", "0".repeat(64));
    let short_token = format!("/{}", &token[..63]);

    for (what, result) in [
        ("a wrong token", page_request(local, &right_host, &wrong_token, Some(ORIGIN)).await),
        ("a token one digit short", page_request(local, &right_host, &short_token, Some(ORIGIN)).await),
        ("no token", page_request(local, &right_host, "/", Some(ORIGIN)).await),
        ("another origin", page_request(local, &right_host, &path, Some("http://evil.example")).await),
        ("a longer origin", page_request(local, &right_host, &path, Some("tauri://localhost.evil.example")).await),
        ("no origin", page_request(local, &right_host, &path, None).await),
        ("a wrong host name", page_request(local, &format!("localhost:{local}"), &path, Some(ORIGIN)).await),
        ("a wrong port in the host", page_request(local, "127.0.0.1:1", &path, Some(ORIGIN)).await),
    ] {
        let error = result.err().unwrap_or_else(|| panic!("{what} got in"));
        assert_eq!(status_of(&error), Some(403), "{what}");
    }

    // None of that used the token: the page's own upgrade works, and no subprotocol is answered.
    let mut client = page(&url).await;
    client.send(Message::text("hello")).await.unwrap();
    assert_eq!(client.next().await.unwrap().unwrap(), Message::text("hello"));
    assert_eq!(rig.proxies.snapshot().last_error, None, "a refused guess is not an ending");
}

#[tokio::test]
async fn no_subprotocol_is_answered_and_a_page_that_offers_none_gets_none() {
    let (port, _seen) = echo_daemon().await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let (local, token) = parts(&url);
    let tcp = TcpStream::connect(("127.0.0.1", local)).await.unwrap();
    let mut request = format!("ws://127.0.0.1:{local}/{token}").into_client_request().unwrap();
    request.headers_mut().insert("Origin", HeaderValue::from_static(ORIGIN));
    let (_client, response) = client_async(request, tcp).await.unwrap();
    assert_eq!(response.status().as_u16(), 101);
    assert!(response.headers().get("sec-websocket-protocol").is_none(), "the daemon's bearer subprotocol is never passed back");
}

#[tokio::test]
async fn after_the_upgrade_the_port_is_closed_and_the_token_cannot_be_used_again() {
    let (port, _seen) = echo_daemon().await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let (local, token) = parts(&url);
    let mut client = page(&url).await;
    // The listener is dropped before the page has its answer: no new connection, so no second use.
    assert!(TcpStream::connect(("127.0.0.1", local)).await.is_err(), "the port is closed");
    let again = page_request(local, &format!("127.0.0.1:{local}"), &format!("/{token}"), Some(ORIGIN)).await;
    assert!(again.is_err(), "a second use of the token");
    client.send(Message::text("still here")).await.unwrap();
    assert_eq!(client.next().await.unwrap().unwrap(), Message::text("still here"));
}

/// The listener on its own: the token is held by another upgrade, so a client that has it too is a
/// second use, and gets a 403 on the wire; once the holder lets go (its upgrade failed), the token
/// works.
#[tokio::test]
async fn a_second_use_of_the_token_is_a_403_and_a_claim_that_failed_is_given_back() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let token = "cd".repeat(32);
    let gate = Arc::new(Gate::new(token.clone(), ORIGIN, port));
    let holder = tokio_tungstenite::tungstenite::http::Request::builder()
        .uri(format!("/{token}"))
        .header("Origin", ORIGIN)
        .header("Host", format!("127.0.0.1:{port}"))
        .body(())
        .unwrap();
    assert_eq!(gate.check(&holder), Ok(()), "another upgrade holds the token");
    let (conn, limits, refusals) = (Conn::new(), Limits::default(), Mutex::new(Vec::new()));
    let record = |refusal: Refusal| refusals.lock().unwrap().push(refusal);
    let client = async {
        let (host, path) = (format!("127.0.0.1:{port}"), format!("/{token}"));
        let second = page_request(port, &host, &path, Some(ORIGIN)).await.expect_err("the second use got in");
        assert_eq!(status_of(&second), Some(403), "a second use is a 403");
        gate.release();
        page_request(port, &host, &path, Some(ORIGIN)).await.expect("the released token works")
    };
    let (_page, _client) =
        tokio::time::timeout(PATIENCE, async { tokio::join!(accept_page(listener, gate.clone(), &conn, &limits, &record), client) }).await.unwrap();
    assert_eq!(*refusals.lock().unwrap(), [Refusal::Used]);
    assert_eq!(conn.refusals(), 1);
}

#[tokio::test]
async fn two_clients_with_the_token_at_once_let_in_one() {
    let (port, _seen) = echo_daemon().await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let (local, token) = parts(&url);
    let (host, path) = (format!("127.0.0.1:{local}"), format!("/{token}"));
    let (a, b) = tokio::join!(page_request(local, &host, &path, Some(ORIGIN)), page_request(local, &host, &path, Some(ORIGIN)));
    let (winners, losers): (Vec<_>, Vec<_>) = [a, b].into_iter().partition(Result::is_ok);
    assert_eq!((winners.len(), losers.len()), (1, 1));
}

#[tokio::test]
async fn at_most_sixteen_upgrades_are_read_at_once_and_each_is_given_its_time() {
    let (port, _seen) = echo_daemon().await;
    let limits = Limits { upgrade_wait: Duration::from_millis(600), ..Limits::default() };
    let rig = Rig::with(limits);
    let url = rig.open("entry", port).await;
    let (local, token) = parts(&url);
    // Sixteen clients that connect and say nothing hold every place.
    let mut stalled = Vec::new();
    for _ in 0..16 {
        stalled.push(TcpStream::connect(("127.0.0.1", local)).await.unwrap());
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
    // The seventeenth is dropped unanswered.
    let mut seventeenth = TcpStream::connect(("127.0.0.1", local)).await.unwrap();
    let mut byte = [0u8; 1];
    let read = tokio::time::timeout(Duration::from_millis(500), seventeenth.read(&mut byte)).await;
    assert!(matches!(read, Ok(Ok(0) | Err(_))), "dropped without an answer: {read:?}");
    // So is the page's own, for now.
    let early = page_request(local, &format!("127.0.0.1:{local}"), &format!("/{token}"), Some(ORIGIN)).await;
    assert!(early.is_err(), "no place is free");
    // After their 600 ms the stalled ones are gone and the page gets in.
    tokio::time::sleep(Duration::from_millis(700)).await;
    let mut client = page_request(local, &format!("127.0.0.1:{local}"), &format!("/{token}"), Some(ORIGIN)).await.unwrap();
    client.send(Message::text("in")).await.unwrap();
    assert_eq!(client.next().await.unwrap().unwrap(), Message::text("in"));
    drop(stalled);
}

#[tokio::test]
async fn a_request_that_is_not_an_upgrade_is_refused_and_does_not_use_the_token_up() {
    let (port, _seen) = echo_daemon().await;
    let rig = Rig::new();
    let url = rig.open("entry", port).await;
    let (local, token) = parts(&url);
    let mut plain = TcpStream::connect(("127.0.0.1", local)).await.unwrap();
    plain.write_all(format!("GET /{token} HTTP/1.1\r\nHost: 127.0.0.1:{local}\r\nOrigin: {ORIGIN}\r\n\r\n").as_bytes()).await.unwrap();
    let mut answer = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(2), plain.read_to_end(&mut answer)).await;
    assert!(!String::from_utf8_lossy(&answer).contains("101"), "not upgraded");
    let mut client = page(&url).await;
    client.send(Message::text("ok")).await.unwrap();
    assert_eq!(client.next().await.unwrap().unwrap(), Message::text("ok"));
}

#[tokio::test]
async fn with_no_page_in_time_the_daemon_hears_1001_and_the_connection_is_forgotten() {
    let (port, mut seen) = echo_daemon().await;
    let limits = Limits { page_wait: Duration::from_millis(300), ..Limits::default() };
    let rig = Rig::with(limits);
    let url = rig.open("entry", port).await;
    let (local, token) = parts(&url);
    assert_eq!(rig.proxies.snapshot().connections.len(), 1);
    assert_eq!(rig.proxies.snapshot().connections[0].state.as_str(), "connecting");
    assert_eq!(next_seen(&mut seen).await, close_of(Some(tokio_tungstenite::tungstenite::protocol::CloseFrame { code: 1001.into(), reason: "".into() })));
    rig.empty().await;
    let snapshot = rig.proxies.snapshot();
    assert_eq!(snapshot.last_error.map(|e| e.code), Some(EndCode::PageTimeout));
    assert!(snapshot.last_error.is_some_and(|e| e.at_ms > 0));
    assert!(
        page_request(local, &format!("127.0.0.1:{local}"), &format!("/{token}"), Some(ORIGIN)).await.is_err(),
        "the token has expired and the port is closed"
    );
}

#[tokio::test]
async fn a_page_that_tried_and_was_refused_ends_as_refused_not_as_a_timeout() {
    let (port, mut seen) = quiet_daemon().await;
    let limits = Limits { page_wait: Duration::from_millis(500), ..Limits::default() };
    let rig = Rig::with(limits);
    let url = rig.open("entry", port).await;
    let (local, token) = parts(&url);
    let wrong = page_request(local, &format!("127.0.0.1:{local}"), &format!("/{token}"), Some("http://other.example")).await;
    assert_eq!(wrong.err().as_ref().and_then(status_of), Some(403));
    assert!(matches!(next_seen(&mut seen).await.1, Seen::Close(Some((1001, _)))));
    rig.empty().await;
    assert_eq!(rig.proxies.snapshot().last_error.map(|e| e.code), Some(EndCode::PageRefused));
    assert!(rig.log().iter().any(|line| line.contains("refused an upgrade")), "{:?}", rig.log());
}

#[tokio::test]
async fn the_token_and_the_local_address_are_in_no_error_log_line_or_snapshot() {
    let (port, _seen) = echo_daemon().await;
    let limits = Limits { page_wait: Duration::from_millis(400), max_connections: 2, ..Limits::default() };
    let rig = Rig::with(limits);
    let mut texts: Vec<String> = Vec::new();

    // A connection that is guessed at with its own token in the path, then used, then closed by the page.
    let url = rig.open("first", port).await;
    let (local, token) = parts(&url);
    let host = format!("127.0.0.1:{local}");
    for (origin, authority) in [(Some("http://evil.example"), host.clone()), (Some(ORIGIN), format!("localhost:{local}")), (None, host.clone())] {
        let refused = page_request(local, &authority, &format!("/{token}"), origin).await.err().unwrap();
        texts.push(format!("{refused:?} {refused}"));
    }
    let mut client = page(&url).await;
    client.send(Message::text("hello")).await.unwrap();
    let _ = client.next().await;
    texts.push(format!("{:?}", rig.proxies.snapshot()));
    client.close(None).await.unwrap();
    while client.next().await.is_some() {}
    rig.empty().await;

    // One that nobody connects to, a fresh one that is refused for the limit, and a bad socket.
    let waiting = rig.open("second", port).await;
    let (_, waiting_token) = parts(&waiting);
    let _third = rig.proxies.reserve("third").unwrap();
    let full = rig.proxies.reserve("fourth").err().unwrap();
    assert_eq!(full.code, ErrorCode::Limit);
    texts.push(format!("{full:?} {full}"));
    texts.push(format!("{url:?} {waiting:?}"));
    tokio::time::sleep(Duration::from_millis(600)).await;
    texts.push(format!("{:?}", rig.proxies.snapshot()));
    texts.extend(rig.log());

    assert!(!rig.log().is_empty(), "something was logged");
    for text in &texts {
        for secret in [token.as_str(), waiting_token.as_str(), url.expose(), waiting.expose(), "ws://127.0.0.1"] {
            assert!(!text.contains(secret), "`{secret}` is in `{text}`");
        }
    }
}
