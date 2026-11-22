//! One accepted download streaming its frames, in the real daemon's order: `Begin`, `Chunk`s, then
//! `End` (or one `Error`: `cancelled`, as the real daemon sends when a cancel stops it).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tokio::sync::{Notify, mpsc};

use super::fault::{Disorder, StreamFault};
use super::frames::{self, Meta};

/// The filler of the bytes a download sends past its range ([`StreamFault::ExtraBytes`]).
const FILLER: u8 = 0xEE;

/// What a cancel reaches: the running download.
#[derive(Default)]
pub(super) struct DownloadCtl {
    cancelled: AtomicBool,
    wake: Notify,
}

impl DownloadCtl {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.wake.notify_one();
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Waits `delay`, or less when a cancel comes.
    async fn pause(&self, delay: Duration) {
        if delay.is_zero() {
            tokio::task::yield_now().await;
        } else {
            tokio::select! {
                () = tokio::time::sleep(delay) => {}
                () = self.wake.notified() => {}
            }
        }
    }
}

/// The downloads of one connection by stream, from accepted to finished.
#[derive(Default)]
pub(super) struct Downloads(Mutex<HashMap<u8, Arc<DownloadCtl>>>);

impl Downloads {
    fn with<R>(&self, f: impl FnOnce(&mut HashMap<u8, Arc<DownloadCtl>>) -> R) -> R {
        f(&mut self.0.lock().unwrap_or_else(PoisonError::into_inner))
    }

    pub fn is_active(&self, stream: u8) -> bool {
        self.with(|map| map.contains_key(&stream))
    }

    pub fn get(&self, stream: u8) -> Option<Arc<DownloadCtl>> {
        self.with(|map| map.get(&stream).cloned())
    }

    pub fn reserve(&self, stream: u8) -> Arc<DownloadCtl> {
        let ctl = Arc::new(DownloadCtl::default());
        self.with(|map| map.insert(stream, Arc::clone(&ctl)));
        ctl
    }

    fn release(&self, stream: u8, ctl: &Arc<DownloadCtl>) {
        self.with(|map| {
            if map.get(&stream).is_some_and(|current| Arc::ptr_eq(current, ctl)) {
                map.remove(&stream);
            }
        });
    }
}

/// A download that passed its checks: every number is final.
pub(super) struct Plan {
    pub stream: u8,
    pub transfer_id: String,
    pub file_name: String,
    pub mime_type: &'static str,
    pub total_bytes: u64,
    pub mtime_ms: u64,
    pub offset: u64,
    pub length: u64,
    pub data: Arc<Vec<u8>>,
    pub fault: Option<StreamFault>,
    pub chunk_bytes: usize,
    pub chunk_delay: Duration,
}

impl Plan {
    pub fn meta(&self) -> Meta<'_> {
        Meta {
            transfer_id: &self.transfer_id,
            file_name: &self.file_name,
            mime_type: self.mime_type,
            total_bytes: self.total_bytes,
            mtime_ms: self.mtime_ms,
            offset: self.offset,
            length: self.length,
        }
    }

    /// The bytes of the range, as far as the file has them.
    fn range(&self) -> &[u8] {
        let start = usize::try_from(self.offset).unwrap_or(usize::MAX);
        let end = usize::try_from(self.offset.saturating_add(self.length)).unwrap_or(usize::MAX);
        self.data.get(start..end).unwrap_or_default()
    }

    /// The bytes `from..from + n` of the stream: the range, then filler.
    fn piece(&self, from: u64, n: u64) -> Vec<u8> {
        let range = self.range();
        let start = usize::try_from(from).unwrap_or(usize::MAX).min(range.len());
        let n = usize::try_from(n).unwrap_or(usize::MAX);
        let mut piece = range[start..range.len().min(start.saturating_add(n))].to_vec();
        piece.resize(n, FILLER);
        piece
    }
}

async fn push(frames: &mpsc::Sender<Vec<u8>>, frame: Vec<u8>) -> Option<()> {
    frames.send(frame).await.ok()
}

/// Streams the download into `frames` and releases its stream. Ends quietly when the connection is gone.
pub(super) async fn run(plan: Plan, frames: mpsc::Sender<Vec<u8>>, ctl: Arc<DownloadCtl>, downloads: Arc<Downloads>) {
    let _ = stream(&plan, &frames, &ctl).await;
    downloads.release(plan.stream, &ctl);
}

async fn stream(plan: &Plan, frames: &mpsc::Sender<Vec<u8>>, ctl: &DownloadCtl) -> Option<()> {
    let s = plan.stream;
    if let Some(StreamFault::ErrorFirst(message)) = &plan.fault {
        return push(frames, frames::error(s, message)).await;
    }
    if ctl.is_cancelled() {
        // Cancelled between the answer and the first frame: no `Begin` was promised yet.
        return push(frames, frames::error(s, "cancelled")).await;
    }
    if matches!(plan.fault, Some(StreamFault::OutOfOrder(Disorder::ChunkBeforeBegin))) {
        push(frames, frames::chunk(s, &[0])).await?;
    }
    push(frames, frames::begin(s, &plan.meta())).await?;
    match &plan.fault {
        Some(StreamFault::OutOfOrder(Disorder::EndBeforeChunks)) => push(frames, frames::end(s)).await?,
        Some(StreamFault::OutOfOrder(Disorder::ChunkOnOtherStream)) => push(frames, frames::chunk(s.wrapping_add(1), &[0])).await?,
        Some(StreamFault::Oversized(bytes)) => push(frames, frames::chunk(s, &vec![0; *bytes])).await?,
        _ => {}
    }

    let extra = if let Some(StreamFault::ExtraBytes(extra)) = &plan.fault { *extra } else { 0 };
    let total = plan.length.min(plan.range().len() as u64).saturating_add(extra);
    let limit = if let Some(StreamFault::ErrorAfter { bytes, .. }) = &plan.fault { total.min(*bytes) } else { total };
    let chunk_bytes = plan.chunk_bytes.max(1) as u64;
    let mut sent = 0;
    while sent < limit {
        if ctl.is_cancelled() {
            return push(frames, frames::error(s, "cancelled")).await;
        }
        let n = chunk_bytes.min(limit - sent);
        push(frames, frames::chunk(s, &plan.piece(sent, n))).await?;
        sent += n;
        if sent < limit {
            ctl.pause(plan.chunk_delay).await;
        }
    }

    if let Some(StreamFault::ErrorAfter { message, .. }) = &plan.fault {
        return push(frames, frames::error(s, message)).await;
    }
    push(frames, frames::end(s)).await?;
    if matches!(plan.fault, Some(StreamFault::OutOfOrder(Disorder::ChunkAfterEnd))) {
        push(frames, frames::chunk(s, &[0])).await?;
    }
    Some(())
}
