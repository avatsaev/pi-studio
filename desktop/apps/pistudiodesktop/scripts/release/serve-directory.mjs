// A static file server for the release check of a pull request's run (spec U5):
//
//   node serve-directory.mjs <directory> <port> [host]
//
// Serves the files of one directory over plain HTTP (host default 127.0.0.1) under their own names,
// GET and HEAD only, and logs one line per request (`<method> <path> <status> <bytes>`). It stands in
// for GitHub's release downloads: the files are named as GitHub names an asset (spaces are dots).
// Ends on SIGTERM or SIGINT.

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

/** The file of `directory` a request path names, or `null`: one segment, no directory, no escape. */
export function resolveRequest(directory, requestPath) {
  let name;
  try {
    name = decodeURIComponent(new URL(requestPath, "http://localhost").pathname.slice(1));
  } catch {
    return null;
  }
  if (name === "" || name !== basename(name) || name.includes("\\") || name === "." || name === "..") return null;
  const file = join(directory, name);
  try {
    return statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** A server over `directory`; `log(line)` receives each request's line. */
export function createFileServer(directory, log = () => {}) {
  return createServer((request, response) => {
    const done = (status, bytes) => log(`${request.method} ${request.url} ${status} ${bytes}`);
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return done(405, 0);
    }
    const file = resolveRequest(directory, request.url ?? "/");
    if (file === null) {
      response.writeHead(404).end();
      return done(404, 0);
    }
    const { size } = statSync(file);
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": size });
    if (request.method === "HEAD") {
      response.end();
      return done(200, 0);
    }
    createReadStream(file)
      .on("error", () => response.destroy())
      .pipe(response)
      .on("finish", () => done(200, size));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, portText, host = "127.0.0.1"] = process.argv.slice(2);
  const port = Number(portText);
  if (!directory || !Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("usage: node serve-directory.mjs <directory> <port> [host]");
    process.exit(2);
  }
  const server = createFileServer(directory, (line) => console.log(line));
  server.listen(port, host, () => console.log(`serving ${directory} on http://${host}:${server.address().port}`));
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
}
