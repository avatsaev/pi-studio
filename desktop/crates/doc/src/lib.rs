//! The document model: pure data plus the invariants that keep it valid. No I/O, no history,
//! no UI. Everything is `serde`, so snapshots, the native format and automation can read it.
#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

use serde::{Deserialize, Serialize};

/// Longest text an item may hold, in bytes. Input is hostile: every size has a cap.
pub const MAX_TEXT_BYTES: usize = 64 * 1024;
/// Most items a document may hold.
pub const MAX_ITEMS: usize = 100_000;

/// Stable identity of an item; never reused within a document.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct ItemId(pub u64);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Item {
    pub id: ItemId,
    pub text: String,
    #[serde(default)]
    pub done: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Document {
    pub title: String,
    #[serde(default)]
    pub items: Vec<Item>,
}

/// Why a document or an edit is not valid.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Invalid {
    TextTooLong { bytes: usize },
    TooManyItems,
    DuplicateId(ItemId),
}

impl std::fmt::Display for Invalid {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Invalid::TextTooLong { bytes } => write!(f, "text is {bytes} bytes; the limit is {MAX_TEXT_BYTES}"),
            Invalid::TooManyItems => write!(f, "a document holds at most {MAX_ITEMS} items"),
            Invalid::DuplicateId(id) => write!(f, "item id {} appears more than once", id.0),
        }
    }
}

fn check_text(text: &str) -> Result<(), Invalid> {
    if text.len() > MAX_TEXT_BYTES { Err(Invalid::TextTooLong { bytes: text.len() }) } else { Ok(()) }
}

impl Document {
    pub fn new(title: impl Into<String>) -> Self {
        Self { title: title.into(), items: Vec::new() }
    }

    /// Check what a file or an automation client could get wrong.
    pub fn validate(&self) -> Result<(), Invalid> {
        check_text(&self.title)?;
        if self.items.len() > MAX_ITEMS {
            return Err(Invalid::TooManyItems);
        }
        let mut seen = std::collections::HashSet::with_capacity(self.items.len());
        for item in &self.items {
            check_text(&item.text)?;
            if !seen.insert(item.id) {
                return Err(Invalid::DuplicateId(item.id));
            }
        }
        Ok(())
    }

    pub fn add_item(&mut self, text: impl Into<String>) -> Result<ItemId, Invalid> {
        let text = text.into();
        check_text(&text)?;
        if self.items.len() >= MAX_ITEMS {
            return Err(Invalid::TooManyItems);
        }
        // Derived from the items, not stored: a file cannot hand us a counter that collides.
        let id = ItemId(self.items.iter().map(|i| i.id.0).max().map_or(1, |m| m.saturating_add(1)));
        self.items.push(Item { id, text, done: false });
        Ok(id)
    }

    pub fn item(&self, id: ItemId) -> Option<&Item> {
        self.items.iter().find(|i| i.id == id)
    }

    pub fn item_mut(&mut self, id: ItemId) -> Option<&mut Item> {
        self.items.iter_mut().find(|i| i.id == id)
    }

    pub fn set_text(&mut self, id: ItemId, text: impl Into<String>) -> Result<bool, Invalid> {
        let text = text.into();
        check_text(&text)?;
        Ok(self.item_mut(id).map(|i| i.text = text).is_some())
    }

    pub fn remove_item(&mut self, id: ItemId) -> Option<Item> {
        let index = self.items.iter().position(|i| i.id == id)?;
        Some(self.items.remove(index))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_never_collide_with_loaded_ones() {
        let mut d = Document::new("t");
        d.items.push(Item { id: ItemId(u64::MAX), text: "from a file".into(), done: false });
        let id = d.add_item("next").unwrap();
        assert_eq!(id, ItemId(u64::MAX), "saturates instead of overflowing");
        assert_eq!(d.validate(), Err(Invalid::DuplicateId(id)), "and validate reports the clash");
        let mut d = Document::new("t");
        let (a, b) = (d.add_item("a").unwrap(), d.add_item("b").unwrap());
        assert_ne!(a, b);
        d.remove_item(a);
        assert_ne!(d.add_item("c").unwrap(), b);
    }

    #[test]
    fn oversized_text_is_refused() {
        let mut d = Document::new("t");
        let long = "x".repeat(MAX_TEXT_BYTES + 1);
        assert_eq!(d.add_item(long.clone()), Err(Invalid::TextTooLong { bytes: long.len() }));
        assert!(d.items.is_empty());
    }
}
