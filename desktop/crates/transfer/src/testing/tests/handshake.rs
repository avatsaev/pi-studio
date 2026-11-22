//! The upgrade, `hello`, `ping` and what the daemon does with a first frame that is no `hello`.

use pistudiodesktop_net::ErrorCode;
use serde_json::json;

use super::client::{Client, Event};
use super::eventually;
use crate::Error;
use crate::testing::{Config, Fault, Features, StandInDaemon};
use crate::wire::inbound::Inbound;
use crate::wire::outbound;

#[tokio::test]
async fn the_handshake_answers_with_the_server_info_and_every_feature() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut client = Client::open(&daemon.url(), None).await.unwrap();
    let info = client.handshake().await;
    assert!(info.file_download_ranges && info.file_transfer_ack && info.agent_streams_mode);
    assert_eq!(info.require_features(), Ok(()));
    assert_eq!(daemon.accepted_connections(), 1);
    assert_eq!(daemon.open_connections(), 1);
}

#[tokio::test]
async fn the_daemon_listens_on_loopback_and_a_port_the_system_chose() {
    let daemon = StandInDaemon::start().await.unwrap();
    assert!(daemon.url().starts_with("ws://127.0.0.1:"));
    assert_ne!(daemon.port(), 0);
    let other = StandInDaemon::start().await.unwrap();
    assert_ne!(daemon.port(), other.port());
}

#[tokio::test]
async fn a_feature_that_is_off_is_left_out_of_the_status() {
    let features = Features { file_download_ranges: false, ..Features::default() };
    let daemon = StandInDaemon::start_with(Config { features, ..Config::default() }).await.unwrap();
    let mut client = Client::open(&daemon.url(), None).await.unwrap();
    client.send(outbound::hello("client-1", "0.2.0-test")).await;
    let raw = client.raw_text().await;
    let status: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let flags = &status["payload"]["features"];
    assert!(flags.get("fileDownloadRanges").is_none());
    assert_eq!(flags["fileTransferAck"], json!(true));
    let Inbound::ServerInfo(info) = Inbound::parse(&raw).unwrap() else { panic!("a status") };
    assert_eq!(info.require_features(), Err(Error::UnsupportedDaemon { missing: "fileDownloadRanges" }));
}

#[tokio::test]
async fn the_daemon_keeps_the_hello_it_was_sent() {
    let daemon = StandInDaemon::start().await.unwrap();
    let _client = Client::connect(&daemon).await;
    let hellos = daemon.hellos();
    assert_eq!(hellos.len(), 1);
    assert_eq!(hellos[0]["clientType"], json!("browser"));
    assert_eq!(hellos[0]["platform"], json!("desktop"));
    assert_eq!(hellos[0]["agentStreams"], json!("none"));
}

#[tokio::test]
async fn a_ping_is_answered_with_a_pong_that_repeats_the_request() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut client = Client::connect(&daemon).await;
    client.send(outbound::ping("ping-7", 1_767_225_600_000)).await;
    assert_eq!(client.text().await, Inbound::Pong { request_id: "ping-7".to_owned() });
    // The daemon's own `ping` is a `pong` away too: it answers a pong with nothing.
    client.send(outbound::pong("srv-1", None, 1, 2)).await;
    client.assert_silent().await;
}

#[tokio::test]
async fn a_request_of_a_type_the_daemon_does_not_know_gets_an_rpc_error() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut client = Client::connect(&daemon).await;
    client.send(json!({"type": "session", "message": {"type": "scenario_no_such_type", "requestId": "req-9"}}).to_string()).await;
    let Inbound::RpcError(error) = client.text().await else { panic!("an rpc_error") };
    assert_eq!(error.request_id.as_deref(), Some("req-9"));
    assert_eq!(error.code, "unknown_message_type");
}

#[tokio::test]
async fn without_a_password_the_upgrade_is_open_and_with_one_it_is_401() {
    let daemon = StandInDaemon::start_with(Config { password: Some("s3cret".to_owned()), ..Config::default() }).await.unwrap();
    let none = Client::open(&daemon.url(), None).await.err().expect("no password is refused");
    assert_eq!(none.code, ErrorCode::Unauthorized);
    let wrong = Client::open(&daemon.url(), Some("nope")).await.err().expect("a wrong password is refused");
    assert_eq!(wrong.code, ErrorCode::Unauthorized);
    assert_eq!(daemon.refused_upgrades(), 2);
    assert_eq!(daemon.accepted_connections(), 0);

    let mut client = Client::open(&daemon.url(), Some("s3cret")).await.unwrap();
    assert!(client.handshake().await.file_transfer_ack);
    assert_eq!(daemon.refused_upgrades(), 2);
    assert_eq!(daemon.accepted_connections(), 1);
}

#[tokio::test]
async fn a_first_frame_that_is_not_a_hello_closes_the_socket_1008() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut binary = Client::open(&daemon.url(), None).await.unwrap();
    binary.send_binary(vec![0x10, 0, b'{', b'}']).await;
    assert!(matches!(binary.event().await, Event::Closed(Some(1008))));

    let mut garbage = Client::open(&daemon.url(), None).await.unwrap();
    garbage.send("not json".to_owned()).await;
    assert!(matches!(garbage.event().await, Event::Closed(Some(1008))));

    let mut other = Client::open(&daemon.url(), None).await.unwrap();
    other.send(outbound::ping("req-1", 1)).await;
    assert!(matches!(other.event().await, Event::Closed(Some(1008))));
    assert_eq!(daemon.hellos().len(), 0);
}

#[tokio::test]
async fn a_connection_that_ends_is_no_longer_open_and_a_dropped_daemon_ends_its_connections() {
    let daemon = StandInDaemon::start().await.unwrap();
    let client = Client::connect(&daemon).await;
    assert_eq!(daemon.open_connections(), 1);
    drop(client);
    eventually("the connection to close", || daemon.open_connections() == 0).await;

    let mut client = Client::connect(&daemon).await;
    drop(daemon);
    assert!(matches!(client.event().await, Event::Failed | Event::Closed(_)));
}

#[tokio::test]
async fn a_fault_is_used_once() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::Silence { request: crate::testing::Asked::Ping });
    assert_eq!(daemon.pending_faults(), 1);
    let mut client = Client::connect(&daemon).await;
    client.send(outbound::ping("a", 1)).await;
    client.assert_silent().await;
    assert_eq!(daemon.pending_faults(), 0);
    client.send(outbound::ping("b", 1)).await;
    assert_eq!(client.text().await, Inbound::Pong { request_id: "b".to_owned() });
}
