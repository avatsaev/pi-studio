import { type IncomingMessage, request as httpRequest, type ServerResponse } from "node:http";

import { ServicePortRegistry } from "./service-port-registry.js";

/**
 * HTTP service proxy (features/service-proxy.md § Behavior; architecture/config.md
 * `daemon.serviceProxy`). Localhost service routes are always on; the optional public alias + a
 * separate service-only listener are gated by config. Proxied service traffic is NOT gated by daemon
 * password auth.
 */

export interface ServiceProxyConfig {
  listen?: string;
  publicBaseUrl?: string;
  /** `false` suppresses ONLY the optional public/listen layers; the localhost proxy stays on. */
  enabled: boolean;
}

/** Resolve effective config from the persisted daemon config + env overrides (env wins). */
export function resolveServiceProxyConfig(
  daemonServiceProxy: { listen?: string; publicBaseUrl?: string; enabled?: boolean } | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ServiceProxyConfig {
  const listen = env.PI_STUDIO_SERVICE_PROXY_LISTEN ?? daemonServiceProxy?.listen;
  const publicBaseUrl =
    env.PI_STUDIO_SERVICE_PROXY_PUBLIC_BASE_URL ?? daemonServiceProxy?.publicBaseUrl;
  const enabledEnv = env.PI_STUDIO_SERVICE_PROXY_ENABLED;
  const enabled =
    enabledEnv !== undefined
      ? enabledEnv === "true" || enabledEnv === "1"
      : daemonServiceProxy?.enabled !== false;
  return { listen, publicBaseUrl, enabled };
}

export class ServiceProxy {
  readonly registry: ServicePortRegistry;
  private readonly config: ServiceProxyConfig;

  constructor(config: ServiceProxyConfig) {
    this.config = config;
    // Public aliases are an optional layer → only when enabled.
    this.registry = new ServicePortRegistry(config.enabled ? config.publicBaseUrl : undefined);
  }

  /** Optional separate service-only listener address (only when enabled + configured). */
  get listenAddress(): string | undefined {
    return this.config.enabled ? this.config.listen : undefined;
  }

  /**
   * Try to handle a request as service traffic. Returns true when the Host matched a service route
   * and the request was reverse-proxied; false when the caller should fall through to normal daemon
   * handling. The `Host` header is forwarded UNCHANGED (routing depends on it).
   */
  handleRequest(req: IncomingMessage, res: ServerResponse): boolean {
    const route = this.registry.lookup(req.headers.host);
    if (!route) return false;

    const proxyReq = httpRequest(
      {
        host: "127.0.0.1",
        port: route.port,
        method: req.method,
        path: req.url,
        headers: req.headers, // Host forwarded unchanged
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on("error", () => {
      // Service not yet listening / crashed → 502 (do not crash the daemon).
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("service unavailable");
    });
    req.pipe(proxyReq);
    return true;
  }
}
