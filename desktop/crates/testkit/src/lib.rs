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
        json!({"id": -1, "text": 7, "done": "yes", "path": 3, "title": [], "filter": {}}),
        json!({"id": u64::MAX, "text": "", "done": null, "path": "", "title": ""}),
        json!({"id": 1e300, "text": long, "path": "/definitely/not/a/dir/\u{0}/file", "title": long}),
        json!({"id": "1", "text": "\u{202e}\u{0}\n", "path": "..", "filter": "\\"}),
        json!({"id": [1], "text": {"a": 1}, "done": 1, "unknown": true}),
    ]
}
