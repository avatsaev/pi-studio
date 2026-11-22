//! Where a save's bytes go.

use std::io;

/// What a save writes the daemon's bytes into. The app implements it over a save's temporary file; a
/// test over memory ([`MemorySink`](super::MemorySink)).
///
/// The sink starts as it is: empty for a first attempt, or holding the bytes an earlier attempt wrote
/// for a resume. [`written`](Self::written) says how many, and the save asks the daemon for the file
/// from that offset on.
///
/// What a save does with the sink when it ends:
///
/// * it completed: [`finish`](Self::finish);
/// * it failed for good (cancelled, refused, changed, a broken protocol, an error of the sink's own):
///   [`discard`](Self::discard);
/// * the connection was lost ([`SaveError::ConnectionLost`](super::SaveError::ConnectionLost)):
///   neither, so that a later save can resume into it.
///
/// A `write` may be dropped before it completes (a cancel arrives while the disk is slow). The
/// sink is not written to again then: only [`discard`](Self::discard) follows.
pub trait Sink: Send {
    /// The bytes in the sink so far, those of earlier attempts included. It is read at the start of a
    /// save, to choose the offset of the request, and after each write, for the progress; it is
    /// what a resume continues from.
    fn written(&self) -> u64;

    /// Appends `data`, which is never empty. The save does not read the socket faster than this
    /// completes: at most the download hold (1 MiB) of what the daemon sent is held while it runs.
    ///
    /// # Errors
    /// The system's error. Its text is shown to the user (`disk`), so it must not carry a local path.
    fn write(&mut self, data: &[u8]) -> impl Future<Output = io::Result<()>> + Send;

    /// The file is complete: flush it and put it where it belongs. Called once, after the last
    /// byte was written, and not interrupted by a cancel.
    ///
    /// # Errors
    /// The system's error, as for [`write`](Self::write).
    fn finish(&mut self) -> impl Future<Output = io::Result<()>> + Send;

    /// The save will not complete and will not resume: remove what was written. Best effort, so it
    /// has no error to give.
    fn discard(&mut self) -> impl Future<Output = ()> + Send;
}
