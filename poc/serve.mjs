import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Tiny static server for the Pi-Studio UI POC. Serves poc/index.html (default 0.0.0.0:7070 so it's
 * reachable over the LAN). The page connects directly to the daemon over WebSocket
 * (e.g. ?host=ws://SERVER_IP:6767&connect=1).
 */
import { networkInterfaces } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.POC_PORT ?? 7070);
const BIND = process.env.POC_BIND ?? "0.0.0.0";

const server = createServer(async (req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  const file = url === "/" || url === "" ? "index.html" : url.replace(/^\/+/, "");
  try {
    const body = await readFile(join(here, file));
    const type = file.endsWith(".html")
      ? "text/html"
      : file.endsWith(".js")
        ? "text/javascript"
        : "application/octet-stream";
    res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

server.listen(PORT, BIND, () => {
  process.stdout.write(`Pi-Studio UI POC serving on http://${BIND}:${PORT}\n`);
  if (BIND === "0.0.0.0") {
    for (const addrs of Object.values(networkInterfaces())) {
      for (const a of addrs ?? []) {
        if (a.family === "IPv4" && !a.internal) {
          process.stdout.write(
            `  open: http://${a.address}:${PORT}/?host=ws://${a.address}:6767&connect=1\n`,
          );
        }
      }
    }
  }
});
