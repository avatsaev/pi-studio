//! The queue: three at once, the rest in order, the connection on demand.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::support::{Frozen, GatedSource, Handle, ProbeSink, engine, eventually, pattern, save, upload};
use crate::engine::{ConnectionState, Kind, TransferState};
use crate::testing::{Config, StandInDaemon};
use crate::upload::MemorySource;

fn ids(engine: &Handle) -> Vec<String> {
    engine.snapshot().active.into_iter().map(|transfer| transfer.id).collect()
}

#[tokio::test]
async fn four_uploads_started_together_run_three_and_the_fourth_starts_when_one_settles() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, seen) = engine(&daemon);
    let mut gates = Vec::new();
    let mut calls = Vec::new();
    for id in ["a", "b", "c", "d"] {
        let (source, gate) = GatedSource::new(pattern(100));
        gates.push(gate);
        calls.push(upload(&engine, id, &format!("/srv/{id}"), source));
    }

    eventually("three uploads run", || engine.snapshot().active.iter().filter(|transfer| transfer.state == TransferState::Running).count() == 3).await;
    let snapshot = engine.snapshot();
    assert_eq!(ids(&engine), ["a", "b", "c"]);
    assert_eq!(snapshot.queued, 1);
    assert_eq!(snapshot.connection.state, ConnectionState::Open);
    assert!(snapshot.active.iter().all(|transfer| transfer.kind == Kind::Upload));
    assert_eq!(seen.states("d"), [TransferState::Queued]);

    // One settles; the fourth takes its place, on the connection that is open.
    gates[0].add_permits(100);
    assert_eq!(calls.remove(0).await.unwrap(), Ok(100));
    eventually("the fourth runs", || ids(&engine) == ["b", "c", "d"]).await;
    assert_eq!(engine.snapshot().queued, 0);
    assert_eq!(seen.states("d"), [TransferState::Queued, TransferState::Running]);

    for gate in &gates[1..] {
        gate.add_permits(100);
    }
    for call in calls {
        assert_eq!(call.await.unwrap(), Ok(100));
    }
    for id in ["a", "b", "c", "d"] {
        assert_eq!(daemon.file(&format!("/srv/{id}")), Some(pattern(100)), "{id}");
    }
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.totals.done, snapshot.totals.failed, snapshot.totals.cancelled), (4, 0, 0));
    assert_eq!(snapshot.connection.opens, 1);
    assert_eq!(daemon.accepted_connections(), 1);
}

#[tokio::test]
async fn transfers_settle_in_an_order_consistent_with_their_sizes() {
    let clock = Frozen::start();
    // A chunk is 100 bytes and the daemon waits a second after each: a file of n chunks takes n - 1 seconds.
    let daemon = StandInDaemon::start_with(Config { chunk_bytes: 100, chunk_delay: Duration::from_secs(1), ..Config::default() }).await.unwrap();
    let sizes = [("a", 200), ("b", 400), ("c", 600), ("d", 200)];
    for (id, size) in sizes {
        daemon.put_file(&format!("/f/{id}"), pattern(size));
    }
    let (engine, seen) = engine(&daemon);
    let order = Arc::new(Mutex::new(Vec::new()));
    let mut probes = Vec::new();
    for (id, _) in sizes {
        let (sink, probe) = ProbeSink::new();
        probes.push(probe);
        let (engine, order) = (Arc::clone(&engine), Arc::clone(&order));
        tokio::spawn(async move {
            let result = engine.save(id, &format!("/f/{id}"), sink).await;
            order.lock().unwrap().push((id, result.is_ok()));
        });
    }
    clock.settle().await;

    // Three run, the fourth waits: the first three took the turns.
    let snapshot = engine.snapshot();
    assert_eq!(ids(&engine), ["a", "b", "c"]);
    assert_eq!(snapshot.queued, 1);
    assert!(snapshot.active.iter().all(|transfer| transfer.kind == Kind::Save && transfer.state == TransferState::Running));
    assert_eq!(seen.states("d"), [TransferState::Queued]);

    // At 1 s the smallest has settled and the fourth took its turn.
    clock.advance(Duration::from_secs(1)).await;
    clock.settle().await;
    assert_eq!(*order.lock().unwrap(), [("a", true)]);
    assert_eq!(ids(&engine), ["b", "c", "d"]);
    assert_eq!(engine.snapshot().queued, 0);

    for _ in 0..5 {
        clock.advance(Duration::from_secs(1)).await;
        clock.settle().await;
    }
    assert_eq!(*order.lock().unwrap(), [("a", true), ("d", true), ("b", true), ("c", true)]);
    for ((id, size), probe) in sizes.iter().zip(&probes) {
        assert_eq!(probe.bytes(), pattern(*size), "{id}");
        assert!(probe.finished(), "{id}");
    }
    assert_eq!(engine.snapshot().totals.done, 4);
}

#[tokio::test]
async fn the_queue_has_no_limit_and_runs_first_in_first_out() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    let order = Arc::new(Mutex::new(Vec::new()));
    let mut gates = Vec::new();
    for index in 0..10 {
        let (source, gate) = GatedSource::new(pattern(10));
        gates.push(gate);
        let (engine, order) = (Arc::clone(&engine), Arc::clone(&order));
        tokio::spawn(async move {
            let result = engine.upload(&format!("t-{index}"), &format!("/srv/{index}"), source).await;
            order.lock().unwrap().push(index);
            result
        });
    }
    eventually("three run", || ids(&engine).len() == 3).await;
    assert_eq!(engine.snapshot().queued, 7);
    // Let them go one at a time, always the oldest still running.
    for (index, gate) in gates.iter().enumerate() {
        gate.add_permits(10);
        eventually("it settles", || order.lock().unwrap().len() == index + 1).await;
        let expected: Vec<String> = (index + 1..(index + 4).min(10)).map(|next| format!("t-{next}")).collect();
        eventually("the oldest waiting transfers take the turns", || ids(&engine) == expected).await;
    }
    assert_eq!(*order.lock().unwrap(), (0..10).collect::<Vec<_>>());
    assert_eq!(engine.snapshot().totals.done, 10);
}

#[tokio::test]
async fn a_transfer_that_starts_with_a_free_place_never_waits_in_the_queue() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, seen) = engine(&daemon);
    assert_eq!(engine.upload("only", "/srv/only", MemorySource::new(pattern(10))).await, Ok(10));
    // It had a turn at once: it waited for the connection, then ran. `queued` was never its state.
    assert_eq!(seen.states("only"), [TransferState::Waiting, TransferState::Running]);
}

#[tokio::test]
async fn two_saves_and_two_uploads_share_the_one_connection() {
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f/one", pattern(70_000));
    daemon.put_file("/f/two", pattern(5));
    let (engine, _) = engine(&daemon);
    let (sink_one, probe_one) = ProbeSink::new();
    let (sink_two, probe_two) = ProbeSink::new();
    let calls = [
        save(&engine, "s1", "/f/one", sink_one),
        save(&engine, "s2", "/f/two", sink_two),
        upload(&engine, "u1", "/srv/u1", MemorySource::new(pattern(70_000))),
        upload(&engine, "u2", "/srv/u2", MemorySource::new(Vec::new())),
    ];
    for call in calls {
        call.await.unwrap().unwrap();
    }
    assert_eq!(probe_one.bytes(), pattern(70_000));
    assert_eq!(probe_two.bytes(), pattern(5));
    assert_eq!(daemon.file("/srv/u1"), Some(pattern(70_000)));
    assert_eq!(daemon.file("/srv/u2"), Some(Vec::new()));
    assert_eq!(daemon.accepted_connections(), 1);
}
