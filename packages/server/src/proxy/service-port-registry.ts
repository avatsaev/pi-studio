import { createServer } from "node:net";

import { publicServiceHostname, serviceHostname } from "./service-hostname.js";

/**
 * In-memory service route table + port assignments (features/service-proxy.md § Behavior, § Data).
 * Tied to running `type:"service"` scripts; not persisted across restarts.
 */

export interface ServiceRoute {
  /** Owning script/terminal slot. */
  slot: number;
  script: string;
  branch?: string | null;
  project: string;
  port: number;
  /** All hostnames (localhost + optional public) that map to this route. */
  hostnames: string[];
}

/** Bind to port 0 to obtain a free localhost port, then release it. */
export function assignFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export class ServicePortRegistry {
  private readonly byHostname = new Map<string, ServiceRoute>();
  private readonly bySlot = new Map<number, ServiceRoute>();

  constructor(private readonly publicBaseUrl?: string) {}

  /** Register a route for a started service. Returns the route (incl. generated hostnames). */
  register(args: {
    slot: number;
    script: string;
    branch?: string | null;
    project: string;
    port: number;
  }): ServiceRoute {
    const hostnames = [serviceHostname(args)];
    if (this.publicBaseUrl) hostnames.push(publicServiceHostname(args, this.publicBaseUrl));

    const route: ServiceRoute = { ...args, hostnames };
    for (const hostname of hostnames) this.byHostname.set(hostname.toLowerCase(), route);
    this.bySlot.set(args.slot, route);
    return route;
  }

  /** Deregister + release a route by slot (service stop). */
  unregister(slot: number): boolean {
    const route = this.bySlot.get(slot);
    if (!route) return false;
    for (const hostname of route.hostnames) this.byHostname.delete(hostname.toLowerCase());
    this.bySlot.delete(slot);
    return true;
  }

  /** Look up a route by the raw `Host` header (strips any `:port`). */
  lookup(host: string | undefined): ServiceRoute | undefined {
    if (!host) return undefined;
    const hostname = host.split(":")[0]?.toLowerCase() ?? "";
    return this.byHostname.get(hostname);
  }

  list(): ServiceRoute[] {
    return [...this.bySlot.values()];
  }
}
