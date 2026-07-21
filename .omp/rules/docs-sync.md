---
description: After modifying code in this project, the related README.md and AGENTS.md files MUST be updated in the same change
alwaysApply: true
---

# Docs sync on code changes

After modifying code in this project, you MUST update the related `README.md` and `AGENTS.md`
files **in the same change** — before yielding. Docs are deliverables, not follow-ups.

## Which docs to update

| Code changed | Docs to check |
|---|---|
| `packages/<pkg>/src/**` | `packages/<pkg>/AGENTS.md`, `packages/<pkg>/README.md` (if it exists) |
| Cross-package or monorepo-level change (build, layout, tooling, new package) | root `AGENTS.md`, root `README.md` |
| `packages/protocol/**` (wire schema) | `packages/protocol/AGENTS.md` + root `AGENTS.md` protocol section |
| `docker/**` | `docker/README.md` + root `README.md` / `AGENTS.md` docker sections |

## What "updated" means

Keep these sections truthful against the code you just changed:

- **Source layout trees** — new/removed/renamed files (one line each: name + responsibility).
- **Public API signatures** — changed options, new exports, new events/hooks.
- **Commands & env vars** — new CLI flags, commands, `PI_STUDIO_*` variables (with defaults).
- **Invariants & conventions** — if your change alters a stated invariant, rewrite it; never leave a contradicted invariant in place.
- **Testing sections** — new test files worth naming.

## Rules

- If nothing documented actually changed (pure internal refactor, test-only change), say so
  explicitly instead of editing docs for churn's sake.
- Never document aspirational behavior — only what the code does now.
- Match the existing doc's structure and voice; don't reformat sections you're not touching.
