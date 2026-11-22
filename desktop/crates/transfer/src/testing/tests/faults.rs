//! The faults of the connection and of the answers: each is observable from the client, and each is
//! used once.

use super::client::{Client, Event, Got};
use super::eventually;
use crate::testing::{After, Asked, Config, Direction, Fault, Request, StandInDaemon};
use crate::wire::binary;
use crate::wire::inbound::{DownloadResponse, Inbound, UploadResponse};
use crate::wire::outbound::{self, DownloadRequest};

fn sample(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i % 249) as u8).collect()
}

async fn request(client: &mut Client, path: &str) -> DownloadResponse {
    client.request_download(path, None, None, None, None).await
}

#[tokio::test]
async fn a_close_after_n_bytes_to_the_client_cuts_the_file_at_exactly_n() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f", sample(100_000));
    daemon.script(Fault::Close { after: After::Bytes(Direction::ToClient, 40_000), code: 4001 });
    let mut client = Client::connect(&daemon).await;
    assert!(matches!(request(&mut client, "/f").await, DownloadResponse::Accepted(_)));
    let mut received = 0;
    let code = loop {
        match client.event().await {
            Event::Binary(bytes) => {
                if let Got::Chunk { data, .. } = Got::read(&bytes) {
                    received += data.len();
                }
            }
            Event::Closed(code) => break code,
            other => panic!("unexpected {other:?}"),
        }
    };
    assert_eq!((received, code), (40_000, Some(4001)));
    eventually("the connection to close", || daemon.open_connections() == 0).await;
}

#[tokio::test]
async fn a_close_after_n_frames_to_the_client_counts_file_transfer_frames() {
    let daemon = StandInDaemon::start_with(Config { chunk_bytes: 100, ..Config::default() }).await.unwrap();
    daemon.put_file("/f", sample(1000));
    daemon.script(Fault::Close { after: After::Frames(Direction::ToClient, 3), code: 1001 });
    let mut client = Client::connect(&daemon).await;
    assert!(matches!(request(&mut client, "/f").await, DownloadResponse::Accepted(_)));
    let mut kinds = Vec::new();
    loop {
        match client.event().await {
            Event::Binary(bytes) => kinds.push(matches!(Got::read(&bytes), Got::Begin { .. })),
            Event::Closed(code) => {
                assert_eq!(code, Some(1001));
                break;
            }
            other => panic!("unexpected {other:?}"),
        }
    }
    assert_eq!(kinds, [true, false, false]);
}

#[tokio::test]
async fn a_close_after_text_frames_and_at_the_start() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::Close { after: After::TextFrames(Direction::ToClient, 1), code: 1012 });
    let mut client = Client::open(&daemon.url(), None).await.unwrap();
    client.handshake().await;
    assert!(matches!(client.event().await, Event::Closed(Some(1012))));

    daemon.script(Fault::Close { after: After::Start, code: 1013 });
    let mut client = Client::open(&daemon.url(), None).await.unwrap();
    assert!(matches!(client.event().await, Event::Closed(Some(1013))));
    assert_eq!(daemon.hellos().len(), 1);
}

#[tokio::test]
async fn a_reset_after_n_frames_from_the_client_ends_the_connection_with_no_close_frame_and_keeps_nothing() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::Reset { after: After::Frames(Direction::FromClient, 2) });
    let mut client = Client::connect(&daemon).await;
    let stream = client.accepted_upload("/f", "t-1").await;
    client.send_binary(binary::encode_begin(stream, "t-1")).await;
    client.send_binary(binary::encode_chunk(stream, b"abc").unwrap()).await;
    assert!(matches!(client.event().await, Event::Failed));
    eventually("the connection to close", || daemon.open_connections() == 0).await;
    assert_eq!(daemon.file("/f"), None);
    assert!(daemon.uploads().is_empty());
}

#[tokio::test]
async fn a_close_after_n_bytes_from_the_client_waits_for_the_chunk_that_reaches_n() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::Close { after: After::Bytes(Direction::FromClient, 150), code: 1011 });
    let mut client = Client::connect(&daemon).await;
    let stream = client.accepted_upload("/f", "t-1").await;
    client.send_binary(binary::encode_begin(stream, "t-1")).await;
    client.send_binary(binary::encode_chunk(stream, &[1; 100]).unwrap()).await;
    client.assert_silent().await;
    client.send_binary(binary::encode_chunk(stream, &[2; 100]).unwrap()).await;
    assert!(matches!(client.event().await, Event::Closed(Some(1011))));
}

#[tokio::test]
async fn a_daemon_that_stops_reading_leaves_requests_unread_and_the_socket_open() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::StopReading { after: After::TextFrames(Direction::FromClient, 1) });
    let mut client = Client::connect(&daemon).await;
    client.send(outbound::ping("p", 1)).await;
    client.assert_silent().await;
    let upload = client.id();
    client.send(outbound::upload_request(&upload, "/f", "t-1")).await;
    client.assert_silent().await;
    assert_eq!(daemon.open_connections(), 1);
    // A new connection is served as usual.
    let mut other = Client::connect(&daemon).await;
    other.send(outbound::ping("q", 1)).await;
    assert_eq!(other.text().await, Inbound::Pong { request_id: "q".to_owned() });
}

#[tokio::test]
async fn a_daemon_that_stops_answering_still_reads() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::StopAnswering { after: After::TextFrames(Direction::FromClient, 1) });
    let mut client = Client::connect(&daemon).await;
    client.send(outbound::ping("p", 1)).await;
    client.send(outbound::upload_request("req-1", "/f", "t-1")).await;
    client.assert_silent().await;
    // The first upload on a connection has stream 1.
    client.send_binary(binary::encode_begin(1, "t-1")).await;
    client.send_binary(binary::encode_chunk(1, b"abc").unwrap()).await;
    client.send_binary(binary::encode_end(1, true)).await;
    eventually("the upload to end", || daemon.file("/f").is_some()).await;
    assert_eq!(daemon.file("/f"), Some(b"abc".to_vec()));
    client.assert_silent().await;
}

#[tokio::test]
async fn a_refusal_names_the_error_it_was_given_and_is_used_once() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f", b"x".to_vec());
    let mut client = Client::connect(&daemon).await;

    daemon.script(Fault::no_free_stream(Request::Upload));
    assert_eq!(client.open_upload("/g", "t-1").await, UploadResponse::Refused { error: "no_free_stream".to_owned() });
    assert!(matches!(client.open_upload("/g", "t-1").await, UploadResponse::Accepted { .. }));

    daemon.script(Fault::Refuse { request: Request::Download, error: "unreadable".to_owned() });
    let DownloadResponse::Refused(refusal) = request(&mut client, "/f").await else { panic!("refused") };
    assert_eq!((refusal.error.as_str(), refusal.stream), ("unreadable", None));
    assert!(matches!(request(&mut client, "/f").await, DownloadResponse::Accepted(_)));
    client.stream_frames().await;

    daemon.script(Fault::Refuse { request: Request::Cancel, error: "denied".to_owned() });
    let reply = client.ask(|id| outbound::download_cancel_request(id, 1)).await;
    let cancel = reply.cancel_response().unwrap();
    assert_eq!((cancel.ok, cancel.error.as_deref()), (false, Some("denied")));
    assert_eq!(daemon.pending_faults(), 0);
}

#[tokio::test]
async fn an_rpc_error_answers_the_request_with_the_code_and_message_given() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::RpcError { request: Request::Upload, code: "handler_error".to_owned(), message: "boom".to_owned() });
    let mut client = Client::connect(&daemon).await;
    let id = client.id();
    client.send(outbound::upload_request(&id, "/f", "t-1")).await;
    let Inbound::RpcError(error) = client.text().await else { panic!("an rpc_error") };
    assert_eq!((error.request_id.as_deref(), error.code.as_str(), error.message.as_str()), (Some(id.as_str()), "handler_error", "boom"));
}

#[tokio::test]
async fn a_request_can_go_unanswered_while_the_connection_goes_on() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f", b"x".to_vec());
    let mut client = Client::connect(&daemon).await;

    daemon.script(Fault::Silence { request: Asked::Download });
    let id = client.id();
    client
        .send(outbound::download_request(&DownloadRequest { request_id: &id, path: "/f", stream: None, offset: None, length: None, if_unchanged: None }))
        .await;
    client.assert_silent().await;
    assert!(matches!(request(&mut client, "/f").await, DownloadResponse::Accepted(_)));
    client.stream_frames().await;

    daemon.script(Fault::Silence { request: Asked::Upload });
    let id = client.id();
    client.send(outbound::upload_request(&id, "/g", "t-1")).await;
    client.assert_silent().await;

    daemon.script(Fault::Silence { request: Asked::Cancel });
    let id = client.id();
    client.send(outbound::download_cancel_request(&id, 1)).await;
    client.assert_silent().await;
    assert_eq!(daemon.pending_faults(), 0);
}

#[tokio::test]
async fn a_hello_can_go_unanswered() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::Silence { request: Asked::Hello });
    let mut client = Client::open(&daemon.url(), None).await.unwrap();
    client.send(outbound::hello("c", "1")).await;
    client.assert_silent().await;
    assert_eq!(daemon.hellos().len(), 1);
    client.send(outbound::ping("p", 1)).await;
    assert_eq!(client.text().await, Inbound::Pong { request_id: "p".to_owned() });
}

#[tokio::test]
async fn an_upload_can_fail_at_the_end_and_keep_nothing() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f", b"old".to_vec());
    daemon.script(Fault::UploadFails { error: "rename_failed (EACCES)".to_owned() });
    let mut client = Client::connect(&daemon).await;
    let stream = client.accepted_upload("/f", "t-1").await;
    client.send_upload(stream, "t-1", b"new", 8).await;
    let complete = client.upload_complete().await;
    assert_eq!((complete.ok, complete.error.as_deref(), complete.bytes_written), (false, Some("rename_failed (EACCES)"), 3));
    assert_eq!(daemon.file("/f"), Some(b"old".to_vec()));
    assert_eq!(daemon.uploads()[0].error.as_deref(), Some("rename_failed (EACCES)"));
}

#[tokio::test]
async fn a_wrong_bytes_written_is_reported_while_the_file_is_stored_whole() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.script(Fault::WrongBytesWritten { reported: 999 });
    let mut client = Client::connect(&daemon).await;
    let stream = client.accepted_upload("/f", "t-1").await;
    client.send_upload(stream, "t-1", b"abc", 8).await;
    let complete = client.upload_complete().await;
    assert_eq!((complete.ok, complete.bytes_written), (true, 999));
    assert_eq!(daemon.file("/f"), Some(b"abc".to_vec()));
    assert_eq!(daemon.uploads()[0].bytes_received, 3);
}
