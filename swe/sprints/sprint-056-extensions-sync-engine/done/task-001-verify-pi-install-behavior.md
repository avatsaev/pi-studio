# Task 001 — Verify live `pi install` behavior before building on it

- **Sprint:** sprint-056-extensions-sync-engine
- **Status:** done
- **Type:** test + docs
- **Area:** packages/server (extensions — verification only); `swe/features/preinstalled-extensions.md`
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Resolve the five open `TODO(verify)` items against the **bundled** Pi CLI and record the observed
facts in the spec, so tasks 003–006 are designed against measured behavior rather than assumptions.

## Context / why

The spec's whole path-parity guarantee — *install location == the location a daemon-spawned
`pi --mode rpc` agent loads from* — rests on one unverified claim: that `pi install` writes the
**global** settings file under `PI_CODING_AGENT_DIR`. Pi's own packages doc only names the literal
`~/.pi/agent/settings.json`. If the env var is not honoured on the **write** path, the executor needs
a different redirection mechanism and § Public Contract's effective-pi-home story must be rewritten —
invalidating tasks 003–006 *after* they were built. One small task up front is far cheaper than that
discovery in task 006.

Four smaller unknowns feed directly into later design decisions:

- **Reinstall idempotency** — the benign cross-process race stance (§ Concurrency) assumes
  `pi install <same spec>` twice is a harmless success.
- **TTY requirement** — any interactive prompt hangs a headless daemon's sync for the full 180 s
  per-package timeout.
- **stderr fidelity** — if pi swallows npm's own `404`/`E401`/`ETIMEDOUT` markers behind a generic
  message, `classify()` collapses to `install_failed`/`unknown` and task 005's `reason` taxonomy
  loses most of its value (acceptable per spec — classification is cosmetic, never control flow —
  but the acceptance criteria must then be relaxed to match reality, not aspiration).
- **Partial writes** — whether a failed install can leave an entry in `settings.json`, which affects
  how honest the planner's `user_removed`/`pending` distinction is for that identity.

## Scope references

- `swe/features/preinstalled-extensions.md` § TODO(verify) (the five unchecked items),
  § Executor — per-package failure isolation, § Public Contract (Effective pi-home key)
- `packages/server/src/agent/providers/pi/rpc-transport.ts:66` — `resolveBundledPiCli()`, the binary
  under test
- `packages/server/src/agent/provider-registry.ts:57-64` — `piHomeEnv()`, the exact env shape spawned
  agents receive (`PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`)
- `packages/server/src/agent/providers/pi/transport-errors.test.ts:82-86` — precedent for asserting
  against the real bundled binary in a committed test
- Create: `packages/server/src/extensions/pi-install-behavior.test.ts`

## What to build

Manual probes + recorded findings, plus one **offline, deterministic** committed test. **No
production code in this task.**

1. **Probe** each open item against the bundled CLI (`node <resolveBundledPiCli()> install …`) with
   `PI_CODING_AGENT_DIR` pointed at a scratch temp dir, never the real `~/.pi`:
   - Where the global settings file is actually written (the load-bearing question).
   - `pi install <same spec>` run twice — exit code, and whether `settings.json` gains a duplicate
     entry.
   - Non-interactive invocation (stdin not a TTY) — completes, or prompts.
   - stderr for a 404 spec and for an auth-required spec — how much npm text survives verbatim.
   - `settings.json` contents after a **failed** install.
2. **Record** every result in the spec's § TODO(verify), flipping each item to `[x]` with the command,
   a verbatim output excerpt, and the pi version — matching how the two already-verified items are
   written. An item that genuinely cannot be settled stays `[ ]` with a one-line reason **and** the
   fallback task 005 must then take.
3. **Commit the offline half as a test**: seed a `settings.json` under a temp `PI_CODING_AGENT_DIR`
   and assert the bundled `pi` **reads** its packages from there (read-side command, e.g. `pi list`).
   This locks in half of path parity with no network and no registry.

## Out of scope

- Any manifest, planner, executor, config, or state-store code (tasks 002–006).
- Committing any test that installs from the real registry — the root suite must stay offline,
  deterministic, and full-suite-safe.
- Changing `piHomeEnv`/`provider-registry.ts` (task 003 owns the shared derivation).

## Acceptance criteria

- [ ] All five `TODO(verify)` items are `[x]` with command + verbatim evidence + the pi version they
      were checked against, or `[ ]` with an explicit reason and a stated fallback for task 005.
- [ ] The `PI_CODING_AGENT_DIR` **write-path** question is answered unambiguously. If the answer is
      "not honoured", § Public Contract and § Executor are amended **in this task** and the summary
      calls it out as a design change for tasks 003/005.
- [ ] A committed offline test proves the bundled `pi` reads packages from a `settings.json` under a
      temp `PI_CODING_AGENT_DIR`; it passes with no network access.
- [ ] `npm test` passes; nothing added here touches the network or the real `~/.pi`.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: create `packages/server/src/extensions/pi-install-behavior.test.ts`; run
  `npx vitest run packages/server/src/extensions`; all pass.
- Manual: record each probe's exact command and output excerpt in the task summary as well as in the
  spec.

## Notes

- Record `pi --version` alongside the findings — the spec's two verified items cite pi 0.84.1, and a
  future bump can invalidate them.
- Probe with a real but tiny package (one of the five `core` entries is fine) and a deliberately
  bogus one; never probe against the user's real `~/.pi`.
- If any `pi install` path can prompt, capture exactly which one — task 005 must force
  non-interactive mode for it, beyond the `GIT_TERMINAL_PROMPT`/`GIT_SSH_COMMAND`/`npm_config_yes`
  guards already in the spec.
- The `unauthorized` stderr probe has no natural target now that no private package is curated — a
  real npm `E401` needs a registry you lack rights to. Expect that half of the stderr-fidelity item
  to stay `[ ]`; the recorded fallback is task 005 treating the `unauthorized` classify case as
  best-effort (collapsing to `install_failed`/`unknown` is acceptable).
