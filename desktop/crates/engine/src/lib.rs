//! The engine: a [`Session`] that owns the app's settings and stored state, and the command registry.
//!
//! Every user-visible action is a command with a stable id. The window, the CLI, the control
//! channel and tests all call [`Session::execute`] with an id and JSON params, so anything a
//! person can do an agent or a script can do too, and nothing here knows about a UI toolkit.
#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

pub mod commands;
mod daemon_cmds;
mod error;
mod local;
pub mod params;
mod query_cmds;
mod remote;
mod secret;
mod secret_job;
mod session;
mod settings_cmds;
mod storage;
#[cfg(all(test, not(target_arch = "wasm32")))]
mod test_store;

pub use commands::{CommandSpec, command_specs, find};
pub use error::{EngineError, Result};
pub use local::{BridgePassword, BridgePlan, Dial, DialPlan, LocalRequest, relay_address};
#[cfg(not(target_arch = "wasm32"))]
pub use remote::SshSecrets;
pub use remote::{RemoteAction, RemoteRequest, SshPlan};
pub use secret_job::{SecretJob, execute_unlocked};
pub use session::Session;
pub use storage::Notice;
pub use update_cmds::{UNAVAILABLE as UPDATE_UNAVAILABLE, UpdateAction, UpdateGate};
