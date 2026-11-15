//! History: undo and redo over immutable document snapshots.
//!
//! A state is an `Arc<Document>`. Recording one costs a pointer, undo swaps pointers, and
//! readers (the UI, autosave, background jobs) hold a snapshot without locking. Large payloads
//! inside the document should be `Arc`-shared too, so a new state copies only what changed.
#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

use std::collections::VecDeque;
use std::sync::Arc;

use pistudiodesktop_doc::Document;

/// One history row: the label of the step and the state to return to.
#[derive(Clone, Debug)]
pub struct Step {
    pub label: String,
    pub state: Arc<Document>,
}

#[derive(Clone, Debug)]
pub struct History {
    past: VecDeque<Step>,
    future: Vec<Step>,
    limit: usize,
}

impl Default for History {
    fn default() -> Self {
        Self::new(50)
    }
}

impl History {
    /// Keep at most `limit` undo steps (at least one); the oldest are dropped first.
    pub fn new(limit: usize) -> Self {
        Self { past: VecDeque::new(), future: Vec::new(), limit: limit.max(1) }
    }

    /// Record `before`, the state that undoing `label` returns to. Clears redo.
    pub fn record(&mut self, label: impl Into<String>, before: Arc<Document>) {
        self.future.clear();
        self.past.push_back(Step { label: label.into(), state: before });
        while self.past.len() > self.limit {
            self.past.pop_front();
        }
    }

    /// Step back from `current`: the undone step's label and the state to show.
    pub fn undo(&mut self, current: Arc<Document>) -> Option<(String, Arc<Document>)> {
        let step = self.past.pop_back()?;
        self.future.push(Step { label: step.label.clone(), state: current });
        Some((step.label, step.state))
    }

    pub fn redo(&mut self, current: Arc<Document>) -> Option<(String, Arc<Document>)> {
        let step = self.future.pop()?;
        self.past.push_back(Step { label: step.label.clone(), state: current });
        Some((step.label, step.state))
    }

    pub fn undo_label(&self) -> Option<&str> {
        self.past.back().map(|s| s.label.as_str())
    }

    pub fn redo_label(&self) -> Option<&str> {
        self.future.last().map(|s| s.label.as_str())
    }

    pub fn past_len(&self) -> usize {
        self.past.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(title: &str) -> Arc<Document> {
        Arc::new(Document::new(title))
    }

    #[test]
    fn undo_then_redo_returns_the_same_snapshots() {
        let (a, b) = (doc("a"), doc("b"));
        let mut h = History::default();
        h.record("Rename", a.clone());
        let (label, back) = h.undo(b.clone()).unwrap();
        assert_eq!(label, "Rename");
        assert!(Arc::ptr_eq(&back, &a), "undo hands back the recorded snapshot, not a copy");
        let (_, forward) = h.redo(back).unwrap();
        assert!(Arc::ptr_eq(&forward, &b));
        assert!(h.redo(forward).is_none());
    }

    #[test]
    fn a_new_step_clears_redo_and_the_limit_drops_the_oldest() {
        let mut h = History::new(2);
        h.record("one", doc("0"));
        h.undo(doc("1"));
        h.record("two", doc("0"));
        assert_eq!(h.redo_label(), None);
        h.record("three", doc("2"));
        h.record("four", doc("3"));
        assert_eq!(h.past_len(), 2);
        assert_eq!(h.undo_label(), Some("four"));
    }
}
