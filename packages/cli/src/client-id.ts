import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the `$PI_STUDIO_HOME` directory (CLI side). Defaults to `~/.pi-studio`.
 * (features/cli.md § Data & Persistence; architecture/config.md.)
 */
export function resolveHome(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.PI_STUDIO_HOME?.trim();
  if (fromEnv) return fromEnv;
  return join(homedir(), ".pi-studio");
}

/**
 * Resolve a stable local client id, persisted under `$PI_STUDIO_HOME/cli-client-id` so the CLI
 * presents the same `clientId` across invocations in its hello handshake. The daemon owns all real
 * state; this id is just a stable identity (features/cli.md § Data & Persistence).
 */
export function resolveClientId(
  home: string = resolveHome(),
  generate: () => string = defaultGenerate,
): string {
  const file = join(home, "cli-client-id");
  try {
    if (existsSync(file)) {
      const existing = readFileSync(file, "utf8").trim();
      if (existing) return existing;
    }
  } catch {
    // Unreadable — fall through and mint a fresh (in-memory) id.
  }

  const id = generate();
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(file, `${id}\n`, "utf8");
  } catch {
    // Best-effort persistence; a non-writable home still yields a usable (ephemeral) id.
  }
  return id;
}

function defaultGenerate(): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `cli-${rand}`;
}
