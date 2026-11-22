//! Tests of the upload.
//!
//! * `standin`: the whole flow against the stand-in daemon over a real socket, for every size, and
//!   a daemon that stops reading.
//! * `outcomes`: every way an upload ends, with the frame the stand-in received for it.
//! * `frames`: the exact frames and their order, and the hold when the daemon is slow, against a
//!   scripted daemon over an in-memory pipe.

mod frames;
mod outcomes;
mod standin;
mod support;
