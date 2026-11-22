//! What the daemon and this crate say to each other, as bytes and text, and nothing else.
//!
//! No socket, no clock and no state live here: every function takes a frame and returns a value,
//! so the whole module is tested against the published fixtures
//! (`packages/protocol/fixtures/external-clients/`) and against hostile input.
//!
//! * [`outbound`]: the text frames the engine sends (`hello`, the three requests, `ping`, `pong`).
//! * [`inbound`]: the text frames the daemon sends, read no further than the engine needs.
//! * [`binary`]: the file-transfer frames (`Begin`, `Chunk`, `End`, `Error`), both ways.
//!
//! Every number read from the daemon is a whole number from 0 to 2^53 − 1, the range the daemon's
//! JSON can hold exactly, and is kept as a `u64`: a file of 5 GiB is not a special case. Nothing is
//! reserved from a length the daemon gave. A broken frame is an [`Error::Protocol`], never a panic,
//! and the message never repeats what the daemon sent.
//!
//! [`Error::Protocol`]: crate::Error::Protocol

pub mod binary;
pub mod inbound;
pub mod outbound;

mod fields;

#[cfg(test)]
mod tests;
