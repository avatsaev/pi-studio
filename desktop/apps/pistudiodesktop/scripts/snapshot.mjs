#!/usr/bin/env node
// Render the real frontend to a PNG without opening the app.
//
//   npm run snapshot -- --out ui.png --size 720x420 \
//     --script '[["engine.execute", {"command": "item.add", "params": {"text": "milk"}}], ["ui.set", {"theme": "light"}]]'
//
// The view comes from the real shell (`cargo run -p pistudiodesktop-shell --example view`), the page is
// the built frontend (`npm run build`), and a headless browser draws it. That browser is
// Playwright's, not the platform webview the app uses, so trust it for layout and themes and
// check platform quirks in the running app.
//
//   --out FILE       PNG to write (default snapshot.png)
//   --size WxH       size in CSS pixels (default 960x640)
//   --scale N        device pixels per CSS pixel (default 2)
//   --script JSON    control-protocol calls applied in order to a new document (default [])
//   --view FILE      draw this saved view instead of asking the shell
//   --click NAME     click the button with this accessible name first, e.g. a menu: --click File
//   --browser NAME   chromium (default) or webkit

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(app, "dist");
const workspace = path.resolve(app, "..", "..");

function fail(message) {
  console.error(`snapshot: ${message}`);
  process.exit(1);
}

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fail(`--${name} needs a value`));
}

const out = path.resolve(option("out", "snapshot.png"));
const size = /^(\d+)x(\d+)$/.exec(option("size", "960x640")) ?? fail("--size is WIDTHxHEIGHT, e.g. 720x420");
const [width, height] = [Number(size[1]), Number(size[2])];
const scale = Number(option("scale", "2")) || fail("--scale is a number");
const browserName = option("browser", "chromium");
const click = option("click", null);

if (!existsSync(path.join(dist, "index.html"))) {
  fail("the frontend is not built: run `npm run build` first");
}

const saved = option("view", null);
const view = saved
  ? readFileSync(saved, "utf8")
  : execFileSync("cargo", ["run", "-q", "-p", "pistudiodesktop-shell", "--example", "view", "--", "--script", option("script", "[]")], {
      cwd: workspace,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
try {
  JSON.parse(view);
} catch {
  fail("the view is not JSON");
}

const playwright = await import("playwright").catch(() => fail("playwright is not installed: run `npm ci`"));
const launcher = playwright[browserName] ?? fail("--browser is chromium or webkit");
const browser = await launcher.launch().catch((error) => fail(`cannot start ${browserName}: ${error.message}\nrun \`npm run snapshot:install\` once`));

const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
await page.addInitScript(`window.__PISTUDIODESKTOP_VIEW__ = ${view};`);
// Serve dist/ from disk under a made-up origin: module scripts do not load from file:// URLs.
const origin = "http://snapshot.invalid";
await page.route(`${origin}/**`, (route) => {
  const requested = decodeURIComponent(new URL(route.request().url()).pathname);
  const file = path.join(dist, requested === "/" ? "index.html" : requested);
  if (!file.startsWith(dist) || !existsSync(file)) {
    return route.fulfill({ status: 404, body: "not found" });
  }
  return route.fulfill({ path: file });
});
await page.goto(`${origin}/`);
// `<main>` exists once the first view is drawn.
await page.waitForSelector("main");
if (click) {
  await page.getByRole("button", { name: click, exact: true }).click();
}
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out} (${width * scale}×${height * scale})`);
