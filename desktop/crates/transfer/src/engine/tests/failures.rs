//! A connection that cannot open or that drops fails the transfers; a refused transfer is counted.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::support::{Failing, Frozen, GatedSource, ProbeSink, engine, engine_with, eventually, pattern, save, upload};
use crate::Limits;
use crate::engine::{ConnectError, ConnectionState};
use crate::testing::{After, Config, Direction, Fault, Features, StandInDaemon};
use crate::upload::MemorySource;

#[tokio::test]
async fn a_connection_that_cannot_open_fails_every_transfer_that_waits_for_it_or_for_its_turn() {
    let (engine, seen) = engine_with(Failing(ConnectError::new("unauthorized", "The daemon refused the password.", false)), Limits::default());
    let (sink, probe) = ProbeSink::new();
    let mut calls = vec![save(&engine, "s", "/f/a", sink)];
    for id in ["a", "b", "c"] {
        calls.push(upload(&engine, id, &format!("/srv/{id}"), MemorySource::new(pattern(10))));
    }

    for call in calls {
        let failure = call.await.unwrap().unwrap_err();
        assert_eq!(failure.code, "unauthorized");
        assert_eq!(failure.message, "The daemon refused the password.");
    }
    // The save that waited was discarded.
    assert!(probe.discarded());
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.totals.done, snapshot.totals.failed, snapshot.totals.cancelled), (0, 4, 0));
    assert_eq!((snapshot.queued, snapshot.active.len()), (0, 0));
    assert_eq!((snapshot.connection.state, snapshot.connection.opens), (ConnectionState::Closed, 0));
    assert_eq!(snapshot.last_error.map(|error| error.code), Some("unauthorized"));
    // The queued one was told `queued` and nothing when it failed.
    assert_eq!(seen.states("c").last().copied(), Some(crate::engine::TransferState::Queued));
}

#[tokio::test]
async fn a_daemon_without_a_feature_fails_the_transfers_with_unsupported_daemon() {
    let features = Features { file_transfer_ack: false, ..Features::default() };
    let daemon = StandInDaemon::start_with(Config { features, ..Config::default() }).await.unwrap();
    let (engine, _) = engine(&daemon);
    let failure = engine.upload("a", "/srv/a", MemorySource::new(pattern(10))).await.unwrap_err();
    assert_eq!(failure.code, "unsupported_daemon");
    assert!(failure.message.contains("fileTransferAck"), "{}", failure.message);
    assert_eq!(engine.snapshot().connection.state, ConnectionState::Closed);
    eventually("the connection is closed", || daemon.open_connections() == 0).await;
}

#[tokio::test]
async fn a_connection_that_drops_fails_the_transfers_on_it_and_the_queued_ones_use_another() {
    let daemon = StandInDaemon::start().await.unwrap();
    // The first connection is reset after three upload frames; the second is not.
    daemon.script(Fault::Reset { after: After::Frames(Direction::FromClient, 3) });
    let (engine, _) = engine(&daemon);
    let big = pattern(32 * 1024 * 20);
    let mut calls = Vec::new();
    for id in ["a", "b", "c"] {
        calls.push(upload(&engine, id, &format!("/srv/{id}"), MemorySource::new(big.clone())));
    }
    let queued = upload(&engine, "d", "/srv/d", MemorySource::new(big.clone()));

    for call in calls {
        assert_eq!(call.await.unwrap().unwrap_err().code, "connection_lost");
    }
    assert_eq!(queued.await.unwrap(), Ok(u64::try_from(big.len()).unwrap()));
    assert_eq!(daemon.file("/srv/d"), Some(big));
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.totals.done, snapshot.totals.failed), (1, 3));
    assert_eq!(snapshot.connection.opens, 2);
    assert_eq!(snapshot.last_error.map(|error| error.code), Some("connection_lost"));
    assert_eq!(daemon.accepted_connections(), 2);
}

#[tokio::test]
async fn a_save_lost_with_its_connection_is_discarded() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f/a", pattern(32 * 1024 * 8));
    daemon.script(Fault::Reset { after: After::Bytes(Direction::ToClient, 100_000) });
    let (engine, _) = engine(&daemon);
    let (sink, probe) = ProbeSink::new();
    let failure = engine.save("a", "/f/a", sink).await.unwrap_err();
    assert_eq!(failure.code, "connection_lost");
    assert!(probe.discarded());
    assert!(!probe.finished());
}

#[tokio::test]
async fn a_refusal_by_the_daemon_is_a_failure_with_its_reason() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    let (sink, probe) = ProbeSink::new();
    let failure = engine.save("a", "/f/missing", sink).await.unwrap_err();
    assert_eq!(failure.code, "daemon_refused");
    assert!(failure.message.contains("not_found"), "{}", failure.message);
    assert!(probe.discarded());
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.totals.done, snapshot.totals.failed, snapshot.totals.cancelled), (0, 1, 0));
    assert_eq!(snapshot.last_error.map(|error| error.code), Some("daemon_refused"));
    // The connection is fine: the next transfer uses it.
    assert_eq!(engine.upload("b", "/srv/b", MemorySource::new(pattern(5))).await, Ok(5));
    assert_eq!(daemon.accepted_connections(), 1);
}

#[tokio::test]
async fn the_last_error_carries_the_time_of_the_engines_clock() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    let before = u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis()).unwrap();
    let (engine, _) = engine(&daemon);
    clock.advance(Duration::from_secs(10)).await;
    let (sink, _probe) = ProbeSink::new();
    assert!(engine.save("a", "/f/missing", sink).await.is_err());
    let at = engine.snapshot().last_error.unwrap().at_ms;
    // Ten seconds of the paused clock passed since the engine was made, and a little of the wall clock.
    assert!(at >= before + 10_000, "{at} < {before} + 10000");
    assert!(at < before + 10_000 + 2_000, "{at}");
}

#[tokio::test]
async fn a_source_that_panics_fails_its_transfer_and_nothing_else() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    let (stuck, _gate) = GatedSource::new(pattern(10));
    let other = upload(&engine, "other", "/srv/other", stuck);
    let failure = engine.upload("p", "/srv/p", super::support::PanickingSource).await.unwrap_err();
    assert_eq!(failure.code, "internal");
    assert!(!failure.message.contains("nobody planned"), "the panic's own words stay out of the message");
    assert_eq!(engine.snapshot().totals.failed, 1);
    assert_eq!(engine.upload("q", "/srv/q", MemorySource::new(pattern(5))).await, Ok(5));
    assert!(engine.cancel("other"));
    assert_eq!(other.await.unwrap().unwrap_err().code, "cancelled");
}
