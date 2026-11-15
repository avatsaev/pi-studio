use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

use pistudiodesktop_engine::Session;
use serde_json::{Value, json};

use crate::{AppShell, Envelope, PickKind, Request, Services, ThemeKind, control, menus};

fn app() -> AppShell {
    let mut app = AppShell::new(Session::new(), Services::default());
    app.run("file.new", json!({"title": "Today"})).unwrap();
    app
}

fn texts(app: &AppShell) -> Vec<String> {
    app.session.snapshot().unwrap().items.iter().map(|i| format!("{}{}", if i.done { "x " } else { "" }, i.text)).collect()
}

fn menu_item(app: &mut AppShell, id: &str) -> Value {
    let view = control::view(app);
    let found = view["menus"].as_array().unwrap().iter().flat_map(|m| m["items"].as_array().unwrap().clone()).find(|i| i["id"] == id);
    found.unwrap_or_else(|| panic!("no menu item {id}"))
}

/// A picker that answers with `answer` and records what it was asked.
fn with_picker(answer: Option<PathBuf>) -> (AppShell, Rc<RefCell<Vec<PickKind>>>) {
    let asked = Rc::new(RefCell::new(Vec::new()));
    let log = Rc::clone(&asked);
    let services = Services {
        pick_file: Some(Box::new(move |kind| {
            log.borrow_mut().push(kind);
            answer.clone()
        })),
    };
    let mut app = AppShell::new(Session::new(), services);
    app.run("file.new", json!({"title": "Today"})).unwrap();
    (app, asked)
}

#[test]
fn the_view_is_the_ui_state_the_document_and_the_generated_menu_bar() {
    let mut app = app();
    app.run("item.add", json!({"text": "milk"})).unwrap();
    let view = control::view(&mut app);
    assert_eq!(view["ui"], json!({"theme": "dark", "hideDone": false, "status": ""}));
    assert_eq!(view["document"]["items"][0]["text"], "milk");
    let labels: Vec<&str> = view["menus"].as_array().unwrap().iter().map(|m| m["label"].as_str().unwrap()).collect();
    assert_eq!(labels, menus::MENU_ORDER);

    let undo = menu_item(&mut app, "edit.undo");
    assert_eq!(undo["enabled"], true);
    assert_eq!(undo["shortcut"]["key"], "z");
    assert_eq!(undo["shortcut"]["cmd"], true);
    let redo = menu_item(&mut app, "edit.redo");
    assert_eq!((redo["enabled"].clone(), redo["reason"].clone()), (json!(false), json!("nothing to redo")), "a disabled item says why");
    assert_eq!(menu_item(&mut app, "view.theme.dark")["checked"], true);
    assert_eq!(menu_item(&mut app, "view.hideDone")["checked"], false);
}

#[test]
fn a_menu_click_runs_the_command_as_one_undoable_step() {
    let mut app = app();
    app.run("item.add", json!({"text": "milk"})).unwrap();
    app.run("item.setDone", json!({"id": 1})).unwrap();
    assert_eq!(menus::invoke(&mut app, "item.clearDone"), Ok(json!({"removed": 1})));
    assert!(texts(&app).is_empty());
    assert_eq!(app.session.active().unwrap().history.undo_label(), Some("Clear Completed"));
    menus::invoke(&mut app, "edit.undo").unwrap();
    assert_eq!(texts(&app), ["x milk"]);
    menus::invoke(&mut app, "view.hideDone").unwrap();
    assert!(app.ui.hide_done, "shell commands are invoked the same way");
}

#[test]
fn a_failed_command_reaches_the_status_bar_and_a_success_clears_it() {
    let mut app = app();
    assert!(app.run("item.add", json!({"text": "   "})).is_err());
    assert_eq!(app.ui.status, "bad params: `text` is empty");
    app.run("item.add", json!({"text": "milk"})).unwrap();
    assert_eq!(app.ui.status, "");
}

#[test]
fn commands_that_need_a_file_ask_the_service_and_a_cancel_changes_nothing() {
    let dir = std::env::temp_dir().join(format!("pistudiodesktop-shell-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("list.pistudiodesktop");

    let (mut app, asked) = with_picker(Some(file.clone()));
    app.run("item.add", json!({"text": "milk"})).unwrap();
    menus::invoke(&mut app, "file.save").unwrap();
    assert_eq!(*asked.borrow(), [PickKind::Save], "Save on a document without a file asks where, like Save As");
    assert!(!app.session.active().unwrap().dirty());
    menus::invoke(&mut app, "file.save").unwrap();
    assert_eq!(asked.borrow().len(), 1, "the second Save knows the file");
    menus::invoke(&mut app, "file.open").unwrap();
    assert_eq!(asked.borrow().last(), Some(&PickKind::Open));
    assert_eq!(texts(&app), ["milk"]);

    let (mut app, asked) = with_picker(None);
    let before = app.session.snapshot().unwrap();
    assert_eq!(menus::invoke(&mut app, "file.open"), Ok(Value::Null));
    assert_eq!(*asked.borrow(), [PickKind::Open]);
    assert!(std::sync::Arc::ptr_eq(&before, &app.session.snapshot().unwrap()));
    assert_eq!(app.ui.status, "");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn without_a_file_service_the_items_are_disabled_and_say_why() {
    let mut app = app();
    let open = menu_item(&mut app, "file.open");
    assert_eq!((open["enabled"].clone(), open["reason"].clone()), (json!(false), json!("file dialogs are not available here")));
    assert!(menus::invoke(&mut app, "file.open").is_err());
    assert_eq!(app.ui.status, "file dialogs are not available here");
    assert_eq!(menu_item(&mut app, "file.new")["enabled"], true);
}

#[test]
fn the_control_protocol_drives_and_inspects_the_app() {
    let mut app = app();
    let call = |app: &mut AppShell, method: &str, params: Value| control::handle(app, method, &params);
    let added = call(&mut app, "engine.execute", json!({"command": "item.add", "params": {"text": "eggs"}}));
    assert_eq!(added, json!({"ok": true, "result": {"id": 1}}));
    assert_eq!(call(&mut app, "ui.set", json!({"theme": "light", "hideDone": true}))["ok"], true);
    let seen = call(&mut app, "ui.inspect", Value::Null);
    assert_eq!(seen["result"]["ui"]["theme"], "light");
    assert_eq!(seen["result"]["document"]["items"][0]["text"], "eggs");
    assert_eq!(call(&mut app, "engine.execute", json!({"command": "view.theme.dark"}))["ok"], true, "shell commands run by id too");
    assert_eq!(app.ui.theme, ThemeKind::Dark);

    let before = app.ui.clone();
    let refused = call(&mut app, "ui.set", json!({"hideDone": false, "nope": 1}));
    assert_eq!(refused, json!({"ok": false, "error": "unknown field `nope`"}));
    assert_eq!(app.ui, before, "a refused ui.set changes nothing");
    assert_eq!(call(&mut app, "ui.nope", Value::Null)["ok"], false);
    assert_eq!(call(&mut app, "engine.execute", json!({"command": "item.delete", "params": {"id": 99}}))["error"], "bad params: no item with id 99");
    let listed = call(&mut app, "engine.commands", Value::Null);
    assert!(listed["result"].as_array().unwrap().iter().any(|c| c["id"] == "edit.redo" && c["enabled"] == false));
}

#[test]
fn requests_from_a_channel_are_answered_in_order() {
    let mut app = app();
    let (tx, rx) = std::sync::mpsc::channel();
    let (first, first_reply) =
        Envelope::new(Request::Control { method: "engine.execute".into(), params: json!({"command": "item.add", "params": {"text": "milk"}}) });
    let (second, second_reply) = Envelope::new(Request::Invoke { command: "edit.undo".into() });
    tx.send(first).unwrap();
    tx.send(second).unwrap();
    drop(tx);
    for envelope in rx {
        let reply = app.answer(&envelope.request);
        envelope.reply.send(reply).unwrap();
    }
    assert_eq!(first_reply.try_recv().unwrap(), json!({"ok": true, "result": {"id": 1}}));
    assert_eq!(second_reply.try_recv().unwrap(), json!({"ok": true, "result": {"undone": "Add Item"}}));
    assert!(texts(&app).is_empty());
}
