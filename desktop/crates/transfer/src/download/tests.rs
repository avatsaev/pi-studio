//! Tests of the save.
//!
//! `standin` runs it against the stand-in daemon over a real socket: the sizes, a resume, a slow
//! sink, and every outcome. The others drive a scripted daemon over an in-memory pipe on a paused
//! clock, so that the order of the daemon's answers, a stalled daemon and the bytes held are exact:
//! `cancel` (the cancel racing the answer, in both orders), `hostile` (what a lying daemon sends),
//! `backpressure` (the hold).

mod backpressure;
mod cancel;
mod hostile;
mod standin;
mod support;
