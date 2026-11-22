//! Downloads from memory: the answer first, then `Begin`, `Chunk`s and `End`; ranges, the
//! `ifUnchanged` guard, the real daemon's refusals and the cancel.

use std::time::Duration;

use serde_json::json;

use super::client::{Client, Downloaded, Got};
use crate::testing::{Config, StandInDaemon};
use crate::wire::inbound::{DownloadRefused, DownloadResponse, Inbound};
use crate::wire::outbound::{self, IfUnchanged};

fn sample(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i % 253) as u8).collect()
}

fn refused(error: &str, stream: Option<u8>) -> DownloadRefused {
    DownloadRefused { error: error.to_owned(), stream, total_bytes: None, mtime_ms: None }
}

#[tokio::test]
async fn a_whole_file_comes_in_the_real_frame_order_in_chunks_of_the_configured_size() {
    let daemon = StandInDaemon::start_with(Config { chunk_bytes: 1000, ..Config::default() }).await.unwrap();
    let data = sample(5000);
    let info = daemon.put_file("/srv/notes.txt", data.clone());
    let mut client = Client::connect(&daemon).await;
    let got = client.download("/srv/notes.txt", None, None).await.unwrap();
    assert_eq!(got.kinds(), ["Begin", "Chunk", "Chunk", "Chunk", "Chunk", "Chunk", "End"]);
    assert_eq!(got.bytes(), data);
    let accepted = &got.accepted;
    assert_eq!((accepted.total_bytes, accepted.mtime_ms, accepted.offset, accepted.length), (5000, info.mtime_ms, 0, 5000));
    let Got::Begin { stream, meta } = &got.frames[0] else { panic!("a Begin") };
    assert_eq!(*stream, accepted.stream);
    assert_eq!(meta.transfer_id, accepted.transfer_id);
    assert_eq!(meta.file_name.as_deref(), Some("notes.txt"));
    assert_eq!(meta.mime_type.as_deref(), Some("text/plain"));
    assert_eq!((meta.total_bytes, meta.mtime_ms, meta.offset, meta.length), (Some(5000), Some(info.mtime_ms), Some(0), Some(5000)));
    assert_eq!(got.frames.last(), Some(&Got::End { stream: accepted.stream, ok: true }));
}

#[tokio::test]
async fn a_range_is_served_and_the_length_is_clamped_to_the_file() {
    let daemon = StandInDaemon::start().await.unwrap();
    let data = sample(100);
    daemon.put_file("/f", data.clone());
    let mut client = Client::connect(&daemon).await;

    let got = client.download("/f", Some(8), Some(16)).await.unwrap();
    assert_eq!((got.accepted.offset, got.accepted.length, got.accepted.total_bytes), (8, 16, 100));
    assert_eq!(got.bytes(), data[8..24]);

    let got = client.download("/f", Some(90), Some(500)).await.unwrap();
    assert_eq!((got.accepted.offset, got.accepted.length), (90, 10));
    assert_eq!(got.bytes(), data[90..]);

    let got = client.download("/f", Some(40), None).await.unwrap();
    assert_eq!(got.accepted.length, 60);
    assert_eq!(got.bytes(), data[40..]);
}

#[tokio::test]
async fn an_offset_at_the_end_is_an_empty_range_and_one_past_it_is_refused() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f", sample(10));
    let mut client = Client::connect(&daemon).await;
    let got = client.download("/f", Some(10), None).await.unwrap();
    assert_eq!(got.kinds(), ["Begin", "End"]);
    assert_eq!(got.accepted.length, 0);
    let error = client.download("/f", Some(11), None).await.unwrap_err();
    assert_eq!(error.error, "range_not_satisfiable");
    assert!(error.stream.is_some());
}

#[tokio::test]
async fn if_unchanged_lets_the_same_file_through_and_refuses_a_changed_one_with_its_current_state() {
    let daemon = StandInDaemon::start().await.unwrap();
    let first = daemon.put_file("/f", sample(64));
    let mut client = Client::connect(&daemon).await;
    let guard = |info: crate::testing::FileInfo| Some(IfUnchanged { size: info.size, mtime_ms: info.mtime_ms });

    let response = client.request_download("/f", Some(4), Some(32), None, guard(first)).await;
    let DownloadResponse::Accepted(accepted) = response else { panic!("accepted") };
    assert_eq!((accepted.stream, accepted.offset, accepted.length), (4, 32, 32));
    client.stream_frames().await;

    // Changed between the two requests: another size, then another time with the same size.
    let second = daemon.put_file("/f", sample(70));
    let response = client.request_download("/f", Some(4), Some(32), None, guard(first)).await;
    assert_eq!(
        response,
        DownloadResponse::Refused(DownloadRefused { error: "changed".to_owned(), stream: Some(4), total_bytes: Some(70), mtime_ms: Some(second.mtime_ms) })
    );
    let third = daemon.put_file("/f", sample(70));
    let response = client.request_download("/f", Some(4), None, None, guard(second)).await;
    let DownloadResponse::Refused(refusal) = response else { panic!("refused") };
    assert_eq!((refusal.error.as_str(), refusal.mtime_ms), ("changed", Some(third.mtime_ms)));
}

#[tokio::test]
async fn a_file_that_changes_while_a_download_runs_does_not_change_that_download() {
    let daemon = StandInDaemon::start_with(Config { chunk_bytes: 100, chunk_delay: Duration::from_millis(20), ..Config::default() }).await.unwrap();
    let data = sample(1000);
    daemon.put_file("/f", data.clone());
    let mut client = Client::connect(&daemon).await;
    let response = client.request_download("/f", None, None, None, None).await;
    let DownloadResponse::Accepted(accepted) = response else { panic!("accepted") };
    daemon.put_file("/f", vec![0xAB; 3]);
    let got = Downloaded { accepted, frames: client.stream_frames().await };
    assert_eq!(got.bytes(), data);
}

#[tokio::test]
async fn the_refusals_of_the_real_daemon() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f", sample(10));
    let mut client = Client::connect(&daemon).await;

    let missing = client.download("/nowhere", None, None).await.unwrap_err();
    assert_eq!(missing.error, "not_found");
    assert!(missing.stream.is_some());

    // Requests the typed builder cannot make.
    let manual = |message: serde_json::Value| {
        move |id: &str| {
            let mut message = message.clone();
            message["type"] = json!("file_download_request");
            message["requestId"] = json!(id);
            json!({"type": "session", "message": message}).to_string()
        }
    };
    let cases = [
        (json!({}), "missing_path"),
        (json!({"path": ""}), "missing_path"),
        (json!({"path": "/f", "stream": 256}), "invalid_stream"),
        (json!({"path": "/f", "stream": "1"}), "invalid_stream"),
        (json!({"path": "/f", "offset": -1}), "invalid_range"),
        (json!({"path": "/f", "offset": 1.5}), "invalid_range"),
        (json!({"path": "/f", "length": 0}), "invalid_range"),
        (json!({"path": "/f", "length": "9"}), "invalid_range"),
        (json!({"path": "/f", "offset": 9_007_199_254_740_992_u64}), "invalid_range"),
        (json!({"path": "/f", "ifUnchanged": null}), "changed"),
        (json!({"path": "/f", "ifUnchanged": {"size": 10}}), "changed"),
    ];
    for (message, error) in cases {
        let reply = client.ask(manual(message.clone())).await;
        let DownloadResponse::Refused(refusal) = reply.download_response().unwrap() else { panic!("{message} was accepted") };
        assert_eq!(refusal.error, error, "{message}");
    }
}

#[tokio::test]
async fn a_stream_in_use_and_the_exhausted_stream_ids_are_refused() {
    let daemon =
        StandInDaemon::start_with(Config { chunk_bytes: 10, chunk_delay: Duration::from_millis(200), stream_slots: 8, ..Config::default() }).await.unwrap();
    daemon.put_file("/f", sample(100));
    let mut client = Client::connect(&daemon).await;
    client.skip_binary = true;

    let DownloadResponse::Accepted(first) = client.request_download("/f", Some(5), None, None, None).await else { panic!("accepted") };
    assert_eq!(first.stream, 5);
    let again = client.request_download("/f", Some(5), None, None, None).await;
    assert_eq!(again, DownloadResponse::Refused(refused("stream_in_use", Some(5))));

    // The seven other ids of eight, then none.
    for _ in 0..7 {
        assert!(matches!(client.request_download("/f", None, None, None, None).await, DownloadResponse::Accepted(_)));
    }
    let none = client.request_download("/f", None, None, None, None).await;
    assert_eq!(none, DownloadResponse::Refused(refused("no_free_stream", None)));
}

#[tokio::test]
async fn a_cancel_is_answered_before_the_error_frame_and_stops_the_download() {
    let daemon = StandInDaemon::start_with(Config { chunk_bytes: 100, chunk_delay: Duration::from_millis(30), ..Config::default() }).await.unwrap();
    daemon.put_file("/f", sample(10_000));
    let mut client = Client::connect(&daemon).await;
    let response = client.request_download("/f", Some(9), None, None, None).await;
    assert!(matches!(response, DownloadResponse::Accepted(_)));
    assert!(matches!(client.frame().await, Got::Begin { .. }));
    assert!(matches!(client.frame().await, Got::Chunk { .. }));

    let id = client.id();
    client.send(outbound::download_cancel_request(&id, 9)).await;
    let mut answered = false;
    let mut chunks = 0;
    let last = loop {
        match client.event().await {
            super::client::Event::Text(text) => {
                let Inbound::Reply(reply) = Inbound::parse(&text).unwrap() else { panic!("an answer") };
                let cancel = reply.cancel_response().unwrap();
                assert!(cancel.ok);
                assert!(!answered, "one answer");
                answered = true;
            }
            super::client::Event::Binary(bytes) => match Got::read(&bytes) {
                Got::Chunk { .. } => chunks += 1,
                other => break other,
            },
            other => panic!("unexpected {other:?}"),
        }
    };
    assert!(answered, "the answer came before the Error frame");
    assert_eq!(last, Got::Error { stream: 9, message: "cancelled".to_owned() });
    assert!(chunks < 99, "the download stopped early");
    client.assert_silent().await;

    // It is over: the same cancel finds nothing.
    let reply = client.ask(|id| outbound::download_cancel_request(id, 9)).await;
    let cancel = reply.cancel_response().unwrap();
    assert_eq!((cancel.ok, cancel.error.as_deref()), (false, Some("not_found")));
}

#[tokio::test]
async fn a_cancel_of_a_stream_that_never_ran_is_not_found() {
    let daemon = StandInDaemon::start().await.unwrap();
    let mut client = Client::connect(&daemon).await;
    let reply = client.ask(|id| outbound::download_cancel_request(id, 200)).await;
    let cancel = reply.cancel_response().unwrap();
    assert_eq!((cancel.ok, cancel.error.as_deref()), (false, Some("not_found")));
}

#[tokio::test]
async fn the_daemon_records_every_download_request_as_the_client_sent_it() {
    let daemon = StandInDaemon::start().await.unwrap();
    let info = daemon.put_file("/srv/a.bin", sample(5000));
    let mut client = Client::connect(&daemon).await;
    client.download("/srv/a.bin", None, None).await.unwrap();
    let guard = IfUnchanged { size: info.size, mtime_ms: info.mtime_ms };
    match client.request_download("/srv/a.bin", None, Some(1000), None, Some(guard)).await {
        DownloadResponse::Accepted(_) => {}
        DownloadResponse::Refused(refused) => panic!("{refused:?}"),
    }
    let requests = daemon.download_requests();
    assert_eq!(requests.len(), 2);
    assert!(requests[0].get("offset").is_none() && requests[0].get("ifUnchanged").is_none());
    assert_eq!((requests[1]["path"].as_str(), requests[1]["offset"].as_u64()), (Some("/srv/a.bin"), Some(1000)));
    assert_eq!(requests[1]["ifUnchanged"], json!({ "size": 5000, "mtimeMs": info.mtime_ms }));
}
