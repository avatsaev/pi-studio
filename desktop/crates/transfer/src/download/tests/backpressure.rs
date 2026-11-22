//! A slow sink slows the daemon: the bytes the connection holds that are not yet written never
//! exceed the download hold and one frame, whatever the size of the file.
//!
//! The daemon is scripted over a pipe of 64 KiB on a paused clock, so that what it managed to push
//! into the pipe while the sink was stuck is the bytes the client had taken off it plus the pipe
//! and the client's read buffer: a few frames beyond the hold, not the file.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use tokio::sync::Semaphore;

use super::support::{Range, TestSink, accepted, all_streams_free, begin, chunk, end, request_id, scripted_with, spin, start, stream_of};
use crate::Limits;

/// What a chunk charges against the hold besides its bytes: its two header bytes and 64 for the frame itself.
const OVERHEAD: usize = 2 + 64;

/// The pipe between the scripted daemon and the client.
const PIPE: usize = 64 * 1024;

/// What the client may have taken off the pipe and not parsed: the WebSocket's read buffer, at most 128 KiB.
const READ_BUFFER: usize = 128 * 1024;

fn payload(index: usize, frame: usize) -> Vec<u8> {
    vec![u8::try_from(index % 251).unwrap_or(0); frame]
}

/// Runs a download of `frames` chunks of `frame` bytes into a sink that is stuck, and returns how many
/// chunks the daemon had pushed into the pipe by then. Then the sink is let go: every byte must arrive, in order.
async fn stuck_then_released(hold: usize, frame: usize, frames: usize) -> usize {
    let limits = Limits { download_hold_bytes: hold, ..Limits::default() };
    let (connection, mut daemon) = scripted_with(limits, PIPE).await;
    let gate = Arc::new(Semaphore::new(0));
    let writes = Arc::new(AtomicUsize::new(0));
    let sink = TestSink {
        gate: Some(Arc::clone(&gate)),
        on_write: Some(Box::new({
            let writes = Arc::clone(&writes);
            move |_| {
                writes.fetch_add(1, Ordering::SeqCst);
            }
        })),
        ..TestSink::new()
    };
    let saving = start(&connection, sink, None);
    let request = daemon.request().await;
    let stream = stream_of(&request);
    let range = Range::whole(stream, (frame * frames) as u64);
    daemon.send_json(&accepted(&request_id(&request), range));
    daemon.send_binary(begin(range));
    for index in 0..frames {
        daemon.send_binary(chunk(stream, &payload(index, frame)));
    }
    daemon.send_binary(end(stream));

    // The sink takes nothing for a long while: the daemon is stopped by the pipe, not by the end of the file.
    tokio::time::sleep(Duration::from_secs(5)).await;
    assert_eq!(writes.load(Ordering::SeqCst), 1, "the first write is waiting for the disk");
    let pushed = daemon.delivered().saturating_sub(2);

    // The disk catches up: every frame is written, in order, intact.
    gate.add_permits(frames + 1);
    spin().await;
    let (result, sink) = saving.task.await.unwrap();
    let saved = result.unwrap();
    assert_eq!(saved.bytes, (frame * frames) as u64);
    assert_eq!(sink.writes, frames);
    assert!(sink.inner.is_finished());
    assert!(sink.bytes().chunks(frame).enumerate().all(|(index, bytes)| bytes == payload(index, frame)), "the bytes are the daemon's, in its order");
    assert!(all_streams_free(&connection));
    pushed
}

/// How many frames of `frame` bytes fit in `hold` (as the connection charges them), and how many more
/// may be on their way: the one the reader holds, the pipe, and the read buffer.
fn allowed(hold: usize, frame: usize) -> usize {
    let held = hold / (frame + OVERHEAD);
    held + 1 + PIPE / frame + READ_BUFFER / frame + 1
}

#[tokio::test(start_paused = true)]
async fn a_stuck_sink_holds_the_daemon_back_at_the_1_mib_hold_and_one_frame() {
    const FRAME: usize = 32 * 1024;
    let hold = 1024 * 1024;
    let pushed = stuck_then_released(hold, FRAME, 400).await;

    // 400 frames are 12.5 MiB; with the sink stuck the daemon got about 1 MiB and a few frames across.
    assert!(pushed >= hold / (FRAME + OVERHEAD), "the connection read its hold: {pushed} frames");
    assert!(pushed <= allowed(hold, FRAME), "{pushed} of 400 frames were taken from a daemon whose sink was stuck (at most {})", allowed(hold, FRAME));
}

#[tokio::test(start_paused = true)]
async fn the_bound_follows_the_hold_not_the_file() {
    const FRAME: usize = 16 * 1024;
    let hold = 64 * 1024;
    let pushed = stuck_then_released(hold, FRAME, 400).await;

    assert!(pushed >= hold / (FRAME + OVERHEAD));
    assert!(pushed <= allowed(hold, FRAME), "{pushed} of 400 frames were taken from a daemon whose sink was stuck (at most {})", allowed(hold, FRAME));
}
