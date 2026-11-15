use pistudiodesktop_doc::Document;
use serde_json::Value;

use crate::commands::{CommandSpec, always, has_doc};
use crate::{Result, Session, params};

pub fn specs() -> Vec<CommandSpec> {
    vec![
        CommandSpec {
            id: "file.new",
            label: "New",
            menu: &["File"],
            shortcut: Some("Cmd+N"),
            params: r#"{"title": string = "Untitled"}"#,
            enabled: always,
            run: new,
        },
        CommandSpec {
            id: "file.open",
            label: "Open…",
            menu: &["File"],
            shortcut: Some("Cmd+O"),
            params: r#"{"path": string}"#,
            enabled: always,
            run: fs::open,
        },
        CommandSpec {
            id: "file.save",
            label: "Save",
            menu: &["File"],
            shortcut: Some("Cmd+S"),
            params: r#"{"path": string = the document's file}"#,
            enabled: has_doc,
            run: fs::save,
        },
        CommandSpec {
            id: "file.saveAs",
            label: "Save As…",
            menu: &["File"],
            shortcut: Some("Cmd+Shift+S"),
            params: r#"{"path": string}"#,
            enabled: has_doc,
            run: fs::save_as,
        },
        CommandSpec { id: "file.close", label: "Close", menu: &["File"], shortcut: Some("Cmd+W"), params: "{}", enabled: has_doc, run: close },
    ]
}

fn new(s: &mut Session, p: &Value) -> Result<Value> {
    let doc = Document::new(params::str_param(p, "title")?.unwrap_or("Untitled"));
    doc.validate()?;
    s.open_document(doc, None);
    Ok(Value::Null)
}

fn close(s: &mut Session, _: &Value) -> Result<Value> {
    s.close_document();
    Ok(Value::Null)
}

#[cfg(not(target_arch = "wasm32"))]
mod fs {
    use std::io::Write;
    use std::path::{Path, PathBuf};

    use serde_json::{Value, json};

    use crate::{EngineError, Result, Session, params};

    fn io_error(path: &Path, e: impl std::fmt::Display) -> EngineError {
        EngineError::Other(format!("{}: {e}", path.display()))
    }

    pub fn open(s: &mut Session, p: &Value) -> Result<Value> {
        let path = PathBuf::from(params::req_str(p, "path")?);
        // Refuse an oversized file before reading it, not after.
        let len = std::fs::metadata(&path).map_err(|e| io_error(&path, e))?.len();
        if len > pistudiodesktop_format::MAX_BYTES as u64 {
            return Err(io_error(&path, pistudiodesktop_format::FormatError::TooLarge { bytes: usize::try_from(len).unwrap_or(usize::MAX) }));
        }
        let bytes = std::fs::read(&path).map_err(|e| io_error(&path, e))?;
        s.open_bytes(&bytes, Some(path.clone())).map_err(|e| io_error(&path, e))?;
        Ok(json!({"path": path}))
    }

    pub fn save(s: &mut Session, p: &Value) -> Result<Value> {
        let path = match params::str_param(p, "path")? {
            Some(path) => PathBuf::from(path),
            None => s.active().and_then(|d| d.path.clone()).ok_or_else(|| EngineError::BadParams("`path` is required: the document was never saved".into()))?,
        };
        write(s, path)
    }

    pub fn save_as(s: &mut Session, p: &Value) -> Result<Value> {
        write(s, PathBuf::from(params::req_str(p, "path")?))
    }

    fn write(s: &mut Session, path: PathBuf) -> Result<Value> {
        let doc = s.snapshot().ok_or_else(|| EngineError::Other("no document open".into()))?;
        let bytes = pistudiodesktop_format::encode(&doc)?;
        write_atomic(&path, &bytes).map_err(|e| io_error(&path, e))?;
        s.mark_saved(path.clone());
        Ok(json!({"path": path, "bytes": bytes.len()}))
    }

    /// Temp file in the same folder, flush to disk, rename over the target: a crash or a full
    /// disk mid-save leaves the previous file intact.
    fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        let dir = path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
        let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
        tmp.write_all(bytes)?;
        tmp.as_file().sync_all()?;
        tmp.persist(path).map_err(|e| e.error)?;
        Ok(())
    }
}

/// The browser has no file system: the web shell reads and downloads bytes itself and calls
/// `Session::open_bytes` / `pistudiodesktop_format::encode`.
#[cfg(target_arch = "wasm32")]
mod fs {
    use serde_json::Value;

    use crate::{EngineError, Result, Session};

    fn unsupported() -> Result<Value> {
        Err(EngineError::Other("files are not available in the browser build".into()))
    }

    pub fn open(_: &mut Session, _: &Value) -> Result<Value> {
        unsupported()
    }

    pub fn save(_: &mut Session, _: &Value) -> Result<Value> {
        unsupported()
    }

    pub fn save_as(_: &mut Session, _: &Value) -> Result<Value> {
        unsupported()
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use serde_json::json;

    use crate::{EngineError, Session};

    #[test]
    fn save_then_open_round_trips_and_tracks_dirty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("list.pistudiodesktop");
        let mut s = Session::new();
        s.execute("file.new", json!({"title": "List"})).unwrap();
        s.execute("item.add", json!({"text": "milk"})).unwrap();
        assert!(matches!(s.execute("file.save", json!({})), Err(EngineError::BadParams(_))), "no path yet");
        s.execute("file.saveAs", json!({"path": path})).unwrap();
        assert!(!s.active().unwrap().dirty());
        s.execute("item.add", json!({"text": "eggs"})).unwrap();
        assert!(s.active().unwrap().dirty());
        s.execute("file.save", json!({})).unwrap();

        let mut other = Session::new();
        other.execute("file.open", json!({"path": path})).unwrap();
        assert_eq!(other.snapshot(), s.snapshot());
        assert!(!other.active().unwrap().dirty());
    }

    #[test]
    fn a_failed_open_keeps_the_open_document() {
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join("bad.pistudiodesktop");
        std::fs::write(&bad, b"not json").unwrap();
        let mut s = Session::new();
        s.execute("file.new", json!({"title": "Keep"})).unwrap();
        for path in [bad, dir.path().join("missing.pistudiodesktop")] {
            assert!(s.execute("file.open", json!({"path": path})).is_err());
        }
        assert_eq!(s.snapshot().unwrap().title, "Keep");
    }
}
