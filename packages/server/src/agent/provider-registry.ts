import type { ProviderDefinition } from "@av-pi-studio/protocol";

import type { PersistedConfig } from "../config/daemon-config.js";
import type { AgentClient } from "./provider-contract.js";
import { PROVIDER_MANIFEST } from "./manifest.js";
import { resolvePiAgentDir, piHomeEnv } from "./pi-home.js";
import { MockAgentClient } from "./providers/mock/mock-provider.js";
import { PiAgentClient } from "./providers/pi/agent.js";
import type { PiTransportFactory } from "./providers/pi/rpc-transport.js";

/** Re-exported for the existing import surface (`provider-registry.test.ts`'s path-parity tests,
 *  and any other in-tree consumer) — the implementation lives in `./pi-home.js` (moved, not
 *  copied), which `extensions-state.ts` and the CLI's `extensions list --local` also import
 *  directly, without pulling in the provider runtime this module carries. */
export { resolvePiAgentDir };

/** Provider client-factory registry (features/agent-providers.md § Registration surface;
 *  config.md § Provider override). */

export interface ProviderClientDeps {
  logger?: Pick<Console, "info" | "warn" | "error">;
  /** Injected for tests. */
  transportFactory?: PiTransportFactory;
  binaryResolver?: (bin: string, env?: Record<string, string | undefined>) => boolean;
}

export type ProviderClientFactory = (deps?: ProviderClientDeps) => AgentClient;

/** Built-in provider factories, invoked with `(logger, runtimeSettings, options)`-style deps. */
export const PROVIDER_CLIENT_FACTORIES: Record<string, ProviderClientFactory> = {
  pi: (deps) =>
    new PiAgentClient({
      transportFactory: deps?.transportFactory,
      binaryResolver: deps?.binaryResolver,
      logger: deps?.logger,
    }),
  mock: () => new MockAgentClient(),
};

/**
 * Resolve a usable `AgentClient` for `providerId` (`pi` or `mock`). `agents.providers.pi` applies
 * its `command` and `env`. Building a client does **not** spawn Pi.
 */
export function resolveProviderClient(
  providerId: string,
  config: PersistedConfig,
  deps?: ProviderClientDeps,
): AgentClient {
  if (providerId === "mock") return new MockAgentClient();
  if (providerId !== "pi") throw new Error(`unknown provider: ${providerId}`);
  const override = config.agents.providers.pi;
  return new PiAgentClient({
    command: override?.command,
    env: { ...piHomeEnv(config), ...override?.env },
    transportFactory: deps?.transportFactory,
    binaryResolver: deps?.binaryResolver,
    logger: deps?.logger,
  });
}

/** Holds the visible provider metadata (the manifest). Never spawns the Pi process. */
export class ProviderRegistry {
  private readonly metadata: Record<string, ProviderDefinition>;

  constructor(manifest: Record<string, ProviderDefinition> = PROVIDER_MANIFEST) {
    this.metadata = { ...manifest };
  }

  getMetadata(providerId: string): ProviderDefinition | undefined {
    return this.metadata[providerId];
  }

  listMetadata(): ProviderDefinition[] {
    return Object.values(this.metadata);
  }
}
