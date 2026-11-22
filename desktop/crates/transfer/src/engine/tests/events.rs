//! The events: one at every change of state, at most ten a second while bytes move, none at settlement.

use std::time::Duration;

use super::support::{Frozen, GatedSource, engine, eventually, pattern, real_pause, upload};
use crate::engine::TransferState::{Queued, Running, Waiting};
use crate::testing::StandInDaemon;
use crate::upload::MemorySource;

#[tokio::test]
async fn a_transfer_tells_each_change_of_state_and_nothing_when_it_settles() {
    // The clock is frozen, so no progress event is due: only the changes of state are told.
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, seen) = engine(&daemon);

    let result = engine.upload("a", "/srv/a", MemorySource::new(pattern(100_000))).await;
    assert_eq!(result, Ok(100_000));
    let told = seen.all();
    assert_eq!(seen.of("a"), [(Waiting, 0), (Running, 0)]);
    assert_eq!(told[0].total, Some(100_000));

    // Nothing comes after the answer, however long the engine goes on.
    clock.advance(Duration::from_secs(60)).await;
    clock.settle().await;
    assert_eq!(seen.all(), told);
}

#[tokio::test]
async fn a_queued_transfer_tells_queued_then_running() {
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, seen) = engine(&daemon);
    let mut gates = Vec::new();
    let mut calls = Vec::new();
    for id in ["a", "b", "c", "d"] {
        let (source, gate) = GatedSource::new(pattern(10));
        gates.push(gate);
        calls.push(upload(&engine, id, &format!("/srv/{id}"), source));
    }
    eventually("three run", || engine.snapshot().active.len() == 3 && seen.states("c").len() == 2).await;
    assert_eq!(seen.states("a"), [Waiting, Running]);
    assert_eq!(seen.states("d"), [Queued]);
    gates[0].add_permits(10);
    eventually("d runs", || seen.states("d") == [Queued, Running]).await;
    for gate in &gates {
        gate.add_permits(10);
    }
    for call in calls {
        assert!(call.await.unwrap().is_ok());
    }
    // The state changes of `d`, and no event after its answer.
    assert_eq!(seen.states("d"), [Queued, Running]);
}

#[tokio::test]
async fn a_transfer_tells_at_most_ten_progress_events_a_second() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    let (engine, seen) = engine(&daemon);
    // 40 chunks, read one for each permit: 30 of them in 30 steps of 52 ms, 1.56 s of the clock.
    let chunk = 32 * 1024;
    let (source, gate) = GatedSource::new(pattern(40 * chunk));
    let call = upload(&engine, "a", "/srv/a", source);
    clock.settle().await;
    let begun = tokio::time::Instant::now();
    for _ in 0..30 {
        gate.add_permits(1);
        real_pause(10).await;
        clock.advance(Duration::from_millis(50)).await;
    }
    let elapsed = tokio::time::Instant::now().saturating_duration_since(begun);

    let progress: Vec<u64> = seen.of("a").into_iter().filter(|(state, done)| *state == Running && *done > 0).map(|(_, done)| done).collect();
    let allowed = usize::try_from(elapsed.as_millis() / 100).unwrap() + 1;
    assert!(progress.len() <= allowed, "{} events in {elapsed:?}", progress.len());
    assert!(progress.len() >= allowed - 3, "{} events in {elapsed:?}: progress is told", progress.len());
    assert!(progress.windows(2).all(|pair| pair[0] < pair[1]), "{progress:?}");
    assert!(progress.iter().all(|done| done % u64::try_from(chunk).unwrap() == 0));

    gate.add_permits(100);
    assert_eq!(call.await.unwrap(), Ok(u64::try_from(40 * chunk).unwrap()));
}

#[tokio::test]
async fn a_saves_first_events_do_not_know_the_size_before_the_daemon_answers() {
    let clock = Frozen::start();
    let daemon = StandInDaemon::start().await.unwrap();
    daemon.put_file("/f/a", pattern(1000));
    let (engine, seen) = engine(&daemon);
    let (sink, _probe) = super::support::ProbeSink::new();
    assert_eq!(engine.save("a", "/f/a", sink).await, Ok(1000));
    let told = seen.all();
    // Waiting and running before the answer: the size is not known yet.
    assert_eq!((told[0].state, told[0].total), (Waiting, None));
    assert_eq!((told[1].state, told[1].total), (Running, None));
    clock.advance(Duration::from_secs(1)).await;
    assert_eq!(seen.all(), told);
}
