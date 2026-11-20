# Spike — HTML preview from the app's own custom scheme (D7)

Sprint-105/task-001, 2026-11-20. Measured on **Linux** (WebKitGTK, Tauri 2, the `pi-desktop-xvfb`
container under WebKitWebDriver). The experiment code was reverted; this note is the record.

## Result

**It works on Linux.** A document served from a custom scheme registered with
`register_uri_scheme_protocol`, loaded in `<iframe sandbox="allow-scripts">`, runs its inline
scripts and stays isolated: opaque origin, no parent access, no storage, no popups, no command
channel. Two things the design must account for:

1. **The navigation guard refuses the frame.** On WebKitGTK, Tauri's `on_navigation` hook fires
   for subframe loads too. With `shell::navigation::allows` as it is, the log shows
   `navigation refused: pi-preview://localhost` and the frame stays blank. The preview scheme must
   be admitted by the navigation rule. That is safe for the main window because the response
   header alone sandboxes the document (question 4).
2. **The command channel's real defence inside the frame is the invoke key, not the frame.** With
   the "Block remote resources" tag off, a `fetch("ipc://localhost/boot")` from the frame reaches
   Tauri and is answered `500 missing Tauri-Invoke-Key header`, which is also what a forged
   `storage_set` gets. `window.__TAURI_INTERNALS__` is not injected into the frame. Task-003 should
   keep `ipc:` out of the frame's reach when it can (see the policy below) and add a test that the
   frame cannot invoke.

## Per-platform table

| Platform | Scripts run | Isolated | URL form | Status |
|---|---|---|---|---|
| Linux (WebKitGTK) | yes | yes | `pi-preview://localhost/<path>` | **measured 2026-11-20** |
| macOS (WKWebView) | — | — | expected `pi-preview://localhost/<path>` | not measured |
| Windows (WebView2) | — | — | expected `http://pi-preview.localhost/<path>` | not measured |

Until macOS and Windows are measured they are treated as unable (`"inert"`), the safe side of D7.

## Answers (Linux, observed)

1. **Inline script runs?** Yes — `scriptRan: true` in every variant.
2. **URL form and `frame-src`:** `pi-preview://localhost/probe.html`; the window's policy needs
   `frame-src pi-preview:` (the experiment listed `pi-preview: http://pi-preview.localhost blob:`;
   only the first is used on Linux). The navigation rule must also admit the scheme (above).
3. **From inside the frame** (sandbox attribute + header):
   - `parent.document` → `SecurityError: Sandbox access violation: Blocked a frame at
     "pi-preview://localhost" from accessing a cross-origin frame … lacks the "allow-same-origin"
     flag.`
   - Command channel: `window.__TAURI_INTERNALS__` is `undefined` in the frame; with the blocking tag
     on, `fetch("ipc://localhost/boot")` and `fetch("http://ipc.localhost/boot")` fail
     (`TypeError: Load failed`); with it off, `ipc://` answers `500 missing Tauri-Invoke-Key header`
     (for `boot` and for a forged `storage_set`).
   - Popup: `window.open("about:blank")` returns `null`.
   - `localStorage` → `SecurityError: The operation is insecure.`
   - `self.origin` is `"null"`.
4. **`sandbox` response header without a sandboxing frame:** a frame *without* the `sandbox`
   attribute loading the same URL got the same result (origin `"null"`, parent and storage
   blocked), so WebKitGTK honours `Content-Security-Policy: sandbox allow-scripts` on the response.
   A top-level load could not be tried: the main window's navigation rule refuses it, and the frame
   cannot open windows.
5. **"Block remote resources" tag inside the document:** with the tag, a remote image
   (`https://www.google.com/favicon.ico`) and a `no-cors` `fetch` of it both fail; without it, the
   image loads and the fetch returns an opaque response. The tag works as a network policy inside
   the framed document (the container had network: `curl https://example.com` → 200).

The alternatives (`blob:` frame, loopback HTTP listener) were not needed.

## Minimal shape that worked (no implementation)

- `tauri::Builder::register_uri_scheme_protocol("pi-preview", |ctx, request| -> http::Response<Vec<u8>>)`.
- Response headers: `Content-Type: text/html; charset=utf-8`, `Content-Security-Policy: sandbox allow-scripts`,
  `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- Window policy: add `"frame-src": ["pi-preview:"]` to `app.security.csp` (plus the Windows form when measured).
- Navigation rule: admit `pi-preview://localhost/…` (and the Windows form) in `shell::navigation::allows`.
- Page: `<iframe sandbox="allow-scripts" src="pi-preview://localhost/<token>">` — never `allow-same-origin`.
- Tauri-side note from sprint-103/task-001: Tauri treats registered custom schemes as local for ACL purposes;
  the invoke key is what stopped the frame here, so task-003 must test that the frame cannot invoke.

## Repeat it on macOS or Windows (a few minutes)

1. In `src-tauri/src/main.rs`, register the `pi-preview` scheme as above, serving the probe page below
   from a file, and add the header unless the URL contains `nosandbox`.
2. Add `"frame-src": ["pi-preview:", "http://pi-preview.localhost"]` to the policy and admit the scheme in
   the navigation rule.
3. Build, open the app, open the developer tools on the main page and run:

   ```js
   window.addEventListener("message", (e) => e.data.probe && console.table(e.data.probe));
   const f = document.createElement("iframe");
   f.setAttribute("sandbox", "allow-scripts");
   f.src = "pi-preview://localhost/probe.html"; // Windows: "http://pi-preview.localhost/probe.html"
   document.body.append(f);
   ```

4. Record every row: `scriptRan` must be true; every other row must read `blocked`, except `popup`
   (`null window` is the pass) and `ownTauriInternals` (`undefined` is the pass). Repeat without the
   `sandbox` attribute (question 4) and with the meta tag removed (question 5: then the remote rows load).
5. Revert the experiment.

### Probe page

```html
<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline' data:; script-src 'unsafe-inline' data:; connect-src 'none'">
<title>preview probe</title></head>
<body><h1 id="h">probe: scripts did not run</h1>
<img id="remote" src="https://www.google.com/favicon.ico">
<script>
(async () => {
  const r = { scriptRan: true, origin: String(self.origin), href: location.href };
  const t = async (name, fn) => { try { r[name] = "ALLOWED: " + String(await fn()); } catch (e) { r[name] = "blocked: " + (e && e.name) + " " + (e && e.message); } };
  await t("parentDocument", () => parent.document.title);
  await t("ownTauriInternals", () => typeof window.__TAURI_INTERNALS__);
  await t("ipcFetch", async () => { const x = await fetch("ipc://localhost/boot", { method: "POST", body: "{}" }); return x.status + " " + (await x.text()).slice(0, 120); });
  await t("ipcHttpFetch", async () => (await fetch("http://ipc.localhost/boot", { method: "POST", body: "{}" })).status);
  await t("popup", () => { const w = window.open("about:blank"); return w === null ? "null window" : "opened"; });
  await t("localStorage", () => { localStorage.setItem("x", "1"); return localStorage.getItem("x"); });
  await t("remoteFetch", async () => "type " + (await fetch("https://www.google.com/favicon.ico", { mode: "no-cors" })).type);
  await new Promise((res) => setTimeout(res, 1500));
  const img = document.getElementById("remote");
  r.remoteImage = img.complete && img.naturalWidth > 0 ? "ALLOWED: loaded" : "blocked: not loaded";
  document.getElementById("h").textContent = "probe: scripts ran";
  parent.postMessage({ probe: r }, "*");
})();
</script></body></html>
```
