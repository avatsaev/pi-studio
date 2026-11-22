//! What the engine refuses before it does anything: a bad id or path, an id in use.

use super::support::{GatedSource, ProbeSink, engine, eventually, pattern, upload};
use crate::testing::StandInDaemon;
use crate::upload::MemorySource;

async fn refused_with(id: &str, path: &str) -> &'static str {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, seen) = engine(&daemon);
    let failure = engine.upload(id, path, MemorySource::new(pattern(1))).await.unwrap_err();
    // Nothing happened: no connection, no event, no count.
    assert_eq!(daemon.accepted_connections(), 0);
    assert!(seen.all().is_empty());
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.totals.failed, snapshot.queued, snapshot.active.len()), (0, 0, 0));
    failure.code
}

#[tokio::test]
async fn an_id_is_one_to_64_letters_digits_and_hyphens() {
    for id in ["", &"a".repeat(65), "a b", "a_b", "a/b", "é", "a.b", "a\n", "../x"] {
        assert_eq!(refused_with(id, "/srv/x").await, "invalid_request", "{id:?}");
    }
}

#[tokio::test]
async fn ids_of_the_allowed_shapes_are_accepted() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    for id in ["a", "Z", "0", "-", "a-B-9", &"x".repeat(64), "9b2f6c0e-7d41-4a3f-8e55-0c1d2e3f4a5b"] {
        assert_eq!(engine.upload(id, "/srv/ok", MemorySource::new(pattern(3))).await, Ok(3), "{id}");
    }
}

#[tokio::test]
async fn a_path_is_one_to_4096_bytes() {
    assert_eq!(refused_with("a", "").await, "invalid_request");
    assert_eq!(refused_with("a", &"p".repeat(4097)).await, "invalid_request");
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    assert_eq!(engine.upload("a", &"p".repeat(4096), MemorySource::new(pattern(3))).await, Ok(3));
}

#[tokio::test]
async fn an_id_that_is_running_or_queued_is_a_duplicate_and_one_that_settled_is_free() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    let mut gates = Vec::new();
    let mut calls = Vec::new();
    for id in ["a", "b", "c", "d"] {
        let (source, gate) = GatedSource::new(pattern(10));
        gates.push(gate);
        calls.push(upload(&engine, id, &format!("/srv/{id}"), source));
    }
    eventually("three run, one waits", || engine.snapshot().active.len() == 3 && engine.snapshot().queued == 1).await;

    // `a` is running and `d` is queued.
    for id in ["a", "d"] {
        let failure = engine.upload(id, "/srv/dup", MemorySource::new(pattern(1))).await.unwrap_err();
        assert_eq!(failure.code, "duplicate_id", "{id}");
    }
    let (sink, probe) = ProbeSink::new();
    let failure = engine.save("a", "/f/x", sink).await.unwrap_err();
    assert_eq!(failure.code, "duplicate_id");
    // A save that was refused is discarded: nobody else will.
    assert!(probe.discarded());
    // The refusals changed nothing.
    let snapshot = engine.snapshot();
    assert_eq!((snapshot.active.len(), snapshot.queued, snapshot.totals.failed), (3, 1, 0));

    gates[0].add_permits(10);
    assert_eq!(calls.remove(0).await.unwrap(), Ok(10));
    // Its id is free: the same id starts again, and waits its turn behind the three that run.
    let again = upload(&engine, "a", "/srv/a-again", MemorySource::new(pattern(4)));
    eventually("it waits", || engine.snapshot().queued == 1).await;
    for gate in &gates {
        gate.add_permits(10);
    }
    for call in calls {
        assert_eq!(call.await.unwrap(), Ok(10));
    }
    assert_eq!(again.await.unwrap(), Ok(4));
}

#[tokio::test]
async fn a_save_with_a_bad_id_is_discarded() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, _) = engine(&daemon);
    let (sink, probe) = ProbeSink::new();
    assert_eq!(engine.save("bad id", "/f/x", sink).await.unwrap_err().code, "invalid_request");
    assert!(probe.discarded());
    assert_eq!(daemon.accepted_connections(), 0);
}
