//! The relay socket through the proxy, against the relay stand-in with an echo daemon half.

use std::time::Duration;

use futures_util::{SinkExt as _, StreamExt as _};
use pistudiodesktop_net::{LocalUrl, Proxies};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::{WebSocketStream, client_async_with_config};

use super::*;
use crate::connect::connect;
use crate::testing::{Seen, StandIn, Step};

const DAEMON_SECRET: [u8; 32] = [9; 32];
const ORIGIN: &str = "tauri://localhost";
const PATIENCE: Duration = Duration::from_secs(60);
const MIXED: usize = 10_000;
const BIG: usize = 64 * 1024 * 1024;
/// What the proxy's own limit allows on the page's leg and so what the relay socket is given.
const PROXY_LIMIT: usize = 128 * 1024 * 1024;

type Page = WebSocketStream<TcpStream>;

fn open_script(last: Vec<Step>) -> Vec<Step> {
    let mut script = vec![Step::ReadConnect, Step::Paired, Step::Hello, Step::Ready];
    script.extend(last);
    script
}

async fn page_of(url: &LocalUrl) -> Page {
    let rest = url.expose().strip_prefix("ws://127.0.0.1:").unwrap();
    let (port, token) = rest.split_once('/').unwrap();
    let tcp = TcpStream::connect(("127.0.0.1", port.parse::<u16>().unwrap())).await.unwrap();
    let mut request = format!("ws://127.0.0.1:{port}/{token}").into_client_request().unwrap();
    request.headers_mut().insert("Origin", HeaderValue::from_static(ORIGIN));
    let config = WebSocketConfig::default().max_message_size(None).max_frame_size(None);
    client_async_with_config(request, tcp, Some(config)).await.unwrap().0
}

/// A proxy whose daemon leg is the relay socket to `stand_in`; returns the page's end.
async fn through_proxy(stand_in: &StandIn, proxies: &Proxies) -> Page {
    let connected = connect(&stand_in.url(), &stand_in.daemon_public(), PROXY_LIMIT, Duration::from_secs(10)).await.unwrap();
    let url = proxies.reserve("relay").unwrap().open(connected.into_socket(), ORIGIN).await.unwrap();
    page_of(&url).await
}

fn message(index: usize) -> Message {
    let size = match index % 4 {
        0 => 0,
        1 => 1 + index % 97,
        2 => 1000 + index % 5000,
        _ => 70_000,
    };
    let bytes: Vec<u8> = (0..size).map(|i| u8::try_from((i * 31 + index) % 251).unwrap_or(0)).collect();
    if index.is_multiple_of(2) { Message::binary(bytes) } else { Message::text(bytes.iter().map(|b| char::from(b'a' + b % 26)).collect::<String>()) }
}

#[test]
fn the_message_limit_keeps_the_sealed_frame_within_100_mib() {
    assert_eq!(plain_limit(PROXY_LIMIT) + SEAL_OVERHEAD, MAX_SEALED_BYTES);
    assert_eq!(plain_limit(1000), 1000);
    assert_eq!(sealed_limit(1000), 1017);
}

#[tokio::test]
async fn the_socket_reports_the_callers_limit_capped() {
    let stand_in = StandIn::start(DAEMON_SECRET, open_script(vec![Step::Echo])).await.unwrap();
    let small = connect(&stand_in.url(), &stand_in.daemon_public(), 1000, Duration::from_secs(10)).await.unwrap().into_socket();
    assert_eq!(small.max_message_bytes(), 1000);
    let big = connect(&stand_in.url(), &stand_in.daemon_public(), usize::MAX, Duration::from_secs(10)).await.unwrap().into_socket();
    assert_eq!(big.max_message_bytes(), MAX_SEALED_BYTES - SEAL_OVERHEAD);
}

#[tokio::test]
async fn ten_thousand_mixed_messages_arrive_in_order_and_intact() {
    let stand_in = StandIn::start(DAEMON_SECRET, open_script(vec![Step::Echo])).await.unwrap();
    let proxies = Proxies::new(|_| {});
    let (mut sink, mut stream) = through_proxy(&stand_in, &proxies).await.split();
    let sender = tokio::spawn(async move {
        for index in 0..MIXED {
            sink.send(message(index)).await.unwrap();
        }
        sink
    });
    for index in 0..MIXED {
        let echoed = tokio::time::timeout(PATIENCE, stream.next()).await.unwrap().unwrap().unwrap();
        assert_eq!(echoed, message(index), "message {index}");
    }
    drop(sender.await.unwrap());
}

#[tokio::test]
async fn a_64_mib_message_passes_holding_one_message_and_a_batch() {
    let stand_in = StandIn::start(DAEMON_SECRET, open_script(vec![Step::Echo])).await.unwrap();
    let proxies = Proxies::new(|_| {});
    let mut page = through_proxy(&stand_in, &proxies).await;
    let payload: Vec<u8> = (0..BIG).map(|i| u8::try_from(i % 253).unwrap_or(0)).collect();
    page.send(Message::binary(payload.clone())).await.unwrap();
    let echoed = tokio::time::timeout(PATIENCE, page.next()).await.unwrap().unwrap().unwrap();
    assert!(echoed == Message::binary(payload), "the echo differs");
    let entry = proxies.snapshot().connections.remove(0);
    let bound = (BIG + pistudiodesktop_net::Limits::default().flush_bytes) as u64;
    assert!(entry.peak_held_in <= bound && entry.peak_held_out <= bound, "held {} and {}", entry.peak_held_in, entry.peak_held_out);
}

#[tokio::test]
async fn a_tampered_frame_closes_4200_on_both_legs() {
    let mut stand_in = StandIn::start(DAEMON_SECRET, open_script(vec![Step::Binary(vec![0xAB; 40])])).await.unwrap();
    let proxies = Proxies::new(|_| {});
    let mut page = through_proxy(&stand_in, &proxies).await;
    let Some(Ok(Message::Close(Some(frame)))) = tokio::time::timeout(PATIENCE, page.next()).await.unwrap() else { panic!("no close") };
    assert_eq!((u16::from(frame.code), frame.reason.as_str()), (CLOSE_CHANNEL_ERROR, CLOSE_CHANNEL_ERROR_REASON));
    loop {
        match tokio::time::timeout(PATIENCE, stand_in.seen()).await.unwrap() {
            Some(Seen::Closed(close)) => {
                assert_eq!(close.map(|(code, _)| code), Some(CLOSE_CHANNEL_ERROR));
                break;
            }
            Some(_) => {}
            None => panic!("the stand-in never saw a close"),
        }
    }
}

#[tokio::test]
async fn a_relay_close_passes_to_the_page_with_its_code() {
    let stand_in = StandIn::start(DAEMON_SECRET, open_script(vec![Step::Close(4108, "gone".to_owned())])).await.unwrap();
    let proxies = Proxies::new(|_| {});
    let mut page = through_proxy(&stand_in, &proxies).await;
    let Some(Ok(Message::Close(Some(frame)))) = tokio::time::timeout(PATIENCE, page.next()).await.unwrap() else { panic!("no close") };
    assert_eq!((u16::from(frame.code), frame.reason.as_str()), (4108, "gone"));
}
