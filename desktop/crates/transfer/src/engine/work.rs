//! What one transfer does with a connection, behind one interface, so that the queue treats an upload
//! and a save alike and holds the caller's source or sink without being generic over it.

use std::mem;
use std::pin::Pin;

use tokio::sync::watch;

use super::event::Reporter;
use super::failure::Failure;
use super::snapshot::Kind;
use crate::connection::Connection;
use crate::download::{self, Request, SaveError, Sink, Version};
use crate::held::Held;
use crate::limits::{CHUNK_BYTES, Limits};
use crate::upload::{self, Target, UploadError, UploadSource};

pub(super) type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// How an attempt at a transfer ended.
#[derive(Debug)]
pub(super) enum Ended {
    /// It completed: the bytes.
    Done(u64),
    /// The caller cancelled it.
    Cancelled,
    /// It failed for a reason that another attempt would meet again.
    Failed(Failure),
    /// The connection ended, or the daemon did not answer: another attempt on another connection can
    /// succeed. The work is left ready for it (a save keeps its resume point, an upload is marked to
    /// rewind), and the engine makes it when the connection is open again.
    Lost(Failure),
}

/// The cancel of one transfer, as a future an attempt hands to `upload` or `save`.
#[derive(Debug)]
pub(super) struct Cancel(watch::Receiver<bool>);

impl Cancel {
    pub fn new(signal: watch::Receiver<bool>) -> Self {
        Self(signal)
    }

    /// Completes when the transfer is cancelled, or when the engine is gone.
    pub async fn cancelled(&self) {
        let mut signal = self.0.clone();
        let _ = signal.wait_for(|cancelled| *cancelled).await;
    }
}

/// What an attempt needs from the engine.
pub(super) struct Run<'a> {
    pub connection: &'a Connection,
    pub cancel: Cancel,
    pub reporter: &'a Reporter,
    pub limits: &'a Limits,
    pub held: &'a Held,
    /// A new id for this attempt (an upload's `transferId`).
    pub transfer_id: String,
}

/// An upload or a save, with its source or sink.
pub(super) trait Work: Send {
    fn kind(&self) -> Kind;

    /// One attempt over `run.connection`: the first from the start, a later one after an
    /// [`Ended::Lost`] where the transfer left off (a save) or from byte 0 (an upload, which rewinds its
    /// source and reports no bytes done).
    fn run<'a>(&'a mut self, run: Run<'a>) -> BoxFuture<'a, Ended>;

    /// The transfer will not run (again): release what it holds. An upload holds nothing; a save
    /// removes its temporary file. Called for a transfer that was cancelled or refused before it ran,
    /// or that was lost with its connection; a save that ran to a failure has discarded itself.
    fn discard(&mut self) -> BoxFuture<'_, ()>;
}

pub(super) struct UploadWork<S> {
    path: String,
    source: S,
    /// An attempt has run: the next starts from the first byte again, so the source is rewound first.
    attempted: bool,
}

impl<S> UploadWork<S> {
    pub fn new(path: &str, source: S) -> Self {
        Self { path: path.to_owned(), source, attempted: false }
    }
}

impl<S: UploadSource> Work for UploadWork<S> {
    fn kind(&self) -> Kind {
        Kind::Upload
    }

    fn run<'a>(&'a mut self, run: Run<'a>) -> BoxFuture<'a, Ended> {
        Box::pin(async move {
            if mem::replace(&mut self.attempted, true) {
                let rewound = tokio::select! {
                    biased;
                    () = run.cancel.cancelled() => return Ended::Cancelled,
                    rewound = self.source.rewind() => rewound,
                };
                if let Err(error) = rewound {
                    return Ended::Failed(Failure::from(UploadError::SourceUnreadable { reason: error.to_string() }));
                }
            }
            // The upload's read buffer: one chunk, whatever the size of the file.
            let _held = run.held.hold(run.limits.chunk_bytes.clamp(1, CHUNK_BYTES));
            let target = Target { path: &self.path, transfer_id: &run.transfer_id };
            let reporter = run.reporter;
            let outcome =
                upload::upload(run.connection, target, &mut self.source, |done| reporter.progress(done, None), run.cancel.cancelled(), run.limits).await;
            match outcome {
                Ok(uploaded) => Ended::Done(uploaded.bytes),
                Err(UploadError::Cancelled) => Ended::Cancelled,
                Err(error @ UploadError::ConnectionLost(_)) => {
                    // The next attempt starts from byte 0: nothing is done until it sends.
                    reporter.rewind();
                    Ended::Lost(Failure::from(error))
                }
                Err(error) => Ended::Failed(Failure::from(error)),
            }
        })
    }

    fn discard(&mut self) -> BoxFuture<'_, ()> {
        Box::pin(async {})
    }
}

pub(super) struct SaveWork<S> {
    path: String,
    sink: S,
    /// The file as the daemon's first answer described it: what a resume asks the daemon to still find.
    version: Option<Version>,
}

impl<S> SaveWork<S> {
    pub fn new(path: &str, sink: S) -> Self {
        Self { path: path.to_owned(), sink, version: None }
    }
}

impl<S: Sink> Work for SaveWork<S> {
    fn kind(&self) -> Kind {
        Kind::Save
    }

    fn run<'a>(&'a mut self, run: Run<'a>) -> BoxFuture<'a, Ended> {
        Box::pin(async move {
            let request = Request { path: &self.path, resume: self.version };
            let reporter = run.reporter;
            let outcome = download::save(
                run.connection,
                request,
                &mut self.sink,
                |progress| reporter.progress(progress.done, Some(progress.total)),
                run.cancel.cancelled(),
                run.limits,
            )
            .await;
            match outcome {
                // The file's size, not the bytes of this attempt: a resumed save wrote only the rest.
                Ok(saved) => Ended::Done(saved.version.total_bytes),
                Err(SaveError::Cancelled) => Ended::Cancelled,
                Err(SaveError::ConnectionLost { reason, version }) => {
                    self.version = version.or(self.version);
                    Ended::Lost(Failure::from(SaveError::ConnectionLost { reason, version }))
                }
                Err(error) => Ended::Failed(Failure::from(error)),
            }
        })
    }

    fn discard(&mut self) -> BoxFuture<'_, ()> {
        Box::pin(self.sink.discard())
    }
}
