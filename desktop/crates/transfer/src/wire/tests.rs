//! The wire code against the published fixtures (`packages/protocol/fixtures/external-clients/`), read
//! from the repository, and against hostile input (`hostile`).
//!
//! An outbound frame must equal its fixture's `frame` except at the fixture's `volatile` pointers,
//! where the presence and the JSON type must match and the value may differ. An inbound fixture is
//! read into the value it spells out. A binary fixture is decoded, and what an upload sends is
//! encoded back to the same bytes. A fixture that changes shape fails these tests.

use std::path::PathBuf;

use serde_json::{Value, json};

use super::binary::{self, BeginMeta, FileFrame};
use super::inbound::{
    CancelResponse, DownloadAccepted, DownloadRefused, DownloadResponse, Inbound, Ping, Reply, RpcError, ServerInfo, UploadComplete, UploadResponse,
};
use super::outbound::{self, DownloadRequest, IfUnchanged};
use crate::Error;

mod hostile;

fn fixture_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../packages/protocol/fixtures/external-clients"))
}

/// A fixture file (`name` without `.json`; `binary/…` for a binary frame).
fn fixture(name: &str) -> Value {
    let path = fixture_dir().join(format!("{name}.json"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

/// The text of a fixture's `frame`.
fn frame_text(fixture: &Value) -> String {
    fixture["frame"].to_string()
}

fn json_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// `text` is the fixture's frame, except that each `volatile` pointer holds a value of the same JSON
/// type. `ignored` are top-level keys the fixture has and the engine does not send.
fn assert_matches_fixture(text: &str, fixture: &Value, ignored: &[&str]) {
    let mut actual: Value = serde_json::from_str(text).expect("the engine's frame is JSON");
    let mut expected = fixture["frame"].clone();
    for key in ignored {
        let removed = expected.as_object_mut().and_then(|object| object.remove(*key));
        assert!(removed.is_some(), "the fixture no longer has `{key}`");
    }
    let volatile = fixture["volatile"].as_array().expect("a fixture lists its volatile pointers");
    for pointer in volatile {
        let pointer = pointer.as_str().expect("a pointer is a string");
        let ours = actual.pointer_mut(pointer).unwrap_or_else(|| panic!("the engine's frame lacks {pointer}"));
        let theirs = expected.pointer_mut(pointer).unwrap_or_else(|| panic!("the fixture lacks {pointer}"));
        assert_eq!(json_kind(ours), json_kind(theirs), "{pointer} changed type");
        *ours = Value::Null;
        *theirs = Value::Null;
    }
    assert_eq!(actual, expected);
}

fn at<'a>(fixture: &'a Value, pointer: &str) -> &'a Value {
    fixture.pointer(pointer).unwrap_or_else(|| panic!("the fixture lacks {pointer}"))
}

fn text_at(fixture: &Value, pointer: &str) -> String {
    at(fixture, pointer).as_str().unwrap_or_else(|| panic!("{pointer} is not a string")).to_owned()
}

fn number_at(fixture: &Value, pointer: &str) -> u64 {
    at(fixture, pointer).as_u64().unwrap_or_else(|| panic!("{pointer} is not a whole number"))
}

fn stream_at(fixture: &Value, pointer: &str) -> u8 {
    u8::try_from(number_at(fixture, pointer)).expect("a stream fits a byte")
}

fn protocol_error(result: Result<impl std::fmt::Debug, Error>) {
    assert!(matches!(result, Err(Error::Protocol(_))), "expected a protocol error, got {result:?}");
}

// ---- outbound text ---------------------------------------------------------------------------

#[test]
fn hello_equals_its_fixture_without_capabilities() {
    let fixture = fixture("hello.agentStreams");
    let text = outbound::hello("client-2", &text_at(&fixture, "/frame/appVersion"));
    assert_matches_fixture(&text, &fixture, &["capabilities"]);
    assert!(at(&fixture, "/frame/capabilities").is_object(), "the fixture's capabilities are what the engine leaves out");
}

#[test]
fn the_upload_request_equals_its_fixture() {
    let fixture = fixture("file_upload_request");
    let text = outbound::upload_request("req-9", "/tmp/other.txt", "transfer-9");
    assert_matches_fixture(&text, &fixture, &[]);
}

#[test]
fn the_download_request_equals_its_fixtures() {
    let first = fixture("file_download_request");
    let text = outbound::download_request(&DownloadRequest {
        request_id: "req-9",
        path: "/other",
        stream: Some(stream_at(&first, "/frame/message/stream")),
        offset: None,
        length: None,
        if_unchanged: None,
    });
    assert_matches_fixture(&text, &first, &[]);

    let ranged = fixture("file_download_request.range");
    let text = outbound::download_request(&DownloadRequest {
        request_id: "req-9",
        path: "/other",
        stream: None,
        offset: Some(number_at(&ranged, "/frame/message/offset")),
        length: Some(number_at(&ranged, "/frame/message/length")),
        if_unchanged: Some(IfUnchanged { size: 7, mtime_ms: 8 }),
    });
    assert_matches_fixture(&text, &ranged, &[]);
}

#[test]
fn a_resume_request_carries_the_offset_and_the_guard_and_no_length() {
    let text = outbound::download_request(&DownloadRequest {
        request_id: "r",
        path: "/p",
        stream: Some(4),
        offset: Some(5 * 1024 * 1024 * 1024),
        length: None,
        if_unchanged: Some(IfUnchanged { size: 6 * 1024 * 1024 * 1024, mtime_ms: 1_767_225_600_000 }),
    });
    let frame: Value = serde_json::from_str(&text).expect("JSON");
    assert_eq!(
        frame,
        json!({"type": "session", "message": {
            "type": "file_download_request", "requestId": "r", "path": "/p", "stream": 4,
            "offset": 5_368_709_120_u64,
            "ifUnchanged": {"size": 6_442_450_944_u64, "mtimeMs": 1_767_225_600_000_u64},
        }})
    );
}

#[test]
fn the_cancel_request_equals_its_fixture() {
    let fixture = fixture("file_download_cancel_request");
    let text = outbound::download_cancel_request("req-9", stream_at(&fixture, "/frame/message/stream"));
    assert_matches_fixture(&text, &fixture, &[]);
}

#[test]
fn ping_and_pong_equal_their_fixtures() {
    let ping = fixture("ping");
    assert_matches_fixture(&outbound::ping("req-9", number_at(&ping, "/frame/clientSentAt")), &ping, &[]);

    let pong = fixture("pong");
    let text = outbound::pong(
        "req-9",
        Some(number_at(&pong, "/frame/clientSentAt")),
        number_at(&pong, "/frame/serverReceivedAt"),
        number_at(&pong, "/frame/serverSentAt"),
    );
    assert_matches_fixture(&text, &pong, &[]);

    let without = outbound::pong("req-9", None, 1, 2);
    assert!(!without.contains("clientSentAt"));
}

// ---- inbound text ----------------------------------------------------------------------------

fn parse(fixture: &Value) -> Inbound {
    Inbound::parse(&frame_text(fixture)).expect("the fixture parses")
}

fn reply(fixture: &Value) -> Reply {
    match parse(fixture) {
        Inbound::Reply(reply) => reply,
        other => panic!("expected a reply, got {other:?}"),
    }
}

#[test]
fn server_info_reads_the_three_flags_and_a_missing_flag_is_false() {
    let fixture = fixture("status.server_info");
    assert_eq!(parse(&fixture), Inbound::ServerInfo(ServerInfo { file_download_ranges: false, file_transfer_ack: false, agent_streams_mode: false }));

    let mut frame = fixture["frame"].clone();
    for flag in ["fileDownloadRanges", "fileTransferAck", "agentStreamsMode"] {
        frame["payload"]["features"][flag] = json!(true);
    }
    let Ok(Inbound::ServerInfo(info)) = Inbound::parse(&frame.to_string()) else { panic!("server_info") };
    assert_eq!(info, ServerInfo { file_download_ranges: true, file_transfer_ack: true, agent_streams_mode: true });
    assert_eq!(info.require_features(), Ok(()));
}

#[test]
fn a_daemon_without_a_feature_is_unsupported_and_the_error_names_it() {
    let all = ServerInfo { file_download_ranges: true, file_transfer_ack: true, agent_streams_mode: true };
    let cases = [
        (ServerInfo { file_download_ranges: false, ..all }, "fileDownloadRanges"),
        (ServerInfo { file_transfer_ack: false, ..all }, "fileTransferAck"),
        (ServerInfo { agent_streams_mode: false, ..all }, "agentStreamsMode"),
    ];
    for (info, missing) in cases {
        assert_eq!(info.require_features(), Err(Error::UnsupportedDaemon { missing }));
    }
}

#[test]
fn a_status_that_is_not_server_info_is_other() {
    let frame = json!({"type": "status", "payload": {"status": "agent_idle"}});
    assert_eq!(Inbound::parse(&frame.to_string()), Ok(Inbound::Other { kind: "status".into() }));
}

#[test]
fn the_features_of_a_server_info_are_an_object_or_absent() {
    for features in [json!("yes"), json!(true), json!(5), json!([1, 2])] {
        let frame = json!({"type": "status", "payload": {"status": "server_info", "features": features}});
        protocol_error(Inbound::parse(&frame.to_string()));
    }
    let none = Inbound::ServerInfo(ServerInfo { file_download_ranges: false, file_transfer_ack: false, agent_streams_mode: false });
    for payload in [json!({"status": "server_info"}), json!({"status": "server_info", "features": null})] {
        let frame = json!({"type": "status", "payload": payload});
        assert_eq!(Inbound::parse(&frame.to_string()), Ok(none.clone()));
    }
}

#[test]
fn ping_and_pong_are_read() {
    let ping = fixture("ping");
    assert_eq!(
        parse(&ping),
        Inbound::Ping(Ping { request_id: text_at(&ping, "/frame/requestId"), client_sent_at: Some(number_at(&ping, "/frame/clientSentAt")) })
    );
    let bare = json!({"type": "ping", "requestId": "a"});
    assert_eq!(Inbound::parse(&bare.to_string()), Ok(Inbound::Ping(Ping { request_id: "a".into(), client_sent_at: None })));

    let pong = fixture("pong");
    assert_eq!(parse(&pong), Inbound::Pong { request_id: text_at(&pong, "/frame/requestId") });
}

#[test]
fn rpc_error_is_read() {
    let fixture = fixture("rpc_error");
    assert_eq!(
        parse(&fixture),
        Inbound::RpcError(RpcError {
            request_id: Some(text_at(&fixture, "/frame/message/requestId")),
            code: "unknown_message_type".into(),
            message: "no handler for scenario_no_such_type".into(),
        })
    );
}

#[test]
fn the_upload_response_is_read() {
    let fixture = fixture("file_upload_response");
    let reply = reply(&fixture);
    assert_eq!(reply.request_id, text_at(&fixture, "/frame/message/requestId"));
    assert_eq!(reply.kind, "file_upload_response");
    assert_eq!(reply.upload_response(), Ok(UploadResponse::Accepted { stream: stream_at(&fixture, "/frame/message/stream") }));

    let refused = json!({"type": "session", "message": {
        "type": "file_upload_response", "ok": false, "error": "no_free_stream", "requestId": "r"}});
    let Ok(Inbound::Reply(refused)) = Inbound::parse(&refused.to_string()) else { panic!("reply") };
    assert_eq!(refused.upload_response(), Ok(UploadResponse::Refused { error: "no_free_stream".into() }));
}

#[test]
fn upload_complete_is_read() {
    let fixture = fixture("file_upload_complete");
    assert_eq!(
        parse(&fixture),
        Inbound::UploadComplete(UploadComplete {
            transfer_id: text_at(&fixture, "/frame/message/transferId"),
            stream: stream_at(&fixture, "/frame/message/stream"),
            ok: true,
            bytes_written: number_at(&fixture, "/frame/message/bytesWritten"),
            error: None,
        })
    );

    let failed = json!({"type": "session", "message": {
        "type": "file_upload_complete", "transferId": "t", "stream": 2, "ok": false, "bytesWritten": 0, "error": "disk full"}});
    let Ok(Inbound::UploadComplete(failed)) = Inbound::parse(&failed.to_string()) else { panic!("complete") };
    assert!(!failed.ok);
    assert_eq!(failed.error.as_deref(), Some("disk full"));
}

#[test]
fn the_download_response_is_read() {
    let fixture = fixture("file_download_response");
    assert_eq!(
        reply(&fixture).download_response(),
        Ok(DownloadResponse::Accepted(DownloadAccepted {
            stream: stream_at(&fixture, "/frame/message/stream"),
            transfer_id: text_at(&fixture, "/frame/message/transferId"),
            total_bytes: 32,
            mtime_ms: number_at(&fixture, "/frame/message/mtimeMs"),
            offset: number_at(&fixture, "/frame/message/offset"),
            length: number_at(&fixture, "/frame/message/length"),
        }))
    );
}

#[test]
fn the_refused_download_response_is_read() {
    let fixture = fixture("file_download_response.rejected");
    assert_eq!(
        reply(&fixture).download_response(),
        Ok(DownloadResponse::Refused(DownloadRefused {
            error: "not_found".into(),
            stream: Some(stream_at(&fixture, "/frame/message/stream")),
            total_bytes: None,
            mtime_ms: None,
        }))
    );

    let changed = json!({"type": "session", "message": {
        "type": "file_download_response", "ok": false, "error": "changed", "totalBytes": 40, "mtimeMs": 99, "requestId": "r"}});
    let Ok(Inbound::Reply(changed)) = Inbound::parse(&changed.to_string()) else { panic!("reply") };
    assert_eq!(
        changed.download_response(),
        Ok(DownloadResponse::Refused(DownloadRefused { error: "changed".into(), stream: None, total_bytes: Some(40), mtime_ms: Some(99) }))
    );
}

#[test]
fn the_cancel_response_is_read() {
    let fixture = fixture("file_download_cancel_response");
    assert_eq!(reply(&fixture).cancel_response(), Ok(CancelResponse { ok: false, error: Some("not_found".into()) }));
    let stopped = json!({"type": "session", "message": {"type": "file_download_cancel_response", "ok": true, "requestId": "r"}});
    let Ok(Inbound::Reply(stopped)) = Inbound::parse(&stopped.to_string()) else { panic!("reply") };
    assert_eq!(stopped.cancel_response(), Ok(CancelResponse { ok: true, error: None }));
}

#[test]
fn a_reader_refuses_an_answer_of_another_kind() {
    protocol_error(reply(&fixture("file_upload_response")).download_response());
    protocol_error(reply(&fixture("file_download_response")).cancel_response());
    protocol_error(reply(&fixture("file_download_cancel_response")).upload_response());
}

#[test]
fn anything_else_is_read_by_its_type_only() {
    let update = fixture("agent_update");
    let kind = text_at(&update, "/frame/message/type");
    assert_eq!(parse(&update), Inbound::Other { kind });

    let top = json!({"type": "something_new", "payload": {"deep": [1, 2, 3]}});
    assert_eq!(Inbound::parse(&top.to_string()), Ok(Inbound::Other { kind: "something_new".into() }));

    // A session message with no requestId is not an answer.
    let message = json!({"type": "session", "message": {"type": "terminals_update", "n": 1}});
    assert_eq!(Inbound::parse(&message.to_string()), Ok(Inbound::Other { kind: "terminals_update".into() }));
}

#[test]
fn a_reply_keeps_every_field_for_the_caller() {
    let fixture = fixture("list_agents_response");
    let reply = reply(&fixture);
    assert_eq!(reply.request_id, text_at(&fixture, "/frame/message/requestId"));
    assert_eq!(Value::Object(reply.fields), fixture["frame"]["message"]);
}

#[test]
fn sizes_of_5_gib_and_2_pow_53_minus_1_are_read_exactly() {
    let five_gib: u64 = 5 * 1024 * 1024 * 1024;
    let largest: u64 = (1 << 53) - 1;
    for total in [five_gib, largest] {
        let frame = json!({"type": "session", "message": {
            "type": "file_download_response", "ok": true, "stream": 1, "transferId": "t",
            "totalBytes": total, "mtimeMs": 1, "offset": total - 1, "length": 1, "requestId": "r"}});
        let Ok(Inbound::Reply(reply)) = Inbound::parse(&frame.to_string()) else { panic!("reply") };
        let Ok(DownloadResponse::Accepted(accepted)) = reply.download_response() else { panic!("accepted") };
        assert_eq!((accepted.total_bytes, accepted.offset, accepted.length), (total, total - 1, 1));

        let complete = json!({"type": "session", "message": {
            "type": "file_upload_complete", "transferId": "t", "stream": 1, "ok": true, "bytesWritten": total}});
        let Ok(Inbound::UploadComplete(complete)) = Inbound::parse(&complete.to_string()) else { panic!("complete") };
        assert_eq!(complete.bytes_written, total);

        let begin = format!("{{\"transferId\":\"t\",\"totalBytes\":{total},\"offset\":{total},\"length\":{total}}}");
        let mut bytes = vec![0x10, 1];
        bytes.extend_from_slice(begin.as_bytes());
        let Ok(FileFrame::Begin { meta, .. }) = binary::decode(&bytes) else { panic!("begin") };
        assert_eq!((meta.total_bytes, meta.offset, meta.length), (Some(total), Some(total), Some(total)));
    }
}

#[test]
fn numbers_that_do_not_fit_are_errors() {
    let too_big = (1_u64 << 53).to_string();
    for bad in [too_big.as_str(), "-1", "1.5", "5.0", "1e3", "\"5\"", "true", "18446744073709551616"] {
        let text = format!(
            "{{\"type\":\"session\",\"message\":{{\"type\":\"file_upload_complete\",\"transferId\":\"t\",\"stream\":1,\"ok\":true,\"bytesWritten\":{bad}}}}}"
        );
        protocol_error(Inbound::parse(&text));
        let begin = format!("{{\"transferId\":\"t\",\"totalBytes\":{bad}}}");
        let mut bytes = vec![0x10, 1];
        bytes.extend_from_slice(begin.as_bytes());
        protocol_error(binary::decode(&bytes));
    }
    for bad in ["256", "-1", "1.5", "\"1\""] {
        let text = format!("{{\"type\":\"session\",\"message\":{{\"type\":\"file_upload_response\",\"ok\":true,\"stream\":{bad},\"requestId\":\"r\"}}}}");
        let Ok(Inbound::Reply(reply)) = Inbound::parse(&text) else { panic!("reply") };
        protocol_error(reply.upload_response());
    }
}

#[test]
fn a_broken_envelope_is_a_protocol_error_that_does_not_repeat_it() {
    for text in [
        "",
        "null",
        "[]",
        "\"text\"",
        "{}",
        "{\"type\":5}",
        "{\"type\":\"session\"}",
        "{\"type\":\"session\",\"message\":3}",
        "{\"type\":\"session\",\"message\":{}}",
        "{\"type\":\"ping\"}",
        "{\"type\":\"pong\",\"requestId\":1}",
        "not json at all",
    ] {
        let Err(Error::Protocol(text_of_error)) = Inbound::parse(text) else { panic!("{text:?} should be an error") };
        assert!(text.len() < 8 || !text_of_error.contains(text), "the error repeats the frame");
    }
}

// ---- binary frames ---------------------------------------------------------------------------

fn bytes_of(hex: &str) -> Vec<u8> {
    hex.split_whitespace().map(|pair| u8::from_str_radix(pair, 16).expect("hex")).collect()
}

fn frame_bytes(fixture: &Value) -> Vec<u8> {
    bytes_of(fixture["hex"].as_str().expect("a binary fixture has hex"))
}

fn binary_fixture(name: &str) -> (Vec<u8>, Value) {
    let fixture = fixture(&format!("binary/{name}"));
    (frame_bytes(&fixture), fixture)
}

fn begin_meta_from(decoded: &Value) -> BeginMeta {
    let meta = &decoded["meta"];
    let opt = |key: &str| meta.get(key).and_then(Value::as_u64);
    let text = |key: &str| meta.get(key).and_then(Value::as_str).map(str::to_owned);
    BeginMeta {
        transfer_id: text("transferId").expect("transferId"),
        file_name: text("fileName"),
        mime_type: text("mimeType"),
        total_bytes: opt("totalBytes"),
        mtime_ms: opt("mtimeMs"),
        offset: opt("offset"),
        length: opt("length"),
    }
}

#[test]
fn both_begin_fixtures_are_decoded_to_their_meta() {
    for name in ["file_transfer.begin", "file_transfer.begin.download"] {
        let (bytes, fixture) = binary_fixture(name);
        let decoded = &fixture["decoded"];
        assert_eq!(decoded["opcode"], "Begin");
        let stream = stream_at(decoded, "/stream");
        assert_eq!(binary::decode(&bytes), Ok(FileFrame::Begin { stream, meta: begin_meta_from(decoded) }));
        // The fixture's `meta` is the JSON in its `hex`: compared as parsed JSON, not as bytes.
        let payload: Value = serde_json::from_slice(&bytes[2..]).expect("JSON");
        assert_eq!(payload, decoded["meta"]);
    }
    let (_, download) = binary_fixture("file_transfer.begin.download");
    let meta = begin_meta_from(&download["decoded"]);
    assert_eq!((meta.total_bytes, meta.mtime_ms, meta.offset, meta.length), (Some(32), Some(1_767_225_600_000), Some(8), Some(16)));
}

#[test]
fn the_upload_begin_carries_the_transfer_id_alone_and_reads_back() {
    let (_, fixture) = binary_fixture("file_transfer.begin");
    let decoded = &fixture["decoded"];
    let stream = stream_at(decoded, "/stream");
    let transfer_id = text_at(decoded, "/meta/transferId");
    let frame = binary::encode_begin(stream, &transfer_id);
    assert_eq!(&frame[..2], &[0x10, stream]);
    let payload: Value = serde_json::from_slice(&frame[2..]).expect("JSON");
    assert_eq!(payload, json!({"transferId": transfer_id}));
    let Ok(FileFrame::Begin { stream: read_stream, meta }) = binary::decode(&frame) else { panic!("begin") };
    assert_eq!((read_stream, meta.transfer_id.as_str()), (stream, transfer_id.as_str()));
    assert_eq!((meta.file_name, meta.total_bytes), (None, None));
}

#[test]
fn the_chunk_fixture_round_trips() {
    let (bytes, fixture) = binary_fixture("file_transfer.chunk");
    let decoded = &fixture["decoded"];
    let stream = stream_at(decoded, "/stream");
    let data = bytes_of(decoded["dataHex"].as_str().expect("dataHex"));
    assert_eq!(binary::decode(&bytes), Ok(FileFrame::Chunk { stream, data: &data }));
    assert_eq!(binary::encode_chunk(stream, &data), Ok(bytes));
}

#[test]
fn the_end_fixture_round_trips_and_one_byte_is_the_marker() {
    let (bytes, fixture) = binary_fixture("file_transfer.end");
    let decoded = &fixture["decoded"];
    let stream = stream_at(decoded, "/stream");
    let ok = decoded["ok"].as_bool().expect("ok");
    assert_eq!(binary::decode(&bytes), Ok(FileFrame::End { stream, ok }));
    assert_eq!(binary::encode_end(stream, ok), bytes);
    assert_eq!(binary::encode_end(stream, false), vec![0x12, stream, 0]);
    assert_eq!(binary::decode(&[0x12, 9, 0]), Ok(FileFrame::End { stream: 9, ok: false }));
    assert_eq!(binary::decode(&[0x12, 9, 7, 1, 2]), Ok(FileFrame::End { stream: 9, ok: true }));
    assert_eq!(binary::decode(&[0x12, 9]), Ok(FileFrame::End { stream: 9, ok: true }));
}

#[test]
fn the_error_fixture_round_trips() {
    let (bytes, fixture) = binary_fixture("file_transfer.error");
    let decoded = &fixture["decoded"];
    let stream = stream_at(decoded, "/stream");
    let message = text_at(decoded, "/message");
    assert_eq!(binary::decode(&bytes), Ok(FileFrame::Error { stream, message: message.clone() }));
    assert_eq!(binary::encode_error(stream, &message), Ok(bytes));
}

#[test]
fn every_decoded_frame_knows_its_stream() {
    for name in ["begin", "begin.download", "chunk", "end", "error"] {
        let (bytes, fixture) = binary_fixture(&format!("file_transfer.{name}"));
        let frame = binary::decode(&bytes).expect("decodes");
        assert_eq!(frame.stream(), stream_at(&fixture["decoded"], "/stream"));
    }
}

#[test]
fn a_frame_shorter_than_its_header_an_unknown_opcode_and_a_bad_begin_are_errors() {
    protocol_error(binary::decode(&[]));
    protocol_error(binary::decode(&[0x11]));
    for opcode in [0x00, 0x01, 0x0f, 0x14, 0x7f, 0xff] {
        protocol_error(binary::decode(&[opcode, 1, 2, 3]));
    }
    for payload in [&b""[..], b"not json", b"[]", b"{}", b"{\"transferId\":5}", b"{\"transferId\":\"t\",\"fileName\":3}", b"\xff\xfe"] {
        let mut frame = vec![0x10, 1];
        frame.extend_from_slice(payload);
        protocol_error(binary::decode(&frame));
    }
}

#[test]
fn a_frame_over_the_message_limit_is_refused_before_it_is_read() {
    let limit = crate::limits::MAX_MESSAGE_BYTES;
    let mut frame = vec![0x11, 1];
    frame.resize(limit + 1, 0);
    protocol_error(binary::decode(&frame));
    frame.truncate(limit);
    assert!(matches!(binary::decode(&frame), Ok(FileFrame::Chunk { .. })));
    protocol_error(binary::encode_chunk(1, &frame));
    assert!(binary::encode_chunk(1, &frame[..limit - 2]).is_ok());
    protocol_error(Inbound::parse(&" ".repeat(limit + 1)));

    let mut long_begin = vec![0x10, 1];
    long_begin.extend_from_slice(format!("{{\"transferId\":\"{}\"}}", "x".repeat(70_000)).as_bytes());
    protocol_error(binary::decode(&long_begin));
}

#[test]
fn only_the_four_file_transfer_opcodes_are_the_engines() {
    for opcode in 0..=u8::MAX {
        assert_eq!(binary::is_file_transfer(opcode), (0x10..=0x13).contains(&opcode), "opcode {opcode:#04x}");
    }
}
