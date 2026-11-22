//! Tests of the bulk connection.
//!
//! Most run over an in-memory pipe to a scripted daemon (`support`) on a paused clock, so that time
//! moves exactly and no test waits for real seconds. `standin` runs the connection against the
//! stand-in daemon over a real socket.

mod backpressure;
mod closing;
mod ending;
mod handshake;
mod hostile;
mod liveness;
mod requests;
mod routing;
mod standin;
mod support;
