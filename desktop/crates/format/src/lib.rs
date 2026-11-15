//! The native file format: bytes to `Document` and back. No file system here, so the browser
//! build can use it; the engine reads and writes the files.
//!
//! The envelope carries a format name and a version. A file from a newer version is refused
//! with a message that says so, never half-read.
#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unimplemented, clippy::todo, clippy::unreachable)]

use pistudiodesktop_doc::Document;
use serde::{Deserialize, Serialize};

pub const FORMAT: &str = "pistudiodesktop";
pub const VERSION: u32 = 1;
/// File extension, without the dot.
pub const EXTENSION: &str = "pistudiodesktop";
/// Largest file `decode` accepts.
pub const MAX_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum FormatError {
    #[error("the file is {bytes} bytes; the limit is {MAX_BYTES}")]
    TooLarge { bytes: usize },
    #[error("not a {FORMAT} file: {0}")]
    NotOurs(String),
    #[error("the file was written by a newer version (format {found}; this build reads up to {VERSION})")]
    Newer { found: u32 },
    #[error("the file is damaged: {0}")]
    Invalid(String),
}

/// Read first, so a foreign or newer file is named as such before its body is parsed.
#[derive(Deserialize)]
struct Head {
    format: String,
    version: u32,
}

#[derive(Deserialize)]
struct Body {
    document: Document,
}

#[derive(Serialize)]
struct Envelope<'a> {
    format: &'a str,
    version: u32,
    document: &'a Document,
}

pub fn encode(doc: &Document) -> Result<Vec<u8>, FormatError> {
    serde_json::to_vec_pretty(&Envelope { format: FORMAT, version: VERSION, document: doc }).map_err(|e| FormatError::Invalid(e.to_string()))
}

pub fn decode(bytes: &[u8]) -> Result<Document, FormatError> {
    if bytes.len() > MAX_BYTES {
        return Err(FormatError::TooLarge { bytes: bytes.len() });
    }
    let head: Head = serde_json::from_slice(bytes).map_err(|e| FormatError::NotOurs(e.to_string()))?;
    if head.format != FORMAT {
        return Err(FormatError::NotOurs(format!("format is `{}`", head.format.chars().take(40).collect::<String>())));
    }
    if head.version > VERSION {
        return Err(FormatError::Newer { found: head.version });
    }
    // Older versions migrate here: match on `head.version` and convert before validating.
    let body: Body = serde_json::from_slice(bytes).map_err(|e| FormatError::Invalid(e.to_string()))?;
    body.document.validate().map_err(|e| FormatError::Invalid(e.to_string()))?;
    Ok(body.document)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        let mut doc = Document::new("Groceries");
        doc.add_item("milk").unwrap();
        doc.add_item("ünïcödé ✓").unwrap();
        assert_eq!(decode(&encode(&doc).unwrap()).unwrap(), doc);
    }

    #[test]
    fn hostile_files_are_errors_not_panics() {
        assert!(matches!(decode(b""), Err(FormatError::NotOurs(_))));
        assert!(matches!(decode(b"{\"format\":\"other\",\"version\":1}"), Err(FormatError::NotOurs(_))));
        assert_eq!(decode(b"{\"format\":\"pistudiodesktop\",\"version\":999}"), Err(FormatError::Newer { found: 999 }));
        assert!(matches!(decode(b"{\"format\":\"pistudiodesktop\",\"version\":1}"), Err(FormatError::Invalid(_))));
        let twice = br#"{"format":"pistudiodesktop","version":1,"document":{"title":"t","items":[{"id":1,"text":"a"},{"id":1,"text":"b"}]}}"#;
        assert!(matches!(decode(twice), Err(FormatError::Invalid(m)) if m.contains("more than once")));
        assert!(matches!(decode(&vec![b' '; MAX_BYTES + 1]), Err(FormatError::TooLarge { .. })));
    }
}
