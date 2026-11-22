//! What a transfer tells the caller while it moves: an [`Event`] at every change of state, and at most
//! ten a second per transfer while bytes move. None when it settles: the answer of the call says so.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tokio::time::Instant;

/// Where a transfer is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferState {
    /// Behind as many transfers as the engine runs at once.
    Queued,
    /// Bytes are moving.
    Running,
    /// The bulk connection is being opened.
    Waiting,
}

impl TransferState {
    /// The state as the page reads it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Waiting => "waiting",
        }
    }
}

/// `transfer_progress`: a transfer's state and how far it is. Never holds a path or a handle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    /// The transfer's id, as the caller gave it.
    pub id: String,
    /// Where the transfer is.
    pub state: TransferState,
    /// Bytes sent (an upload) or written to disk (a save).
    pub done: u64,
    /// The file's size, when it is known: an upload's from its source, a save's once the daemon answered.
    pub total: Option<u64>,
}

/// What the caller gives the engine to receive [`Event`]s. It runs on whichever task changed the
/// state, in the engine's own order for state changes, and must be quick and must not call back into
/// the engine.
pub(super) type Events = Arc<dyn Fn(Event) + Send + Sync>;

/// At most one event per interval: the first is always allowed.
#[derive(Debug)]
struct Throttle {
    interval: Duration,
    last: Option<Instant>,
}

impl Throttle {
    /// Whether an event at `now` is allowed, and if so counts it.
    fn permit(&mut self, now: Instant) -> bool {
        if self.last.is_some_and(|last| now.saturating_duration_since(last) < self.interval) {
            return false;
        }
        self.last = Some(now);
        true
    }

    /// Counts an event that is sent regardless, so that the next one waits an interval after it.
    fn mark(&mut self, now: Instant) {
        self.last = Some(now);
    }
}

#[derive(Debug)]
struct Counts {
    done: u64,
    total: Option<u64>,
    throttle: Throttle,
}

/// One transfer's progress: what the snapshot reads, and where its events come from.
pub(super) struct Reporter {
    id: String,
    events: Events,
    counts: Mutex<Counts>,
}

impl Reporter {
    pub fn new(id: &str, total: Option<u64>, events: Events, interval: Duration) -> Self {
        Self { id: id.to_owned(), events, counts: Mutex::new(Counts { done: 0, total, throttle: Throttle { interval, last: None } }) }
    }

    fn lock(&self) -> MutexGuard<'_, Counts> {
        self.counts.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The bytes done and the total, as the last report left them.
    pub fn counts(&self) -> (u64, Option<u64>) {
        let counts = self.lock();
        (counts.done, counts.total)
    }

    /// The transfer is in `state` now: always told.
    pub fn state_changed(&self, state: TransferState) {
        let event = {
            let mut counts = self.lock();
            counts.throttle.mark(Instant::now());
            Event { id: self.id.clone(), state, done: counts.done, total: counts.total }
        };
        (self.events)(event);
    }

    /// Bytes are moving: `done` of `total` (when the call knows it; `None` keeps what is known). Told
    /// at most once an interval.
    pub fn progress(&self, done: u64, total: Option<u64>) {
        let event = {
            let mut counts = self.lock();
            counts.done = done;
            counts.total = total.or(counts.total);
            if !counts.throttle.permit(Instant::now()) {
                return;
            }
            Event { id: self.id.clone(), state: TransferState::Running, done, total: counts.total }
        };
        (self.events)(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collecting(interval: Duration, total: Option<u64>) -> (Reporter, Arc<Mutex<Vec<Event>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let events: Events = Arc::new(move |event| sink.lock().unwrap().push(event));
        (Reporter::new("a-1", total, events, interval), seen)
    }

    #[tokio::test(start_paused = true)]
    async fn progress_is_told_at_most_once_an_interval() {
        let (reporter, seen) = collecting(Duration::from_millis(100), Some(1000));
        reporter.progress(1, None);
        reporter.progress(2, None);
        tokio::time::advance(Duration::from_millis(99)).await;
        reporter.progress(3, None);
        tokio::time::advance(Duration::from_millis(1)).await;
        reporter.progress(4, None);
        reporter.progress(5, None);
        let done: Vec<u64> = seen.lock().unwrap().iter().map(|event| event.done).collect();
        assert_eq!(done, [1, 4]);
        assert_eq!(reporter.counts(), (5, Some(1000)));
    }

    #[tokio::test(start_paused = true)]
    async fn a_second_of_reports_is_at_most_ten_events() {
        let (reporter, seen) = collecting(Duration::from_millis(100), None);
        for step in 0..1000_u64 {
            reporter.progress(step, None);
            tokio::time::advance(Duration::from_millis(1)).await;
        }
        let count = seen.lock().unwrap().len();
        assert!((9..=10).contains(&count), "{count}");
    }

    #[tokio::test(start_paused = true)]
    async fn a_change_of_state_is_always_told_and_counts_toward_the_rate() {
        let (reporter, seen) = collecting(Duration::from_millis(100), Some(10));
        reporter.state_changed(TransferState::Queued);
        reporter.state_changed(TransferState::Waiting);
        reporter.state_changed(TransferState::Running);
        reporter.progress(5, None);
        tokio::time::advance(Duration::from_millis(100)).await;
        reporter.progress(6, None);
        let seen = seen.lock().unwrap();
        let states: Vec<_> = seen.iter().map(|event| (event.state, event.done)).collect();
        assert_eq!(states, [(TransferState::Queued, 0), (TransferState::Waiting, 0), (TransferState::Running, 0), (TransferState::Running, 6)]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_known_total_is_kept_when_a_report_does_not_know_it() {
        let (reporter, seen) = collecting(Duration::ZERO, None);
        reporter.progress(1, Some(9));
        reporter.progress(2, None);
        let seen = seen.lock().unwrap();
        assert_eq!(seen.iter().map(|event| event.total).collect::<Vec<_>>(), [Some(9), Some(9)]);
    }

    #[test]
    fn the_states_are_named_as_the_page_reads_them() {
        assert_eq!(TransferState::Queued.as_str(), "queued");
        assert_eq!(TransferState::Running.as_str(), "running");
        assert_eq!(TransferState::Waiting.as_str(), "waiting");
    }
}
