// @av-pi-studio/protocol — shared wire schemas, codecs, capability flags.
// Depends on no other workspace package (see MAIN-SCOPE.md §3).

/** Protocol package version marker; real wire schemas land in sprint-002. */
export const PROTOCOL_PACKAGE = "@av-pi-studio/protocol" as const;

// Shared validation conventions + base primitive schemas (reused by protocol + persistence).
export * from "./validation.js";

// WebSocket wire schemas: top-level envelopes, handshake, session messages.
export * from "./messages.js";

// Capability flags + serialization-time gating.
export * from "./client-capabilities.js";

// Binary frame codecs (terminal stream + file transfer).
export * from "./binary-frames/index.js";

// Endpoint/host parsing.
export * from "./endpoint.js";

// Provider manifest types.
export * from "./provider-manifest.js";
