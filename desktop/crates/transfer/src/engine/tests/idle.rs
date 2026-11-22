//! The connection's life: opened by the first transfer, closed 30 s after the last, on a clock the test moves.

use std::time::Duration;

use super::support::{Frozen, GatedSource, engine, pattern, upload};
use crate::engine::ConnectionState;
use crate::testing::StandInDaemon;
use crate::upload::MemorySource;

const SECOND: Duration = Duration::from_secs(1);

#[tokio::test]
async fn an_engine_with_no_transfer_never_dials() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    clock.run_for(Duration::from_secs(120)).await;
    clock.settle().await;
    assert_eq!(daemon.accepted_connections(), 0);
    assert_eq!(engine.snapshot().connection.state, ConnectionState::Closed);
}

#[tokio::test]
async fn the_connection_closes_30_seconds_after_the_last_transfer() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);

    assert_eq!(engine.upload("a", "/srv/a", MemorySource::new(pattern(1000))).await, Ok(1000));
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.connection.state, snapshot.connection.opens), (ConnectionState::Open, 1));
    assert!(snapshot.active.is_empty());

    // 29.992 s after the last transfer: still open.
    clock.run_for(Duration::from_millis(29_990)).await;
    clock.settle().await;
    assert_eq!(engine.snapshot().connection.state, ConnectionState::Open);
    assert_eq!(daemon.open_connections(), 1);
    assert!(daemon.client_closes().is_empty());

    // 30.014 s: closed, with 1000.
    clock.run_for(Duration::from_millis(20)).await;
    clock.settle().await;
    assert_eq!(engine.snapshot().connection.state, ConnectionState::Closed);
    assert_eq!(daemon.open_connections(), 0);
    assert_eq!(daemon.client_closes(), [Some(1000)]);
    assert_eq!(engine.snapshot().connection.opens, 1);
}

#[tokio::test]
async fn a_transfer_started_at_29_seconds_keeps_the_connection_open() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);

    assert_eq!(engine.upload("a", "/srv/a", MemorySource::new(pattern(10))).await, Ok(10));
    clock.run_for(29 * SECOND).await;
    assert_eq!(engine.upload("b", "/srv/b", MemorySource::new(pattern(20))).await, Ok(20));
    // The second transfer used the connection that was open.
    assert_eq!((engine.snapshot().connection.opens, daemon.accepted_connections()), (1, 1));

    // The first transfer's 30 s are over (at 31 s): the connection is not closed, the timer began again.
    clock.run_for(2 * SECOND).await;
    clock.settle().await;
    assert_eq!(engine.snapshot().connection.state, ConnectionState::Open);
    assert_eq!(daemon.open_connections(), 1);

    // 30 s after the second transfer it is.
    clock.run_for(Duration::from_millis(28_100)).await;
    clock.settle().await;
    assert_eq!(engine.snapshot().connection.state, ConnectionState::Closed);
    assert_eq!(daemon.open_connections(), 0);
    assert_eq!(daemon.client_closes(), [Some(1000)]);
    assert_eq!(daemon.accepted_connections(), 1);
}

#[tokio::test]
async fn a_transfer_after_the_connection_closed_opens_another() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);

    assert_eq!(engine.upload("a", "/srv/a", MemorySource::new(pattern(10))).await, Ok(10));
    clock.run_for(31 * SECOND).await;
    clock.settle().await;
    assert_eq!(daemon.open_connections(), 0);

    assert_eq!(engine.upload("b", "/srv/b", MemorySource::new(pattern(10))).await, Ok(10));
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.connection.state, snapshot.connection.opens), (ConnectionState::Open, 2));
    assert_eq!(daemon.accepted_connections(), 2);
    assert_eq!(daemon.hellos().len(), 2);
}

#[tokio::test]
async fn the_connection_is_not_idle_while_a_transfer_runs() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    let (source, gate) = GatedSource::new(pattern(100));
    let call = upload(&engine, "slow", "/srv/slow", source);
    clock.settle().await;

    // A transfer that runs for 100 s keeps the connection; the daemon answers its pings, in steps small
    // enough for each pong to come back before the next ping is due.
    for _ in 0..20 {
        clock.advance(5 * SECOND).await;
    }
    assert_eq!(engine.snapshot().connection.state, ConnectionState::Open);
    assert_eq!(daemon.open_connections(), 1);
    assert_eq!(engine.snapshot().active.len(), 1);

    gate.add_permits(100);
    assert_eq!(call.await.unwrap(), Ok(100));
    // The 30 s count from here, not from the start.
    clock.run_for(Duration::from_millis(29_990)).await;
    clock.settle().await;
    assert_eq!(daemon.open_connections(), 1);
    clock.run_for(Duration::from_millis(20)).await;
    clock.settle().await;
    assert_eq!(daemon.open_connections(), 0);
}
