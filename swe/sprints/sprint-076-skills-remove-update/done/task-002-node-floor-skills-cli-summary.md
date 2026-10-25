# Task 002 — Node floor ≥22.20, pinned `skills` dependency, `skills-cli.ts` — Summary

- **Sprint:** sprint-076-skills-remove-update
- **Completed:** 2026-10-25
- **Status:** done

## What was done

- Bumped root `engines.node` from `>=20` to `>=22.20` (`skills` 1.7.4 declares
  `engines.node >= 22.20.0`, stricter than Pi 1.4.0's own floor — brief D14).
- Installed `skills@1.7.4` as an exact-pinned dependency of `packages/server`
  (`npm install --save-exact skills@1.7.4 -w packages/server`); `package-lock.json` updated and
  committed. `skills` declares `bin: {skills, add-skill} -> ./bin/cli.mjs`, no `exports`/`main`
  (spawn-only), matching the architecture doc's ground truth.
- Updated the single doc line stating the Node floor: `AGENTS.md` § Tech stack
  (`Node.js ≥ 20` → `Node.js ≥ 22.20`). `README.md` and `packages/cli/README.md` were checked
  (`grep -rniE '≥\s*20|>=\s*20\b|node\s*20\b'`) and contain no Node-version statement to update —
  only unrelated `node-pty`/`node -e` mentions.
- Added `packages/server/src/resources/skills-cli.ts`:
  - `resolveSkillsCli()` — mirrors `resolveBundledPiCli()` (`agent/providers/pi/rpc-transport.ts`):
    ESM `import.meta.resolve("skills/package.json")` first, then a `node_modules` walk-up
    fallback (the loader-independent path vitest actually exercises); reads the installed
    package's own `package.json` `bin` rather than hardcoding `bin/cli.mjs`.
  - `skillsArgv(op, …)` — overloaded builder: `add` → `["add","-g","-a","pi","-y","-s",...names,src]`;
    `remove` → `["remove","-g","-y",name]` (never `-a`); `update` → `["update","-g","-y"]`.
  - `spawnEnv(agentDir, cloneTimeoutMs?)` — `PI_CODING_AGENT_DIR`, `GIT_TERMINAL_PROMPT=0`,
    `GIT_SSH_COMMAND="ssh -o BatchMode=yes"`, `npm_config_yes=true`, `DISABLE_TELEMETRY=1`,
    `DO_NOT_TRACK=1`, `SKILLS_CLONE_TIMEOUT_MS` (default `300000`, overridable below the caller's
    item timeout).
- Added `packages/server/src/resources/skills-cli.test.ts` (6 cases): bin resolution equals the
  installed package's declared `bin.skills` path; `add`/`remove`/`update` argv shapes; `remove`
  argv never contains `-a`; `spawnEnv` default and overridden clone timeout.
- Updated `packages/server/AGENTS.md`: added the `skills-cli.ts` entry to the `resources/` source
  tree and a new invariant bullet in § Pi resource management ("the `skills` CLI is a pinned
  exact dependency, resolved, never hardcoded").
- Confirmed no other `packages/*/package.json` declares its own `engines` field (only root).

## Files changed

| File | Change |
|------|--------|
| `package.json` | `engines.node` `>=20` → `>=22.20` |
| `package-lock.json` | `skills@1.7.4` added under `packages/server` |
| `packages/server/package.json` | `"skills": "1.7.4"` dependency (exact-pinned) |
| `packages/server/src/resources/skills-cli.ts` | new — `resolveSkillsCli`, `skillsArgv`, `spawnEnv` |
| `packages/server/src/resources/skills-cli.test.ts` | new — 6 unit tests |
| `AGENTS.md` | Node runtime floor line updated |
| `packages/server/AGENTS.md` | `skills-cli.ts` tree entry + new resources invariant bullet |

## Build & test results

```
$ npx vitest run packages/server/src/resources/skills-cli.test.ts
 ✓ packages/server/src/resources/skills-cli.test.ts (6 tests) 3ms
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(clean, no output)

$ npx tsc -b --force packages/server
(clean, no output)

$ TMPHOME=$(mktemp -d) && HOME="$TMPHOME" PI_CODING_AGENT_DIR="$TMPHOME/.pi" \
    node node_modules/skills/bin/cli.mjs --version
1.7.4
```

## Acceptance criteria checked

- [x] `resolveSkillsCli()` returns the path declared in the installed package's `bin` (test asserts
  equality against `node_modules/skills/package.json`'s `bin.skills`)
- [x] `remove` argv never contains `-a` (asserted directly in the test)
- [x] `npm install` on a clean checkout under Node 22.20 succeeds (ran under Node 24.13, which
  satisfies `>=22.20`; `npm install --save-exact skills@1.7.4 -w packages/server` completed with
  no errors and updated the lockfile)

## Follow-ups

None — out of scope per the task (running any `skills`/`pi` operation is tasks 004-005).
