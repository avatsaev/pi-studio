// @av-pi-studio/cli — Commander.js terminal client; can manage a local daemon.
import { PROTOCOL_PACKAGE } from "@av-pi-studio/protocol";

export const CLI_PACKAGE = "@av-pi-studio/cli" as const;

/** Proves the cli consumes protocol's emitted declarations. */
export const PROTOCOL_DEP = PROTOCOL_PACKAGE;

// CLI core: connection, output rendering, dispatch helpers, exit codes.
export * from "./client-id.js";
export * from "./output.js";
export * from "./connection.js";
export * from "./cli-core.js";
export * from "./agent-commands.js";
export * from "./pairing.js";
export * from "./qr.js";
export * from "./daemon-control.js";
export * from "./daemon-commands.js";
export * from "./feature-commands.js";
export * from "./program.js";
