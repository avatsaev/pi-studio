import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/** A local HTTP server for tests; `handler` answers every request. */
export interface HttpFixture {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  requests: string[];
  close(): Promise<void>;
}

export async function startHttpFixture(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<HttpFixture> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? "");
    handler(req, res);
  });
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", resolve);
  await promise;
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () => {
      const closed = Promise.withResolvers<void>();
      server.closeAllConnections();
      server.close(() => closed.resolve());
      return closed.promise;
    },
  };
}
