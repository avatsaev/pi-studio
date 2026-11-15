//! Print what the frontend would draw, without a window: the `ui.inspect` value after a script.
//!
//! ```sh
//! cargo run -q -p pistudiodesktop-shell --example view -- \
//!     --script '[["engine.execute", {"command": "item.add", "params": {"text": "milk"}}], ["ui.set", {"theme": "light"}]]'
//! ```
//!
//! `--script` is a JSON array of `[method, params]` control-protocol calls, applied in order to
//! a new document. Each reply goes to standard error, the view to standard output. The frontend's
//! `npm run snapshot` feeds this to the real components in a headless browser and saves a PNG.

use pistudiodesktop_engine::Session;
use pistudiodesktop_shell::{AppShell, Services, control};
use serde_json::{Value, json};

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let script: Vec<(String, Value)> =
        arg(&args, "--script").map(|s| serde_json::from_str(&s).expect("--script must be [[method, params], …]")).unwrap_or_default();
    let mut session = Session::new();
    session.execute("file.new", json!({"title": "Snapshot"})).expect("file.new");
    let mut app = AppShell::new(session, Services::default());
    for (method, params) in script {
        eprintln!("{method}: {}", control::handle(&mut app, &method, &params));
    }
    println!("{}", control::view(&mut app));
}
