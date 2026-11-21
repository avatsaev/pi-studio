//! The resume ticker: a thread that wakes every [`TICK_MS`], reads the clocks, asks the pure
//! [`WakeDetector`] whether the machine slept, and tells the page with a `connection_resume`
//! event. The shell crate holds the detection, the rate limit (one signal per 5 s for every
//! reason) and the counts `ui.inspect` reports; this file only reads the clocks and emits.
//!
//! The thread closes no socket and probes none: the page's workbench does that on the event.

use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::sync::{Arc, LazyLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use pistudiodesktop_shell::resume::{Reason, ResumeSignals, TICK_MS, WakeDetector};
use serde_json::json;
use tauri::{AppHandle, Emitter as _, Manager as _, RunEvent, Runtime};

/// The event the page listens to: payload `{ "reason": "wake" | "network" }`.
pub const EVENT: &str = "connection_resume";

/// Milliseconds on a steady clock that starts at the first call. Every ticker reads this one, so
/// that the rate limit compares times from a single clock.
pub fn steady_ms() -> u64 {
    static START: LazyLock<Instant> = LazyLock::new(Instant::now);
    u64::try_from(START.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// The wall clock in milliseconds since the Unix epoch (negative before it). `None` when the
/// platform's clock cannot be represented; the tick is then skipped.
fn wall_ms() -> Option<i64> {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(after) => i64::try_from(after.as_millis()).ok(),
        Err(before) => i64::try_from(before.duration().as_millis()).ok().map(|ms| -ms),
    }
}

/// Tell the page, unless a signal went less than 5 s ago (whatever its reason). Returns whether an
/// event was sent. A failed emit is logged; it does not count as sent.
pub fn emit<R: Runtime>(handle: &AppHandle<R>, signals: &ResumeSignals, reason: Reason, now_ms: u64) -> bool {
    if !signals.signal(reason, now_ms) {
        log::debug!("resume signal `{}` dropped: one was sent less than 5 s ago", reason.as_str());
        return false;
    }
    log::info!("resume signal: {}", reason.as_str());
    if let Err(e) = handle.emit(EVENT, json!({ "reason": reason.as_str() })) {
        log::warn!("the `{EVENT}` event was not sent: {e}");
    }
    true
}

/// One tick: a wake when the detector says so and the rate limit lets it through. The clocks are
/// arguments so that a test can drive it.
fn tick(detector: &mut WakeDetector, wall_ms: Option<i64>, steady_ms: u64, mut emit: impl FnMut(Reason, u64)) {
    if let Some(wall) = wall_ms
        && detector.observe(wall, steady_ms)
    {
        emit(Reason::Wake, steady_ms);
    }
}

/// Call `work` once per `period` until `stop` is signalled or its sender is gone. The wait is the
/// channel's timeout, so a stop is heard at once.
fn run_until_stopped(stop: &Receiver<()>, period: Duration, mut work: impl FnMut()) {
    while matches!(stop.recv_timeout(period), Err(RecvTimeoutError::Timeout)) {
        work();
    }
}

/// The running ticker, managed by Tauri. Dropping it, or [`stop`](Self::stop), ends the thread.
pub struct Ticker {
    stop: Sender<()>,
}

impl Ticker {
    pub fn stop(&self) {
        // The thread may be gone already: nothing is left to stop.
        let _ = self.stop.send(());
    }
}

/// Start the thread. It ends with the app (see [`on_run_event`]); it holds a handle only to
/// emit.
pub fn start<R: Runtime>(handle: AppHandle<R>, signals: Arc<ResumeSignals>) -> Ticker {
    let (stop, stopped) = channel();
    let spawned = thread::Builder::new().name("resume-ticker".into()).spawn(move || {
        let mut detector = WakeDetector::new();
        // The baseline: the first tick is judged against this one.
        if let Some(wall) = wall_ms() {
            detector.observe(wall, steady_ms());
        }
        run_until_stopped(&stopped, Duration::from_millis(TICK_MS), || {
            tick(&mut detector, wall_ms(), steady_ms(), |reason, now| {
                emit(&handle, &signals, reason, now);
            });
        });
        log::debug!("the resume ticker stopped");
    });
    if let Err(e) = spawned {
        log::warn!("the resume ticker did not start: {e}; the page gets no wake signal");
    }
    Ticker { stop }
}

/// Stop the ticker when the app exits.
pub fn on_run_event<R: Runtime>(handle: &AppHandle<R>, event: &RunEvent) {
    if matches!(event, RunEvent::Exit)
        && let Some(ticker) = handle.try_state::<Ticker>()
    {
        ticker.stop();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    /// What `tick` told: `(reason, steady ms)`.
    fn ticks(clocks: &[(Option<i64>, u64)], signals: &ResumeSignals) -> Vec<(Reason, u64)> {
        let mut detector = WakeDetector::new();
        let mut sent = Vec::new();
        for &(wall, steady) in clocks {
            tick(&mut detector, wall, steady, |reason, now| {
                if signals.signal(reason, now) {
                    sent.push((reason, now));
                }
            });
        }
        sent
    }

    #[test]
    fn a_ten_second_gap_signals_once() {
        let signals = ResumeSignals::new();
        let sent = ticks(&[(Some(0), 0), (Some(2_000), 2_000), (Some(14_000), 4_000), (Some(16_000), 6_000)], &signals);
        assert_eq!(sent, [(Reason::Wake, 4_000)]);
        assert_eq!(signals.counts(), json!({"wake": 1, "network": 0}));
    }

    #[test]
    fn a_nine_second_gap_a_backward_clock_and_an_unreadable_clock_signal_nothing() {
        let signals = ResumeSignals::new();
        assert!(ticks(&[(Some(0), 0), (Some(11_000), 2_000)], &signals).is_empty());
        assert!(ticks(&[(Some(100_000), 0), (Some(10_000), 2_000), (None, 4_000), (Some(12_000), 6_000)], &signals).is_empty());
    }

    #[test]
    fn two_gaps_within_five_seconds_give_one_signal() {
        let signals = ResumeSignals::new();
        // Two 12 s gaps, the second tick 2 s after the first: the second is dropped.
        let sent = ticks(&[(Some(0), 0), (Some(12_000), 2_000), (Some(24_000), 4_000)], &signals);
        assert_eq!(sent.len(), 1);
        assert_eq!(signals.counts(), json!({"wake": 1, "network": 0}));
    }

    #[test]
    fn the_clocks_read_something_sane() {
        let a = steady_ms();
        assert!(steady_ms() >= a);
        assert!(wall_ms().is_some_and(|ms| ms > 1_700_000_000_000), "the wall clock is after 2023");
    }

    #[test]
    fn the_loop_works_each_period_and_stops_at_once_when_told() {
        let (stop, stopped) = channel();
        let count = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&count);
        let worker = thread::spawn(move || {
            run_until_stopped(&stopped, Duration::from_millis(5), || {
                counted.fetch_add(1, Ordering::Relaxed);
            });
        });
        while count.load(Ordering::Relaxed) < 3 {
            thread::sleep(Duration::from_millis(1));
        }
        stop.send(()).unwrap();
        worker.join().unwrap();
    }

    #[test]
    fn the_loop_ends_when_its_sender_is_dropped() {
        let (stop, stopped) = channel::<()>();
        let worker = thread::spawn(move || run_until_stopped(&stopped, Duration::from_secs(3600), || {}));
        drop(stop);
        worker.join().unwrap();
    }

    #[test]
    fn the_ticker_runs_on_a_mock_app_and_stops_with_it() {
        let app = tauri::test::mock_app();
        let signals = Arc::new(ResumeSignals::new());
        let ticker = start(app.handle().clone(), Arc::clone(&signals));
        // Nothing happens within a tick of a quiet clock; the stop is heard without waiting for one.
        ticker.stop();
        assert_eq!(signals.counts(), json!({"wake": 0, "network": 0}));
    }
}
