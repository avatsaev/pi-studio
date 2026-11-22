//! The inbound window: how far Rust may run ahead of the page.
//!
//! Rust counts the payload bytes it sent on the channel; the page acknowledges what `onMessage` has
//! returned from. While more than [`WINDOW_HIGH_BYTES`] are unacknowledged the socket is not read
//! (TCP then slows the daemon); reading resumes below [`WINDOW_LOW_BYTES`]. Between the two marks
//! the state does not change, so reading does not flap around one threshold.

use crate::limits::{WINDOW_HIGH_BYTES, WINDOW_LOW_BYTES};

/// The page acknowledged bytes Rust never sent: a bug or a hostile page, never a wrap-around.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowError {
    pub acknowledged: u64,
    pub outstanding: u64,
}

impl std::fmt::Display for WindowError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "the page acknowledged {} bytes but only {} are outstanding", self.acknowledged, self.outstanding)
    }
}

impl std::error::Error for WindowError {}

/// Bytes sent to the page and bytes it has acknowledged, for one connection.
#[derive(Debug, Clone, Default)]
pub struct InboundWindow {
    sent: u64,
    acknowledged: u64,
    paused: bool,
}

impl InboundWindow {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record `bytes` of payload sent on the channel.
    pub fn on_sent(&mut self, bytes: u64) {
        // Saturating: 2^64 bytes cannot be sent, but a counter must never wrap if it somehow were.
        self.sent = self.sent.saturating_add(bytes);
        if self.outstanding() > WINDOW_HIGH_BYTES {
            self.paused = true;
        }
    }

    /// Record an acknowledgement of `bytes`. More than is outstanding is an error and changes
    /// nothing.
    pub fn on_ack(&mut self, bytes: u64) -> Result<(), WindowError> {
        let outstanding = self.outstanding();
        if bytes > outstanding {
            return Err(WindowError { acknowledged: bytes, outstanding });
        }
        // `bytes <= outstanding = sent - acknowledged`, so the sum cannot pass `sent`.
        self.acknowledged += bytes;
        if self.outstanding() < WINDOW_LOW_BYTES {
            self.paused = false;
        }
        Ok(())
    }

    /// Payload bytes sent and not yet acknowledged.
    pub fn outstanding(&self) -> u64 {
        // `acknowledged <= sent` is the invariant `on_ack` keeps.
        self.sent.saturating_sub(self.acknowledged)
    }

    /// Whether the socket may be read now.
    pub fn may_read(&self) -> bool {
        !self.paused
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::Rng;

    #[test]
    fn a_new_window_reads() {
        let window = InboundWindow::new();
        assert!(window.may_read());
        assert_eq!(window.outstanding(), 0);
    }

    #[test]
    fn stops_above_the_high_mark_not_at_it() {
        let mut window = InboundWindow::new();
        window.on_sent(WINDOW_HIGH_BYTES);
        assert!(window.may_read(), "exactly 8 MiB is still allowed");
        window.on_sent(1);
        assert!(!window.may_read());
    }

    #[test]
    fn resumes_below_the_low_mark_not_at_it() {
        let mut window = InboundWindow::new();
        window.on_sent(WINDOW_HIGH_BYTES + 1);
        assert!(!window.may_read());
        window.on_ack(WINDOW_HIGH_BYTES + 1 - WINDOW_LOW_BYTES - 1).unwrap();
        assert_eq!(window.outstanding(), WINDOW_LOW_BYTES + 1);
        assert!(!window.may_read(), "between the marks it stays stopped");
        window.on_ack(1).unwrap();
        assert_eq!(window.outstanding(), WINDOW_LOW_BYTES);
        assert!(!window.may_read(), "exactly 4 MiB is not below the mark");
        window.on_ack(1).unwrap();
        assert!(window.may_read());
    }

    #[test]
    fn between_the_marks_a_reading_window_keeps_reading() {
        let mut window = InboundWindow::new();
        window.on_sent(WINDOW_HIGH_BYTES);
        window.on_ack(1).unwrap();
        window.on_sent(1);
        assert!(window.may_read());
    }

    #[test]
    fn an_ack_above_what_is_outstanding_is_refused_and_changes_nothing() {
        let mut window = InboundWindow::new();
        assert_eq!(window.on_ack(1), Err(WindowError { acknowledged: 1, outstanding: 0 }));
        window.on_sent(100);
        assert_eq!(window.on_ack(101), Err(WindowError { acknowledged: 101, outstanding: 100 }));
        assert_eq!(window.on_ack(u64::MAX), Err(WindowError { acknowledged: u64::MAX, outstanding: 100 }));
        assert_eq!(window.outstanding(), 100);
        window.on_ack(100).unwrap();
        assert_eq!(window.on_ack(1), Err(WindowError { acknowledged: 1, outstanding: 0 }));
    }

    #[test]
    fn a_zero_ack_is_fine() {
        let mut window = InboundWindow::new();
        window.on_ack(0).unwrap();
    }

    #[test]
    fn counters_do_not_wrap() {
        let mut window = InboundWindow::new();
        window.on_sent(u64::MAX);
        window.on_sent(u64::MAX);
        assert!(!window.may_read());
        assert_eq!(window.outstanding(), u64::MAX);
        window.on_ack(u64::MAX).unwrap();
        assert_eq!(window.outstanding(), 0);
        assert!(window.may_read());
    }

    #[test]
    fn generated_traffic_keeps_the_invariants() {
        let mut rng = Rng::new(0x5eed_0004);
        for _ in 0..50 {
            let mut window = InboundWindow::new();
            let mut model_outstanding: u64 = 0;
            let mut stopped = false;
            for _ in 0..2_000 {
                if rng.below(2) == 0 {
                    let bytes = rng.below(3 * 1024 * 1024) as u64;
                    window.on_sent(bytes);
                    model_outstanding += bytes;
                    if model_outstanding > WINDOW_HIGH_BYTES {
                        stopped = true;
                    }
                } else {
                    // Sometimes more than is outstanding: that must fail and change nothing.
                    let bytes = rng.below(4 * 1024 * 1024) as u64;
                    match window.on_ack(bytes) {
                        Ok(()) => {
                            assert!(bytes <= model_outstanding);
                            model_outstanding -= bytes;
                            if model_outstanding < WINDOW_LOW_BYTES {
                                stopped = false;
                            }
                        }
                        Err(error) => {
                            assert!(bytes > model_outstanding);
                            assert_eq!(error.outstanding, model_outstanding);
                        }
                    }
                }
                assert_eq!(window.outstanding(), model_outstanding);
                assert_eq!(window.may_read(), !stopped);
            }
        }
    }
}
