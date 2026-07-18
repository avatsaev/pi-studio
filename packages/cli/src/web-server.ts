import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

/**
 * Static file server for the prebuilt `@av-pi-studio/web-client` SPA (features/cli.md § Command
 * tree — `web`). The CLI ships no dev-server dependency (vite, etc.); it serves the already-built
 * `dist/web` output from the `web-client` package and falls back to `index.html` for unknown
 * paths (client-side routing via react-router).
 *
 * Process side-effects (locating the built assets, opening the listen socket) are injectable so
 * the command layer is unit-testable without a real HTTP server or installed web-client package.
 */

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/** Resolve the on-disk root of the built web-client SPA (`dist/web`). Throws if unresolvable. */
export function resolveWebClientDist(): string {
  let pkgUrl: string;
  try {
    pkgUrl = import.meta.resolve("@av-pi-studio/web-client/package.json");
  } catch (err) {
    throw new Error(
      "could not resolve @av-pi-studio/web-client — is it installed alongside the CLI?",
      { cause: err },
    );
  }
  const pkgPath = new URL(pkgUrl).pathname;
  const dist = join(pkgPath, "..", "dist", "web");
  if (!existsSync(join(dist, "index.html"))) {
    throw new Error(
      `@av-pi-studio/web-client is installed but has no built UI at ${dist} — run its "build:web" script.`,
    );
  }
  return dist;
}

export interface WebServerHandle {
  url: string;
  close(): Promise<void>;
}

/**
 * Start a static file server rooted at `dir`, listening on `host:port`. SPA fallback: any
 * extension-less path (client-side route) that has no matching file serves `index.html`.
 */
export function startWebServer(opts: {
  dir: string;
  host: string;
  port: number;
}): Promise<WebServerHandle> {
  const { dir, host, port } = opts;

  const server: Server = createServer((req, res) => {
    void handleRequest(dir, req.url ?? "/", res);
  });

  return new Promise<WebServerHandle>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        url: `http://${host}:${actualPort}/`,
        close: () => new Promise<void>((resolveClosed) => server.close(() => resolveClosed())),
      });
    });
  });
}

async function handleRequest(dir: string, requestUrl: string, res: ServerResponse): Promise<void> {
  const pathname = decodeURIComponent(requestUrl.split("?")[0] ?? "/");
  const requested = pathname === "/" ? "/index.html" : pathname;

  // Reject path traversal outside `dir`.
  const relative = normalize(requested).replace(/^([.]{2}[/\\])+/, "");
  const filePath = join(dir, relative);
  if (!filePath.startsWith(dir + sep) && filePath !== join(dir, "index.html")) {
    res.writeHead(403).end("forbidden");
    return;
  }

  const hasExtension = extname(relative) !== "";
  const candidate = hasExtension ? filePath : join(dir, "index.html");

  try {
    const body = await readFile(candidate);
    const type = MIME_TYPES[extname(candidate)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type }).end(body);
  } catch {
    if (hasExtension) {
      res.writeHead(404).end("not found");
      return;
    }
    // SPA fallback for extension-less paths (client-side routes) that still 404'd somehow.
    try {
      const body = await readFile(join(dir, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
    } catch {
      res.writeHead(500).end("internal error");
    }
  }
}
