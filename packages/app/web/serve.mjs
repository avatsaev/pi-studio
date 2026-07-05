#!/usr/bin/env node
/**
 * Pi-Studio app preview server.
 * Uses esbuild to bundle packages/app/web/main.ts (+ all workspace imports) into bundle.js,
 * then serves index.html + bundle.js on LAN.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const here      = dirname(fileURLToPath(import.meta.url));
const appRoot   = dirname(here);
const repoRoot  = join(appRoot, "../..");
const outFile   = join(here, "bundle.js");
const port      = Number(process.env.APP_PREVIEW_PORT ?? 7080);
const bind      = process.env.APP_PREVIEW_BIND ?? "0.0.0.0";

// ── Build ──────────────────────────────────────────────────────────────────

async function runBuild() {
  // 1. Type-check via tsc (fast because noEmit=true here)
  const tscBin = process.platform === "win32" ? "tsc.cmd" : "tsc";
  const tsc = spawnSync(tscBin, ["-p", join(appRoot, "tsconfig.web-preview.json"), "--noEmit"], {
    cwd: appRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (tsc.status !== 0) process.exit(tsc.status ?? 1);

  // 2. Bundle with esbuild — resolves @av-pi-studio/* via npm workspace symlinks
  const req = createRequire(import.meta.url);
  const { build } = req(join(repoRoot, "node_modules/esbuild/lib/main.js"));
  await build({
    entryPoints: [join(here, "main.ts")],
    bundle:      true,
    outfile:     outFile,
    format:      "esm",
    target:      "es2022",
    platform:    "browser",
    tsconfig:    join(appRoot, "tsconfig.web-preview.json"),
    logLevel:    "info",
  });
}

// ── Serve ──────────────────────────────────────────────────────────────────

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js"))   return "text/javascript; charset=utf-8";
  if (file.endsWith(".css"))  return "text/css; charset=utf-8";
  if (file.endsWith(".map"))  return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0] ?? "/");
  const rel     = decoded.replace(/^\/+/, "");
  const full    = normalize(join(root, rel));
  return full.startsWith(normalize(root)) ? full : null;
}

// ── Main ───────────────────────────────────────────────────────────────────

await runBuild();
if (process.argv.includes("--check")) process.exit(0);

const server = createServer(async (req, res) => {
  const urlPath = req.url?.split("?")[0] ?? "/";

  // index.html
  if (urlPath === "/" || urlPath === "/index.html") {
    try {
      const body = await readFile(join(here, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(body);
    } catch {
      res.writeHead(404); return res.end("not found");
    }
  }

  // Everything else: serve from web/ directory (bundle.js, maps, etc.)
  const file = safeJoin(here, urlPath);
  try {
    if (!file || !existsSync(file)) throw new Error("not found");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": contentType(file) });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
});

server.listen(port, bind, () => {
  process.stdout.write(`Pi-Studio app preview serving on http://${bind}:${port}\n`);
  if (bind === "0.0.0.0") {
    for (const addrs of Object.values(networkInterfaces())) {
      for (const addr of addrs ?? []) {
        if (addr.family === "IPv4" && !addr.internal)
          process.stdout.write(`  open: http://${addr.address}:${port}/\n`);
      }
    }
  }
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT",  () => server.close(() => process.exit(0)));
