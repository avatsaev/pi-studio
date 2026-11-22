//! The transfer engine: uploads and saves over a connection of its own to the daemon.
//!
//! The engine speaks the daemon's protocol and schedules transfers, with no window and no Tauri,
//! so that it can be tested without either. Local files are reached through traits the app
//! implements. It opens its socket through [`pistudiodesktop_net::dial`] and through nothing else.
//!
//! * [`limits`]: every time, size and count the engine works within, named, and a [`Limits`] that a
//!   test can shorten.
//! * [`error`]: the one error type.
//!
//! Every input here is hostile (what the daemon sends, what the page asks): sizes are capped
//! before they are used, and nothing panics.
//!
//! Native only: on wasm32 this crate is empty and has no dependency.
#![cfg(not(target_arch = "wasm32"))]

pub mod error;
pub mod limits;

pub use error::Error;
pub use limits::Limits;
