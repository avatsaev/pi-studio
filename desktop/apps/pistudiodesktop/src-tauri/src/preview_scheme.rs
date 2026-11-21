//! The `pi-preview` scheme: the app's answer to a webview asking for a previewed document.
//!
//! All decisions are in [`pistudiodesktop_shell::preview`]; this adapts them to Tauri's request
//! and response types. The scheme is registered for the whole app, so the handler answers any
//! request for it, and only a mounted document gets anything but a 404.

use pistudiodesktop_shell::preview::{Previews, Served, not_found};
use tauri::http::{Request, Response, StatusCode};
use tauri::{Manager as _, Runtime, UriSchemeContext};

/// The handler registered for [`pistudiodesktop_shell::preview::SCHEME`]. The document is never
/// logged.
pub fn handle<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let served = match ctx.app_handle().try_state::<Previews>() {
        Some(previews) => previews.serve(request.method().as_str(), request.uri().path()),
        None => not_found(),
    };
    respond(served)
}

/// A [`Served`] as an HTTP response.
fn respond(served: Served) -> Response<Vec<u8>> {
    let mut builder = Response::builder().status(served.status);
    for (name, value) in served.headers {
        builder = builder.header(*name, *value);
    }
    builder.body(served.body).unwrap_or_else(|_| {
        // The status and the headers are constants the shell chose, so this does not happen; if it
        // did, an empty 404 is the safe answer.
        let mut refusal = Response::new(Vec::new());
        *refusal.status_mut() = StatusCode::NOT_FOUND;
        refusal
    })
}

#[cfg(test)]
mod tests {
    use pistudiodesktop_shell::preview::{HEADERS, Kind};

    use super::*;

    #[test]
    fn a_served_document_becomes_a_200_with_the_four_headers() {
        let store = Previews::new(Kind::Origin);
        let id = store.mount("<p>hi</p>".into()).unwrap();
        let response = respond(store.serve("GET", &format!("/{id}")));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body(), b"<p>hi</p>");
        for (name, value) in HEADERS {
            assert_eq!(response.headers().get(name).and_then(|v| v.to_str().ok()), Some(value), "{name}");
        }
        assert_eq!(response.headers().len(), HEADERS.len());
    }

    #[test]
    fn anything_else_becomes_an_empty_404() {
        let store = Previews::new(Kind::Origin);
        let id = store.mount("<p>hi</p>".into()).unwrap();
        for (method, path) in [("GET", "/nope".to_string()), ("POST", format!("/{id}"))] {
            let response = respond(store.serve(method, &path));
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{method} {path}");
            assert!(response.body().is_empty());
        }
    }
}
