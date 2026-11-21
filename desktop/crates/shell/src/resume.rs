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

use std::collections::BTreeSet;
use std::net::IpAddr;
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

/// How long the address set must stay as it is before a change is reported.
pub const NETWORK_QUIET_MS: u64 = 1_000;

/// Finds a change of the machine's non-loopback addresses from readings the app takes. The caller
/// reads the addresses (every [`NETWORK_PERIOD_MS`], or every [`NETWORK_QUIET_MS`] while
/// [`is_settling`](Self::is_settling)) and passes the set and the time in.
///
/// A change is reported once, when the set has stayed the same for [`NETWORK_QUIET_MS`] after its
/// last change and still holds at least one address. Losing every address is not reported (there
/// is nothing to reconnect over): the empty set becomes the baseline, so that the first address
/// that comes back is a change. A set that returns to the baseline within the quiet time is
/// not reported.
#[derive(Debug, Clone, Default)]
pub struct NetworkWatcher {
    /// The baseline: the set last reported (or first read, or found empty).
    reported: Option<BTreeSet<IpAddr>>,
    /// The latest reading.
    last: BTreeSet<IpAddr>,
    /// When `last` was first seen, while it differs from what was read before it and has not yet
    /// been settled.
    changed_at: Option<u64>,
}

/// The period between two readings when nothing is changing.
pub const NETWORK_PERIOD_MS: u64 = 5_000;

impl NetworkWatcher {
    pub const fn new() -> Self {
        Self { reported: None, last: BTreeSet::new(), changed_at: None }
    }

    /// Whether a change is waiting for its quiet second: read again after [`NETWORK_QUIET_MS`].
    pub const fn is_settling(&self) -> bool {
        self.changed_at.is_some()
    }

    /// Report one reading taken at `now_ms` (a steady clock). Returns true when the page is to be
    /// told. The first reading only sets the baseline.
    pub fn observe(&mut self, now_ms: u64, addrs: BTreeSet<IpAddr>) -> bool {
        if self.reported.is_none() {
            self.reported = Some(addrs.clone());
            self.last = addrs;
            return false;
        }
        if addrs != self.last {
            if addrs.is_empty() {
                // Offline: nothing to signal now; the next address to appear will be.
                self.reported = Some(BTreeSet::new());
                self.changed_at = None;
                self.last = addrs;
                return false;
            }
            self.last = addrs;
            self.changed_at = Some(now_ms);
            return false;
        }
        let Some(since) = self.changed_at else { return false };
        // A steady clock that went backwards restarts the quiet time instead of waiting for it.
        if now_ms < since {
            self.changed_at = Some(now_ms);
            return false;
        }
        if now_ms - since < NETWORK_QUIET_MS {
            return false;
        }
        self.changed_at = None;
        if self.reported.as_ref() == Some(&self.last) {
            return false;
        }
        self.reported = Some(self.last.clone());
        true
    }
}

#[derive(Default)]
struct Limit {
    last_ms: Option<u64>,
    /// A signal the limit refused, per reason, waiting for it to allow one. Two refused signals of
    /// one reason are one pending signal.
    pending_wake: bool,
    pending_network: bool,
}

impl Limit {
    /// Milliseconds until the limit lets a signal through (0: now). A steady clock that went
    /// backwards lets it through.
    fn wait_ms(&self, now_ms: u64) -> u64 {
        match self.last_ms {
            Some(last) if now_ms >= last => MIN_INTERVAL_MS.saturating_sub(now_ms - last),
            _ => 0,
        }
    }

    fn pending(&mut self, reason: Reason) -> &mut bool {
        match reason {
            Reason::Wake => &mut self.pending_wake,
            Reason::Network => &mut self.pending_network,
        }
    }
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

    fn count(&self, reason: Reason) {
        match reason {
            Reason::Wake => self.wake.fetch_add(1, Ordering::Relaxed),
            Reason::Network => self.network.fetch_add(1, Ordering::Relaxed),
        };
    }

    /// A reason was detected at `now_ms`. Returns whether the page is to be told now: false inside
    /// [`MIN_INTERVAL_MS`] of the last signal that was let through, whatever its reason. A refused
    /// signal is not lost: it stays pending (once per reason) until [`take_pending`](Self::take_pending)
    /// finds the limit open. Only a signal that is let through is counted. A steady clock that went
    /// backwards lets the signal through and restarts the interval.
    pub fn signal(&self, reason: Reason, now_ms: u64) -> bool {
        // A poisoned lock still holds plain flags and an `Option<u64>`.
        let mut limit = self.limit.lock().unwrap_or_else(PoisonError::into_inner);
        if limit.wait_ms(now_ms) > 0 {
            *limit.pending(reason) = true;
            return false;
        }
        limit.last_ms = Some(now_ms);
        // This event covers a signal of the same reason that was waiting.
        *limit.pending(reason) = false;
        self.count(reason);
        true
    }

    /// A pending signal the limit now lets through, if any (a wake before a network change). It is
    /// counted and no longer pending: the caller is to emit it.
    pub fn take_pending(&self, now_ms: u64) -> Option<Reason> {
        let mut limit = self.limit.lock().unwrap_or_else(PoisonError::into_inner);
        let reason = [Reason::Wake, Reason::Network].into_iter().find(|&r| *limit.pending(r))?;
        if limit.wait_ms(now_ms) > 0 {
            return None;
        }
        limit.last_ms = Some(now_ms);
        *limit.pending(reason) = false;
        self.count(reason);
        Some(reason)
    }

    /// When something is pending: the milliseconds until the limit lets it through (0 when it
    /// would now). `None` when nothing waits.
    pub fn pending_wait_ms(&self, now_ms: u64) -> Option<u64> {
        let mut limit = self.limit.lock().unwrap_or_else(PoisonError::into_inner);
        let any = *limit.pending(Reason::Wake) || *limit.pending(Reason::Network);
        any.then(|| limit.wait_ms(now_ms))
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
    fn a_network_change_two_seconds_after_a_wake_is_emitted_at_five_seconds_not_lost() {
        let signals = ResumeSignals::new();
        assert!(signals.signal(Reason::Wake, 10_000));
        assert!(!signals.signal(Reason::Network, 12_000));
        assert_eq!(signals.pending_wait_ms(12_000), Some(3_000));
        assert_eq!(signals.take_pending(14_999), None);
        assert_eq!(signals.take_pending(15_000), Some(Reason::Network));
        assert_eq!(signals.counts(), serde_json::json!({ "wake": 1, "network": 1 }));
    }

    #[test]
    fn two_refused_changes_of_one_reason_collapse_into_one() {
        let signals = ResumeSignals::new();
        assert!(signals.signal(Reason::Wake, 0));
        assert!(!signals.signal(Reason::Network, 1_000));
        assert!(!signals.signal(Reason::Network, 2_000));
        assert_eq!(signals.take_pending(5_000), Some(Reason::Network));
        assert_eq!(signals.take_pending(10_000), None);
        assert_eq!(signals.counts(), serde_json::json!({ "wake": 1, "network": 1 }));
    }

    #[test]
    fn a_pending_signal_is_not_emitted_twice() {
        let signals = ResumeSignals::new();
        assert!(signals.signal(Reason::Wake, 0));
        assert!(!signals.signal(Reason::Network, 1_000));
        assert_eq!(signals.take_pending(5_000), Some(Reason::Network));
        assert_eq!(signals.take_pending(5_000), None);
        assert_eq!(signals.pending_wait_ms(5_000), None);
        // A fresh signal of the reason that was pending covers it: nothing is left to emit later.
        assert!(!signals.signal(Reason::Wake, 6_000));
        assert!(signals.signal(Reason::Wake, 10_000));
        assert_eq!(signals.take_pending(20_000), None);
    }

    #[test]
    fn pending_signals_go_out_one_per_interval() {
        let signals = ResumeSignals::new();
        assert!(signals.signal(Reason::Wake, 0));
        assert!(!signals.signal(Reason::Network, 100));
        assert!(!signals.signal(Reason::Wake, 200));
        assert_eq!(signals.take_pending(5_000), Some(Reason::Wake));
        assert_eq!(signals.take_pending(5_000), None);
        assert_eq!(signals.take_pending(10_000), Some(Reason::Network));
    }

    #[test]
    fn reasons_are_named_as_the_event_payload() {
        assert_eq!(Reason::Wake.as_str(), "wake");
        assert_eq!(Reason::Network.as_str(), "network");
    }

    fn set(addrs: &[&str]) -> BTreeSet<IpAddr> {
        addrs.iter().map(|a| a.parse().unwrap()).collect()
    }

    /// Feed `(now_ms, addresses)` readings; returns the times at which a change was reported.
    fn watch(readings: &[(u64, &[&str])]) -> Vec<u64> {
        let mut watcher = NetworkWatcher::new();
        readings.iter().filter(|&&(now, addrs)| watcher.observe(now, set(addrs))).map(|&(now, _)| now).collect()
    }

    const A: &str = "192.168.1.5";
    const B: &str = "10.0.0.7";
    const C: &str = "172.16.0.9";

    #[test]
    fn the_first_reading_is_a_baseline() {
        assert!(watch(&[(0, &[A]), (5_000, &[A])]).is_empty());
    }

    #[test]
    fn an_added_address_signals_once_after_a_quiet_second() {
        assert_eq!(watch(&[(0, &[A]), (5_000, &[A, B]), (5_999, &[A, B]), (6_000, &[A, B]), (11_000, &[A, B])]), [6_000]);
    }

    #[test]
    fn a_removed_address_signals_once() {
        assert_eq!(watch(&[(0, &[A, B]), (5_000, &[A]), (6_000, &[A]), (11_000, &[A])]), [6_000]);
    }

    #[test]
    fn a_replaced_address_signals_once() {
        assert_eq!(watch(&[(0, &[A]), (5_000, &[B]), (6_000, &[B]), (11_000, &[B])]), [6_000]);
    }

    #[test]
    fn losing_every_address_does_not_signal_but_the_return_does() {
        assert!(watch(&[(0, &[A]), (5_000, &[]), (6_000, &[]), (11_000, &[])]).is_empty());
        assert_eq!(watch(&[(0, &[A]), (5_000, &[]), (10_000, &[B]), (11_000, &[B])]), [11_000]);
    }

    #[test]
    fn a_change_during_the_quiet_second_restarts_it() {
        // B at 5000, then C at 5600: quiet is counted from 5600.
        assert_eq!(watch(&[(0, &[A]), (5_000, &[B]), (5_600, &[C]), (6_000, &[C]), (6_599, &[C]), (6_600, &[C])]), [6_600]);
    }

    #[test]
    fn going_back_to_the_baseline_within_the_quiet_second_is_no_change() {
        assert!(watch(&[(0, &[A]), (5_000, &[B]), (5_500, &[A]), (6_500, &[A]), (12_000, &[A])]).is_empty());
    }

    #[test]
    fn it_asks_for_a_quick_reading_only_while_a_change_settles() {
        let mut watcher = NetworkWatcher::new();
        watcher.observe(0, set(&[A]));
        assert!(!watcher.is_settling());
        watcher.observe(5_000, set(&[A, B]));
        assert!(watcher.is_settling());
        assert!(watcher.observe(6_000, set(&[A, B])));
        assert!(!watcher.is_settling());
    }

    #[test]
    fn a_steady_clock_that_went_backwards_restarts_the_quiet_second() {
        assert_eq!(watch(&[(100_000, &[A]), (105_000, &[B]), (10, &[B]), (500, &[B]), (1_010, &[B])]), [1_010]);
    }
}
