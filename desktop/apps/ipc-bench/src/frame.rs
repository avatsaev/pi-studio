//! The benchmark's frame format and its integrity check (row B6).
//!
//! Every frame carries its own counter and a checksum, and a stream carries a running hash:
//!
//! - **Binary**, `size` bytes (a multiple of 4, at least 12): the counter as a little-endian `u32`,
//!   a payload, and at the end the frame's checksum as a little-endian `u32`.
//! - **Text**, `size` characters (ASCII, a multiple of 4, at least 20): the counter as ten decimal
//!   digits and a colon, a filler, and at the end the checksum as eight lowercase hex digits.
//!
//! The checksum is [`hash_words`] of everything before it. A stream's running hash starts at
//! [`BASIS`] and takes each frame's checksum, in order, with [`mix`]: a frame lost, repeated,
//! reordered or changed gives another hash, and the counter and the checksum name the frame.
//!
//! `page/frame.js` is the same format and the same hash; both are tested against the vectors
//! in the tests below and in `page/frame.test.mjs`.

use serde::Serialize;

/// The hash's start value (FNV-1a's offset basis).
pub const BASIS: u32 = 0x811c_9dc5;
const PRIME: u32 = 0x0100_0193;

/// Binary frames: counter, at least one payload word, checksum.
pub const MIN_BINARY: usize = 12;
/// Text frames: counter and colon (11), at least one filler character, checksum (8).
pub const MIN_TEXT: usize = 20;
/// The largest frame the benchmark makes or accepts as a parameter.
pub const MAX_FRAME: usize = 4 << 20;
/// How many frame errors a report lists; `error_count` counts them all.
pub const MAX_LISTED_ERRORS: usize = 20;

const TEXT_PREFIX: usize = 11;
const TEXT_SUFFIX: usize = 8;

/// One step of the hash: the xor of a word, then FNV's prime.
pub fn mix(hash: u32, word: u32) -> u32 {
    (hash ^ word).wrapping_mul(PRIME)
}

/// The hash of `bytes` read as little-endian 32-bit words from [`BASIS`]. Bytes past the last
/// whole word are ignored: callers check the length first.
pub fn hash_words(bytes: &[u8]) -> u32 {
    bytes.as_chunks::<4>().0.iter().fold(BASIS, |hash, c| mix(hash, u32::from_le_bytes(*c)))
}

/// What is wrong with a frame size, if anything.
pub fn check_size(size: usize, text: bool) -> Result<(), String> {
    let min = if text { MIN_TEXT } else { MIN_BINARY };
    if size < min || size > MAX_FRAME || !size.is_multiple_of(4) {
        let kind = if text { "text" } else { "binary" };
        return Err(format!("a {kind} frame is {min} to {MAX_FRAME} bytes, a multiple of 4: {size} is not"));
    }
    Ok(())
}

/// A binary frame's payload, fixed per size: a xorshift stream, so that the bytes are not
/// compressible (and not the same in every position), without costing a random generator per frame.
pub fn binary_template(size: usize) -> Result<Vec<u8>, String> {
    check_size(size, false)?;
    let mut state = u32::try_from(size).unwrap_or(1) | 1;
    let mut frame = Vec::with_capacity(size);
    while frame.len() < size {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        frame.extend_from_slice(&state.to_le_bytes());
    }
    Ok(frame)
}

/// Frame `counter` of a stream made from `template`, and its checksum.
pub fn binary_frame(template: &[u8], counter: u32) -> (Vec<u8>, u32) {
    let mut frame = template.to_vec();
    let sum = stamp_binary(&mut frame, counter);
    (frame, sum)
}

/// Writes the counter and the checksum into a binary frame; returns the checksum.
fn stamp_binary(frame: &mut [u8], counter: u32) -> u32 {
    let n = frame.len();
    if n < MIN_BINARY {
        return 0;
    }
    frame[..4].copy_from_slice(&counter.to_le_bytes());
    let sum = hash_words(&frame[..n - 4]);
    frame[n - 4..].copy_from_slice(&sum.to_le_bytes());
    sum
}

/// A text frame's filler: letters, `size` minus what the counter and the checksum take.
pub fn text_template(size: usize) -> Result<Vec<u8>, String> {
    check_size(size, true)?;
    Ok((0..size - TEXT_PREFIX - TEXT_SUFFIX).map(|i| b'a' + (i % 26) as u8).collect())
}

/// Frame `counter` of a text stream made from `filler`, and its checksum. ASCII, so the bytes
/// are a string.
pub fn text_frame(filler: &[u8], counter: u32) -> (Vec<u8>, u32) {
    let mut frame = Vec::with_capacity(TEXT_PREFIX + filler.len() + TEXT_SUFFIX);
    let mut digits = [b'0'; 10];
    let mut rest = counter;
    for d in digits.iter_mut().rev() {
        *d = b'0' + (rest % 10) as u8;
        rest /= 10;
    }
    frame.extend_from_slice(&digits);
    frame.push(b':');
    frame.extend_from_slice(filler);
    let sum = hash_words(&frame);
    frame.extend_from_slice(format!("{sum:08x}").as_bytes());
    (frame, sum)
}

/// Changes one payload byte of a frame, leaving its checksum as it was: the corruption B6 must find.
pub fn corrupt(frame: &mut [u8], text: bool) {
    let at = if text { TEXT_PREFIX } else { 4 };
    if let Some(b) = frame.get_mut(at) {
        *b = if text { if *b == b'z' { b'a' } else { *b + 1 } } else { *b ^ 1 };
    }
}

/// One frame the check did not accept.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FrameError {
    /// Position in the stream, from 0: the frame that was expected there.
    pub frame: u64,
    pub problem: String,
}

/// What a stream check found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub frames: u64,
    pub bytes: u64,
    /// The running hash, eight lowercase hex digits.
    pub hash: String,
    pub error_count: u64,
    /// The first [`MAX_LISTED_ERRORS`] errors.
    pub errors: Vec<FrameError>,
}

/// Checks a stream of frames as it arrives: each one's counter (the position), its checksum, and
/// the running hash.
#[derive(Debug, Clone)]
pub struct StreamCheck {
    frames: u64,
    bytes: u64,
    chain: u32,
    error_count: u64,
    errors: Vec<FrameError>,
}

impl Default for StreamCheck {
    fn default() -> Self {
        Self { frames: 0, bytes: 0, chain: BASIS, error_count: 0, errors: Vec::new() }
    }
}

impl StreamCheck {
    pub fn accept_binary(&mut self, frame: &[u8]) {
        let n = frame.len();
        if n < MIN_BINARY || !n.is_multiple_of(4) {
            return self.reject(n, format!("a binary frame of {n} bytes: expected a multiple of 4, at least {MIN_BINARY}"));
        }
        let counter = u32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]);
        let stored = u32::from_le_bytes([frame[n - 4], frame[n - 3], frame[n - 2], frame[n - 1]]);
        self.accept(n, u64::from(counter), stored, hash_words(&frame[..n - 4]));
    }

    pub fn accept_text(&mut self, frame: &str) {
        let bytes = frame.as_bytes();
        let n = bytes.len();
        let counter = bytes.get(..10).and_then(|d| std::str::from_utf8(d).ok()).and_then(|d| d.parse::<u64>().ok());
        let stored = bytes.get(n.wrapping_sub(TEXT_SUFFIX)..).and_then(|h| std::str::from_utf8(h).ok()).and_then(|h| u32::from_str_radix(h, 16).ok());
        match (n >= MIN_TEXT && n.is_multiple_of(4) && bytes.get(10) == Some(&b':'), counter, stored) {
            (true, Some(counter), Some(stored)) => self.accept(n, counter, stored, hash_words(&bytes[..n - TEXT_SUFFIX])),
            _ => self.reject(n, format!("a text frame of {n} characters that is not `<counter>:<filler><checksum>`")),
        }
    }

    fn accept(&mut self, size: usize, counter: u64, stored: u32, computed: u32) {
        let position = self.frames;
        if counter != position {
            self.note(position, format!("counter {counter} where {position} was expected"));
        }
        if stored != computed {
            self.note(position, format!("the frame (counter {counter}) was changed: checksum {computed:08x}, not {stored:08x}"));
        }
        self.chain = mix(self.chain, computed);
        self.frames += 1;
        self.bytes += size as u64;
    }

    fn reject(&mut self, size: usize, problem: String) {
        self.note(self.frames, problem);
        self.chain = mix(self.chain, 0);
        self.frames += 1;
        self.bytes += size as u64;
    }

    fn note(&mut self, frame: u64, problem: String) {
        self.error_count += 1;
        if self.errors.len() < MAX_LISTED_ERRORS {
            self.errors.push(FrameError { frame, problem });
        }
    }

    pub fn report(&self) -> Report {
        Report { frames: self.frames, bytes: self.bytes, hash: format!("{:08x}", self.chain), error_count: self.error_count, errors: self.errors.clone() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The same vectors are in `page/frame.test.mjs`.
    #[test]
    fn hash_vectors() {
        assert_eq!(hash_words(&[]), 0x811c_9dc5);
        assert_eq!(hash_words(&[1, 0, 0, 0]), 0x040c_5b8c);
        assert_eq!(hash_words(&[1, 2, 3, 4, 5, 6, 7, 8]), 0xa3b2_5cab);
        // Bytes past the last whole word do not count.
        assert_eq!(hash_words(&[1, 2, 3, 4, 5, 6, 7, 8, 9]), 0xa3b2_5cab);
    }

    #[test]
    fn frame_vectors() {
        let (frame, sum) = binary_frame(&[0; 12], 3);
        assert_eq!(&frame[..4], &[3, 0, 0, 0]);
        assert_eq!(sum, hash_words(&frame[..8]));
        assert_eq!(&frame[8..], &sum.to_le_bytes());
        assert_eq!(sum, FRAME_VECTOR_BINARY);
        let (text, sum) = text_frame(b"abcdefghi", 41);
        assert_eq!(&text[..11], b"0000000041:");
        assert_eq!(text.len(), 28);
        assert_eq!(sum, FRAME_VECTOR_TEXT);
        assert_eq!(&text[20..], format!("{sum:08x}").as_bytes());
    }

    const FRAME_VECTOR_BINARY: u32 = 0x3779_1236;
    const FRAME_VECTOR_TEXT: u32 = 0x98d7_ec07;

    fn stream(frames: u32, size: usize) -> Vec<Vec<u8>> {
        let template = binary_template(size).unwrap();
        (0..frames).map(|i| binary_frame(&template, i).0).collect()
    }

    #[test]
    fn a_clean_stream_passes_and_hashes_the_same_in_every_check() {
        let mut a = StreamCheck::default();
        let mut b = StreamCheck::default();
        for f in stream(50, 64) {
            a.accept_binary(&f);
            b.accept_binary(&f);
        }
        let report = a.report();
        assert_eq!((report.frames, report.bytes, report.error_count), (50, 3200, 0));
        assert_eq!(report, b.report());
    }

    #[test]
    fn a_changed_frame_is_named_and_breaks_the_hash() {
        let clean: Vec<_> = stream(10, 32);
        let mut check = StreamCheck::default();
        let mut hashed = StreamCheck::default();
        for (i, f) in clean.iter().enumerate() {
            hashed.accept_binary(f);
            let mut f = f.clone();
            if i == 6 {
                corrupt(&mut f, false);
            }
            check.accept_binary(&f);
        }
        let report = check.report();
        assert_eq!(report.error_count, 1);
        assert_eq!(report.errors[0].frame, 6);
        assert!(report.errors[0].problem.contains("changed"), "{}", report.errors[0].problem);
        assert_ne!(report.hash, hashed.report().hash);
    }

    #[test]
    fn two_swapped_frames_are_both_named() {
        let mut frames = stream(8, 32);
        frames.swap(3, 4);
        let mut check = StreamCheck::default();
        frames.iter().for_each(|f| check.accept_binary(f));
        let report = check.report();
        assert_eq!(report.errors.iter().map(|e| e.frame).collect::<Vec<_>>(), [3, 4]);
        assert!(report.errors[0].problem.contains("counter 4 where 3"), "{}", report.errors[0].problem);
    }

    #[test]
    fn a_lost_frame_shows_as_a_counter_gap() {
        let mut frames = stream(6, 32);
        frames.remove(2);
        let mut check = StreamCheck::default();
        frames.iter().for_each(|f| check.accept_binary(f));
        let report = check.report();
        assert_eq!(report.frames, 5);
        assert_eq!(report.errors[0].frame, 2);
    }

    #[test]
    fn text_frames_are_checked_and_corruption_is_named() {
        let filler = text_template(200).unwrap();
        let mut check = StreamCheck::default();
        for i in 0..5u32 {
            let (mut f, _) = text_frame(&filler, i);
            assert_eq!(f.len(), 200);
            if i == 3 {
                corrupt(&mut f, true);
            }
            check.accept_text(std::str::from_utf8(&f).unwrap());
        }
        let report = check.report();
        assert_eq!(report.error_count, 1);
        assert_eq!(report.errors[0].frame, 3);
    }

    #[test]
    fn malformed_frames_are_errors_not_panics() {
        let mut check = StreamCheck::default();
        check.accept_binary(&[]);
        check.accept_binary(&[1, 2, 3]);
        check.accept_binary(&[0; 13]);
        check.accept_text("");
        check.accept_text("héllo wörld, not a frame at all");
        check.accept_text("0000000005:abcdefghizzzzzzzz");
        assert_eq!(check.report().error_count, 6);
        assert_eq!(check.report().frames, 6);
    }

    #[test]
    fn sizes_are_checked() {
        assert!(check_size(32, false).is_ok());
        assert!(check_size(200, true).is_ok());
        assert!(check_size(10, false).is_err());
        assert!(check_size(33, false).is_err());
        assert!(check_size(16, true).is_err());
        assert!(check_size(MAX_FRAME + 4, false).is_err());
        assert!(binary_template(7).is_err());
        assert!(text_template(18).is_err());
    }

    #[test]
    fn the_error_list_is_capped_but_counted() {
        let mut check = StreamCheck::default();
        for _ in 0..(MAX_LISTED_ERRORS + 5) {
            check.accept_binary(&[]);
        }
        let report = check.report();
        assert_eq!(report.errors.len(), MAX_LISTED_ERRORS);
        assert_eq!(report.error_count, (MAX_LISTED_ERRORS + 5) as u64);
    }
}
