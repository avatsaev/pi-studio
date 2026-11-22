//! A gauge of the bytes the engine holds in memory for transfers, and the most it held at one moment.
//!
//! The engine holds bytes in two places: an upload's read buffer, and the frames of a download that
//! the daemon sent and the disk has not yet taken. Each is a [`Holding`] taken from one [`Held`], so
//! that [`Held::peak`] is the most of both together (`transfers.peakHeld`, what the memory
//! criterion reads). A file's size appears nowhere in it.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Default)]
struct Gauge {
    now: AtomicU64,
    peak: AtomicU64,
}

/// The shared gauge. Cloning shares it.
#[derive(Debug, Clone, Default)]
pub struct Held(Arc<Gauge>);

impl Held {
    /// A new gauge at zero.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Counts `bytes` as held until the returned [`Holding`] is dropped.
    #[must_use]
    pub fn hold(&self, bytes: usize) -> Holding {
        let bytes = u64::try_from(bytes).unwrap_or(u64::MAX);
        let before = match self.0.now.try_update(Ordering::Relaxed, Ordering::Relaxed, |now| Some(now.saturating_add(bytes))) {
            Ok(before) | Err(before) => before,
        };
        self.0.peak.fetch_max(before.saturating_add(bytes), Ordering::Relaxed);
        Holding { gauge: Arc::clone(&self.0), bytes }
    }

    /// The bytes held now.
    #[must_use]
    pub fn now(&self) -> u64 {
        self.0.now.load(Ordering::Relaxed)
    }

    /// The most bytes that were held at one moment.
    #[must_use]
    pub fn peak(&self) -> u64 {
        self.0.peak.load(Ordering::Relaxed)
    }
}

/// Bytes counted as held; they stop counting when this is dropped.
#[derive(Debug)]
pub struct Holding {
    gauge: Arc<Gauge>,
    bytes: u64,
}

impl Drop for Holding {
    fn drop(&mut self) {
        let bytes = self.bytes;
        let _ = self.gauge.now.try_update(Ordering::Relaxed, Ordering::Relaxed, |now| Some(now.saturating_sub(bytes)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_peak_is_the_most_held_at_once_and_stays_after_release() {
        let held = Held::new();
        let a = held.hold(100);
        let b = held.hold(50);
        assert_eq!((held.now(), held.peak()), (150, 150));
        drop(a);
        assert_eq!((held.now(), held.peak()), (50, 150));
        let c = held.hold(60);
        assert_eq!((held.now(), held.peak()), (110, 150));
        drop((b, c));
        assert_eq!((held.now(), held.peak()), (0, 150));
    }

    #[test]
    fn a_clone_shares_the_gauge() {
        let held = Held::new();
        let other = held.clone();
        let _holding = other.hold(7);
        assert_eq!(held.now(), 7);
    }

    #[test]
    fn counters_saturate_instead_of_wrapping() {
        let held = Held::new();
        let _a = held.hold(usize::MAX);
        let _b = held.hold(usize::MAX);
        assert_eq!(held.peak(), u64::MAX);
    }
}
