// @av-pi-studio/client — low-level daemon WS driver + Pi-StudioClient SDK facade.
import { PROTOCOL_PACKAGE } from "@av-pi-studio/protocol";

export const CLIENT_PACKAGE = "@av-pi-studio/client" as const;

/** Proves the client consumes protocol's emitted declarations. */
export const PROTOCOL_DEP = PROTOCOL_PACKAGE;

// Transport abstraction (direct WS; relay rides the same API).
export * from "./transport.js";

// Low-level daemon WebSocket driver.
export * from "./daemon-client.js";

// High-level PiStudioClient SDK facade + handles.
export * from "./pistudio-client.js";

// Terminal-stream router (binary frame demux per slot).
export * from "./terminal-stream-router.js";

// Reconnection + capability-rehydrate driver.
export * from "./reconnect.js";
