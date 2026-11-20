// The HTML preview probe of `swe/notes/desktop-preview-origin-spike.md`: a document that tries to
// leave its sandbox, mounted through the page's host and loaded in a sandboxed frame. It tells
// whether scripts run and whether every attempt to get out fails.

/** The spike's probe page. Posts its findings to the parent window. */
export const PROBE_HTML = `<!doctype html>
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
</script></body></html>`;

/** The rows whose pass is not "blocked": the answer that means the attempt failed. */
const PASSING_ANSWER = { popup: "ALLOWED: null window", ownTauriInternals: "ALLOWED: undefined" };

const ROWS = ["parentDocument", "ownTauriInternals", "ipcFetch", "ipcHttpFetch", "popup", "localStorage", "remoteFetch", "remoteImage"];

/**
 * Read the probe's findings: `{ verdict, rows }`. `verdict` is "origin works" (scripts ran and
 * every attempt failed), "scripts blocked" (no findings: the frame ran nothing), or "scripts run
 * but isolation broken" with the failing rows listed in `leaks`.
 */
export function interpretProbe(findings) {
  if (!findings || findings.scriptRan !== true) return { verdict: "scripts blocked", leaks: [], rows: [] };
  const rows = ROWS.map((name) => ({ name, answer: String(findings[name] ?? "missing") }));
  const leaks = rows.filter(({ name, answer }) => (name in PASSING_ANSWER ? answer !== PASSING_ANSWER[name] : !answer.startsWith("blocked")));
  return { verdict: leaks.length === 0 ? "origin works" : "scripts run but isolation broken", leaks: leaks.map((row) => row.name), rows };
}

/**
 * Page script (async): load the probe in a sandboxed frame, `src` from a mounted URL or `srcdoc`,
 * and answer with the findings or `null` when the frame posted nothing within `waitMs`.
 */
export const RUN_PROBE_SCRIPT = `
  const [html, url, useSrcdoc, waitMs, done] = [arguments[0], arguments[1], arguments[2], arguments[3], arguments[arguments.length - 1]];
  let findings = null;
  const onMessage = (event) => { if (event.data && event.data.probe) findings = event.data.probe; };
  window.addEventListener("message", onMessage);
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
  if (useSrcdoc) frame.srcdoc = html; else frame.src = url;
  document.body.append(frame);
  const began = Date.now();
  const tick = () => {
    if (findings || Date.now() - began > waitMs) {
      window.removeEventListener("message", onMessage);
      frame.remove();
      done(findings);
    } else setTimeout(tick, 100);
  };
  tick();
`;
