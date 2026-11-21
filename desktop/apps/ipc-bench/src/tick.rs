//! The 2-second tick of row B8: a task that sleeps 2 s, over and over, and records how long each
//! sleep really took. The wake detector of the app's connection resilience (sprint 114) is such a
//! tick: a gap much longer than the interval looks like the machine woke from a nap. The page
//! starts it when a hidden-window run starts and stops it at the end (`bench_tick_start`,
//! `bench_tick_stop`), so the largest gap says whether the tick kept running while the window was
//! hidden.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;

/// The tick the app's wake detector uses (spec § TODO(verify): "the app's 2 s tick"): 2 s.
pub const INTERVAL: Duration = Duration::from_secs(2);
/// The most gaps kept: a run lasts minutes, so this is never reached by one; it bounds a page that never stops the tick.
const MAX_GAPS: usize = 100_000;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// What a tick run saw: the gaps between wake-ups, in milliseconds.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TickReport {
    pub interval_ms: f64,
    pub ticks: usize,
    /// The longest time one sleep of `interval_ms` took (0 when no tick happened).
    pub max_gap_ms: f64,
    /// How much later than the interval the latest tick came (`max_gap_ms - interval_ms`, never below 0).
    pub max_delay_ms: f64,
    pub gaps_ms: Vec<f64>,
}

fn ms(d: Duration) -> f64 {
    (d.as_secs_f64() * 1e6).round() / 1e3
}

/// The report of `gaps` for ticks of `interval`.
pub fn report(interval: Duration, gaps: &[Duration]) -> TickReport {
    let max = gaps.iter().copied().max().unwrap_or_default();
    TickReport {
        interval_ms: ms(interval),
        ticks: gaps.len(),
        max_gap_ms: ms(max),
        max_delay_ms: ms(max.saturating_sub(interval)),
        gaps_ms: gaps.iter().map(|g| ms(*g)).collect(),
    }
}

struct Running {
    task: tauri::async_runtime::JoinHandle<()>,
    gaps: Arc<Mutex<Vec<Duration>>>,
}

/// The tick, managed by Tauri. One at a time: a start while one runs replaces it.
#[derive(Default)]
pub struct Ticker {
    running: Mutex<Option<Running>>,
}

impl Ticker {
    pub fn start(&self, interval: Duration) {
        let gaps = Arc::new(Mutex::new(Vec::new()));
        let seen = gaps.clone();
        let task = tauri::async_runtime::spawn(async move {
            loop {
                let before = Instant::now();
                tokio::time::sleep(interval).await;
                let mut list = lock(&seen);
                if list.len() < MAX_GAPS {
                    list.push(before.elapsed());
                }
            }
        });
        if let Some(old) = lock(&self.running).replace(Running { task, gaps }) {
            old.task.abort();
        }
    }

    /// Stops the tick and reports what it saw (nothing when none was running).
    pub fn stop(&self, interval: Duration) -> TickReport {
        let Some(running) = lock(&self.running).take() else { return report(interval, &[]) };
        running.task.abort();
        let gaps = lock(&running.gaps).clone();
        report(interval, &gaps)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_report_names_the_longest_gap_and_its_delay() {
        let gaps = [Duration::from_millis(2001), Duration::from_millis(7350), Duration::from_millis(2000)];
        let r = report(INTERVAL, &gaps);
        assert_eq!((r.ticks, r.interval_ms, r.max_gap_ms, r.max_delay_ms), (3, 2000.0, 7350.0, 5350.0));
        assert_eq!(r.gaps_ms, [2001.0, 7350.0, 2000.0]);
    }

    #[test]
    fn a_report_of_no_tick_is_empty_and_a_gap_under_the_interval_is_no_delay() {
        let r = report(INTERVAL, &[]);
        assert_eq!((r.ticks, r.max_gap_ms, r.max_delay_ms), (0, 0.0, 0.0));
        let r = report(INTERVAL, &[Duration::from_millis(1999)]);
        assert_eq!((r.max_gap_ms, r.max_delay_ms), (1999.0, 0.0));
    }

    #[test]
    fn a_running_tick_counts_its_wake_ups_and_stops() {
        let interval = Duration::from_millis(20);
        let ticker = Ticker::default();
        tauri::async_runtime::block_on(async {
            ticker.start(interval);
            tokio::time::sleep(Duration::from_millis(210)).await;
        });
        let r = ticker.stop(interval);
        assert!((3..=11).contains(&r.ticks), "{r:?}");
        assert!(r.max_gap_ms >= 20.0, "{r:?}");
        assert_eq!(ticker.stop(interval).ticks, 0, "a second stop finds nothing running");
    }
}
