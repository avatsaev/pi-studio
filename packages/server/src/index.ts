// @av-pi-studio/server — the daemon: WS API, agent supervision, stores, relay.
import { PROTOCOL_PACKAGE } from "@av-pi-studio/protocol";

export const SERVER_PACKAGE = "@av-pi-studio/server" as const;

/** Proves the server consumes protocol's emitted declarations. */
export const SERVER_DEPS = [PROTOCOL_PACKAGE] as const;

// File-based JSON persistence (atomic store primitive + entity stores).
export * from "./persistence/index.js";

// Configuration (daemon config.json + per-project pi-studio.json).
export * from "./config/index.js";

// Daemon identity + bootstrap.
export * from "./daemon/index.js";

// HTTP server (host allowlist, health).
export * from "./http/index.js";

// Optional password auth (bcrypt + bearer / WS subprotocol).
export * from "./auth/index.js";

// WebSocket server (handshake, sessions, capability rehydrate, routing).
export * from "./ws/index.js";

// Agent providers, registry, snapshot, and lifecycle manager.
export * from "./agent/index.js";

// Project + workspace registries, key derivation.
export * from "./projects/index.js";

// PTY terminal manager + binary stream.
export * from "./terminal/index.js";

// File explorer + binary file transfer.
export * from "./files/index.js";

// Operational logging (pino + rotating file).
export * from "./logging/index.js";

// Shared utilities (bounded-concurrency helpers).
export * from "./util/index.js";

// Preinstalled-extensions sync engine: pure planning surface only (manifest, planner, state
// reader) — see extensions/index.ts for why the orchestration/executor modules are excluded.
export * from "./extensions/index.js";

// Update engine (npm lookup/install, install kind) — pure/process-control surface only.
export * from "./update/index.js";

// The runtime seam: the argv of every self-spawn, for Node and for the compiled binary.
export * from "./runtime/self.js";
