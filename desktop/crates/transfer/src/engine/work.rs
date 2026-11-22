//! What one transfer does with a connection, behind one interface, so that the queue treats an upload
//! and a save alike and holds the caller's source or sink without being generic over it.

use std::pin::Pin;

use tokio::sync::watch;

use super::event::Reporter;
use super::failure::Failure;
use super::snapshot::Kind;
use crate::connection::Connection;
use crate::download::{self, Request, SaveError, Sink};
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
    /// The connection ended, or the daemon did not answer: a later attempt on another connection can
    /// succeed. The engine does not make one yet, so this is a failure for now.
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

    /// One attempt over `run.connection`, from the start.
    fn run<'a>(&'a mut self, run: Run<'a>) -> BoxFuture<'a, Ended>;

    /// The transfer will not run (again): release what it holds. An upload holds nothing; a save
    /// removes its temporary file. Called for a transfer that was cancelled or refused before it ran,
    /// or that was lost with its connection; a save that ran to a failure has discarded itself.
    fn discard(&mut self) -> BoxFuture<'_, ()>;
}

pub(super) struct UploadWork<S> {
    pub path: String,
    pub source: S,
}

impl<S: UploadSource> Work for UploadWork<S> {
    fn kind(&self) -> Kind {
        Kind::Upload
    }

    fn run<'a>(&'a mut self, run: Run<'a>) -> BoxFuture<'a, Ended> {
        Box::pin(async move {
            // The upload's read buffer: one chunk, whatever the size of the file.
            let _held = run.held.hold(run.limits.chunk_bytes.clamp(1, CHUNK_BYTES));
            let target = Target { path: &self.path, transfer_id: &run.transfer_id };
            let reporter = run.reporter;
            let outcome =
                upload::upload(run.connection, target, &mut self.source, |done| reporter.progress(done, None), run.cancel.cancelled(), run.limits).await;
            match outcome {
                Ok(uploaded) => Ended::Done(uploaded.bytes),
                Err(UploadError::Cancelled) => Ended::Cancelled,
                Err(error @ UploadError::ConnectionLost(_)) => Ended::Lost(Failure::from(error)),
                Err(error) => Ended::Failed(Failure::from(error)),
            }
        })
    }

    fn discard(&mut self) -> BoxFuture<'_, ()> {
        Box::pin(async {})
    }
}

pub(super) struct SaveWork<S> {
    pub path: String,
    pub sink: S,
}

impl<S: Sink> Work for SaveWork<S> {
    fn kind(&self) -> Kind {
        Kind::Save
    }

    fn run<'a>(&'a mut self, run: Run<'a>) -> BoxFuture<'a, Ended> {
        Box::pin(async move {
            let request = Request { path: &self.path, resume: None };
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
                Ok(saved) => Ended::Done(saved.bytes),
                Err(SaveError::Cancelled) => Ended::Cancelled,
                Err(error @ SaveError::ConnectionLost { .. }) => Ended::Lost(Failure::from(error)),
                Err(error) => Ended::Failed(Failure::from(error)),
            }
        })
    }

    fn discard(&mut self) -> BoxFuture<'_, ()> {
        Box::pin(self.sink.discard())
    }
}
