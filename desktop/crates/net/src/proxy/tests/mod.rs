//! The proxy against local servers and clients: the daemon is a WebSocket server, the page is a
//! WebSocket client, and nothing needs Tauri.

mod closing;
mod flow;
mod gate;
mod set;
mod support;
