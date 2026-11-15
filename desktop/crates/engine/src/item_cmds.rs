use pistudiodesktop_doc::ItemId;
use serde_json::{Value, json};

use crate::commands::{CommandSpec, has_doc};
use crate::{EngineError, Result, Session, params};

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec { id: "item.add", label: "Add Item", menu: &[], shortcut: None, params: r#"{"text": string}"#, enabled: has_doc, run: add },
        CommandSpec {
            id: "item.setDone",
            label: "Check Item",
            menu: &[],
            shortcut: None,
            params: r#"{"id": u64, "done": bool = toggle}"#,
            enabled: has_doc,
            run: set_done,
        },
        CommandSpec {
            id: "item.setText",
            label: "Rename Item",
            menu: &[],
            shortcut: None,
            params: r#"{"id": u64, "text": string}"#,
            enabled: has_doc,
            run: set_text,
        },
        CommandSpec { id: "item.delete", label: "Delete Item", menu: &[], shortcut: None, params: r#"{"id": u64}"#, enabled: has_doc, run: delete },
        CommandSpec {
            id: "item.clearDone",
            label: "Clear Completed",
            menu: &["Item"],
            shortcut: Some("Cmd+Shift+K"),
            params: "{}",
            enabled: any_done,
            run: clear_done,
        },
    ]
}

fn any_done(s: &Session) -> std::result::Result<(), String> {
    let d = s.active().ok_or("no document open")?;
    if d.doc.items.iter().any(|i| i.done) { Ok(()) } else { Err("no completed items".into()) }
}

fn id_param(p: &Value) -> Result<ItemId> {
    params::req_u64(p, "id").map(ItemId)
}

fn no_item(id: ItemId) -> EngineError {
    EngineError::BadParams(format!("no item with id {}", id.0))
}

fn text_param(p: &Value) -> Result<String> {
    let text = params::req_str(p, "text")?.trim();
    if text.is_empty() { Err(EngineError::BadParams("`text` is empty".into())) } else { Ok(text.to_string()) }
}

fn add(s: &mut Session, p: &Value) -> Result<Value> {
    let text = text_param(p)?;
    let id = s.edit("Add Item", |doc| Ok(doc.add_item(text)?))?;
    Ok(json!({"id": id.0}))
}

fn set_done(s: &mut Session, p: &Value) -> Result<Value> {
    let id = id_param(p)?;
    let want = params::bool_param(p, "done")?;
    let done = s.edit("Check Item", |doc| {
        let item = doc.item_mut(id).ok_or_else(|| no_item(id))?;
        item.done = want.unwrap_or(!item.done);
        Ok(item.done)
    })?;
    Ok(json!({"id": id.0, "done": done}))
}

fn set_text(s: &mut Session, p: &Value) -> Result<Value> {
    let (id, text) = (id_param(p)?, text_param(p)?);
    s.edit("Rename Item", |doc| if doc.set_text(id, text)? { Ok(()) } else { Err(no_item(id)) })?;
    Ok(Value::Null)
}

fn delete(s: &mut Session, p: &Value) -> Result<Value> {
    let id = id_param(p)?;
    s.edit("Delete Item", |doc| doc.remove_item(id).map(|_| ()).ok_or_else(|| no_item(id)))?;
    Ok(Value::Null)
}

fn clear_done(s: &mut Session, _: &Value) -> Result<Value> {
    let removed = s.edit("Clear Completed", |doc| {
        let before = doc.items.len();
        doc.items.retain(|i| !i.done);
        Ok(before - doc.items.len())
    })?;
    Ok(json!({"removed": removed}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> Session {
        let mut s = Session::new();
        s.execute("file.new", json!({})).unwrap();
        s
    }

    fn texts(s: &Session) -> Vec<String> {
        s.snapshot().unwrap().items.iter().map(|i| format!("{}{}", if i.done { "x " } else { "" }, i.text)).collect()
    }

    #[test]
    fn add_check_rename_delete_each_undo_as_one_step() {
        let mut s = session();
        let id = s.execute("item.add", json!({"text": "  milk  "})).unwrap()["id"].clone();
        s.execute("item.add", json!({"text": "eggs"})).unwrap();
        assert_eq!(s.execute("item.setDone", json!({"id": id})).unwrap()["done"], true);
        s.execute("item.setText", json!({"id": id, "text": "oat milk"})).unwrap();
        assert_eq!(texts(&s), ["x oat milk", "eggs"]);
        s.execute("item.delete", json!({"id": id})).unwrap();
        assert_eq!(texts(&s), ["eggs"]);
        for expected in [vec!["x oat milk", "eggs"], vec!["x milk", "eggs"], vec!["milk", "eggs"], vec!["milk"], vec![]] {
            s.execute("edit.undo", json!({})).unwrap();
            assert_eq!(texts(&s), expected);
        }
        assert!(matches!(s.execute("edit.undo", json!({})), Err(EngineError::Disabled { .. })));
        s.execute("edit.redo", json!({})).unwrap();
        assert_eq!(texts(&s), ["milk"]);
    }

    #[test]
    fn bad_params_are_errors_and_record_no_history() {
        let mut s = session();
        for (id, p) in [
            ("item.add", json!({})),
            ("item.add", json!({"text": "   "})),
            ("item.add", json!({"text": 5})),
            ("item.setDone", json!({"id": 99})),
            ("item.setDone", json!({"id": -1})),
            ("item.setText", json!({"id": 1})),
            ("item.delete", json!({"id": "1"})),
        ] {
            assert!(matches!(s.execute(id, p.clone()), Err(EngineError::BadParams(_))), "{id} {p}");
        }
        assert_eq!(s.active().unwrap().history.past_len(), 0);
    }

    #[test]
    fn clear_completed_is_disabled_until_something_is_done() {
        let mut s = session();
        let id = s.execute("item.add", json!({"text": "a"})).unwrap()["id"].clone();
        assert!(matches!(s.execute("item.clearDone", json!({})), Err(EngineError::Disabled { .. })));
        s.execute("item.setDone", json!({"id": id, "done": true})).unwrap();
        assert_eq!(s.execute("item.clearDone", json!({})).unwrap()["removed"], 1);
    }
}
