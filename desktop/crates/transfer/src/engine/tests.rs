//! Tests of the engine, against the stand-in daemon.
//!
//! Tests of the connection's idle close, of the events' rate and of a save in flight freeze the clock
//! (`support::Frozen`) and move it by hand, so that no test waits for real seconds. The others need no
//! time and use the real clock.

mod cancel;
mod events;
mod failures;
mod idle;
mod lifecycle;
mod queue;
mod recovery;
mod snapshot;
mod support;
mod validation;
