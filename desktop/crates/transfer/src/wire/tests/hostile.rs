//! Random, truncated and mutated input: nothing panics, and a cut-off frame is an error where it
//! must be one. A panic fails the test. The seed is fixed, so a failure repeats.

use std::fs;

use serde_json::Value;

use super::{fixture_dir, frame_bytes};
use crate::wire::binary::{self, FileFrame};
use crate::wire::inbound::{Inbound, Reply};

/// xorshift64*: enough to vary the input, and the same on every run.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, bound: usize) -> usize {
        usize::try_from(self.next() % u64::try_from(bound.max(1)).unwrap_or(1)).unwrap_or(0)
    }

    fn byte(&mut self) -> u8 {
        self.next().to_le_bytes()[0]
    }
}

/// The `frame` of every top-level fixture, as text.
fn text_frames() -> Vec<String> {
    let mut frames = Vec::new();
    for entry in fs::read_dir(fixture_dir()).expect("the fixture directory") {
        let path = entry.expect("an entry").path();
        let is_json = path.extension().is_some_and(|extension| extension == "json");
        if !is_json || path.file_name().is_some_and(|name| name == "manifest.json") {
            continue;
        }
        let value: Value = serde_json::from_str(&fs::read_to_string(&path).expect("read")).expect("JSON");
        if let Some(frame) = value.get("frame").filter(|frame| frame.get("type").is_some()) {
            frames.push(frame.to_string());
        }
    }
    assert!(frames.len() > 40, "the fixtures were not found");
    frames
}

fn binary_frames() -> Vec<Vec<u8>> {
    ["begin", "begin.download", "chunk", "end", "error"].iter().map(|name| frame_bytes(&super::fixture(&format!("binary/file_transfer.{name}")))).collect()
}

/// Reads a frame as far as the engine ever reads one.
fn read_text(text: &str) {
    if let Ok(Inbound::Reply(reply)) = Inbound::parse(text) {
        read_reply(&reply);
    }
}

fn read_reply(reply: &Reply) {
    let _ = reply.upload_response();
    let _ = reply.download_response();
    let _ = reply.cancel_response();
}

#[test]
fn every_prefix_of_every_text_fixture_is_read_or_refused_without_a_panic() {
    for text in text_frames() {
        for end in 0..text.len() {
            if !text.is_char_boundary(end) {
                continue;
            }
            // A cut-off JSON object is never a frame.
            assert!(Inbound::parse(&text[..end]).is_err(), "a prefix of {} bytes was read", end);
        }
        assert!(Inbound::parse(&text).is_ok(), "a whole fixture frame was refused: {text}");
    }
}

#[test]
fn every_prefix_of_every_binary_fixture_is_read_or_refused_without_a_panic() {
    for frame in binary_frames() {
        for end in 0..=frame.len() {
            let result = binary::decode(&frame[..end]);
            match frame[0] {
                // Metadata cut short is not JSON.
                0x10 if end < frame.len() => assert!(result.is_err()),
                0x10..=0x13 if end >= 2 => assert!(result.is_ok()),
                _ => assert!(end >= 2 || result.is_err()),
            }
        }
    }
}

#[test]
fn random_bytes_never_panic_the_binary_reader() {
    let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
    for _ in 0..20_000 {
        let length = rng.below(80);
        let mut frame: Vec<u8> = (0..length).map(|_| rng.byte()).collect();
        // Half of the frames start like a file-transfer frame, so that the payload readers run.
        if length >= 2 && rng.below(2) == 0 {
            frame[0] = 0x10 + u8::try_from(rng.below(5)).unwrap_or(0);
        }
        if let Ok(FileFrame::Chunk { data, .. }) = binary::decode(&frame) {
            assert_eq!(data.len() + 2, frame.len());
        }
    }
}

#[test]
fn random_and_mutated_text_never_panics_the_text_reader() {
    let frames = text_frames();
    let mut rng = Rng(0x1234_5678_9abc_def1);
    for round in 0..20_000_usize {
        let mut bytes = frames[round % frames.len()].clone().into_bytes();
        for _ in 0..=rng.below(4) {
            match rng.below(4) {
                0 if !bytes.is_empty() => {
                    let at = rng.below(bytes.len());
                    bytes[at] = rng.byte();
                }
                1 if !bytes.is_empty() => {
                    let at = rng.below(bytes.len());
                    bytes.remove(at);
                }
                2 => {
                    let at = rng.below(bytes.len() + 1);
                    bytes.insert(at, b"{}[]\":,0-9e.\\"[rng.below(13)]);
                }
                _ => bytes.truncate(rng.below(bytes.len() + 1)),
            }
        }
        read_text(&String::from_utf8_lossy(&bytes));
    }
    for _ in 0..5_000 {
        let length = rng.below(60);
        let noise: Vec<u8> = (0..length).map(|_| rng.byte()).collect();
        read_text(&String::from_utf8_lossy(&noise));
    }
}

#[test]
fn nesting_numbers_and_unicode_are_read_or_refused() {
    let depth = 100_000;
    let nested = format!("{}{}", "[".repeat(depth), "]".repeat(depth));
    let deep_message = format!("{{\"type\":\"session\",\"message\":{{\"type\":\"x\",\"requestId\":\"r\",\"v\":{nested}}}}}");
    assert!(Inbound::parse(&nested).is_err());
    assert!(Inbound::parse(&deep_message).is_err());
    let mut deep_begin = vec![0x10, 1];
    deep_begin.extend_from_slice(nested.as_bytes());
    assert!(binary::decode(&deep_begin).is_err());

    let digits = "9".repeat(5_000);
    for text in [
        format!("{{\"type\":\"session\",\"message\":{{\"type\":\"file_upload_response\",\"requestId\":\"r\",\"ok\":true,\"stream\":{digits}}}}}"),
        format!("{{\"type\":\"ping\",\"requestId\":\"r\",\"clientSentAt\":{digits}}}"),
        "{\"type\":\"\u{0}\u{10ffff}\u{1f600}\",\"x\":\"\\ud800\"}".to_owned(),
        "{\"type\":\"session\",\"message\":{\"type\":\"file_download_response\",\"requestId\":\"r\",\"ok\":true,\"stream\":1,\"transferId\":\"t\",\"totalBytes\":9007199254740993,\"mtimeMs\":0,\"offset\":0,\"length\":0}}".to_owned(),
    ] {
        read_text(&text);
    }
}

#[test]
fn a_claimed_size_reserves_nothing() {
    // The largest sizes a daemon can claim are read as numbers and cost no memory: no length in any
    // frame is used to reserve a buffer, and the only buffer is the frame the socket has already
    // limited.
    let begin = b"{\"transferId\":\"t\",\"totalBytes\":9007199254740991,\"offset\":9007199254740991,\"length\":9007199254740991}";
    let mut frame = vec![0x10, 255];
    frame.extend_from_slice(begin);
    let Ok(FileFrame::Begin { stream, meta }) = binary::decode(&frame) else { panic!("begin") };
    assert_eq!((stream, meta.length), (255, Some((1 << 53) - 1)));
}
