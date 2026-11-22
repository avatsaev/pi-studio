//! The part of a save that reads the answer and the frames of the stream and writes them to the sink.

use std::pin::Pin;

use super::answer::{self, Asking};
use super::error::SaveError;
use super::settle::{Asked, Stop};
use super::sink::Sink;
use super::{Progress, Saved, Version};
use crate::connection::{Download, Frame};
use crate::error::Error;
use crate::wire::binary::BeginMeta;
use crate::wire::inbound::{DownloadAccepted, Reply};

/// Where a download is in its frames.
struct Flow {
    accepted: DownloadAccepted,
    begun: bool,
    /// The bytes the answer announced that have not come yet.
    remaining: u64,
}

/// One save's reading and writing. It owns nothing the caller needs back: the sink is the caller's.
pub(super) struct Receive<'a, S, P> {
    sink: &'a mut S,
    progress: P,
    asking: Asking,
    /// The file as far as the save knows it, for a resume after a lost connection.
    known: Option<Version>,
}

impl<'a, S: Sink, P: FnMut(Progress)> Receive<'a, S, P> {
    pub fn new(sink: &'a mut S, progress: P, asking: Asking) -> Self {
        Self { sink, progress, asking, known: asking.guard }
    }

    /// Reads the answer, then the frames up to the one that ends the stream, and finishes the sink.
    pub async fn run<A, C>(mut self, download: &mut Download, asked: Pin<&mut A>, cancel: &mut Pin<&mut C>) -> Result<Saved, Stop>
    where
        A: Future<Output = Result<Reply, Error>>,
        C: Future<Output = ()>,
    {
        let accepted = self.answer(asked, cancel).await?;
        let version = Version { total_bytes: accepted.total_bytes, mtime_ms: accepted.mtime_ms };
        self.known = Some(version);
        (self.progress)(Progress { done: self.asking.offset, total: accepted.total_bytes });
        let mut flow = Flow { remaining: accepted.length, accepted, begun: false };
        loop {
            if let Some(bytes) = self.step(download, cancel, &mut flow).await? {
                return Ok(Saved { version, bytes });
            }
        }
    }

    async fn answer<A, C>(&mut self, mut asked: Pin<&mut A>, cancel: &mut Pin<&mut C>) -> Result<DownloadAccepted, Stop>
    where
        A: Future<Output = Result<Reply, Error>>,
        C: Future<Output = ()>,
    {
        let reply = tokio::select! {
            biased;
            () = cancel.as_mut() => return Err(Stop::new(SaveError::Cancelled, Asked::Pending)),
            reply = asked.as_mut() => reply,
        };
        answer::read(reply, &self.asking, self.known)
    }

    /// Takes the next frame and applies it. `Some` is the bytes of the save: it is complete.
    async fn step<C: Future<Output = ()>>(&mut self, download: &mut Download, cancel: &mut Pin<&mut C>, flow: &mut Flow) -> Result<Option<u64>, Stop> {
        let next = tokio::select! {
            biased;
            () = cancel.as_mut() => return Err(Stop::new(SaveError::Cancelled, Asked::Accepted)),
            next = download.next() => next,
        };
        // The frame is held until it is written: the connection reads on only as the deliveries are dropped.
        let delivery = next.map_err(|error| Stop::new(SaveError::from_connection(error, self.known), Asked::Settled))?;
        match delivery.frame() {
            Frame::Begin(meta) => begin(meta, flow).map(|()| None),
            Frame::Chunk(data) => self.chunk(data, cancel, flow).await.map(|()| None),
            Frame::End { ok } => self.end(*ok, flow).await.map(Some),
            Frame::Error { message } => Err(Stop::new(SaveError::refused(message), Asked::Settled)),
        }
    }

    async fn chunk<C: Future<Output = ()>>(&mut self, data: &[u8], cancel: &mut Pin<&mut C>, flow: &mut Flow) -> Result<(), Stop> {
        // The stream goes on after any of these: the daemon is told to stop it.
        let running = |error: SaveError| Stop::new(error, Asked::Accepted);
        if !flow.begun {
            return Err(running(SaveError::protocol("a `Chunk` came before `Begin`")));
        }
        let bytes = u64::try_from(data.len()).map_err(|_| running(SaveError::Internal("a chunk's size does not fit a counter")))?;
        flow.remaining = flow.remaining.checked_sub(bytes).ok_or_else(|| running(SaveError::protocol("the daemon sent more bytes than it announced")))?;
        if data.is_empty() {
            return Ok(());
        }
        let wrote = tokio::select! {
            biased;
            () = cancel.as_mut() => None,
            wrote = self.sink.write(data) => Some(wrote),
        };
        match wrote {
            None => Err(running(SaveError::Cancelled)),
            Some(Err(error)) => Err(running(SaveError::Disk { reason: error.to_string() })),
            Some(Ok(())) => {
                (self.progress)(Progress { done: self.sink.written(), total: flow.accepted.total_bytes });
                Ok(())
            }
        }
    }

    /// `End`: the stream is over, whatever follows. Returns the bytes of the save once the sink holds
    /// all of them and has been finished.
    async fn end(&mut self, ok: bool, flow: &Flow) -> Result<u64, Stop> {
        let over = |error: SaveError| Stop::new(error, Asked::Settled);
        if !ok {
            return Err(over(SaveError::DaemonRefused { reason: "the transfer was aborted".to_owned() }));
        }
        if !flow.begun {
            return Err(over(SaveError::protocol("`End` came before `Begin`")));
        }
        if flow.remaining != 0 {
            return Err(over(SaveError::protocol("`End` came before all the announced bytes")));
        }
        // The count is checked before the sink is finished: a finished sink has put the file in place.
        if self.sink.written() != flow.accepted.total_bytes {
            return Err(over(SaveError::Internal("the sink's byte count is not the file's size")));
        }
        self.sink.finish().await.map_err(|error| over(SaveError::Disk { reason: error.to_string() }))?;
        Ok(flow.accepted.length)
    }
}

fn begin(meta: &BeginMeta, flow: &mut Flow) -> Result<(), Stop> {
    let wrong = |error: SaveError| Stop::new(error, Asked::Accepted);
    if flow.begun {
        return Err(wrong(SaveError::protocol("a second `Begin` came")));
    }
    answer::begin(meta, &flow.accepted).map_err(wrong)?;
    flow.begun = true;
    Ok(())
}
