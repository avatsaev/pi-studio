use serde_json::{Value, json};

use crate::commands::CommandSpec;
use crate::{EngineError, Result, Session};

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec { id: "edit.undo", label: "Undo", menu: &["Edit"], shortcut: Some("Cmd+Z"), params: "{}", enabled: can_undo, run: undo },
        CommandSpec { id: "edit.redo", label: "Redo", menu: &["Edit"], shortcut: Some("Cmd+Shift+Z"), params: "{}", enabled: can_redo, run: redo },
    ]
}

fn can_undo(s: &Session) -> std::result::Result<(), String> {
    let d = s.active().ok_or("no document open")?;
    d.history.undo_label().map(|_| ()).ok_or_else(|| "nothing to undo".to_string())
}

fn can_redo(s: &Session) -> std::result::Result<(), String> {
    let d = s.active().ok_or("no document open")?;
    d.history.redo_label().map(|_| ()).ok_or_else(|| "nothing to redo".to_string())
}

fn undo(s: &mut Session, _: &Value) -> Result<Value> {
    let label = s.undo().ok_or_else(|| EngineError::Other("nothing to undo".into()))?;
    Ok(json!({"undone": label}))
}

fn redo(s: &mut Session, _: &Value) -> Result<Value> {
    let label = s.redo().ok_or_else(|| EngineError::Other("nothing to redo".into()))?;
    Ok(json!({"redone": label}))
}
