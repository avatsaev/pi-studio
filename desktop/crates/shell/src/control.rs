//! The control protocol: what a frontend or automation can ask of a running app. Transport-free:
//! the desktop app feeds it from the webview and from a loopback socket, tests and the `view`
//! example call [`handle`] directly.
//!
//! - `engine.execute {command, params?}`: run any command by id
//! - `engine.commands`: the registry, with what is enabled now
//! - `ui.inspect`: the UI state, the document and the menu bar: exactly what the frontend draws
//! - `ui.set {theme?, hideDone?}`: change UI state; an unknown field is an error and nothing
//!   changes

use std::sync::mpsc::{Receiver, Sender, channel};

use serde_json::{Value, json};

use crate::state::ThemeKind;
use crate::{AppShell, menus};

pub const METHODS: &[&str] = &["engine.commands", "engine.execute", "ui.inspect", "ui.set"];

/// What can be asked of the shell.
#[derive(Clone, Debug, PartialEq)]
pub enum Request {
    /// A control-protocol call. The only kind automation can send.
    Control { method: String, params: Value },
    /// A menu click or a shortcut in the frontend: see [`menus::invoke`]. It may open a native
    /// dialog, so it is not part of the control protocol.
    Invoke { command: String },
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
    let shell: Vec<Value> = menus::UI_COMMANDS.iter().map(|c| json!({"id": c.id, "label": c.label, "checked": (c.checked)(app)})).collect();
    json!({
        "ui": app.ui,
        "document": app.session.execute("document.inspect", Value::Null).ok(),
        "menus": menus::model(app),
        "shellCommands": shell,
    })
}

/// Validate every field, then apply them all: a bad request changes nothing.
fn set(app: &mut AppShell, params: &Value) -> Result<Value, String> {
    let fields = params.as_object().ok_or("`ui.set` takes a JSON object")?;
    let mut next = app.ui.clone();
    for (key, value) in fields {
        match key.as_str() {
            "theme" => next.theme = value.as_str().and_then(ThemeKind::from_name).ok_or("`theme` is `dark` or `light`")?,
            "hideDone" => next.hide_done = value.as_bool().ok_or("`hideDone` must be a boolean")?,
            other => return Err(format!("unknown field `{other}`")),
        }
    }
    app.ui = next;
    Ok(Value::Null)
}
