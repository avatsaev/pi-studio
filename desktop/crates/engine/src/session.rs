use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;
use std::sync::Arc;

use pistudiodesktop_doc::Document;
use pistudiodesktop_ops::History;
use serde_json::{Map, Value};

use crate::{EngineError, Result, commands, params};

/// An open document: the current snapshot, how it got there, and where it lives on disk.
pub struct DocState {
    /// Immutable. An edit publishes a new `Arc`; readers keep the one they hold.
    pub doc: Arc<Document>,
    pub history: History,
    /// Grows with every change, undo and redo included. Caches key on it.
    pub revision: u64,
    pub path: Option<PathBuf>,
    saved_revision: u64,
}

impl DocState {
    /// Changed since it was opened or last saved.
    pub fn dirty(&self) -> bool {
        self.saved_revision != self.revision
    }
}

/// One user's working state. The template holds one document; a multi-document app keeps a
/// `Vec<DocState>` and an active index here, and commands keep calling [`Session::active`].
#[derive(Default)]
pub struct Session {
    doc: Option<DocState>,
}

impl Session {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn active(&self) -> Option<&DocState> {
        self.doc.as_ref()
    }

    /// The current document, cheap to take and safe to keep: later edits don't change it.
    pub fn snapshot(&self) -> Option<Arc<Document>> {
        self.doc.as_ref().map(|d| Arc::clone(&d.doc))
    }

    /// Run a command by id. Never panics: unknown ids, wrong params and commands that cannot
    /// run now are errors, and a panic inside a command is caught and reported as one.
    pub fn execute(&mut self, id: &str, params: Value) -> Result<Value> {
        let spec = commands::find(id).ok_or_else(|| EngineError::UnknownCommand(id.to_string()))?;
        let params = match params {
            Value::Null => Value::Object(Map::new()),
            Value::Object(_) => params,
            other => return Err(EngineError::BadParams(format!("`{id}` takes a JSON object, got {}", params::kind(&other)))),
        };
        (spec.enabled)(self).map_err(|reason| EngineError::Disabled { id: id.to_string(), reason })?;
        // Last-resort guard, not a licence to panic: `edit` commits only when its closure
        // returns `Ok`, so a command that unwinds leaves the document as it was.
        catch_unwind(AssertUnwindSafe(|| (spec.run)(self, &params))).unwrap_or_else(|_| {
            log::error!("command `{id}` panicked");
            Err(EngineError::Other(format!("`{id}` failed with an internal error (logged); the document is unchanged")))
        })
    }

    /// Apply an undoable edit: `f` changes a private copy, and only an `Ok` publishes it as the
    /// new snapshot with one history step named `label`.
    pub fn edit<R>(&mut self, label: &str, f: impl FnOnce(&mut Document) -> Result<R>) -> Result<R> {
        let state = self.doc.as_mut().ok_or_else(|| EngineError::Other("no document open".into()))?;
        let before = Arc::clone(&state.doc);
        let mut working = Document::clone(&before);
        let out = f(&mut working)?;
        state.doc = Arc::new(working);
        state.history.record(label, before);
        state.revision = state.revision.wrapping_add(1);
        Ok(out)
    }

    /// The label of the step undone, or `None` at the start of history.
    pub fn undo(&mut self) -> Option<String> {
        let state = self.doc.as_mut()?;
        let (label, doc) = state.history.undo(Arc::clone(&state.doc))?;
        state.doc = doc;
        state.revision = state.revision.wrapping_add(1);
        Some(label)
    }

    pub fn redo(&mut self) -> Option<String> {
        let state = self.doc.as_mut()?;
        let (label, doc) = state.history.redo(Arc::clone(&state.doc))?;
        state.doc = doc;
        state.revision = state.revision.wrapping_add(1);
        Some(label)
    }

    /// Replace the open document (the template does not ask about unsaved changes).
    pub fn open_document(&mut self, doc: Document, path: Option<PathBuf>) {
        self.doc = Some(DocState { doc: Arc::new(doc), history: History::default(), revision: 0, path, saved_revision: 0 });
    }

    /// Open a document from the bytes of a file. Shells without a file system (the browser)
    /// call this with bytes they obtained themselves.
    pub fn open_bytes(&mut self, bytes: &[u8], path: Option<PathBuf>) -> Result<()> {
        let doc = pistudiodesktop_format::decode(bytes)?;
        self.open_document(doc, path);
        Ok(())
    }

    pub fn close_document(&mut self) {
        self.doc = None;
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub(crate) fn mark_saved(&mut self, path: PathBuf) {
        if let Some(state) = self.doc.as_mut() {
            state.path = Some(path);
            state.saved_revision = state.revision;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn session() -> Session {
        let mut s = Session::new();
        s.execute("file.new", json!({"title": "Test"})).unwrap();
        s
    }

    #[test]
    fn a_failed_edit_changes_nothing() {
        let mut s = session();
        let before = s.snapshot().unwrap();
        let r: Result<()> = s.edit("Broken", |doc| {
            doc.title = "half done".into();
            Err(EngineError::Other("no".into()))
        });
        assert!(r.is_err());
        assert!(Arc::ptr_eq(&before, &s.snapshot().unwrap()));
        assert_eq!(s.active().unwrap().history.past_len(), 0);
    }

    #[test]
    fn a_panic_in_a_command_is_an_error_and_the_document_survives() {
        let mut s = session();
        let before = s.snapshot().unwrap();
        let e = s.execute("test.panic", json!({})).unwrap_err();
        assert!(e.to_string().contains("internal error"), "{e}");
        assert!(Arc::ptr_eq(&before, &s.snapshot().unwrap()));
        assert!(s.execute("item.add", json!({"text": "still works"})).is_ok());
    }

    #[test]
    fn params_must_be_an_object_and_ids_must_exist() {
        let mut s = session();
        assert!(matches!(s.execute("item.add", json!([1, 2])), Err(EngineError::BadParams(m)) if m.contains("an array")));
        assert_eq!(s.execute("item.ad", json!({})), Err(EngineError::UnknownCommand("item.ad".into())));
        assert!(matches!(Session::new().execute("item.add", json!({"text": "x"})), Err(EngineError::Disabled { .. })));
    }

    #[test]
    fn snapshots_held_by_readers_do_not_change() {
        let mut s = session();
        let held = s.snapshot().unwrap();
        s.execute("item.add", json!({"text": "later"})).unwrap();
        assert!(held.items.is_empty());
        assert_eq!(s.snapshot().unwrap().items.len(), 1);
    }
}
