#!/usr/bin/env node
// Render the built frontend to a PNG without opening the app, under the app's own
// Content-Security-Policy.
//
//   npm run snapshot -- --out ui.png
//   npm run snapshot -- --query 'host=127.0.0.1:6767&connect=1' --wait-for 'text=connected'
//
// The page is the built frontend (`npm run build`), served from disk with the policy in
// `src-tauri/tauri.conf.json`, and a headless browser draws it. That browser is Playwright's, not
// the platform webview the app uses, so trust it for layout, themes and the policy, and check
// platform quirks in the running app. Exits 1 when the page broke the policy or threw.
//
//   --out FILE         PNG to write (default snapshot.png)
//   --size WxH         size in CSS pixels (default 1280x800)
//   --scale N          device pixels per CSS pixel (default 2)
//   --query STRING     the page's query string: the workbench's launch grammar
//                      (`host=`, `password=`, `cwd=`, `connect=1`), e.g. to connect to a daemon
//   --wait-for SEL     wait for this Playwright selector before the screenshot
//   --steps FILE       then run this ES module's default export, `async (page) => {}`, with the
//                      Playwright page: click, type, open a file
//   --browser NAME     chromium (default) or webkit

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(app, "dist");

function fail(message) {
  console.error(`snapshot: ${message}`);
  process.exit(1);
}

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fail(`--${name} needs a value`));
}

/** The policy as one header value. The config holds it as a string or as directive → source(s). */
function policyHeader(csp) {
  if (typeof csp === "string") return csp;
  return Object.entries(csp)
    .map(([directive, sources]) => `${directive} ${[sources].flat().join(" ")}`)
    .join("; ");
}

const out = path.resolve(option("out", "snapshot.png"));
const size = /^(\d+)x(\d+)$/.exec(option("size", "1280x800")) ?? fail("--size is WIDTHxHEIGHT, e.g. 1280x800");
const [width, height] = [Number(size[1]), Number(size[2])];
const scale = Number(option("scale", "2")) || fail("--scale is a number");
const browserName = option("browser", "chromium");
const query = option("query", "");
const waitFor = option("wait-for", null);
const steps = option("steps", null);

if (!existsSync(path.join(dist, "index.html"))) {
  fail("the frontend is not built: run `npm run build` first");
}
const config = JSON.parse(readFileSync(path.join(app, "src-tauri", "tauri.conf.json"), "utf8"));
const policy = policyHeader(config.app?.security?.csp ?? fail("tauri.conf.json has no app.security.csp"));

const playwright = await import("playwright").catch(() => fail("playwright is not installed: run `npm ci`"));
const launcher = playwright[browserName] ?? fail("--browser is chromium or webkit");
const browser = await launcher.launch().catch((error) => fail(`cannot start ${browserName}: ${error.message}\nrun \`npm run snapshot:install\` once`));

const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
const problems = [];
await page.exposeFunction("__snapshotPolicyViolation", (text) => problems.push(`policy: ${text}`));
await page.addInitScript(() => {
  document.addEventListener("securitypolicyviolation", (event) => {
    window.__snapshotPolicyViolation(`${event.effectiveDirective} blocked ${event.blockedURI || "inline code"}`);
  });
});
page.on("pageerror", (error) => problems.push(`error: ${error.stack ?? error.message}`));

// Serve dist/ from a loopback port: module scripts do not load from file:// URLs, and a browser
// lets a loopback page reach a daemon on this machine.
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};
const server = createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const file = path.join(dist, requested === "/" ? "index.html" : requested);
  if (!file.startsWith(dist + path.sep) || !existsSync(file)) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "Content-Security-Policy": policy,
  });
  response.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

await page.goto(`http://127.0.0.1:${server.address().port}/${query ? `?${query}` : ""}`);
// The workbench has drawn once its mount element has children.
await page.waitForSelector("#root > *");
if (waitFor) {
  await page.waitForSelector(waitFor);
}
if (steps) {
  const module = await import(pathToFileURL(path.resolve(steps)).href);
  await module.default(page);
}
await page.screenshot({ path: out });
await browser.close();
server.close();
console.log(`wrote ${out} (${width * scale}×${height * scale})`);
if (problems.length > 0) {
  fail(`the page had problems:\n  ${[...new Set(problems)].join("\n  ")}`);
}
