// Preinstalled-extensions sync engine: the pure planning surface (manifest, planner, state
// reader). Deliberately does NOT re-export `extensions-service.ts` (orchestration: mutex, config
// persistence, logging) or `sync-executor.ts` (spawns `pi install`) — those are daemon-only. This
// barrel is what the CLI's `extensions list --local` (sprint-057/task-005) consumes: read-only,
// no process spawns, no writes.
export * from "./curated-packs.js";
export * from "./sync-planner.js";
export * from "./extensions-state.js";
export * from "./wire.js";
