//! The control protocol: what automation can ask of a running app. Transport-free: the desktop
//! app feeds it from a loopback socket, tests and the `view` example call [`handle`] directly.
//!
//! - `engine.execute {command, params?}`: run any command by id
//! - `engine.commands`: the registry, with what is enabled now
//! - `ui.inspect`: the UI state, the settings, the daemon registry (no secret) and the menu bar: exactly what the frontend draws
//! - `ui.set {}`: change UI state; it has no field yet, so any field is an error

use std::sync::mpsc::{Receiver, Sender, channel};

use serde_json::{Value, json};

use crate::daemons::{self, LocalOp};
use crate::{AppShell, menus};

pub const METHODS: &[&str] = &["engine.commands", "engine.execute", "ui.inspect", "ui.set"];

/// What can be asked of the shell.
#[derive(Clone, Debug, PartialEq)]
pub enum Request {
    /// A control-protocol call. The only kind automation can send.
    Control { method: String, params: Value },
    /// The page's first call: the boot snapshot, see [`crate::page::boot`].
    Boot,
    /// One workbench key from the page, see [`crate::page::storage_set`].
    StorageSet { key: String, value: String },
    /// Write every unwritten stored key now: the app asks it when it quits.
    Flush,
    /// An engine command from the page, if it is on [`crate::daemons::PAGE_COMMANDS`].
    Engine { id: String, params: Value },
    /// A short operation of the local-daemon supervisor; never from automation.
    Local(LocalOp),
}

/// One request on its way to the thread that owns the shell, with the channel its reply goes
/// back on.
pub struct Envelope {
    pub request: Request,
    pub reply: Sender<Value>,
}

impl Envelope {
    pub fn new(request: Request) -> (Self, Receiver<Value>) {
        let (reply, rx) = channel();
        (Self { request, reply }, rx)
    }
}

/// `{"ok": true, "result": …}` or `{"ok": false, "error": "…"}`.
pub fn reply(result: Result<Value, String>) -> Value {
    match result {
        Ok(result) => json!({"ok": true, "result": result}),
        Err(error) => json!({"ok": false, "error": error}),
    }
}

/// Answer one control-protocol call.
pub fn handle(app: &mut AppShell, method: &str, params: &Value) -> Value {
    reply(match method {
        "engine.execute" => execute(app, params),
        "engine.commands" => app.run("command.list", Value::Null),
        "ui.inspect" => Ok(view(app)),
        "ui.set" => set(app, params),
        other => Err(format!("unknown method `{other}`; methods: {}", METHODS.join(", "))),
    })
}

fn execute(app: &mut AppShell, params: &Value) -> Result<Value, String> {
    let id = params.get("command").and_then(Value::as_str).ok_or("missing `command`")?;
    app.run(id, params.get("params").cloned().unwrap_or(Value::Null))
}

/// Everything the frontend draws, and everything `ui.inspect` returns: what a person sees is
/// what an agent reads.
pub fn view(app: &mut AppShell) -> Value {
    json!({
        "ui": app.ui,
        "settings": app.session.execute("settings.get", Value::Null).ok(),
        "daemons": daemons::view(app),
        "menus": menus::model(app),
    })
}

/// `ui.set` takes an object with no field yet: `{}` succeeds, any field is an error and nothing
/// changes.
fn set(_: &mut AppShell, params: &Value) -> Result<Value, String> {
    let fields = params.as_object().ok_or("`ui.set` takes a JSON object")?;
    match fields.keys().next() {
        Some(other) => Err(format!("unknown field `{other}`")),
        None => Ok(Value::Null),
    }
}
