//! Rigs of the hardening tests: a sink that counts what the engine asks of it, a source that makes
//! bytes without holding them, and a watch for panics in the crate's own code.

use std::io;
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Once, PoisonError};

use tokio::sync::Semaphore;

use crate::download::Sink;
use crate::upload::UploadSource;

/// What a [`RigSink`] was asked to do. One value is shared by the sink the engine owns and the test.
#[derive(Default)]
pub struct Calls {
    kept: Mutex<Vec<u8>>,
    written: AtomicU64,
    finish_started: AtomicU32,
    finishes: AtomicU32,
    discards: AtomicU32,
}

impl Calls {
    /// The bytes the sink kept: nothing when it was made to count only, and nothing after a discard.
    pub fn bytes(&self) -> Vec<u8> {
        self.kept.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// The bytes written, counted whether or not they were kept.
    pub fn written(&self) -> u64 {
        self.written.load(Ordering::SeqCst)
    }

    /// How often `finish` was entered; it may not have returned.
    pub fn finish_started(&self) -> u32 {
        self.finish_started.load(Ordering::SeqCst)
    }

    /// How often `finish` returned.
    pub fn finishes(&self) -> u32 {
        self.finishes.load(Ordering::SeqCst)
    }

    /// How often `discard` ran.
    pub fn discards(&self) -> u32 {
        self.discards.load(Ordering::SeqCst)
    }
}

/// A sink that counts its calls, and that a test can hold in a write or in `finish`.
pub struct RigSink {
    calls: Arc<Calls>,
    write_gate: Option<Arc<Semaphore>>,
    finish_gate: Option<Arc<Semaphore>>,
    keep: bool,
    /// Bytes counted as written before this sink's first: a resume that starts past what memory holds.
    pub start: u64,
}

impl RigSink {
    /// A sink that keeps what it is given.
    pub fn keeping() -> (Self, Arc<Calls>) {
        let calls = Arc::new(Calls::default());
        (Self { calls: Arc::clone(&calls), write_gate: None, finish_gate: None, keep: true, start: 0 }, calls)
    }

    /// A sink that keeps nothing, so that a file of any size needs no memory.
    pub fn counting() -> (Self, Arc<Calls>) {
        let (mut sink, calls) = Self::keeping();
        sink.keep = false;
        (sink, calls)
    }

    /// Takes one write for each permit the gate holds.
    #[must_use]
    pub fn with_write_gate(mut self) -> (Self, Arc<Semaphore>) {
        let gate = Arc::new(Semaphore::new(0));
        self.write_gate = Some(Arc::clone(&gate));
        (self, gate)
    }

    /// Finishes when the gate holds a permit.
    #[must_use]
    pub fn with_finish_gate(mut self) -> (Self, Arc<Semaphore>) {
        let gate = Arc::new(Semaphore::new(0));
        self.finish_gate = Some(Arc::clone(&gate));
        (self, gate)
    }
}

impl std::fmt::Debug for RigSink {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("RigSink").field("start", &self.start).field("keep", &self.keep).finish_non_exhaustive()
    }
}

impl Sink for RigSink {
    fn written(&self) -> u64 {
        self.start.saturating_add(self.calls.written())
    }

    async fn write(&mut self, data: &[u8]) -> io::Result<()> {
        if let Some(gate) = &self.write_gate {
            gate.acquire().await.map_err(|_| io::Error::other("the gate closed"))?.forget();
        }
        if self.keep {
            self.calls.kept.lock().unwrap_or_else(PoisonError::into_inner).extend_from_slice(data);
        }
        self.calls.written.fetch_add(u64::try_from(data.len()).unwrap_or(u64::MAX), Ordering::SeqCst);
        Ok(())
    }

    async fn finish(&mut self) -> io::Result<()> {
        self.calls.finish_started.fetch_add(1, Ordering::SeqCst);
        if let Some(gate) = &self.finish_gate {
            gate.acquire().await.map_err(|_| io::Error::other("the gate closed"))?.forget();
        }
        self.calls.finishes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn discard(&mut self) {
        self.calls.discards.fetch_add(1, Ordering::SeqCst);
        self.calls.kept.lock().unwrap_or_else(PoisonError::into_inner).clear();
    }
}

/// A source of `size` zero bytes that holds none of them: a file of any size with no memory. It
/// counts the bytes it was asked for, so that a test sees how far the upload read.
pub struct CountingSource {
    size: u64,
    at: u64,
    pub read: Arc<AtomicU64>,
}

impl CountingSource {
    pub fn new(size: u64) -> Self {
        Self { size, at: 0, read: Arc::new(AtomicU64::new(0)) }
    }
}

impl UploadSource for CountingSource {
    fn size(&self) -> Option<u64> {
        Some(self.size)
    }

    async fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let count = usize::try_from(self.size.saturating_sub(self.at)).map_or(buf.len(), |left| left.min(buf.len()));
        if let Some(part) = buf.get_mut(..count) {
            part.fill(0);
        }
        self.at += count as u64;
        self.read.fetch_add(count as u64, Ordering::Relaxed);
        Ok(count)
    }

    async fn rewind(&mut self) -> io::Result<()> {
        self.at = 0;
        self.read.store(0, Ordering::Relaxed);
        Ok(())
    }
}

// ---- panics ----

static INSTALL: Once = Once::new();
static PANICS: AtomicUsize = AtomicUsize::new(0);

/// Whether a panic at `file` is the engine's own (or the stand-in's), not a test's assertion.
fn is_library_code(file: &str) -> bool {
    file.contains("transfer/src/") && !file.contains("/tests/") && !file.ends_with("tests.rs")
}

/// How many panics have happened in this crate's own code (not in a test's) since the process began.
/// A panic in a spawned task would otherwise be seen by nobody: a test reads this before and after.
pub fn library_panics() -> usize {
    INSTALL.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if info.location().is_some_and(|location| is_library_code(location.file())) {
                PANICS.fetch_add(1, Ordering::SeqCst);
            }
            previous(info);
        }));
    });
    PANICS.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_panic_is_the_librarys_when_it_is_in_source_that_is_not_a_test() {
        assert!(is_library_code("crates/transfer/src/engine/queue.rs"));
        assert!(is_library_code("crates/transfer/src/testing/connection.rs"));
        assert!(!is_library_code("crates/transfer/src/engine/tests/support.rs"));
        assert!(!is_library_code("crates/transfer/src/engine/tests.rs"));
        assert!(!is_library_code("crates/other/src/lib.rs"));
    }
}
