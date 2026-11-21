//! Resume signals: the app telling the page that a socket may have died while nothing said so
//! (the machine slept, the network changed). Detection and the rate limit are pure; the app
//! binary owns the ticker thread, reads the clocks and passes the times in, so that nothing here
//! reads a clock (and the module compiles for wasm32).
//!
//! - [`WakeDetector`]: a clock gap that the ticker's own period does not account for.
//! - [`ResumeSignals`]: one rate limit shared by every reason (at most one signal per
//!   [`MIN_INTERVAL_MS`]) and the counts `ui.inspect` reports as `connection.resumeSignals`.
//!
//! Rust closes or probes no socket on a signal; the page's workbench does (a 5 s ping, then a
//! reconnect).

use std::sync::Mutex;
use std::sync::PoisonError;
use std::sync::atomic::{AtomicU64, Ordering};

/// The ticker's period: the time between two calls to [`WakeDetector::observe`] that is expected.
pub const TICK_MS: u64 = 2_000;
/// A gap this long (or longer) beyond the period is a wake.
pub const WAKE_GAP_MS: u64 = 10_000;
/// At most one `connection_resume` per this long, whatever the reasons.
pub const MIN_INTERVAL_MS: u64 = 5_000;

/// Why the page is told to check its connection. The payload of `connection_resume` is
/// `{ "reason": <as_str> }`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    Wake,
    Network,
}

impl Reason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Wake => "wake",
            Self::Network => "network",
        }
    }
}

/// Finds a sleep from the times a periodic tick sees. It needs two clocks:
///
/// - the wall clock (`wall_ms`, milliseconds since the Unix epoch) jumps over a system sleep on
///   every platform, while the steady clock of some platforms stands still during it;
/// - the steady clock (`steady_ms`, monotonic, milliseconds from any fixed start) goes on when
///   the process alone was stopped (a debugger, `SIGSTOP`), where some wall clocks would not be
///   believed.
///
/// A tick is a wake when the larger of the two elapsed times exceeds the period by
/// [`WAKE_GAP_MS`] or more. A wall clock that went backwards is not a wake: the tick only takes
/// the new time as its baseline. A clock set forward is a wake: harmless, the page probes and
/// finds the connection alive.
#[derive(Debug, Clone)]
pub struct WakeDetector {
    last: Option<(i64, u64)>,
}

impl Default for WakeDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl WakeDetector {
    pub const fn new() -> Self {
        Self { last: None }
    }

    /// Report one tick. The first call only sets the baseline.
    pub fn observe(&mut self, wall_ms: i64, steady_ms: u64) -> bool {
        let previous = self.last.replace((wall_ms, steady_ms));
        let Some((last_wall, last_steady)) = previous else { return false };
        // A wall clock set back (or a steady clock that was reset) says nothing about a sleep.
        let Ok(wall_elapsed) = u64::try_from(wall_ms.saturating_sub(last_wall)) else { return false };
        let steady_elapsed = steady_ms.saturating_sub(last_steady);
        wall_elapsed.max(steady_elapsed).saturating_sub(TICK_MS) >= WAKE_GAP_MS
    }
}

#[derive(Default)]
struct Limit {
    last_ms: Option<u64>,
}

/// The rate limit and the counts of resume signals, shared between the ticker threads and the
/// owner thread (`ui.inspect`). `now_ms` is a steady clock the caller reads.
#[derive(Default)]
pub struct ResumeSignals {
    limit: Mutex<Limit>,
    wake: AtomicU64,
    network: AtomicU64,
}

impl ResumeSignals {
    pub fn new() -> Self {
        Self::default()
    }

    /// A reason was detected at `now_ms`. Returns whether the page is to be told: false inside
    /// [`MIN_INTERVAL_MS`] of the last signal that was let through, whatever its reason. Only a
    /// signal that is let through is counted. A steady clock that went backwards lets the signal
    /// through and restarts the interval.
    pub fn signal(&self, reason: Reason, now_ms: u64) -> bool {
        // A poisoned lock still holds a valid `Option<u64>`.
        let mut limit = self.limit.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(last) = limit.last_ms
            && now_ms >= last
            && now_ms - last < MIN_INTERVAL_MS
        {
            return false;
        }
        limit.last_ms = Some(now_ms);
        match reason {
            Reason::Wake => self.wake.fetch_add(1, Ordering::Relaxed),
            Reason::Network => self.network.fetch_add(1, Ordering::Relaxed),
        };
        true
    }

    /// The signals let through since launch: `{ "wake": n, "network": n }`.
    pub fn counts(&self) -> serde_json::Value {
        serde_json::json!({ "wake": self.wake.load(Ordering::Relaxed), "network": self.network.load(Ordering::Relaxed) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feed ticks of a fake clock: `(wall_ms, steady_ms)`.
    fn run(ticks: &[(i64, u64)]) -> Vec<bool> {
        let mut detector = WakeDetector::new();
        ticks.iter().map(|&(wall, steady)| detector.observe(wall, steady)).collect()
    }

    #[test]
    fn the_first_tick_is_a_baseline() {
        assert_eq!(run(&[(1_000_000, 5)]), [false]);
    }

    #[test]
    fn on_time_ticks_are_not_wakes() {
        assert_eq!(run(&[(0, 0), (2_000, 2_000), (4_010, 4_010), (6_100, 6_100)]), [false; 4]);
    }

    #[test]
    fn a_ten_second_gap_beyond_the_period_is_a_wake() {
        // Slept 12 s: the tick was due after 2 s, 12 s passed on the wall clock, the steady clock
        // (which does not count a sleep) saw 2 s.
        assert_eq!(run(&[(0, 0), (12_000, 2_000)]), [false, true]);
        // The same when only the steady clock moved (the wall clock is not trusted).
        assert_eq!(run(&[(0, 0), (2_000, 12_000)]), [false, true]);
        // Both moved: a stopped process.
        assert_eq!(run(&[(0, 0), (15_000, 15_000)]), [false, true]);
    }

    #[test]
    fn nine_seconds_beyond_the_period_is_not() {
        assert_eq!(run(&[(0, 0), (11_999, 2_000)]), [false, false]);
        assert_eq!(run(&[(0, 0), (11_000, 11_000)]), [false, false]);
    }

    #[test]
    fn a_backward_wall_clock_is_not_a_wake_and_sets_the_baseline() {
        // An hour back; the steady clock ticked normally. The tick after it is judged against the
        // new baseline.
        assert_eq!(run(&[(10_000_000, 0), (6_400_000, 2_000), (6_402_000, 4_000)]), [false, false, false]);
    }

    #[test]
    fn a_wall_clock_set_far_back_never_overflows() {
        assert_eq!(run(&[(i64::MAX, 0), (i64::MIN, 2_000)]), [false, false]);
        // And a leap forward over the whole range is a wake, without overflow.
        assert_eq!(run(&[(i64::MIN, 0), (i64::MAX, 2_000)]), [false, true]);
    }

    #[test]
    fn a_steady_clock_that_went_backwards_is_not_a_wake() {
        assert_eq!(run(&[(0, 50_000), (2_000, 100)]), [false, false]);
    }

    #[test]
    fn two_gaps_within_five_seconds_give_one_signal() {
        let signals = ResumeSignals::new();
        assert!(signals.signal(Reason::Wake, 100_000));
        assert!(!signals.signal(Reason::Wake, 102_000));
        assert!(!signals.signal(Reason::Wake, 104_999));
        assert!(signals.signal(Reason::Wake, 105_000));
        assert_eq!(signals.counts(), serde_json::json!({ "wake": 2, "network": 0 }));
    }

    #[test]
    fn the_limit_is_shared_by_every_reason() {
        let signals = ResumeSignals::new();
        assert!(signals.signal(Reason::Network, 10_000));
        assert!(!signals.signal(Reason::Wake, 11_000), "a wake right after a network signal is dropped");
        assert!(signals.signal(Reason::Wake, 15_000));
        assert_eq!(signals.counts(), serde_json::json!({ "wake": 1, "network": 1 }));
    }

    #[test]
    fn a_dropped_signal_does_not_extend_the_interval() {
        let signals = ResumeSignals::new();
        assert!(signals.signal(Reason::Wake, 0));
        assert!(!signals.signal(Reason::Wake, 4_000));
        assert!(signals.signal(Reason::Wake, 5_000), "the interval runs from the signal let through");
    }

    #[test]
    fn a_steady_clock_that_went_backwards_lets_the_signal_through() {
        let signals = ResumeSignals::new();
        assert!(signals.signal(Reason::Wake, 100_000));
        assert!(signals.signal(Reason::Wake, 10));
    }

    #[test]
    fn counts_start_at_zero() {
        assert_eq!(ResumeSignals::new().counts(), serde_json::json!({ "wake": 0, "network": 0 }));
    }

    #[test]
    fn reasons_are_named_as_the_event_payload() {
        assert_eq!(Reason::Wake.as_str(), "wake");
        assert_eq!(Reason::Network.as_str(), "network");
    }
}
