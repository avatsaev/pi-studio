//! The frame batch: whole WebSocket messages, each marked text or binary.
//!
//! A batch is a sequence of items `[kind: 1 byte][length: 4 bytes, little-endian][payload]`; kind 1
//! is UTF-8 text and kind 2 is binary. [`encode_text`] and [`encode_binary`] append one item to a
//! buffer; [`decode`] walks a byte slice and yields the items or the first error, then stops.

use pistudiodesktop_net::limits::MAX_MESSAGE_BYTES;

use crate::limits::{ITEM_HEADER_LEN, KIND_BINARY, KIND_TEXT};

/// One decoded message, borrowing the batch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Item<'a> {
    Text(&'a str),
    Binary(&'a [u8]),
}

impl Item<'_> {
    /// The length of the payload in bytes (only the tests read it).
    #[cfg(test)]
    pub fn payload_len(&self) -> usize {
        match self {
            Item::Text(text) => text.len(),
            Item::Binary(bytes) => bytes.len(),
        }
    }
}

/// Why a batch could not be encoded or decoded. `offset` is the position of the item's first byte.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodecError {
    /// The item's kind byte is neither 1 (text) nor 2 (binary).
    UnknownKind { offset: usize, kind: u8 },
    /// The input ends inside an item's header or payload.
    Truncated { offset: usize },
    /// The payload is longer than [`MAX_MESSAGE_BYTES`].
    TooLarge { offset: usize, len: u64 },
    /// A text item's payload is not UTF-8.
    InvalidUtf8 { offset: usize },
}

impl std::fmt::Display for CodecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CodecError::UnknownKind { offset, kind } => write!(f, "frame item at byte {offset} has unknown kind {kind} (expected 1 for text or 2 for binary)"),
            CodecError::Truncated { offset } => write!(f, "frame batch ends inside the item at byte {offset}"),
            CodecError::TooLarge { offset, len } => write!(f, "frame item at byte {offset} is {len} bytes, above the {MAX_MESSAGE_BYTES}-byte message limit"),
            CodecError::InvalidUtf8 { offset } => write!(f, "text item at byte {offset} is not valid UTF-8"),
        }
    }
}

impl std::error::Error for CodecError {}

/// Append a text item to `out`. On error `out` is unchanged.
pub fn encode_text(out: &mut Vec<u8>, text: &str) -> Result<(), CodecError> {
    encode(out, KIND_TEXT, text.as_bytes())
}

/// Append a binary item to `out`. On error `out` is unchanged.
pub fn encode_binary(out: &mut Vec<u8>, bytes: &[u8]) -> Result<(), CodecError> {
    encode(out, KIND_BINARY, bytes)
}

fn encode(out: &mut Vec<u8>, kind: u8, payload: &[u8]) -> Result<(), CodecError> {
    // The cap keeps the length inside four bytes as well: 128 MiB is far below `u32::MAX`.
    let len = u32::try_from(payload.len()).ok().filter(|_| payload.len() <= MAX_MESSAGE_BYTES);
    let Some(len) = len else {
        return Err(CodecError::TooLarge { offset: out.len(), len: payload.len() as u64 });
    };
    out.reserve(ITEM_HEADER_LEN + payload.len());
    out.push(kind);
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(payload);
    Ok(())
}

/// Walk `bytes` item by item. After the first error the iterator is finished.
pub fn decode(bytes: &[u8]) -> Items<'_> {
    Items { bytes, pos: 0, done: false }
}

/// The items of a batch; see [`decode`].
#[derive(Debug, Clone)]
pub struct Items<'a> {
    bytes: &'a [u8],
    pos: usize,
    done: bool,
}

impl<'a> Items<'a> {
    fn next_item(&mut self) -> Result<Item<'a>, CodecError> {
        let offset = self.pos;
        let rest = self.bytes.get(offset..).unwrap_or_default();
        let (header, body) = rest.split_first_chunk::<ITEM_HEADER_LEN>().ok_or(CodecError::Truncated { offset })?;
        let kind = header[0];
        if kind != KIND_TEXT && kind != KIND_BINARY {
            return Err(CodecError::UnknownKind { offset, kind });
        }
        let len = u32::from_le_bytes([header[1], header[2], header[3], header[4]]);
        // The cap comes before the bounds check: a length past it is wrong whatever follows.
        let len = usize::try_from(len).ok().filter(|len| *len <= MAX_MESSAGE_BYTES).ok_or(CodecError::TooLarge { offset, len: u64::from(len) })?;
        let payload = body.get(..len).ok_or(CodecError::Truncated { offset })?;
        // `len` is at most `body.len()` here, so the sum cannot pass `bytes.len()`.
        self.pos = offset + ITEM_HEADER_LEN + len;
        if kind == KIND_TEXT { std::str::from_utf8(payload).map(Item::Text).map_err(|_| CodecError::InvalidUtf8 { offset }) } else { Ok(Item::Binary(payload)) }
    }
}

impl<'a> Iterator for Items<'a> {
    type Item = Result<Item<'a>, CodecError>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done || self.pos >= self.bytes.len() {
            return None;
        }
        let item = self.next_item();
        if item.is_err() {
            self.done = true;
        }
        Some(item)
    }
}

impl std::iter::FusedIterator for Items<'_> {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::Rng;

    fn decode_all(bytes: &[u8]) -> Result<Vec<Item<'_>>, CodecError> {
        decode(bytes).collect()
    }

    #[test]
    fn layout_is_kind_then_little_endian_length_then_payload() {
        let mut out = Vec::new();
        encode_text(&mut out, "hi").unwrap();
        encode_binary(&mut out, &[9, 8, 7]).unwrap();
        assert_eq!(out, [1, 2, 0, 0, 0, b'h', b'i', 2, 3, 0, 0, 0, 9, 8, 7]);
        assert_eq!(decode_all(&out).unwrap(), [Item::Text("hi"), Item::Binary(&[9, 8, 7])]);
    }

    #[test]
    fn empty_batch_and_empty_payloads() {
        assert_eq!(decode_all(&[]).unwrap(), []);
        let mut out = Vec::new();
        encode_text(&mut out, "").unwrap();
        encode_binary(&mut out, &[]).unwrap();
        assert_eq!(decode_all(&out).unwrap(), [Item::Text(""), Item::Binary(&[])]);
    }

    #[test]
    fn generated_batches_round_trip() {
        let mut rng = Rng::new(0x5eed_0001);
        for _ in 0..300 {
            let mut texts = Vec::new();
            let mut blobs = Vec::new();
            let mut plan = Vec::new();
            for _ in 0..rng.below(12) {
                // Mostly small, sometimes empty, sometimes a few KiB, rarely 70 KiB (past u16).
                let len = match rng.below(10) {
                    0 | 1 => 0,
                    9 => 70_000 + rng.below(1_000),
                    8 => rng.below(5_000),
                    _ => rng.below(200),
                };
                if rng.below(2) == 0 {
                    texts.push(rng.text(len));
                    plan.push((true, texts.len() - 1));
                } else {
                    blobs.push(rng.bytes(len));
                    plan.push((false, blobs.len() - 1));
                }
            }
            let mut batch = Vec::new();
            let mut want = Vec::new();
            for (is_text, i) in &plan {
                if *is_text {
                    encode_text(&mut batch, &texts[*i]).unwrap();
                    want.push(Item::Text(&texts[*i]));
                } else {
                    encode_binary(&mut batch, &blobs[*i]).unwrap();
                    want.push(Item::Binary(&blobs[*i]));
                }
            }
            assert_eq!(decode_all(&batch).unwrap(), want);
        }
    }

    #[test]
    fn every_truncation_of_a_valid_batch_is_an_error() {
        let mut batch = Vec::new();
        encode_text(&mut batch, "héllo wörld").unwrap();
        encode_binary(&mut batch, &[1, 2, 3, 4, 5]).unwrap();
        encode_text(&mut batch, "x").unwrap();
        // Cuts at item boundaries give a shorter valid batch; every other cut must fail.
        let boundaries = [0, 5 + 13, 5 + 13 + 5 + 5, batch.len()];
        for cut in 0..=batch.len() {
            let result = decode_all(&batch[..cut]);
            if boundaries.contains(&cut) {
                assert!(result.is_ok(), "cut {cut}");
            } else {
                assert!(matches!(result, Err(CodecError::Truncated { .. })), "cut {cut}: {result:?}");
            }
        }
    }

    #[test]
    fn unknown_kind_is_refused_with_its_offset() {
        let mut batch = Vec::new();
        encode_binary(&mut batch, &[1]).unwrap();
        let at = batch.len();
        batch.extend_from_slice(&[3, 0, 0, 0, 0]);
        assert_eq!(decode_all(&batch), Err(CodecError::UnknownKind { offset: at, kind: 3 }));
        for kind in (0..=255u8).filter(|k| *k != 1 && *k != 2) {
            assert!(matches!(decode_all(&[kind, 0, 0, 0, 0]), Err(CodecError::UnknownKind { .. })), "kind {kind}");
        }
    }

    #[test]
    fn lengths_past_the_end_or_the_cap_are_errors() {
        // Past the end of the input.
        assert_eq!(decode_all(&[2, 4, 0, 0, 0, 1, 2, 3]), Err(CodecError::Truncated { offset: 0 }));
        // Past the cap, with a payload that does not exist: refused for size, not for truncation.
        for len in [MAX_MESSAGE_BYTES as u32 + 1, u32::MAX / 2, u32::MAX] {
            let mut batch = vec![2];
            batch.extend_from_slice(&len.to_le_bytes());
            assert_eq!(decode_all(&batch), Err(CodecError::TooLarge { offset: 0, len: u64::from(len) }));
        }
        // Exactly at the cap is within bounds (and here truncated, since nothing follows).
        let mut batch = vec![2];
        batch.extend_from_slice(&(MAX_MESSAGE_BYTES as u32).to_le_bytes());
        assert_eq!(decode_all(&batch), Err(CodecError::Truncated { offset: 0 }));
    }

    #[test]
    fn text_that_is_not_utf8_is_refused_but_binary_is_not() {
        for bad in [&[0xff][..], &[0xc3, 0x28], &[0xe2, 0x82], &[0xed, 0xa0, 0x80], &[0xf0, 0x28, 0x8c, 0xbc]] {
            let mut batch = vec![1];
            batch.extend_from_slice(&(bad.len() as u32).to_le_bytes());
            batch.extend_from_slice(bad);
            assert_eq!(decode_all(&batch), Err(CodecError::InvalidUtf8 { offset: 0 }), "{bad:?}");
            batch[0] = 2;
            assert_eq!(decode_all(&batch).unwrap(), [Item::Binary(bad)]);
        }
    }

    #[test]
    fn the_iterator_stops_after_the_first_error() {
        let mut batch = Vec::new();
        encode_text(&mut batch, "ok").unwrap();
        batch.extend_from_slice(&[9, 0, 0, 0, 0]);
        encode_text(&mut batch, "never reached").unwrap();
        let mut items = decode(&batch);
        assert_eq!(items.next(), Some(Ok(Item::Text("ok"))));
        assert!(matches!(items.next(), Some(Err(CodecError::UnknownKind { .. }))));
        assert_eq!(items.next(), None);
        assert_eq!(items.next(), None);
    }

    #[test]
    fn encoding_above_the_cap_fails_and_leaves_the_buffer_alone() {
        let mut out = vec![7];
        let big = vec![0u8; MAX_MESSAGE_BYTES + 1];
        assert_eq!(encode_binary(&mut out, &big), Err(CodecError::TooLarge { offset: 1, len: MAX_MESSAGE_BYTES as u64 + 1 }));
        assert_eq!(out, [7]);
    }

    #[test]
    fn an_item_exactly_at_the_cap_round_trips() {
        let blob = vec![0xabu8; MAX_MESSAGE_BYTES];
        let mut out = Vec::new();
        encode_binary(&mut out, &blob).unwrap();
        let items = decode_all(&out).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].payload_len(), MAX_MESSAGE_BYTES);
    }

    #[test]
    fn random_bytes_never_panic() {
        let mut rng = Rng::new(0x5eed_0002);
        for round in 0..20_000 {
            let len = rng.below(64);
            let mut bytes = rng.bytes(len);
            // Half the rounds start with a valid kind so the length and UTF-8 paths are reached.
            if round % 2 == 0 && !bytes.is_empty() {
                bytes[0] = 1 + (rng.below(2) as u8);
            }
            for item in decode(&bytes).flatten() {
                assert!(item.payload_len() <= bytes.len());
            }
        }
    }

    #[test]
    fn mutated_valid_batches_never_panic_and_keep_their_bounds() {
        let mut rng = Rng::new(0x5eed_0003);
        let mut valid = Vec::new();
        for i in 0..6 {
            encode_text(&mut valid, &"ab".repeat(i)).unwrap();
            encode_binary(&mut valid, &vec![i as u8; i * 3]).unwrap();
        }
        for _ in 0..20_000 {
            let mut bytes = valid.clone();
            for _ in 0..1 + rng.below(4) {
                let at = rng.below(bytes.len());
                bytes[at] = rng.below(256) as u8;
            }
            let end = rng.below(bytes.len() + 1);
            let mut consumed = 0usize;
            for item in decode(&bytes[..end]) {
                match item {
                    Ok(item) => consumed += ITEM_HEADER_LEN + item.payload_len(),
                    Err(_) => break,
                }
            }
            assert!(consumed <= end);
        }
    }
}
