# Task 001 — Summary

- **Sprint:** sprint-056-extensions-sync-engine
- **Status:** done
- **pi version probed:** 0.84.1 (`node_modules/@earendil-works/pi-coding-agent`)

## What was built

No production code (per task scope). Resolved all five open `TODO(verify)` items in
`swe/features/preinstalled-extensions.md` against the live bundled `pi` CLI, and committed one
offline, deterministic test that locks in the read-side half of path parity.

- Created `packages/server/src/extensions/pi-install-behavior.test.ts` — seeds a `settings.json`
  under a temp `PI_CODING_AGENT_DIR` and asserts `pi list` reports it, with no network access and no
  mutation of the seeded file.
- Updated `swe/features/preinstalled-extensions.md` § TODO(verify): flipped four items to `[x]` with
  command + verbatim evidence; left the `unauthorized`-stderr sub-case `[ ]` with an explicit reason
  and the recorded fallback for task 005 (as anticipated by this task's own notes).

## Findings (commands + verbatim evidence)

All probes ran with `PI_CODING_AGENT_DIR` pointed at a fresh `mktemp -d`, never the real `~/.pi`.

**1. Write-path honours `PI_CODING_AGENT_DIR` — RESOLVED, "yes".**
```
$ PI_CODING_AGENT_DIR=$(mktemp -d) node node_modules/@earendil-works/pi-coding-agent/dist/cli.js install npm:pi-powerline-footer
Installing npm:pi-powerline-footer...
added 1 package in 249ms
Installed npm:pi-powerline-footer
$ cat $PI_CODING_AGENT_DIR/settings.json
{
  "packages": [
    "npm:pi-powerline-footer"
  ]
}
```
Written directly at `<PI_CODING_AGENT_DIR>/settings.json` (not `<dir>/agent/settings.json` —
`PI_CODING_AGENT_DIR` already **is** the agent dir, matching `piHomeEnv`'s
`join(piHome, "agent")`). Real `~/.pi/agent` was left untouched (checked before/after). No design
change needed — § Public Contract's write-path story stands as written.

**2. Reinstall idempotency — RESOLVED, "yes, harmless".**
```
$ pi install npm:pi-powerline-footer   # 1st run
added 1 package in 100ms  → exit 0
$ pi install npm:pi-powerline-footer   # 2nd run, same PI_CODING_AGENT_DIR
up to date in 90ms        → exit 0
$ cat settings.json   # unchanged, single entry, no duplicate
{"packages": ["npm:pi-powerline-footer"]}
```

**3. TTY requirement — RESOLVED, "never".** `pi install <spec> < /dev/null` (stdin not a TTY)
completed without hanging for both a successful and a failing install. Additionally,
`grep -c "readline\|createInterface\|inquirer\|prompts(" dist/cli.js` returns `0` — the bundled CLI
has zero interactive-prompt code paths for `install` to reach, on any platform. No extra
non-interactive flag is needed beyond the three env-var guards already in the spec
(`GIT_TERMINAL_PROMPT`, `GIT_SSH_COMMAND`, `npm_config_yes`).

**4. stderr fidelity — PARTIALLY RESOLVED.** 404 case verified verbatim:
```
$ pi install npm:this-package-definitely-does-not-exist-pi-studio-probe-xyz < /dev/null
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/this-package-definitely-does-not-exist-pi-studio-probe-xyz - Not found
...
Error: npm install this-package-definitely-does-not-exist-pi-studio-probe-xyz --prefix .../npm --legacy-peer-deps failed with code 1
$ echo $?
1
```
`npm error code E404` and `404 Not Found` survive verbatim — `classify()` can reliably match
`not_found` on exit code + those markers. The `unauthorized` (401/403) sub-case stays `[ ]`: no
private-registry package exists to probe against (the curated `core` set is all public npm), and a
real `E401`/`E403` needs a registry this runner has no credentials for. Recorded fallback for
task 005: `classify()` pattern-matches `401`/`403`/`E401`/`E403` best-effort with no live
verification; a miss collapsing to `install_failed`/`unknown` is acceptable per spec (classification
is cosmetic, never control flow).

**5. Partial writes on failure — RESOLVED, "never".** Tested both a fresh `PI_CODING_AGENT_DIR`
(no `settings.json` created at all after the 404 above) and an existing one with one prior
successful install (the file is byte-identical before/after the subsequent failed install — no
partial or half-written entry). The planner's `user_removed`/`pending` distinction needs no
revision: an identity is either fully present (successful install) or fully absent.

## Test / verification results

- `npx vitest run packages/server/src/extensions` — 1 test file, 1 test, **pass**.
- `npm run build:server` — pass.
- `npm run typecheck` — pass.
- `npx oxlint packages/server/src/extensions` — clean.
- `npx oxfmt --check packages/server/src/extensions/pi-install-behavior.test.ts` — clean.

## Acceptance criteria

- [x] All five `TODO(verify)` items resolved: four `[x]` with command + verbatim evidence + pi
      version; one (`unauthorized` stderr) left `[ ]` with explicit reason + fallback for task 005.
- [x] `PI_CODING_AGENT_DIR` write-path question answered unambiguously ("yes, honoured") — no design
      change needed.
- [x] Committed offline test proves `pi` reads packages from a seeded `settings.json` under a temp
      `PI_CODING_AGENT_DIR`, no network access.
- [x] `npm test` scope (`packages/server/src/extensions`) passes; nothing committed touches the
      network or the real `~/.pi`.

## Follow-ups for later tasks

- Task 005: `classify()`'s `unauthorized` branch is unverified against a real 401/403 — implement it
  as best-effort pattern matching per the fallback above, do not add a "verified" claim to its tests.
- No other design changes required — every other assumption tasks 003–006 were designed against held.
