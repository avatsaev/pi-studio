//! The preview origin: HTML documents the page mounts, served from a custom scheme of the app.
//!
//! The workbench previews an HTML file in a sandboxed frame. A frame fed through `srcdoc` inherits
//! the window's Content-Security-Policy, which blocks scripts; a frame loaded from another origin
//! is governed by its own response headers instead. So the page mounts the document here
//! ([`Previews::mount`]), gets a URL on the app's `pi-preview` scheme, and points the frame at it.
//! The app's scheme handler answers that URL from [`Previews::serve`] with headers that isolate
//! the document ([`HEADERS`]): `sandbox allow-scripts` repeats what the frame's `sandbox`
//! attribute says, so the document is isolated even if it were ever loaded outside the frame.
//!
//! Only some webviews can do this (`swe/notes/desktop-preview-origin-spike.md`): [`kind`] says
//! which. Where it says [`Kind::Inert`] nothing can be mounted and the page keeps its `srcdoc`
//! frame, scripts off.
//!
//! The document is untrusted: it was written by an agent. It is held in memory only and never
//! logged, and nothing but a mounted document is ever served from this origin. The origin appears
//! in no capability; the frame's only way to the app's commands is a key it does not have.

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

/// The scheme of the preview origin.
pub const SCHEME: &str = "pi-preview";

/// The host the origin is served from. `navigation::allows` admits exactly this scheme and host.
pub const HOST: &str = "localhost";

/// The origin's URL form on the platforms where it works (Linux, as measured; the Windows form,
/// `http://pi-preview.localhost`, is not used because that platform is not measured).
const ORIGIN: &str = "pi-preview://localhost";

/// The most documents mounted at once.
pub const MAX_DOCUMENTS: usize = 32;

/// The most bytes of documents mounted at once, in total.
pub const MAX_BYTES: usize = 32 * 1024 * 1024;

/// An id is 128 random bits as hex: 32 characters.
const ID_BYTES: usize = 16;

/// The headers of a served document. `sandbox` isolates it without the frame's help; `no-store`
/// and `nosniff` keep the webview from caching it or guessing another type.
pub const HEADERS: [(&str, &str); 4] = [
    ("Content-Type", "text/html; charset=utf-8"),
    ("Content-Security-Policy", "sandbox allow-scripts"),
    ("Cache-Control", "no-store"),
    ("X-Content-Type-Options", "nosniff"),
];

/// The headers of a refusal: the same isolation, no document.
const NOT_FOUND_HEADERS: [(&str, &str); 4] = [
    ("Content-Type", "text/plain; charset=utf-8"),
    ("Content-Security-Policy", "sandbox"),
    ("Cache-Control", "no-store"),
    ("X-Content-Type-Options", "nosniff"),
];

/// Whether this platform can run a previewed document's scripts from the preview origin.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// Documents are served from the origin and their scripts run, isolated.
    Origin,
    /// Not possible, or not measured: the page keeps the `srcdoc` frame.
    Inert,
}

impl Kind {
    /// The word the boot snapshot carries.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Origin => "origin",
            Self::Inert => "inert",
        }
    }
}

/// The platform table, from the spike's results. `os` is a `std::env::consts::OS` name. A platform
/// that was not measured is [`Kind::Inert`], the safe side.
pub fn kind_for(os: &str) -> Kind {
    match os {
        // Measured 2026-11-20: WebKitGTK runs the scripts and the frame stays isolated.
        "linux" => Kind::Origin,
        // macOS (WKWebView) and Windows (WebView2): not measured.
        _ => Kind::Inert,
    }
}

/// [`kind_for`] the platform the app runs on.
pub fn kind() -> Kind {
    kind_for(std::env::consts::OS)
}

/// Why a mount was refused. The text is shown to the page and never holds the document.
#[derive(Debug, PartialEq, Eq)]
pub enum MountError {
    /// This platform cannot serve previews from an origin of their own.
    Inert,
    /// [`MAX_DOCUMENTS`] are mounted.
    TooMany,
    /// The document would take the total past [`MAX_BYTES`].
    TooLarge,
    /// No unique id could be made.
    NoId(String),
}

impl fmt::Display for MountError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Inert => write!(f, "scripts in previews are not supported on this platform; the page should keep the sandboxed srcdoc frame"),
            Self::TooMany => write!(f, "{MAX_DOCUMENTS} previews are already open; close one and try again"),
            Self::TooLarge => write!(f, "the preview would take the open previews past {} MiB in total; close one and try again", MAX_BYTES / (1024 * 1024)),
            Self::NoId(why) => write!(f, "could not make an id for the preview ({why})"),
        }
    }
}

/// What the scheme handler answers.
#[derive(Debug, PartialEq, Eq)]
pub struct Served {
    pub status: u16,
    pub headers: &'static [(&'static str, &'static str)],
    pub body: Vec<u8>,
}

/// The answer for anything that is not a mounted document: another path, id or method.
pub fn not_found() -> Served {
    Served { status: 404, headers: &NOT_FOUND_HEADERS, body: Vec::new() }
}

#[derive(Default)]
struct State {
    documents: HashMap<String, Arc<String>>,
    /// The bytes of every document in `documents`.
    bytes: usize,
}

/// The mounted documents. Managed by the app; shared by the page's commands and the scheme handler.
pub struct Previews {
    kind: Kind,
    state: Mutex<State>,
}

impl Default for Previews {
    /// The store for the platform the app runs on.
    fn default() -> Self {
        Self::new(kind())
    }
}

/// `ID_BYTES` random bytes as lowercase hex.
#[cfg(not(target_arch = "wasm32"))]
fn random_id() -> Result<String, MountError> {
    use std::fmt::Write as _;

    let mut bytes = [0_u8; ID_BYTES];
    getrandom::fill(&mut bytes).map_err(|e| MountError::NoId(format!("no random source: {e}")))?;
    let mut id = String::with_capacity(ID_BYTES * 2);
    for byte in bytes {
        // Writing to a `String` cannot fail.
        let _ = write!(id, "{byte:02x}");
    }
    Ok(id)
}

#[cfg(target_arch = "wasm32")]
fn random_id() -> Result<String, MountError> {
    Err(MountError::NoId("the browser build has no random source".into()))
}

/// Whether `id` is what [`random_id`] makes. Anything else is not looked up.
fn is_id(id: &str) -> bool {
    id.len() == ID_BYTES * 2 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The URL a document with this id is served from.
pub fn url_for(id: &str) -> String {
    format!("{ORIGIN}/{id}")
}

/// The id in a URL that [`url_for`] made; `None` for any other URL.
pub fn id_of(url: &str) -> Option<&str> {
    url.strip_prefix(ORIGIN)?.strip_prefix('/').filter(|id| is_id(id))
}

impl Previews {
    /// A store for a platform of this kind. [`Kind::Inert`] refuses every mount.
    pub fn new(kind: Kind) -> Self {
        Self { kind, state: Mutex::default() }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // The state is a map and a counter, consistent between statements: a panic elsewhere
        // leaves nothing half done.
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// What the boot snapshot says about previews on this platform.
    pub fn kind(&self) -> Kind {
        self.kind
    }

    /// Keep `html` and answer its id. Refused when the platform is inert, when [`MAX_DOCUMENTS`] are
    /// mounted, or when the total would pass [`MAX_BYTES`]; a refused mount keeps nothing.
    pub fn mount(&self, html: String) -> Result<String, MountError> {
        if self.kind == Kind::Inert {
            return Err(MountError::Inert);
        }
        let mut state = self.lock();
        if state.documents.len() >= MAX_DOCUMENTS {
            return Err(MountError::TooMany);
        }
        // `checked_add` and not `+`: the caps must hold for any input.
        if state.bytes.checked_add(html.len()).is_none_or(|total| total > MAX_BYTES) {
            return Err(MountError::TooLarge);
        }
        let id = random_id()?;
        let Entry::Vacant(slot) = state.documents.entry(id.clone()) else {
            // 2^-128 per mount; refusing is simpler than a retry loop and keeps the byte count true.
            return Err(MountError::NoId("the random id was already in use".into()));
        };
        let bytes = html.len();
        slot.insert(Arc::new(html));
        state.bytes += bytes;
        Ok(id)
    }

    /// The document mounted under `id`.
    pub fn get(&self, id: &str) -> Option<Arc<String>> {
        self.lock().documents.get(id).cloned()
    }

    /// Drop the document under `id`; an unknown id is ignored.
    pub fn release(&self, id: &str) {
        let mut state = self.lock();
        if let Some(document) = state.documents.remove(id) {
            state.bytes -= document.len();
        }
    }

    /// [`Self::release`] for a URL that [`url_for`] made; any other URL is ignored.
    pub fn release_url(&self, url: &str) {
        if let Some(id) = id_of(url) {
            self.release(id);
        }
    }

    /// Drop every document (the page reloaded: it holds none of the URLs any more).
    pub fn clear(&self) {
        *self.lock() = State::default();
    }

    /// The number of documents mounted.
    pub fn len(&self) -> usize {
        self.lock().documents.len()
    }

    /// Whether no document is mounted.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The bytes of the documents mounted.
    pub fn bytes(&self) -> usize {
        self.lock().bytes
    }

    /// The answer to a request for `path` (the URL's path, with its leading `/`) by `method`: the
    /// document with [`HEADERS`] for a `GET` of a mounted id, and [`not_found`] for everything else.
    pub fn serve(&self, method: &str, path: &str) -> Served {
        let document = (method == "GET").then(|| path.strip_prefix('/')).flatten().filter(|id| is_id(id)).and_then(|id| self.get(id));
        match document {
            Some(document) => Served { status: 200, headers: &HEADERS, body: document.as_bytes().to_vec() },
            None => not_found(),
        }
    }
}

#[cfg(test)]
mod tests;
