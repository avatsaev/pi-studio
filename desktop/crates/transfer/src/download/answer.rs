//! What the daemon's answer to a download request, and the `Begin` after it, are allowed to say.
//!
//! The daemon's numbers are a claim. The save writes what arrives, so it checks the claim against what
//! it asked for before it relies on one of them: the stream is the one named, the range starts where
//! the sink ends, the range runs to the end of the file (there is no `length` in the request, so
//! the daemon sends everything from the offset), and a resume got the file it guarded.

use super::Version;
use super::error::SaveError;
use super::settle::{Asked, Stop};
use crate::error::Error;
use crate::wire::binary::BeginMeta;
use crate::wire::inbound::{DownloadAccepted, DownloadResponse, Reply};

/// What the request asked for.
#[derive(Debug, Clone, Copy)]
pub(super) struct Asking {
    /// The stream the daemon was asked to send on.
    pub stream: u8,
    /// The first byte asked for: the sink's bytes.
    pub offset: u64,
    /// The file as the first answer described it, on a resume.
    pub guard: Option<Version>,
}

/// Reads the answer to the download request. `Ok` is an accepted download that says what was asked.
///
/// The `asked` of an error says what the daemon may still do on the stream: nothing after a refusal
/// or a lost connection, send frames after an answer that is not right.
pub(super) fn read(reply: Result<Reply, Error>, asking: &Asking, known: Option<Version>) -> Result<DownloadAccepted, Stop> {
    let reply = reply.map_err(|error| failed(error, known))?;
    match reply.download_response() {
        Ok(DownloadResponse::Accepted(accepted)) => check(&accepted, asking).map(|()| accepted),
        Ok(DownloadResponse::Refused(refused)) => Err(Stop::new(SaveError::refused(&refused.error), Asked::Settled)),
        // An answer of the wrong shape: the daemon may or may not have started.
        Err(error) => Err(Stop::new(SaveError::Protocol(error), Asked::Unknown)),
    }
}

/// What a request that got no usable answer means: a lost connection, or a protocol error that ended
/// it, leaves nothing to settle; a timeout, or an `rpc_error`, does not say whether the daemon
/// reserved the stream.
fn failed(error: Error, known: Option<Version>) -> Stop {
    let asked = match error {
        Error::Timeout | Error::Rpc { .. } => Asked::Unknown,
        Error::Closed(_) | Error::Protocol(_) | Error::Internal(_) | Error::Dial(_) | Error::UnsupportedDaemon { .. } => Asked::Settled,
    };
    Stop::new(SaveError::from_connection(error, known), asked)
}

fn check(accepted: &DownloadAccepted, asking: &Asking) -> Result<(), Stop> {
    let wrong = |what: &str| Stop::new(SaveError::protocol(what), Asked::Accepted);
    if accepted.stream != asking.stream {
        return Err(wrong("the answer names another stream"));
    }
    if accepted.offset != asking.offset {
        return Err(wrong("the answer starts at another offset"));
    }
    // The range must end where the file ends; a shorter one would be taken for the whole file.
    if accepted.offset.checked_add(accepted.length) != Some(accepted.total_bytes) {
        return Err(wrong("the answer's range does not end at the end of the file"));
    }
    if asking.guard.is_some_and(|guard| guard != Version { total_bytes: accepted.total_bytes, mtime_ms: accepted.mtime_ms }) {
        return Err(wrong("the answer describes another file than the one guarded"));
    }
    Ok(())
}

/// A `Begin` must repeat what the answer said, for every field it carries.
pub(super) fn begin(meta: &BeginMeta, accepted: &DownloadAccepted) -> Result<(), SaveError> {
    let agrees = |sent: Option<u64>, answered: u64| sent.is_none_or(|sent| sent == answered);
    let same = meta.transfer_id == accepted.transfer_id
        && agrees(meta.total_bytes, accepted.total_bytes)
        && agrees(meta.mtime_ms, accepted.mtime_ms)
        && agrees(meta.offset, accepted.offset)
        && agrees(meta.length, accepted.length);
    if same { Ok(()) } else { Err(SaveError::protocol("`Begin` says something else than the answer")) }
}
