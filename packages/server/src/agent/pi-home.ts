import { join, resolve } from "node:path";

import type { PersistedConfig } from "../config/daemon-config.js";
import { expandHome } from "../files/resolve-path.js";

/**
 * The pi-home derivation, standalone (sprint-057/task-005): extracted out of `provider-registry.ts`
 * so a consumer needing only "where does a spawned Pi agent's `~/.pi/agent` tree live" — the
 * extensions sync engine, and now the CLI's `extensions list --local` — never pulls in the real
 * `PiAgentClient`/`MockAgentClient` provider runtime that `provider-registry.ts` also carries.
 * `provider-registry.ts` re-exports {@link resolvePiAgentDir} for its existing import surface; this
 * is the one implementation (moved, not copied) so the path-parity guarantee stays one function in
 * one place.
 */

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
export function piHomeEnv(config: PersistedConfig): Record<string, string> {
  const agentDir = resolvePiAgentDir(config);
  if (!agentDir) return {};
  return {
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions"),
  };
}

/** Resolved `auth.json`/`models.json` paths; `undefined` fields let Pi's own defaults decide.
 *  Mirrors {@link PiAuthPaths} in `packages/cli/src/auth-runtime.ts` — this is the daemon-side
 *  sibling, deliberately not a shared import (that module belongs to a different package). */
export interface PiAuthPaths {
  authPath?: string;
  modelsPath?: string;
}

/**
 * Derive `auth.json`/`models.json` from {@link resolvePiAgentDir} — the single intentional
 * coupling point between the provider-auth RPC family and the spawn path
 * (features/provider-auth-rpc.md § New/changed files). A credential written at this path MUST be
 * the one a daemon-spawned `pi --mode rpc` child reads via `piHomeEnv()`'s
 * `PI_CODING_AGENT_DIR`/`PI_CODING_AGENT_SESSION_DIR`, which is why this derives from the same
 * `resolvePiAgentDir` rather than re-deriving the precedence independently.
 */
export function resolvePiAuthPaths(config: PersistedConfig): PiAuthPaths {
  const agentDir = resolvePiAgentDir(config);
  if (!agentDir) return {};
  return {
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  };
}
