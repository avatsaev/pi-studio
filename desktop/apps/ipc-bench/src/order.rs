//! The outbound order buffer: frames leave for the socket in `seq` order.
//!
//! The page numbers its sends from 0, but its invokes can reach Rust out of order. A frame with the
//! expected number passes at once, together with any waiting frames that follow it. An early frame
//! waits, at most [`MAX_EARLY_FRAMES`] of them. A gap older than [`SEND_ORDER_GAP`] fails with
//! `send_order`. The clock is injected: callers pass the current instant, so tests need no sleeping.
//!
//! An error means the connection is broken: the caller closes it and drops the buffer.

use std::collections::BTreeMap;
use std::time::Instant;

use crate::limits::{MAX_EARLY_FRAMES, SEND_ORDER_CODE, SEND_ORDER_GAP};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderError {
    /// The number was already passed on.
    AlreadyPassed { seq: u64, expected: u64 },
    /// A frame with this number is already waiting.
    Duplicate { seq: u64 },
    /// [`MAX_EARLY_FRAMES`] frames are already waiting.
    TooManyEarly { seq: u64, expected: u64 },
    /// The expected frame did not arrive within [`SEND_ORDER_GAP`].
    GapTooLong { expected: u64 },
}

impl OrderError {
    /// The error code the page sees: every ordering failure is `send_order`.
    pub fn code(&self) -> &'static str {
        SEND_ORDER_CODE
    }
}

impl std::fmt::Display for OrderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OrderError::AlreadyPassed { seq, expected } => write!(f, "send {seq} arrived after the connection moved on to {expected}"),
            OrderError::Duplicate { seq } => write!(f, "send {seq} arrived twice"),
            OrderError::TooManyEarly { seq, expected } => write!(f, "send {seq} arrived while {MAX_EARLY_FRAMES} others already wait for {expected}"),
            OrderError::GapTooLong { expected } => write!(f, "send {expected} did not arrive within {} s", SEND_ORDER_GAP.as_secs()),
        }
    }
}

impl std::error::Error for OrderError {}

/// Holds early frames of type `T` until the ones before them arrive.
#[derive(Debug)]
pub struct OrderBuffer<T> {
    next: u64,
    waiting: BTreeMap<u64, T>,
    /// When the oldest still-open gap began: set when a frame starts waiting, and reset when the
    /// gap closes but another opens behind it.
    gap_since: Option<Instant>,
}

impl<T> Default for OrderBuffer<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> OrderBuffer<T> {
    pub fn new() -> Self {
        Self { next: 0, waiting: BTreeMap::new(), gap_since: None }
    }

    /// Offer the frame numbered `seq` at time `now`. Frames that may now be written, in order, are
    /// appended to `ready` (the frame itself first, then the waiting ones behind it). On error
    /// nothing is appended and the frame is dropped.
    pub fn push(&mut self, seq: u64, frame: T, now: Instant, ready: &mut Vec<T>) -> Result<(), OrderError> {
        // A gap that outlived its limit fails even when this very frame would have closed it: the
        // timer would have fired already.
        self.check_gap(now)?;
        let expected = self.next;
        if seq < expected {
            return Err(OrderError::AlreadyPassed { seq, expected });
        }
        if seq > expected {
            if self.waiting.contains_key(&seq) {
                return Err(OrderError::Duplicate { seq });
            }
            if self.waiting.len() >= MAX_EARLY_FRAMES {
                return Err(OrderError::TooManyEarly { seq, expected });
            }
            self.waiting.insert(seq, frame);
            self.gap_since.get_or_insert(now);
            return Ok(());
        }
        ready.push(frame);
        // Saturating: 2^64 frames cannot be sent; the counter must not wrap if they somehow were.
        self.next = self.next.saturating_add(1);
        while let Some(frame) = self.waiting.remove(&self.next) {
            ready.push(frame);
            self.next = self.next.saturating_add(1);
        }
        // Frames still waiting are behind a new gap, which starts now.
        self.gap_since = if self.waiting.is_empty() { None } else { Some(now) };
        Ok(())
    }

    /// Fail when the open gap is older than [`SEND_ORDER_GAP`] at `now`. For a timer: sleep until
    /// the gap's deadline, then call this.
    pub fn check_gap(&self, now: Instant) -> Result<(), OrderError> {
        match self.gap_since {
            Some(since) if now.saturating_duration_since(since) > SEND_ORDER_GAP => Err(OrderError::GapTooLong { expected: self.next }),
            _ => Ok(()),
        }
    }

    /// The instant after which the open gap, if any, is too old. The benchmark polls [`OrderBuffer::check_gap`]; only the tests read this.
    #[cfg(test)]
    pub fn deadline(&self) -> Option<Instant> {
        self.gap_since.and_then(|since| since.checked_add(SEND_ORDER_GAP))
    }

    /// The number the next passing frame must carry.
    pub fn expected(&self) -> u64 {
        self.next
    }

    /// How many frames wait for a missing one.
    pub fn waiting(&self) -> usize {
        self.waiting.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::Rng;
    use std::time::Duration;

    fn push(buffer: &mut OrderBuffer<u64>, seq: u64, now: Instant) -> Result<Vec<u64>, OrderError> {
        let mut ready = Vec::new();
        buffer.push(seq, seq, now, &mut ready).map(|()| ready)
    }

    #[test]
    fn in_order_frames_pass_at_once() {
        let (mut buffer, now) = (OrderBuffer::new(), Instant::now());
        for seq in 0..10 {
            assert_eq!(push(&mut buffer, seq, now).unwrap(), [seq]);
        }
        assert_eq!(buffer.expected(), 10);
        assert_eq!(buffer.waiting(), 0);
        assert_eq!(buffer.deadline(), None);
    }

    #[test]
    fn an_early_frame_waits_and_leaves_with_the_ones_behind_a_late_arrival() {
        let (mut buffer, now) = (OrderBuffer::new(), Instant::now());
        assert_eq!(push(&mut buffer, 2, now).unwrap(), Vec::<u64>::new());
        assert_eq!(push(&mut buffer, 1, now).unwrap(), Vec::<u64>::new());
        assert_eq!(push(&mut buffer, 4, now).unwrap(), Vec::<u64>::new());
        assert_eq!(buffer.waiting(), 3);
        assert_eq!(push(&mut buffer, 0, now).unwrap(), [0, 1, 2]);
        assert_eq!(buffer.waiting(), 1);
        assert_eq!(push(&mut buffer, 3, now).unwrap(), [3, 4]);
        assert_eq!(buffer.waiting(), 0);
    }

    #[test]
    fn a_passed_number_and_a_waiting_duplicate_are_errors() {
        let (mut buffer, now) = (OrderBuffer::new(), Instant::now());
        push(&mut buffer, 0, now).unwrap();
        assert_eq!(push(&mut buffer, 0, now), Err(OrderError::AlreadyPassed { seq: 0, expected: 1 }));
        push(&mut buffer, 3, now).unwrap();
        assert_eq!(push(&mut buffer, 3, now), Err(OrderError::Duplicate { seq: 3 }));
        assert_eq!(buffer.waiting(), 1);
    }

    #[test]
    fn the_sixty_fifth_early_frame_is_an_error_and_the_sixty_fourth_is_not() {
        let (mut buffer, now) = (OrderBuffer::new(), Instant::now());
        for seq in 1..=64 {
            assert_eq!(push(&mut buffer, seq, now).unwrap(), Vec::<u64>::new());
        }
        assert_eq!(push(&mut buffer, 65, now), Err(OrderError::TooManyEarly { seq: 65, expected: 0 }));
        // A duplicate is reported as a duplicate even when the buffer is full.
        assert_eq!(push(&mut buffer, 64, now), Err(OrderError::Duplicate { seq: 64 }));
        let released = push(&mut buffer, 0, now).unwrap();
        assert_eq!(released, (0..=64).collect::<Vec<_>>());
    }

    #[test]
    fn a_gap_fails_once_the_clock_passes_five_seconds() {
        let (mut buffer, start) = (OrderBuffer::new(), Instant::now());
        push(&mut buffer, 1, start).unwrap();
        assert_eq!(buffer.deadline(), Some(start + SEND_ORDER_GAP));
        assert_eq!(buffer.check_gap(start + SEND_ORDER_GAP), Ok(()), "exactly 5 s is not past 5 s");
        let late = start + SEND_ORDER_GAP + Duration::from_millis(1);
        let error = buffer.check_gap(late).unwrap_err();
        assert_eq!(error, OrderError::GapTooLong { expected: 0 });
        assert_eq!(error.code(), "send_order");
        // A frame arriving after the limit fails too, even the one that would have closed the gap.
        assert_eq!(push(&mut buffer, 0, late), Err(OrderError::GapTooLong { expected: 0 }));
    }

    #[test]
    fn a_closed_gap_has_no_deadline_and_a_new_gap_starts_its_own_clock() {
        let (mut buffer, start) = (OrderBuffer::new(), Instant::now());
        push(&mut buffer, 1, start).unwrap();
        push(&mut buffer, 3, start + Duration::from_secs(1)).unwrap();
        // 0 arrives at 4 s: frame 1 leaves, 3 still waits behind the gap at 2, whose clock starts now.
        assert_eq!(push(&mut buffer, 0, start + Duration::from_secs(4)).unwrap(), [0, 1]);
        assert_eq!(buffer.deadline(), Some(start + Duration::from_secs(9)));
        assert_eq!(buffer.check_gap(start + Duration::from_secs(8)), Ok(()));
        assert!(buffer.check_gap(start + Duration::from_secs(10)).is_err());
        assert_eq!(push(&mut buffer, 2, start + Duration::from_secs(5)).unwrap(), [2, 3]);
        assert_eq!(buffer.deadline(), None);
        assert_eq!(buffer.check_gap(start + Duration::from_secs(3600)), Ok(()));
    }

    #[test]
    fn an_older_instant_than_the_gap_start_is_not_a_timeout() {
        // A clock that steps backwards must not underflow.
        let (mut buffer, start) = (OrderBuffer::new(), Instant::now() + Duration::from_secs(100));
        push(&mut buffer, 1, start).unwrap();
        assert_eq!(buffer.check_gap(start - Duration::from_secs(50)), Ok(()));
    }

    #[test]
    fn a_huge_number_waits_like_any_other_and_cannot_wrap_the_counter() {
        let (mut buffer, now) = (OrderBuffer::new(), Instant::now());
        assert_eq!(push(&mut buffer, u64::MAX, now).unwrap(), Vec::<u64>::new());
        assert_eq!(push(&mut buffer, u64::MAX - 1, now).unwrap(), Vec::<u64>::new());
        assert_eq!(push(&mut buffer, 0, now).unwrap(), [0]);
        assert_eq!(buffer.expected(), 1);
    }

    #[test]
    fn errors_leave_the_buffer_as_it_was() {
        let (mut buffer, now) = (OrderBuffer::new(), Instant::now());
        push(&mut buffer, 2, now).unwrap();
        let _ = push(&mut buffer, 2, now);
        let _ = push(&mut buffer, u64::MAX, now);
        assert_eq!(buffer.waiting(), 2);
        assert_eq!(push(&mut buffer, 0, now).unwrap(), [0]);
        assert_eq!(push(&mut buffer, 1, now).unwrap(), [1, 2]);
    }

    #[test]
    fn shuffled_within_sixty_four_comes_out_in_order() {
        let mut rng = Rng::new(0x5eed_0005);
        let now = Instant::now();
        for _ in 0..200 {
            // Blocks of up to 65 numbers, each shuffled: at most 64 frames ever wait at once.
            let mut arrival = Vec::new();
            let mut base = 0u64;
            while base < 600 {
                let size = 1 + rng.below(65) as u64;
                let mut block: Vec<u64> = (base..base + size).collect();
                rng.shuffle(&mut block);
                arrival.extend(block);
                base += size;
            }
            let mut buffer = OrderBuffer::new();
            let mut out = Vec::new();
            for seq in &arrival {
                buffer.push(*seq, *seq, now, &mut out).unwrap();
                assert!(buffer.waiting() <= MAX_EARLY_FRAMES);
            }
            assert_eq!(out, (0..base).collect::<Vec<_>>());
            assert_eq!(buffer.waiting(), 0);
        }
    }

    #[test]
    fn hostile_numbers_never_panic_and_never_release_out_of_order() {
        let mut rng = Rng::new(0x5eed_0006);
        let start = Instant::now();
        for _ in 0..200 {
            let mut buffer = OrderBuffer::new();
            let mut out: Vec<u64> = Vec::new();
            let mut now = start;
            for _ in 0..500 {
                now += Duration::from_millis(rng.below(400) as u64);
                let seq = match rng.below(4) {
                    0 => rng.next_u64(),
                    1 => buffer.expected().saturating_sub(rng.below(3) as u64),
                    _ => buffer.expected() + rng.below(70) as u64,
                };
                if buffer.push(seq, seq, now, &mut out).is_err() {
                    break;
                }
                assert!(buffer.waiting() <= MAX_EARLY_FRAMES);
            }
            // Whatever was released is exactly 0, 1, 2, ... with no gap and no repeat.
            assert!(out.iter().enumerate().all(|(i, seq)| *seq == i as u64), "{out:?}");
            assert_eq!(buffer.expected(), out.len() as u64);
        }
    }
}
