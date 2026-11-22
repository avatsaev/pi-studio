//! The engine going away.

use std::sync::Arc;

use futures_util::FutureExt;

use super::support::{GatedSource, engine, eventually, pattern};
use crate::testing::StandInDaemon;
use crate::upload::MemorySource;

#[tokio::test]
async fn dropping_the_engine_stops_its_transfers_and_hangs_up() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    let engine = Arc::into_inner(engine).expect("the test holds the only handle");
    let (source, _gate) = GatedSource::new(pattern(10));
    // The call is started and then dropped, as a command that is aborted: the transfer stays with the engine.
    assert!(engine.upload("a", "/srv/a", source).now_or_never().is_none());
    eventually("it runs", || engine.snapshot().active.len() == 1 && daemon.open_connections() == 1).await;

    drop(engine);
    eventually("the daemon sees the connection end", || daemon.open_connections() == 0).await;
}

#[tokio::test]
async fn an_idle_engine_that_is_dropped_hangs_up_the_open_connection() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    assert_eq!(engine.upload("a", "/srv/a", MemorySource::new(pattern(10))).await, Ok(10));
    assert_eq!(daemon.open_connections(), 1);
    drop(engine);
    eventually("the daemon sees the connection end", || daemon.open_connections() == 0).await;
}
