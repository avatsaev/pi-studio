import { join, resolve } from "node:path";

import type { ProviderDefinition } from "@av-pi-studio/protocol";

import type { PersistedConfig, ProviderOverride } from "../config/daemon-config.js";
import { expandHome } from "../files/resolve-path.js";
import type { AgentClient, AgentModelDefinition } from "./provider-contract.js";
import { PROVIDER_MANIFEST } from "./manifest.js";
import { MockAgentClient } from "./providers/mock/mock-provider.js";
import { PiAgentClient } from "./providers/pi/agent.js";
import type { PiTransportFactory } from "./providers/pi/rpc-transport.js";

/**
 * Provider client-factory registry + custom Pi-compatible profile resolution
 * (features/agent-providers.md § Registration surface / § Custom Pi-compatible profiles;
 * config.md § Provider override).
 */

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

/** Wrap `listModels` so a custom profile's `models` replaces and `additionalModels` merge/relabel. */
function applyModelOverrides(client: PiAgentClient, override: ProviderOverride): AgentClient {
  if (!override.models && !override.additionalModels) return client;
  const baseList = override.models as AgentModelDefinition[] | undefined;
  const additional = (override.additionalModels as AgentModelDefinition[] | undefined) ?? [];
  const original = client.listModels.bind(client);

  client.listModels = async (opts) => {
    const base = baseList ?? (await original(opts));
    const byId = new Map(base.map((m) => [m.id, m]));
    for (const model of additional) byId.set(model.id, { ...byId.get(model.id), ...model });
    return [...byId.values()];
  };
  return client;
}

/**
 * The one shared derivation of the directory a spawned Pi agent uses for its `~/.pi/agent` tree
 * (features/preinstalled-extensions.md § Public Contract — Effective pi-home key). Precedence:
 * `agents.providers.pi.env.PI_CODING_AGENT_DIR` (wins) > `join(daemon.piHome, "agent")` > Pi's own
 * default. Returns `undefined` for the last case — callers that need an absolute path (the
 * extensions state key, the executor's install env) apply Pi's own default themselves; callers
 * that only add env vars when redirecting (`piHomeEnv` below) treat `undefined` as "add nothing".
 *
 * Both non-default branches are `~`-expanded and resolved to an absolute path (against the
 * daemon's own cwd) *here*, in the one derivation, rather than by each consumer: the bundled Pi
 * CLI's own path handling (`normalizePath`) expands a leading `~/` but never resolves a relative
 * path, so a raw relative or `~`-prefixed value would install into one directory (whatever this
 * process resolves it to) while a spawned agent loads from another (whatever Pi resolves it to)
 * — a silent, permanent install/load split that state's "offered" bookkeeping would never surface
 * or retry. Absolutizing here, once, is what makes the state key (`effectivePiHomeKey`), the
 * executor's install env, and the agent's spawn env provably agree.
 */
export function resolvePiAgentDir(config: PersistedConfig): string | undefined {
  const override = config.agents.providers.pi?.env?.PI_CODING_AGENT_DIR;
  if (override) return resolve(expandHome(override));
  if (config.daemon.piHome) return resolve(expandHome(config.daemon.piHome), "agent");
  return undefined;
}

/** Derive `PI_CODING_AGENT_DIR`/`PI_CODING_AGENT_SESSION_DIR` from {@link resolvePiAgentDir}, so a
 * single Pi-Studio setting redirects the bundled Pi CLI's entire `~/.pi/agent` tree (models.json,
 * auth.json, settings.json, sessions/, …) to a custom directory. */
function piHomeEnv(config: PersistedConfig): Record<string, string> {
  const agentDir = resolvePiAgentDir(config);
  if (!agentDir) return {};
  return {
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions"),
  };
}

function buildPiClient(
  providerId: string,
  override: ProviderOverride | undefined,
  config: PersistedConfig,
  deps?: ProviderClientDeps,
): AgentClient {
  const client = new PiAgentClient({
    provider: providerId,
    command: override?.command,
    env: { ...piHomeEnv(config), ...override?.env },
    sessionDir:
      override?.params && typeof override.params.sessionDir === "string"
        ? override.params.sessionDir
        : undefined,
    transportFactory: deps?.transportFactory,
    binaryResolver: deps?.binaryResolver,
    logger: deps?.logger,
  });
  return override ? applyModelOverrides(client, override) : client;
}

/**
 * Resolve a usable `AgentClient` for `providerId`. Built-ins use their factory; an override of `pi`
 * applies its settings; a custom `extends:"pi"` profile launches via its own `command` and locates
 * imports via `params.sessionDir`. Building a client does **not** spawn Pi.
 */
export function resolveProviderClient(
  providerId: string,
  config: PersistedConfig,
  deps?: ProviderClientDeps,
): AgentClient {
  const override = config.agents.providers[providerId];

  if (providerId === "pi") return buildPiClient("pi", override, config, deps);
  if (providerId === "mock") return new MockAgentClient();

  if (override?.extends === "pi") return buildPiClient(providerId, override, config, deps);

  const factory = PROVIDER_CLIENT_FACTORIES[providerId];
  if (factory) return factory(deps);
  throw new Error(`unknown provider: ${providerId}`);
}

/**
 * Holds visible provider metadata (manifest + config overrides). Replacing metadata updates
 * label/description/enabled/default-mode only — it must **never** spawn the Pi process.
 */
export class ProviderRegistry {
  private metadata: Record<string, ProviderDefinition>;

  constructor(manifest: Record<string, ProviderDefinition> = PROVIDER_MANIFEST) {
    this.metadata = { ...manifest };
  }

  getMetadata(providerId: string): ProviderDefinition | undefined {
    return this.metadata[providerId];
  }

  listMetadata(): ProviderDefinition[] {
    return Object.values(this.metadata);
  }

  /** Merge config provider overrides into visible metadata. Does not construct/launch any client. */
  replaceMetadata(config: PersistedConfig): void {
    for (const [id, override] of Object.entries(config.agents.providers)) {
      const base = this.metadata[id] ?? this.metadata.pi;
      const capabilities = base?.capabilities ?? this.metadata.pi?.capabilities;
      if (!capabilities) continue;
      this.metadata[id] = {
        ...base,
        id,
        label: override.label ?? base?.label ?? id,
        description: override.description ?? base?.description,
        capabilities,
        modes: base?.modes ?? [],
      };
    }
  }
}
