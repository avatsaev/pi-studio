//! The stand-in daemon against a client written with this crate's `wire` module and dialled through
//! `net`, the way the engine will connect: the handshake, uploads, downloads, each scripted fault,
//! and every frame the stand-in sends against the published fixtures.

mod client;
mod downloads;
mod faults;
mod handshake;
mod pinned;
mod stream_faults;
mod uploads;

use std::time::{Duration, Instant};

/// Waits until `condition` holds, for up to five seconds.
async fn eventually(what: &str, condition: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !condition() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}
