import { chmodSync, existsSync } from "node:fs";
import { readFileSync } from "node:fs";

import { z } from "zod";

import { atomicWriteJson } from "../persistence/atomic-store.js";

/**
 * Daemon config (`$PI_STUDIO_HOME/config.json`) — architecture/config.md § Daemon config,
 * § Env precedence, § Behavior; MAIN-SCOPE.md §6.
 *
 * Every field is optional with a sensible default, so a missing or `{}` config yields a fully
 * populated object. Environment variables overlay the parsed config (env
 * wins) for the keys enumerated in config.md.
 */

// ---------------------------------------------------------------------------
// Provider overrides (agents.providers.{id})
// ---------------------------------------------------------------------------

/** The built-in `pi` provider's launch settings. */
export const providerOverrideSchema = z.object({
  command: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});
export type ProviderOverride = z.infer<typeof providerOverrideSchema>;

/**
 * `agents.providers` map: only the built-in `pi` entry. Any other key is a config error, because
 * agent records point at a provider id and ignoring the entry would only move the failure to the
 * agent's next start.
 */
export const providersRecordSchema = z
  .record(z.string(), z.unknown())
  .superRefine((record, ctx) => {
    for (const id of Object.keys(record)) {
      if (id === "pi") continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'only "pi" is supported',
        path: [id],
      });
    }
  })
  .pipe(z.object({ pi: providerOverrideSchema.optional() }));

export const metadataGenerationProviderSchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
  thinkingOptionId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// PersistedConfigSchema
// ---------------------------------------------------------------------------

const hostnamesSchema = z.union([z.literal(true), z.array(z.string())]);
export type Hostnames = z.infer<typeof hostnamesSchema>;

export const persistedConfigSchema = z
  .object({
    version: z.number().default(1),
    daemon: z
      .object({
        listen: z.string().default("127.0.0.1:6767"),
        hostnames: hostnamesSchema.default(["localhost", "*.localhost"]),
        /** Developer switch: browser `Origin`s the direct WS port accepts (exact match). Default: none. */
        devAllowedOrigins: z.array(z.string()).default([]),
        relay: z
          .object({
            enabled: z.boolean().default(false),
            endpoint: z.string().optional(),
            publicEndpoint: z.string().optional(),
            useTls: z.boolean().default(false),
            publicUseTls: z.boolean().default(false),
          })
          .default({}),
        /** Overrides the bundled Pi CLI's own config dir (PI_CODING_AGENT_DIR/…SESSION_DIR). */
        piHome: z.string().optional(),
        auth: z.object({ password: z.string().optional() }).default({}),
        /** Preinstalled-extensions sync (features/preinstalled-extensions.md § Daemon config). */
        extensions: z
          .object({
            autoSync: z.boolean().default(true),
            /** Selected audience packs, additive to the always-implicit `core`. */
            packs: z.array(z.string()).default([]),
          })
          .default({}),
        /** Daemon self-update (features/self-update.md § Check). */
        update: z.object({ autoCheck: z.boolean().default(true) }).default({}),
      })
      .default({}),
    app: z.object({ baseUrl: z.string().optional() }).default({}),
    agents: z
      .object({
        providers: providersRecordSchema.default({}),
        metadataGeneration: z
          .object({ providers: z.array(metadataGenerationProviderSchema).default([]) })
          .default({}),
      })
      .default({}),
  })
  .default({});

export type PersistedConfig = z.infer<typeof persistedConfigSchema>;

// ---------------------------------------------------------------------------
// Environment overlay (env wins)
// ---------------------------------------------------------------------------

type Env = Record<string, string | undefined>;

function envBool(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Overlay environment variables onto a parsed config (env wins) for the keys enumerated in
 * config.md § Env precedence.
 */
export function overlayEnv(config: PersistedConfig, env: Env): PersistedConfig {
  const next: PersistedConfig = structuredClone(config);

  if (env.PI_STUDIO_LISTEN) next.daemon.listen = env.PI_STUDIO_LISTEN;
  if (env.PI_STUDIO_PASSWORD) next.daemon.auth.password = env.PI_STUDIO_PASSWORD;
  if (env.PI_STUDIO_PI_HOME) next.daemon.piHome = env.PI_STUDIO_PI_HOME;

  if (env.PI_STUDIO_HOSTNAMES !== undefined) {
    const raw = env.PI_STUDIO_HOSTNAMES.trim();
    next.daemon.hostnames =
      raw.toLowerCase() === "true"
        ? true
        : raw
            .split(",")
            .map((h) => h.trim())
            .filter((h) => h.length > 0);
  }

  if (env.PI_STUDIO_DEV_ALLOWED_ORIGINS !== undefined) {
    next.daemon.devAllowedOrigins = env.PI_STUDIO_DEV_ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
  }

  if (env.PI_STUDIO_RELAY_ENABLED !== undefined) {
    next.daemon.relay.enabled = envBool(env.PI_STUDIO_RELAY_ENABLED);
  }
  if (env.PI_STUDIO_RELAY_ENDPOINT) next.daemon.relay.endpoint = env.PI_STUDIO_RELAY_ENDPOINT;
  if (env.PI_STUDIO_RELAY_PUBLIC_ENDPOINT) {
    next.daemon.relay.publicEndpoint = env.PI_STUDIO_RELAY_PUBLIC_ENDPOINT;
  }
  if (env.PI_STUDIO_RELAY_USE_TLS !== undefined) {
    next.daemon.relay.useTls = envBool(env.PI_STUDIO_RELAY_USE_TLS);
  }
  if (env.PI_STUDIO_RELAY_PUBLIC_USE_TLS !== undefined) {
    next.daemon.relay.publicUseTls = envBool(env.PI_STUDIO_RELAY_PUBLIC_USE_TLS);
  }

  if (env.PI_STUDIO_APP_BASE_URL) next.app.baseUrl = env.PI_STUDIO_APP_BASE_URL;

  if (env.PI_STUDIO_EXTENSIONS_AUTOSYNC !== undefined) {
    const v = env.PI_STUDIO_EXTENSIONS_AUTOSYNC.trim().toLowerCase();
    next.daemon.extensions.autoSync = !(v === "false" || v === "0");
  }
  if (env.PI_STUDIO_EXTENSION_PACKS !== undefined) {
    next.daemon.extensions.packs = env.PI_STUDIO_EXTENSION_PACKS.split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }
  if (env.PI_STUDIO_UPDATE_AUTOCHECK !== undefined) {
    const v = env.PI_STUDIO_UPDATE_AUTOCHECK.trim().toLowerCase();
    next.daemon.update.autoCheck = !(v === "false" || v === "0");
  }

  return next;
}

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

/**
 * Load `config.json`: read JSON (or `{}` when missing/corrupt), validate with
 * {@link persistedConfigSchema}, then overlay env vars. Throws if the parsed
 * config is structurally invalid (e.g. an `agents.providers` key other than `pi`).
 */
export function loadConfig(path: string, env: Env = process.env): PersistedConfig {
  let raw: unknown = {};
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      raw = {};
    }
  }
  const result = persistedConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      result.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`).join("; "),
    );
  }
  const parsed = result.data;
  return overlayEnv(parsed, env);
}

// ---------------------------------------------------------------------------
// persistExtensionPacks
// ---------------------------------------------------------------------------

/**
 * Persist `daemon.extensions.packs` into `configPath`, merging into the RAW file contents — never a
 * loaded (env-overlaid) config. Creates the file/dir when missing. Written 0600: config.json can
 * carry the daemon password hash.
 *
 * Reads the raw JSON (`{}` when the file is missing or unparseable — never throw the caller's RPC
 * away over a corrupt config), sets `daemon.extensions.packs`, writes atomically, then ensures mode
 * `0600` (mode only applies on create, so re-chmod like the CLI does for files written before the
 * rule).
 */
export async function persistExtensionPacks(
  configPath: string,
  packs: readonly string[],
): Promise<void> {
  // Read raw JSON: file missing or parse error → treat as {}
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    } catch {
      config = {};
    }
  }

  // Merge only daemon.extensions.packs; preserve all other keys
  const daemon = (config.daemon as Record<string, unknown> | undefined) ?? {};
  const extensions = (daemon.extensions as Record<string, unknown> | undefined) ?? {};
  extensions.packs = Array.from(packs);
  daemon.extensions = extensions;
  config.daemon = daemon;

  // Write atomically via permissive schema (do NOT round-trip persistedConfigSchema)
  await atomicWriteJson(configPath, config, z.record(z.string(), z.unknown()));

  // Re-chmod to 0600 (best-effort, mirrors CLI pattern)
  try {
    chmodSync(configPath, 0o600);
  } catch {
    /* best-effort */
  }
}

/**
 * Persist `daemon.update.autoCheck` into `configPath` with the same raw read-merge-write as
 * {@link persistExtensionPacks}: unknown keys survive, env overrides are never written.
 */
export async function persistUpdateAutoCheck(configPath: string, enabled: boolean): Promise<void> {
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    } catch {
      config = {};
    }
  }

  const daemon = (config.daemon as Record<string, unknown> | undefined) ?? {};
  const update = (daemon.update as Record<string, unknown> | undefined) ?? {};
  update.autoCheck = enabled;
  daemon.update = update;
  config.daemon = daemon;

  await atomicWriteJson(configPath, config, z.record(z.string(), z.unknown()));

  try {
    chmodSync(configPath, 0o600);
  } catch {
    /* best-effort */
  }
}
