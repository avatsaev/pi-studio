//! `hello` and `server_info`.

use std::time::Duration;

use pistudiodesktop_net::DaemonSocket;
use serde_json::json;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::Message;

use super::support::{APP, FEATURES, Peer, assert_about, pair, server_info};
use crate::Limits;
use crate::connection::Connection;
use crate::error::{Ended, Error};

fn close_code(message: Option<Message>) -> Option<u16> {
    match message {
        Some(Message::Close(Some(frame))) => Some(u16::from(frame.code)),
        _ => None,
    }
}

async fn open_against(script: impl AsyncFnOnce(&mut Peer)) -> (Result<Connection, Error>, Peer) {
    let limits = Limits::default();
    let (socket, mut peer) = pair(&limits).await;
    let (opened, ()) = tokio::join!(Connection::open(DaemonSocket::new(socket), &APP, limits), script(&mut peer));
    (opened, peer)
}

#[tokio::test(start_paused = true)]
async fn hello_is_the_first_frame_and_names_a_desktop_client_that_wants_no_agent_stream() {
    let (opened, _peer) = open_against(async |peer| {
        let hello = peer.accept().await;
        assert_eq!(
            hello,
            json!({
                "type": "hello",
                "clientId": "client-1",
                "clientType": "browser",
                "platform": "desktop",
                "agentStreams": "none",
                "protocolVersion": 1,
                "appVersion": "pistudiodesktop/test",
            })
        );
        assert!(hello.get("capabilities").is_none(), "this connection consumes no stream event");
    })
    .await;
    assert!(opened.is_ok());
}

#[tokio::test(start_paused = true)]
async fn the_connection_opens_when_the_three_features_are_there_and_ignores_the_others() {
    let (opened, _peer) = open_against(async |peer| {
        let mut features = FEATURES.to_vec();
        features.extend(["extensionUi", "agentTodos"]);
        peer.accept_with(&features).await;
    })
    .await;
    assert!(opened.is_ok());
}

#[tokio::test(start_paused = true)]
async fn server_info_is_awaited_for_30_seconds() {
    let start = Instant::now();
    let (opened, mut peer) = open_against(async |peer| {
        assert_eq!(peer.text().await["type"], "hello");
    })
    .await;
    assert_eq!(opened.unwrap_err(), Error::Timeout);
    assert_about(start.elapsed(), Duration::from_secs(30));
    assert_eq!(close_code(peer.next().await), Some(1000), "the socket is closed");
}

#[tokio::test(start_paused = true)]
async fn a_daemon_without_one_of_the_three_flags_is_unsupported_and_the_socket_is_closed() {
    for (missing, kept) in [
        ("fileDownloadRanges", ["fileTransferAck", "agentStreamsMode"]),
        ("fileTransferAck", ["fileDownloadRanges", "agentStreamsMode"]),
        ("agentStreamsMode", ["fileDownloadRanges", "fileTransferAck"]),
    ] {
        let (opened, mut peer) = open_against(async |peer| {
            peer.accept_with(&kept).await;
        })
        .await;
        assert_eq!(opened.unwrap_err(), Error::UnsupportedDaemon { missing }, "without {missing}");
        assert_eq!(close_code(peer.next().await), Some(1000));
    }
}

#[tokio::test(start_paused = true)]
async fn a_daemon_that_lists_no_features_at_all_is_unsupported() {
    for frame in [
        json!({ "type": "status", "payload": { "status": "server_info", "serverId": "x", "capabilities": {} } }),
        json!({ "type": "status", "payload": { "status": "server_info", "serverId": "x", "capabilities": {}, "features": null } }),
        json!({ "type": "status", "payload": { "status": "server_info", "serverId": "x", "capabilities": {}, "features": {} } }),
    ] {
        let (opened, _peer) = open_against(async |peer| {
            peer.text().await;
            peer.send(Message::text(frame.to_string())).await;
        })
        .await;
        assert_eq!(opened.unwrap_err(), Error::UnsupportedDaemon { missing: "fileDownloadRanges" }, "{frame}");
    }
}

#[tokio::test(start_paused = true)]
async fn a_status_of_the_wrong_shape_ends_the_connection_with_protocol() {
    for frame in [
        json!({ "type": "status" }),
        json!({ "type": "status", "payload": 5 }),
        json!({ "type": "status", "payload": "server_info" }),
        json!({ "type": "status", "payload": { "status": "something_else" } }),
        json!({ "type": "status", "payload": { "status": 7 } }),
        json!({ "type": "status", "payload": { "status": "server_info", "features": "all" } }),
        json!({ "type": "status", "payload": { "status": "server_info", "features": [true] } }),
    ] {
        let (opened, mut peer) = open_against(async |peer| {
            peer.text().await;
            peer.send(Message::text(frame.to_string())).await;
        })
        .await;
        assert!(matches!(opened.as_ref().unwrap_err(), Error::Protocol(_)), "{frame}: {opened:?}");
        assert_eq!(close_code(peer.next().await), Some(1002), "{frame}");
    }
}

#[tokio::test(start_paused = true)]
async fn broken_text_before_server_info_ends_the_connection_with_protocol() {
    for text in ["not json", "[1, 2]", "{}", "{\"type\": 5}", "{\"type\":\"session\"}", "{\"type\":\"ping\"}"] {
        let (opened, _peer) = open_against(async |peer| {
            peer.text().await;
            peer.send(Message::text(text)).await;
        })
        .await;
        assert!(matches!(opened.as_ref().unwrap_err(), Error::Protocol(_)), "{text}: {opened:?}");
    }
}

#[tokio::test(start_paused = true)]
async fn frames_before_server_info_are_ignored_and_a_ping_is_answered() {
    let (opened, _peer) = open_against(async |peer| {
        peer.text().await;
        peer.send(Message::text(json!({ "type": "agent_stream", "agentId": "a" }).to_string())).await;
        peer.send(Message::binary(vec![0x01, 0x02, 0x03])).await;
        peer.send(Message::binary(vec![0x11, 0x00, 0x09])).await;
        peer.send(Message::text(json!({ "type": "ping", "requestId": "early", "clientSentAt": 5 }).to_string())).await;
        let pong = peer.text().await;
        assert_eq!(pong["type"], "pong");
        assert_eq!(pong["requestId"], "early");
        assert_eq!(pong["clientSentAt"], 5);
        peer.send(Message::text(server_info(&FEATURES).to_string())).await;
    })
    .await;
    assert!(opened.is_ok());
}

#[tokio::test(start_paused = true)]
async fn a_close_before_server_info_names_the_daemons_code() {
    let (opened, _peer) = open_against(async |peer| {
        peer.text().await;
        peer.send(Message::Close(Some(tokio_tungstenite::tungstenite::protocol::CloseFrame { code: 1008.into(), reason: "bad hello".into() }))).await;
    })
    .await;
    assert_eq!(opened.unwrap_err(), Error::Closed(Ended::Remote(Some(1008))));
}

#[tokio::test(start_paused = true)]
async fn a_pipe_that_ends_before_server_info_is_a_failed_socket() {
    let limits = Limits::default();
    let (socket, mut peer) = pair(&limits).await;
    let opened = tokio::join!(Connection::open(DaemonSocket::new(socket), &APP, limits), async {
        peer.text().await;
        drop(peer);
    })
    .0;
    assert_eq!(opened.unwrap_err(), Error::Closed(Ended::Socket));
}

#[tokio::test(start_paused = true)]
async fn a_socket_that_does_not_refuse_a_larger_message_is_not_accepted() {
    let limits = Limits::default();
    // The socket was made for a larger limit than the connection is told it has.
    let (socket, _peer) = pair(&Limits { max_message_bytes: limits.max_message_bytes * 2, ..limits }).await;
    assert!(matches!(Connection::open(DaemonSocket::new(socket), &APP, limits).await.unwrap_err(), Error::Internal(_)));
}
