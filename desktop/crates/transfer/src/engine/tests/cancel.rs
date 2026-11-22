//! Cancel of a queued transfer, of an active one, of one that waits for the connection, and of all.

use std::time::Duration;

use super::support::{Frozen, GatedSource, HeldConnector, ProbeSink, engine, engine_with, eventually, pattern, real_pause, save, upload};
use crate::Limits;
use crate::connection::Close;
use crate::engine::{ConnectionState, TransferState};
use crate::testing::{Config, StandInDaemon};
use crate::upload::MemorySource;

fn cancelled() -> crate::engine::Failure {
    crate::engine::Failure::cancelled()
}

#[tokio::test]
async fn a_queued_transfer_cancels_at_once_and_the_others_go_on() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, seen) = engine(&daemon);
    let mut gates = Vec::new();
    let mut calls = Vec::new();
    for id in ["a", "b", "c", "d"] {
        let (source, gate) = GatedSource::new(pattern(100));
        gates.push(gate);
        calls.push(upload(&engine, id, &format!("/srv/{id}"), source));
    }
    eventually("the fourth is queued", || engine.snapshot().queued == 1 && engine.snapshot().active.len() == 3).await;

    assert!(engine.cancel("d"));
    assert_eq!(calls.pop().unwrap().await.unwrap(), Err(cancelled()));
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.queued, snapshot.active.len()), (0, 3));
    assert_eq!((snapshot.totals.done, snapshot.totals.failed, snapshot.totals.cancelled), (0, 0, 1));
    assert_eq!(snapshot.last_error, None, "a cancel is not an error");
    // Its last event was the one that said it was queued: nothing is told when it settles.
    assert_eq!(seen.states("d"), [TransferState::Queued]);
    // It is gone: the same id is free, and a second cancel finds nothing.
    assert!(!engine.cancel("d"));

    for gate in &gates {
        gate.add_permits(100);
    }
    for call in calls {
        assert_eq!(call.await.unwrap(), Ok(100));
    }
    assert_eq!(daemon.file("/srv/d"), None);
    let totals = engine.snapshot().totals;
    assert_eq!((totals.done, totals.failed, totals.cancelled), (3, 0, 1));
}

#[tokio::test]
async fn an_active_upload_cancels_tells_the_daemon_and_gives_its_place_to_the_next() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    let (stuck, _gate) = GatedSource::new(pattern(100));
    let first = upload(&engine, "a", "/srv/a", stuck);
    let mut others = Vec::new();
    for id in ["b", "c"] {
        let (source, gate) = GatedSource::new(pattern(10));
        gate.add_permits(10);
        others.push(upload(&engine, id, &format!("/srv/{id}"), source));
    }
    let queued = upload(&engine, "d", "/srv/d", MemorySource::new(pattern(7)));
    eventually("b and c are done and the fourth runs", || engine.snapshot().totals.done >= 2).await;

    assert!(engine.cancel("a"));
    assert_eq!(first.await.unwrap(), Err(cancelled()));
    assert_eq!(queued.await.unwrap(), Ok(7));
    for other in others {
        assert_eq!(other.await.unwrap(), Ok(10));
    }
    // The daemon was told: it kept nothing and its record says the client aborted.
    eventually("the daemon saw the abort", || daemon.uploads().iter().any(|record| record.path == "/srv/a")).await;
    let record = daemon.uploads().into_iter().find(|record| record.path == "/srv/a").unwrap();
    assert_eq!(record.error.as_deref(), Some("client_aborted"));
    assert_eq!(daemon.file("/srv/a"), None);
    let totals = engine.snapshot().totals;
    assert_eq!((totals.done, totals.failed, totals.cancelled), (3, 0, 1));
}

#[tokio::test]
async fn an_active_save_cancels_and_is_discarded() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start_with(Config { chunk_bytes: 100, chunk_delay: Duration::from_secs(1), ..Config::default() }).await.unwrap();
    daemon.put_file("/f/a", pattern(1000));
    let (engine, _) = engine(&daemon);
    let (sink, probe) = ProbeSink::new();
    let call = save(&engine, "a", "/f/a", sink);
    clock.settle().await;
    assert_eq!(engine.snapshot().active[0].done, 100);

    assert!(engine.cancel("a"));
    clock.settle().await;
    assert_eq!(call.await.unwrap(), Err(cancelled()));
    assert!(probe.discarded());
    assert!(!probe.finished());
    let snapshot = engine.snapshot();
    assert!(snapshot.active.is_empty());
    assert_eq!(snapshot.totals.cancelled, 1);
}

#[tokio::test]
async fn a_queued_save_that_is_cancelled_is_discarded_without_ever_running() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f/a", pattern(10));
    let (engine, _) = engine(&daemon);
    let mut gates = Vec::new();
    for id in ["a", "b", "c"] {
        let (source, gate) = GatedSource::new(pattern(10));
        gates.push(gate);
        upload(&engine, id, &format!("/srv/{id}"), source);
    }
    let (sink, probe) = ProbeSink::new();
    let queued = save(&engine, "s", "/f/a", sink);
    eventually("it is queued", || engine.snapshot().queued == 1).await;

    assert!(engine.cancel("s"));
    assert_eq!(queued.await.unwrap(), Err(cancelled()));
    assert!(probe.discarded());
    assert_eq!(probe.written.load(std::sync::atomic::Ordering::SeqCst), 0);
    for gate in &gates {
        gate.add_permits(10);
    }
}

#[tokio::test]
async fn transfers_that_wait_for_the_connection_cancel_and_the_dial_is_given_up() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f/a", pattern(10));
    let connector = HeldConnector::new(&daemon);
    let gate = std::sync::Arc::clone(&connector.gate);
    let (engine, seen) = engine_with(connector, Limits::default());
    let (sink, probe) = ProbeSink::new();
    let saving = save(&engine, "s", "/f/a", sink);
    let uploading = upload(&engine, "u", "/srv/u", MemorySource::new(pattern(10)));
    eventually("both wait", || {
        let snapshot = engine.snapshot();
        snapshot.connection.state == ConnectionState::Connecting
            && snapshot.active.iter().all(|transfer| transfer.state == TransferState::Waiting)
            && snapshot.active.len() == 2
    })
    .await;
    assert_eq!(seen.states("s"), [TransferState::Waiting]);

    assert!(engine.cancel("s"));
    assert_eq!(saving.await.unwrap(), Err(cancelled()));
    assert!(probe.discarded());
    // One transfer still waits: the dial goes on.
    assert_eq!(engine.snapshot().connection.state, ConnectionState::Connecting);
    assert!(engine.cancel("u"));
    assert_eq!(uploading.await.unwrap(), Err(cancelled()));

    // Nothing needs a connection now: the dial was given up, and a late permit opens nothing.
    assert_eq!(engine.snapshot().connection.state, ConnectionState::Closed);
    gate.add_permits(1);
    real_pause(50).await;
    assert_eq!(daemon.accepted_connections(), 0);
    let totals = engine.snapshot().totals;
    assert_eq!((totals.done, totals.failed, totals.cancelled), (0, 0, 2));
}

#[tokio::test]
async fn cancel_all_settles_every_transfer_as_cancelled_and_closes_the_connection() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f/a", pattern(10));
    let (engine, _) = engine(&daemon);
    let mut calls = Vec::new();
    let mut gates = Vec::new();
    for id in ["a", "b", "c", "d"] {
        let (source, gate) = GatedSource::new(pattern(100));
        gates.push(gate);
        calls.push(upload(&engine, id, &format!("/srv/{id}"), source));
    }
    let (sink, probe) = ProbeSink::new();
    calls.push(save(&engine, "s", "/f/a", sink));
    eventually("three run, two wait", || engine.snapshot().active.len() == 3 && engine.snapshot().queued == 2).await;

    engine.cancel_all_and_close(Close::GoingAway).await;

    for call in calls {
        assert_eq!(call.await.unwrap(), Err(cancelled()));
    }
    assert!(probe.discarded());
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.totals.done, snapshot.totals.failed, snapshot.totals.cancelled), (0, 0, 5));
    assert_eq!((snapshot.queued, snapshot.active.len(), snapshot.connection.state), (0, 0, ConnectionState::Closed));
    assert_eq!(daemon.client_closes(), [Some(1001)]);
    eventually("the daemon's side is closed", || daemon.open_connections() == 0).await;
    // The three that ran told the daemon; nothing was kept.
    eventually("three aborts", || daemon.uploads().len() == 3).await;
    assert!(daemon.uploads().iter().all(|record| record.error.as_deref() == Some("client_aborted")));

    // The engine is still usable: a new transfer opens a new connection.
    assert_eq!(engine.upload("e", "/srv/e", MemorySource::new(pattern(5))).await, Ok(5));
    assert_eq!(engine.snapshot().connection.opens, 2);
}

#[tokio::test]
async fn cancel_all_while_the_connection_is_being_dialled_gives_the_dial_up() {
    let daemon = StandInDaemon::start().await.unwrap();
    let connector = HeldConnector::new(&daemon);
    let gate = std::sync::Arc::clone(&connector.gate);
    let (engine, _) = engine_with(connector, Limits::default());
    let first = upload(&engine, "a", "/srv/a", MemorySource::new(pattern(10)));
    let second = upload(&engine, "b", "/srv/b", MemorySource::new(pattern(10)));
    eventually("they wait", || engine.snapshot().connection.state == ConnectionState::Connecting).await;

    engine.cancel_all_and_close(Close::Normal).await;
    assert_eq!(first.await.unwrap(), Err(cancelled()));
    assert_eq!(second.await.unwrap(), Err(cancelled()));
    gate.add_permits(1);
    real_pause(50).await;
    assert_eq!(daemon.accepted_connections(), 0);
    assert_eq!(engine.snapshot().connection.state, ConnectionState::Closed);
}

#[tokio::test]
async fn cancel_all_with_nothing_to_do_is_quiet() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    engine.cancel_all_and_close(Close::Normal).await;
    assert_eq!(engine.snapshot().totals.cancelled, 0);
    assert_eq!(daemon.accepted_connections(), 0);
    assert!(!engine.cancel("nothing"));
}
