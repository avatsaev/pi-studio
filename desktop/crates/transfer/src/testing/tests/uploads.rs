//! Uploads into memory: the answers, the `file_upload_complete` push, and the rule that nothing is
//! kept unless `End` arrived.

use serde_json::json;

use super::client::Client;
use super::eventually;
use crate::testing::{Config, StandInDaemon};
use crate::wire::binary;
use crate::wire::inbound::{Inbound, UploadResponse};

fn sample(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i % 251) as u8).collect()
}

#[tokio::test]
async fn an_upload_is_stored_and_acknowledged() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut client = Client::connect(&daemon).await;
    let data = sample(100_000);
    let stream = client.accepted_upload("/srv/a/b.bin", "t-1").await;
    client.send_upload(stream, "t-1", &data, 32 * 1024).await;
    let complete = client.upload_complete().await;
    assert_eq!((complete.transfer_id.as_str(), complete.stream, complete.ok), ("t-1", stream, true));
    assert_eq!(complete.bytes_written, 100_000);
    assert_eq!(complete.error, None);
    assert_eq!(daemon.file("/srv/a/b.bin"), Some(data));
    let records = daemon.uploads();
    assert_eq!(records.len(), 1);
    assert_eq!((records[0].path.as_str(), records[0].bytes_received, records[0].error.as_deref()), ("/srv/a/b.bin", 100_000, None));
}

#[tokio::test]
async fn an_empty_file_is_an_upload_with_no_chunk() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut client = Client::connect(&daemon).await;
    let stream = client.accepted_upload("/e", "t-e").await;
    client.send_upload(stream, "t-e", &[], 1024).await;
    assert_eq!(client.upload_complete().await.bytes_written, 0);
    assert_eq!(daemon.file("/e"), Some(Vec::new()));
}

#[tokio::test]
async fn an_upload_over_an_existing_file_replaces_it_with_a_new_modification_time() {
    let daemon = StandInDaemon::start().await.unwrap();
    let before = daemon.put_file("/f", b"old".to_vec());
    let mut client = Client::connect(&daemon).await;
    let stream = client.accepted_upload("/f", "t-2").await;
    client.send_upload(stream, "t-2", b"newer", 1024).await;
    assert!(client.upload_complete().await.ok);
    assert_eq!(daemon.file("/f"), Some(b"newer".to_vec()));
    let after = daemon.file_info("/f").unwrap();
    assert_eq!(after.size, 5);
    assert!(after.mtime_ms > before.mtime_ms);
}

#[tokio::test]
async fn nothing_is_kept_when_the_connection_ends_before_the_end() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f", b"keep me".to_vec());
    let mut client = Client::connect(&daemon).await;
    let stream = client.accepted_upload("/f", "t-3").await;
    client.send_binary(binary::encode_begin(stream, "t-3")).await;
    client.send_binary(binary::encode_chunk(stream, &sample(5000)).unwrap()).await;
    let other = client.accepted_upload("/g", "t-4").await;
    client.send_binary(binary::encode_begin(other, "t-4")).await;
    drop(client);
    eventually("the connection to close", || daemon.open_connections() == 0).await;
    assert_eq!(daemon.file("/f"), Some(b"keep me".to_vec()));
    assert_eq!(daemon.file("/g"), None);
    assert!(daemon.uploads().is_empty());
}

#[tokio::test]
async fn an_error_frame_discards_the_upload_and_the_push_carries_its_message() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut client = Client::connect(&daemon).await;
    let stream = client.accepted_upload("/f", "t-5").await;
    client.send_binary(binary::encode_begin(stream, "t-5")).await;
    client.send_binary(binary::encode_chunk(stream, b"half").unwrap()).await;
    client.send_binary(binary::encode_error(stream, "client_aborted").unwrap()).await;
    let complete = client.upload_complete().await;
    assert!(!complete.ok);
    assert_eq!(complete.error.as_deref(), Some("client_aborted"));
    assert_eq!(complete.bytes_written, 4);
    assert_eq!(daemon.file("/f"), None);

    let stream = client.accepted_upload("/f", "t-6").await;
    client.send_binary(binary::encode_error(stream, "").unwrap()).await;
    assert_eq!(client.upload_complete().await.error.as_deref(), Some("client_error"));
}

#[tokio::test]
async fn an_end_with_no_begin_is_no_begin_and_a_begin_of_another_transfer_is_ignored() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut client = Client::connect(&daemon).await;
    let stream = client.accepted_upload("/f", "t-7").await;
    client.send_binary(binary::encode_end(stream, true)).await;
    let complete = client.upload_complete().await;
    assert_eq!(complete.error.as_deref(), Some("no_begin"));

    let stream = client.accepted_upload("/f", "t-8").await;
    client.send_binary(binary::encode_begin(stream, "another")).await;
    client.send_binary(binary::encode_chunk(stream, b"data").unwrap()).await;
    client.send_binary(binary::encode_end(stream, true)).await;
    assert_eq!(client.upload_complete().await.error.as_deref(), Some("no_begin"));
    assert_eq!(daemon.file("/f"), None);
}

#[tokio::test]
async fn frames_for_a_stream_that_is_not_open_are_ignored() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut client = Client::connect(&daemon).await;
    client.send_binary(binary::encode_begin(77, "x")).await;
    client.send_binary(binary::encode_chunk(77, b"x").unwrap()).await;
    client.send_binary(binary::encode_end(77, true)).await;
    client.send_binary(vec![0x99]).await;
    client.send(crate::wire::outbound::ping("p", 1)).await;
    assert_eq!(client.text().await, Inbound::Pong { request_id: "p".to_owned() });
}

#[tokio::test]
async fn a_request_without_a_path_or_transfer_id_is_missing_fields() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut client = Client::connect(&daemon).await;
    let reply = client.ask(|id| json!({"type": "session", "message": {"type": "file_upload_request", "requestId": id, "path": "/f"}}).to_string()).await;
    assert_eq!(reply.upload_response().unwrap(), UploadResponse::Refused { error: "missing_fields".to_owned() });
}

#[tokio::test]
async fn the_streams_run_out_as_in_the_real_daemon_and_a_finished_upload_frees_its_stream() {
    let daemon = StandInDaemon::start_with(Config { stream_slots: 2, ..Config::default() }).await.unwrap();
    let mut client = Client::connect(&daemon).await;
    let first = client.accepted_upload("/a", "t-a").await;
    let second = client.accepted_upload("/b", "t-b").await;
    assert_ne!(first, second);
    assert_eq!(client.open_upload("/c", "t-c").await, UploadResponse::Refused { error: "no_free_stream".to_owned() });
    client.send_upload(first, "t-a", b"a", 8).await;
    assert!(client.upload_complete().await.ok);
    assert_eq!(client.accepted_upload("/c", "t-c").await, first);
}

#[tokio::test]
async fn without_ack_no_push_is_sent() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut client = Client::connect(&daemon).await;
    let reply = client
        .ask(|id| json!({"type": "session", "message": {"type": "file_upload_request", "requestId": id, "path": "/f", "transferId": "t-9"}}).to_string())
        .await;
    let UploadResponse::Accepted { stream } = reply.upload_response().unwrap() else { panic!("accepted") };
    client.send_upload(stream, "t-9", b"abc", 8).await;
    client.send(crate::wire::outbound::ping("p", 1)).await;
    assert_eq!(client.text().await, Inbound::Pong { request_id: "p".to_owned() });
    assert_eq!(daemon.file("/f"), Some(b"abc".to_vec()));
}
