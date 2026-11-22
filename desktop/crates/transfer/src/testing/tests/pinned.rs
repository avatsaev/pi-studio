//! Every frame the stand-in sends, against the published fixtures
//! (`packages/protocol/fixtures/external-clients/`), so that it cannot drift from the contract
//! unnoticed. The stand-in's frames are compared with the fixture's `frame` except at its
//! `volatile` pointers, where the presence and the JSON type must match and the value may differ.
//! The requests are the fixtures' own frames, sent as they are.

use std::path::PathBuf;

use serde_json::{Value, json};

use super::client::Client;
use crate::testing::{Fault, StandInDaemon, StreamFault};
use crate::wire::binary;
use crate::wire::outbound;

/// The file the download fixtures name; its mtime is the fixtures'.
const FIXTURE_MTIME_MS: u64 = 1_767_225_600_000;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../packages/protocol/fixtures/external-clients")).join(format!("{name}.json"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// `text` is the fixture's frame, except at the volatile pointers. `extra` are pointers the
/// stand-in's frame has beyond the fixture's (the fixture pins a subset of the feature flags).
fn assert_matches(text: &str, fixture: &Value, extra: &[&str]) {
    let mut actual: Value = serde_json::from_str(text).expect("the stand-in's frame is JSON");
    let mut expected = fixture["frame"].clone();
    for pointer in extra {
        let (parent, key) = pointer.rsplit_once('/').expect("a pointer with a key");
        let removed = actual.pointer_mut(parent).and_then(Value::as_object_mut).and_then(|object| object.remove(key));
        assert!(removed.is_some(), "the stand-in's frame lacks {pointer}");
    }
    for pointer in fixture["volatile"].as_array().expect("a fixture lists its volatile pointers") {
        let pointer = pointer.as_str().expect("a pointer is a string");
        let ours = actual.pointer_mut(pointer).unwrap_or_else(|| panic!("the stand-in's frame lacks {pointer}"));
        let theirs = expected.pointer_mut(pointer).unwrap_or_else(|| panic!("the fixture lacks {pointer}"));
        assert_eq!(kind(ours), kind(theirs), "{pointer} changed type");
        *ours = Value::Null;
        *theirs = Value::Null;
    }
    assert_eq!(actual, expected);
}

/// The bytes a binary fixture spells in `hex`.
fn hex_bytes(fixture: &Value) -> Vec<u8> {
    fixture["hex"].as_str().expect("a hex string").split_whitespace().map(|byte| u8::from_str_radix(byte, 16).expect("a hex byte")).collect()
}

/// A frame as the fixture has it, with the stream byte aside (the fixtures' streams are arbitrary).
fn without_stream(frame: &[u8]) -> (u8, &[u8]) {
    (frame[0], &frame[2..])
}

/// A daemon that holds the fixtures' file: 32 bytes, `hello` first, at the fixtures' time.
async fn started() -> StandInDaemon {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut data = b"hello".to_vec();
    data.resize(32, b'.');
    daemon.put_file_at("/FAKE/path/to/hello.txt", data, FIXTURE_MTIME_MS);
    daemon
}

#[tokio::test]
async fn the_status_matches_its_fixture_and_lists_the_features_the_engine_needs() {
    let daemon = started().await;
    let mut client = Client::open(&daemon.url(), None).await.unwrap();
    client.send(outbound::hello("client-1", "0.2.0-test")).await;
    let status = fixture("status.server_info");
    assert_matches(
        &client.raw_text().await,
        &status,
        &["/payload/features/fileDownloadRanges", "/payload/features/fileTransferAck", "/payload/features/agentStreamsMode"],
    );
}

#[tokio::test]
async fn the_hello_the_stand_in_accepts_is_the_fixtures() {
    let daemon = started().await;
    let mut client = Client::open(&daemon.url(), None).await.unwrap();
    // The fixture's hello (a `cli` client with capabilities) and the engine's own are both accepted.
    client.send(fixture("hello")["frame"].to_string()).await;
    client.raw_text().await;
    let mut engine = Client::open(&daemon.url(), None).await.unwrap();
    engine.send(fixture("hello.agentStreams")["frame"].to_string()).await;
    engine.raw_text().await;
    assert_eq!(daemon.hellos().len(), 2);
}

#[tokio::test]
async fn the_pong_matches_its_fixture_and_repeats_the_ping() {
    let daemon = started().await;
    let mut client = Client::connect(&daemon).await;
    let ping = fixture("ping");
    client.send(ping["frame"].to_string()).await;
    let raw = client.raw_text().await;
    assert_matches(&raw, &fixture("pong"), &[]);
    let pong: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(pong["requestId"], ping["frame"]["requestId"]);
    assert_eq!(pong["clientSentAt"], ping["frame"]["clientSentAt"]);
}

#[tokio::test]
async fn an_unknown_request_matches_the_rpc_error_fixture() {
    let daemon = started().await;
    let mut client = Client::connect(&daemon).await;
    let error = fixture("rpc_error");
    let request = json!({"type": "session", "message": {"type": "scenario_no_such_type", "requestId": "req-1"}});
    client.send(request.to_string()).await;
    assert_matches(&client.raw_text().await, &error, &[]);
}

#[tokio::test]
async fn the_upload_frames_match_their_fixtures() {
    let daemon = started().await;
    let mut client = Client::connect(&daemon).await;
    let request = fixture("file_upload_request");
    let transfer_id = request["frame"]["message"]["transferId"].as_str().unwrap().to_owned();
    client.send(request["frame"].to_string()).await;
    let raw = client.raw_text().await;
    assert_matches(&raw, &fixture("file_upload_response"), &[]);
    let stream = serde_json::from_str::<Value>(&raw).unwrap()["message"]["stream"].as_u64().unwrap() as u8;

    client.send_upload(stream, &transfer_id, &[7; 30], 1024).await;
    let raw = client.raw_text().await;
    assert_matches(&raw, &fixture("file_upload_complete"), &[]);
    let complete: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(complete["message"]["transferId"], json!(transfer_id));
    assert_eq!(complete["message"]["bytesWritten"], json!(30));
    // The `ack` the fixture's request carries is what makes the push come.
    assert_eq!(request["frame"]["message"]["ack"], json!(true));
}

#[tokio::test]
async fn the_download_frames_match_their_fixtures() {
    let daemon = started().await;
    let mut client = Client::connect(&daemon).await;
    let mut request = fixture("file_download_request.range")["frame"].clone();
    request["message"]["path"] = json!("/FAKE/path/to/hello.txt");
    // The fixture's request (offset 8, length 16, guarded by the fixture's size and time) is accepted.
    client.send(request.to_string()).await;
    let raw = client.raw_text().await;
    let response = fixture("file_download_response");
    assert_matches(&raw, &response, &[]);
    let reply: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(reply["message"]["requestId"], request["message"]["requestId"]);
    assert_eq!(reply["message"]["totalBytes"], response["frame"]["message"]["totalBytes"]);
    assert_eq!((reply["message"]["offset"].clone(), reply["message"]["length"].clone()), (json!(8), json!(16)));
    assert_eq!(reply["message"]["mtimeMs"], json!(FIXTURE_MTIME_MS));

    let begin = fixture("binary/file_transfer.begin.download");
    let frame = client.raw_binary().await;
    let (opcode, payload) = without_stream(&frame);
    assert_eq!(opcode, 0x10);
    let meta: Value = serde_json::from_slice(payload).unwrap();
    let theirs: Value = serde_json::from_slice(&hex_bytes(&begin)[2..]).unwrap();
    // The fixture's file is `hello.txt` of 32 bytes at 8 for 16; only the transfer id is the daemon's.
    let (mut ours, mut theirs) = (meta, theirs);
    assert!(ours["transferId"].is_string());
    ours["transferId"] = Value::Null;
    theirs["transferId"] = Value::Null;
    assert_eq!(ours, theirs);
    assert_eq!(frame[1], reply["message"]["stream"].as_u64().unwrap() as u8);

    let chunk = fixture("binary/file_transfer.chunk");
    let hello = hex_bytes(&chunk);
    let frame = client.raw_binary().await;
    assert_eq!(without_stream(&frame).0, hello[0]);
    assert_eq!(frame.len(), 2 + 16, "the range is 16 bytes of the file");

    let end = hex_bytes(&fixture("binary/file_transfer.end"));
    let frame = client.raw_binary().await;
    assert_eq!(without_stream(&frame), without_stream(&end));
}

#[tokio::test]
async fn a_chunk_of_the_fixtures_data_and_an_error_frame_match_their_fixtures() {
    let daemon = started().await;
    daemon.put_file("/hello", b"hello".to_vec());
    let mut client = Client::connect(&daemon).await;
    daemon.script(Fault::DownloadStream(StreamFault::ErrorAfter { bytes: 5, message: "read_failed".to_owned() }));
    let id = client.id();
    client
        .send(outbound::download_request(&outbound::DownloadRequest {
            request_id: &id,
            path: "/hello",
            stream: None,
            offset: None,
            length: None,
            if_unchanged: None,
        }))
        .await;
    client.raw_text().await;
    client.raw_binary().await;
    let chunk = client.raw_binary().await;
    let fixture_chunk = hex_bytes(&fixture("binary/file_transfer.chunk"));
    assert_eq!(without_stream(&chunk), without_stream(&fixture_chunk));
    let error = client.raw_binary().await;
    let fixture_error = hex_bytes(&fixture("binary/file_transfer.error"));
    assert_eq!(without_stream(&error), without_stream(&fixture_error));
}

#[tokio::test]
async fn a_refused_download_and_a_cancel_that_finds_nothing_match_their_fixtures() {
    let daemon = started().await;
    let mut client = Client::connect(&daemon).await;
    let mut request = fixture("file_download_request")["frame"].clone();
    request["message"]["path"] = json!("/FAKE/does/not/exist");
    client.send(request.to_string()).await;
    assert_matches(&client.raw_text().await, &fixture("file_download_response.rejected"), &[]);

    let cancel = fixture("file_download_cancel_request");
    client.send(cancel["frame"].to_string()).await;
    assert_matches(&client.raw_text().await, &fixture("file_download_cancel_response"), &[]);
}

#[tokio::test]
async fn what_the_stand_in_sends_is_what_the_wire_module_encodes_for_the_frames_both_ways() {
    // `End` and `Error` are the same bytes whichever side sends them, so `wire`'s encoders and the
    // stand-in's must agree.
    let daemon = started().await;
    daemon.put_file("/hello", b"hello".to_vec());
    daemon.script(Fault::DownloadStream(StreamFault::ErrorAfter { bytes: 5, message: "read_failed".to_owned() }));
    let mut client = Client::connect(&daemon).await;
    let id = client.id();
    client
        .send(outbound::download_request(&outbound::DownloadRequest {
            request_id: &id,
            path: "/hello",
            stream: Some(3),
            offset: None,
            length: None,
            if_unchanged: None,
        }))
        .await;
    client.raw_text().await;
    client.raw_binary().await;
    assert_eq!(client.raw_binary().await, binary::encode_chunk(3, b"hello").unwrap());
    assert_eq!(client.raw_binary().await, binary::encode_error(3, "read_failed").unwrap());
    let mut again = Client::connect(&daemon).await;
    let id = again.id();
    again
        .send(outbound::download_request(&outbound::DownloadRequest {
            request_id: &id,
            path: "/hello",
            stream: Some(3),
            offset: None,
            length: None,
            if_unchanged: None,
        }))
        .await;
    again.raw_text().await;
    again.raw_binary().await;
    again.raw_binary().await;
    assert_eq!(again.raw_binary().await, binary::encode_end(3, true));
}
