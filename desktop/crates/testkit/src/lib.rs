//! Test helpers shared by the workspace. Other crates use this as a dev-dependency only
//! (`cargo xtask layers` checks that), and it depends on no workspace crate, so there is no
//! dependency cycle.
#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

use serde_json::{Value, json};

/// Params no command asked for: wrong types, extremes, empties and oversized values. Every
/// command must answer each of them with `Ok` or `Err`, never a panic or a hang.
pub fn adversarial_params() -> Vec<Value> {
    let long = "x".repeat(1 << 20);
    vec![
        json!({}),
        json!({"key": -1, "value": "yes", "filter": {}}),
        json!({"key": "autoStartLocalDaemon", "value": 7, "filter": []}),
        json!({"key": "checkForUpdates", "value": long, "filter": long}),
        json!({"key": "", "value": null, "filter": "\\"}),
        json!({"key": [1], "value": {"a": 1}, "unknown": true}),
        json!({"key": "\u{202e}\u{0}\n", "value": 1e300}),
    ]
}
