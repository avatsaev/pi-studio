# Security read — `core` curated pack

Release-blocking check (swe/features/preinstalled-extensions.md § Acceptance Criteria, § How
updates actually reach users) for every entry Pi-Studio ships unpinned in the `core` pack, before
the first release that includes the manifest (`CURATED_PACKS`, `packages/server/src/extensions/
curated-packs.ts`). Pi packages run with full system access (pi's own docs), and every entry here is
third-party-maintained code Pi-Studio vouches for as a *project*, not a frozen version — see the
manifest's own note on why sources stay unpinned.

Review is **per-project**, not per-version: an upstream release ships to users without a further
Pi-Studio review (accepted, same as any `npm install foo`). This note gets a fresh dated line added
only when a *new* entry is curated, never re-dated for a version bump.

| Entry | Added | Notes |
|-------|-------|-------|
| `npm:@99percentpeople/pi-background-tasks` | 2026-08-13 | Small, focused single-purpose extension (background command execution + attachable PTY/TUI sessions) for the Pi extension ecosystem. No native bindings, no postinstall network calls beyond ordinary npm install. Maintainer is an active, named publisher of several `pi`-ecosystem extensions on npm — not an anonymous one-off. Permissions posture: runs child processes it spawns on the user's behalf (the same trust boundary as the coding agent itself, which already executes shell commands). |
| `npm:pi-memctx` | 2026-08-13 | Memory-context extension: reads/writes a local knowledge store under the user's own pi-home, no external service calls, no telemetry. Package is small and single-purpose. Reviewed for absence of obfuscated code, unexpected `postinstall` scripts, or outbound network calls beyond the declared feature (none found at time of review). |
| `npm:@juicesharp/rpiv-todo` | 2026-08-13 | Pure in-memory/overlay UI extension (todo-list rendering); no filesystem access beyond pi's own extension API, no network calls. Lowest-risk entry in the set — presentation only. |
| `npm:pi-web-access` | 2026-08-13 | Broadest permissions of the five: web search, URL fetch, repo cloning, PDF/YouTube extraction — genuine outbound network access by design (that is the feature). Reviewed as a widely-used, actively maintained extension in the pi ecosystem with a clear, narrow purpose matching its permissions; no unrelated data exfiltration paths found in its declared tool surface. This is the entry future re-reviews should prioritize if its maintenance status changes, given its network-access footprint. |
| `npm:pi-powerline-footer` | 2026-08-13 | Cosmetic status-bar renderer only; no network access, no filesystem access beyond reading session/git status already available to any pi extension. Lowest-risk entry alongside the todo overlay. |

**Process for future entries:** before adding a new `CuratedEntry` to any pack, add a new dated row
here (project + maintainer health, permissions posture — per-project, not per-version) in the same
task/PR that adds the manifest entry. `deprecated: true` tombstones do not need a new row; they stay
whatever was last reviewed while they were live.
