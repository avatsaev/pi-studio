//! The engine: a [`Session`] that owns the open document, and the command registry.
//!
//! Every user-visible action is a command with a stable id. The window, the CLI, the control
//! channel and tests all call [`Session::execute`] with an id and JSON params, so anything a
//! person can do an agent or a script can do too, and nothing here knows about a UI toolkit.
#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

pub mod commands;
mod edit_cmds;
mod error;
mod file_cmds;
mod item_cmds;
pub mod params;
mod query_cmds;
mod session;

pub use commands::{CommandSpec, command_specs, find};
pub use error::{EngineError, Result};
pub use session::{DocState, Session};
