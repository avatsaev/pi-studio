import { createServer } from "node:net";

/** A TCP port nothing listens on at the moment (another process may take it before it is used). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** The status of the daemon's health endpoint, or `null` when nothing answers. */
export async function healthStatus(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) });
    return response.status;
  } catch {
    return null;
  }
}
