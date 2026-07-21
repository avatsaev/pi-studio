import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";

import { z } from "zod";

/**
 * Daemon config (`$PI_STUDIO_HOME/config.json`) — architecture/config.md § Daemon config,
 * § Env precedence, § Behavior; MAIN-SCOPE.md §6.
 *
 * Every field is optional with a sensible default, so a missing or `{}` config yields a fully
 * populated object. Legacy shapes (`allowedHosts`, provider `command:{mode,…}`) are normalized
 * inline on load (no migration framework). Environment variables overlay the parsed config (env
 * wins) for the keys enumerated in config.md.
 */

// ---------------------------------------------------------------------------
// Provider overrides (agents.providers.{id})
// ---------------------------------------------------------------------------

/** Provider ids: `/^[a-z][a-z0-9-]*$/`. */
export const providerIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, "invalid provider id");

/** A custom Pi-compatible provider profile, or an override of the built-in `pi` provider. */
export const providerOverrideSchema = z.object({
  extends: z.literal("pi").optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  command: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  models: z.array(z.unknown()).optional(),
  additionalModels: z.array(z.unknown()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  order: z.number().optional(),
});
export type ProviderOverride = z.infer<typeof providerOverrideSchema>;

/** The only built-in provider id; everything else under `agents.providers` is a custom profile. */
const BUILTIN_PROVIDER_IDS = new Set(["pi"]);

/**
 * `agents.providers` map. Keys must match the provider-id pattern. A *custom* profile (any id other
 * than a built-in) must declare `extends:"pi"` and a `label`; overriding the built-in `pi` does not.
 */
export const providersRecordSchema = z
  .record(providerIdSchema, providerOverrideSchema)
  .superRefine((record, ctx) => {
    for (const [id, override] of Object.entries(record)) {
      if (BUILTIN_PROVIDER_IDS.has(id)) continue;
      if (override.extends !== "pi") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `custom provider "${id}" must set extends:"pi"`,
          path: [id, "extends"],
        });
      }
      if (!override.label) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `custom provider "${id}" must set a label`,
          path: [id, "label"],
        });
      }
    }
  });

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
        mcp: z
          .object({
            enabled: z.boolean().default(true),
            injectIntoAgents: z.boolean().default(true),
          })
          .default({}),
        appendSystemPrompt: z.string().default(""),
        cors: z.object({ allowedOrigins: z.array(z.string()).default([]) }).default({}),
        relay: z
          .object({
            enabled: z.boolean().default(false),
            endpoint: z.string().optional(),
            publicEndpoint: z.string().optional(),
            useTls: z.boolean().default(false),
            publicUseTls: z.boolean().default(false),
          })
          .default({}),
        auth: z.object({ password: z.string().optional() }).default({}),
        serviceProxy: z
          .object({
            listen: z.string().optional(),
            publicBaseUrl: z.string().optional(),
            enabled: z.boolean().optional(),
          })
          .default({}),
      })
      .default({}),
    app: z.object({ baseUrl: z.string().optional() }).default({}),
    worktrees: z.object({ root: z.string().optional() }).default({}),
    providers: z
      .object({ local: z.object({ modelsDir: z.string().optional() }).default({}) })
      .default({}),
    agents: z
      .object({
        providers: providersRecordSchema.default({}),
        metadataGeneration: z
          .object({ providers: z.array(metadataGenerationProviderSchema).default([]) })
          .default({}),
      })
      .default({}),
    log: z
      .object({
        level: z.string().default("info"),
        format: z.string().default("json"),
        console: z.record(z.string(), z.unknown()).default({}),
        file: z
          .object({
            level: z.string().optional(),
            path: z.string().optional(),
            rotate: z
              .object({ maxSize: z.string().optional(), maxFiles: z.number().optional() })
              .default({}),
          })
          .default({}),
      })
      .default({}),
  })
  .default({});

export type PersistedConfig = z.infer<typeof persistedConfigSchema>;

// ---------------------------------------------------------------------------
// Legacy normalization (inline; no migration framework)
// ---------------------------------------------------------------------------

/**
 * Migrate a legacy provider override. The old `command` was an object `{ mode, command?, args? }`;
 * the current shape is a `string[]`. The `mode` wrapper is dropped (rpc is implicit).
 *
 * COMPAT(legacy-provider-command): inline; remove when no config.json carries the object form.
 */
function migrateProviderSettings(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const override = { ...(value as Record<string, unknown>) };
  const command = override.command;
  if (command && !Array.isArray(command) && typeof command === "object") {
    const legacy = command as Record<string, unknown>;
    const base =
      typeof legacy.command === "string"
        ? [legacy.command]
        : Array.isArray(legacy.command)
          ? legacy.command
          : [];
    const args = Array.isArray(legacy.args) ? legacy.args : [];
    const merged = [...base, ...args].filter((part): part is string => typeof part === "string");
    if (merged.length > 0) override.command = merged;
    else delete override.command;
  }
  return override;
}

/** Normalize a raw config object before schema validation. */
export function migrateConfig(raw: unknown): unknown {
  const root = { ...(raw as Record<string, unknown>) };
  const daemon = { ...(root.daemon as Record<string, unknown>) };

  // COMPAT(legacy-allowed-hosts): `allowedHosts` → `hostnames` (daemon-level or top-level).
  if (daemon.hostnames === undefined) {
    if (daemon.allowedHosts !== undefined) daemon.hostnames = daemon.allowedHosts;
    else if (root.allowedHosts !== undefined) daemon.hostnames = root.allowedHosts;
  }
  delete daemon.allowedHosts;
  delete root.allowedHosts;
  root.daemon = daemon;

  const agents = { ...(root.agents as Record<string, unknown>) };
  const providers = agents.providers;
  if (providers && typeof providers === "object" && !Array.isArray(providers)) {
    const migrated: Record<string, unknown> = {};
    for (const [id, override] of Object.entries(providers)) {
      migrated[id] = migrateProviderSettings(override);
    }
    agents.providers = migrated;
  }
  if (Object.keys(agents).length > 0) root.agents = agents;

  return root;
}

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

  if (env.PI_STUDIO_SERVICE_PROXY_LISTEN) {
    next.daemon.serviceProxy.listen = env.PI_STUDIO_SERVICE_PROXY_LISTEN;
  }
  if (env.PI_STUDIO_SERVICE_PROXY_PUBLIC_BASE_URL) {
    next.daemon.serviceProxy.publicBaseUrl = env.PI_STUDIO_SERVICE_PROXY_PUBLIC_BASE_URL;
  }
  if (env.PI_STUDIO_SERVICE_PROXY_ENABLED !== undefined) {
    next.daemon.serviceProxy.enabled = envBool(env.PI_STUDIO_SERVICE_PROXY_ENABLED);
  }

  return next;
}

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

/**
 * Load and normalize `config.json`: read JSON (or `{}` when missing/corrupt), migrate legacy
 * shapes, validate with {@link persistedConfigSchema}, then overlay env vars. Throws if the parsed
 * config is structurally invalid (e.g. a bad provider id or a custom provider missing extends/label).
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
  const parsed = persistedConfigSchema.parse(migrateConfig(raw));
  return overlayEnv(parsed, env);
}
