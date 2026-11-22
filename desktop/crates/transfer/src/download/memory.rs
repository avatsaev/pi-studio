//! A [`Sink`] in memory, for the tests of the save and of the engine built on it.

use std::io;

use super::sink::Sink;

/// A sink that keeps what it is given in a `Vec`. It holds the whole file, so it is for tests only.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct MemorySink {
    bytes: Vec<u8>,
    finished: bool,
    discarded: bool,
}

impl MemorySink {
    /// An empty sink: the start of a first attempt.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// A sink that already holds `bytes`: what an earlier attempt wrote, to resume into.
    #[must_use]
    pub fn with_bytes(bytes: Vec<u8>) -> Self {
        Self { bytes, ..Self::default() }
    }

    /// What the sink holds. Empty once it was discarded.
    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Whether the save completed: [`finish`](Sink::finish) was called.
    #[must_use]
    pub fn is_finished(&self) -> bool {
        self.finished
    }

    /// Whether the save was given up: [`discard`](Sink::discard) was called.
    #[must_use]
    pub fn is_discarded(&self) -> bool {
        self.discarded
    }
}

impl Sink for MemorySink {
    fn written(&self) -> u64 {
        u64::try_from(self.bytes.len()).unwrap_or(u64::MAX)
    }

    async fn write(&mut self, data: &[u8]) -> io::Result<()> {
        self.bytes.extend_from_slice(data);
        Ok(())
    }

    async fn finish(&mut self) -> io::Result<()> {
        self.finished = true;
        Ok(())
    }

    async fn discard(&mut self) {
        self.bytes.clear();
        self.discarded = true;
    }
}
