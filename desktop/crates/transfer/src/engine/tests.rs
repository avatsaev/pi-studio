//! Tests of the engine, against the stand-in daemon.
//!
//! Tests of the connection's idle close, of the events' rate and of a save in flight freeze the clock
//! (`support::Frozen`) and move it by hand, so that no test waits for real seconds. The others need no
//! time and use the real clock.
//!
//! Hardening (`stages`, `soak`, `hostile`, `markers`, `counters`): a drop and a cancel at every stage of
//! both transfers, a seeded soak of random faults, hostile frames, what must never appear in a message,
//! and counters past 4 GiB. They share `rigs`.

mod cancel;
mod counters;
mod events;
mod failures;
mod hostile;
mod idle;
mod lifecycle;
mod markers;
mod queue;
mod recovery;
mod rigs;
mod snapshot;
mod soak;
mod stages;
mod support;
mod validation;
