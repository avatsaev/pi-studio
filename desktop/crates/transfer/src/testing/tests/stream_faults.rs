//! A download's frames going wrong, as a hostile or broken daemon would send them.

use super::client::{Client, Event, Got};
use crate::testing::{Config, Disorder, Fault, StandInDaemon, StreamFault};
use crate::wire::inbound::DownloadResponse;

fn sample(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i % 247) as u8).collect()
}

async fn daemon_with_file(config: Config, len: usize) -> (StandInDaemon, Client) {
    let daemon = StandInDaemon::start_with(config).await.unwrap();
    daemon.put_file("/f", sample(len));
    let client = Client::connect(&daemon).await;
    (daemon, client)
}

async fn accepted(client: &mut Client) -> (u8, u64) {
    let response = client.request_download("/f", None, None, None, None).await;
    let DownloadResponse::Accepted(accepted) = response else { panic!("accepted") };
    (accepted.stream, accepted.length)
}

fn kinds(frames: &[Got]) -> Vec<&'static str> {
    frames
        .iter()
        .map(|frame| match frame {
            Got::Begin { .. } => "Begin",
            Got::Chunk { .. } => "Chunk",
            Got::End { .. } => "End",
            Got::Error { .. } => "Error",
        })
        .collect()
}

#[tokio::test]
async fn an_error_as_the_first_frame_has_no_begin() {
    let (daemon, mut client) = daemon_with_file(Config::default(), 50).await;
    daemon.script(Fault::DownloadStream(StreamFault::ErrorFirst("cancelled".to_owned())));
    let (stream, _) = accepted(&mut client).await;
    assert_eq!(client.stream_frames().await, [Got::Error { stream, message: "cancelled".to_owned() }]);
    client.assert_silent().await;
}

#[tokio::test]
async fn a_frame_out_of_order_is_one_extra_frame_in_the_wrong_place() {
    let cases = [
        (Disorder::ChunkBeforeBegin, vec!["Chunk", "Begin", "Chunk", "End"]),
        (Disorder::EndBeforeChunks, vec!["Begin", "End", "Chunk", "End"]),
        (Disorder::ChunkAfterEnd, vec!["Begin", "Chunk", "End", "Chunk"]),
        (Disorder::ChunkOnOtherStream, vec!["Begin", "Chunk", "Chunk", "End"]),
    ];
    for (disorder, expected) in cases {
        let (daemon, mut client) = daemon_with_file(Config::default(), 50).await;
        daemon.script(Fault::DownloadStream(StreamFault::OutOfOrder(disorder)));
        let (stream, _) = accepted(&mut client).await;
        let mut frames = Vec::new();
        // The frames up to the last one the case sends: read as many as it names.
        for _ in 0..expected.len() {
            frames.push(client.frame().await);
        }
        assert_eq!(kinds(&frames), expected, "{disorder:?}");
        match disorder {
            Disorder::ChunkOnOtherStream => assert!(matches!(&frames[1], Got::Chunk { stream: other, .. } if *other == stream.wrapping_add(1))),
            Disorder::ChunkBeforeBegin => assert!(matches!(&frames[0], Got::Chunk { stream: s, data } if *s == stream && data == &[0])),
            _ => {}
        }
        client.assert_silent().await;
    }
}

#[tokio::test]
async fn an_oversized_chunk_cannot_be_read_by_a_client_with_a_smaller_message_limit() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f", sample(50));
    daemon.script(Fault::DownloadStream(StreamFault::Oversized(200 * 1024)));
    let mut client = Client::open_limited(&daemon.url(), None, 64 * 1024).await.unwrap();
    client.handshake().await;
    accepted(&mut client).await;
    assert!(matches!(client.frame().await, Got::Begin { .. }));
    assert!(matches!(client.event().await, Event::Failed));

    // A client with the shipped limit reads it, and the file follows.
    daemon.script(Fault::DownloadStream(StreamFault::Oversized(200 * 1024)));
    let mut client = Client::connect(&daemon).await;
    accepted(&mut client).await;
    let frames = client.stream_frames().await;
    assert_eq!(kinds(&frames), ["Begin", "Chunk", "Chunk", "End"]);
    assert!(matches!(&frames[1], Got::Chunk { data, .. } if data.len() == 200 * 1024));
}

#[tokio::test]
async fn more_bytes_than_the_announced_length_arrive_before_the_end() {
    let (daemon, mut client) = daemon_with_file(Config { chunk_bytes: 40, ..Config::default() }, 100).await;
    daemon.script(Fault::DownloadStream(StreamFault::ExtraBytes(25)));
    let (_, length) = accepted(&mut client).await;
    assert_eq!(length, 100);
    let frames = client.stream_frames().await;
    let data: Vec<u8> = frames.iter().flat_map(|frame| if let Got::Chunk { data, .. } = frame { data.clone() } else { Vec::new() }).collect();
    assert_eq!(data.len(), 125);
    assert_eq!(data[..100], sample(100)[..]);
    assert!(matches!(frames.last(), Some(Got::End { ok: true, .. })));
}

#[tokio::test]
async fn an_error_after_n_bytes_ends_the_stream_with_no_end() {
    let (daemon, mut client) = daemon_with_file(Config { chunk_bytes: 40, ..Config::default() }, 100).await;
    daemon.script(Fault::DownloadStream(StreamFault::ErrorAfter { bytes: 50, message: "changed".to_owned() }));
    let (stream, _) = accepted(&mut client).await;
    let frames = client.stream_frames().await;
    assert_eq!(kinds(&frames), ["Begin", "Chunk", "Chunk", "Error"]);
    let sent: usize = frames.iter().map(|frame| if let Got::Chunk { data, .. } = frame { data.len() } else { 0 }).sum();
    assert_eq!(sent, 50);
    assert_eq!(frames.last(), Some(&Got::Error { stream, message: "changed".to_owned() }));
    client.assert_silent().await;
}

#[tokio::test]
async fn a_stream_fault_is_used_once() {
    let (daemon, mut client) = daemon_with_file(Config::default(), 10).await;
    daemon.script(Fault::DownloadStream(StreamFault::ErrorFirst("read_failed".to_owned())));
    accepted(&mut client).await;
    assert_eq!(kinds(&client.stream_frames().await), ["Error"]);
    accepted(&mut client).await;
    assert_eq!(kinds(&client.stream_frames().await), ["Begin", "Chunk", "End"]);
}
