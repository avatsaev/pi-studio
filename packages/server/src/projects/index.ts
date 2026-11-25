// Project + workspace registries and key derivation.
export * from "./workspace-registry.js";

// Open-project flow, git detection.
export * from "./git-detect.js";
export * from "./open-project.js";

// Pi-Studio worktree service (create/setup, archive/teardown, auto-archive coupling).
export * from "./worktree-service.js";

// Git status/diff projections + streaming.
export * from "./status-projection.js";
export * from "./workspace-git-service.js";
export * from "./checkout-diff-manager.js";
export * from "./git-checkout-rpc.js";

// Git mutation operations (commit/branch/merge/pull/push/stash).
export * from "./git-operations.js";

// GitHub PR operations + auto-archive-on-merge.
export * from "./github-service.js";
