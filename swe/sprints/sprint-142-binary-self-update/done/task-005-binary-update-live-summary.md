# Task 005 — Live check of binary self-update — Summary

- **Sprint:** sprint-142-binary-self-update
- **Completed:** 2026-11-24
- **Status:** done

## What was run
`scripts/binary-update-check/run.mjs` (+ README) in a Node-less `debian:bookworm-slim` container, host-network ports 19xxx, with N=0.0.9001, N+1=0.0.9002, a broken N+2=0.0.9003 (the real build with a wrapper whose `__daemon` exits 3) and a corrupted asset; second run 92 expectations, exit 0, 38 s. Results: new dated section at the top of `packages/server/docs/daemon-update-live-results.md` (Answered/Open list).

| Item | Outcome |
|---|---|
| (a) N → N+1, clients reconnect | Pass: installing → updating_extensions → restarting; reconnected 2 s after apply on the same address; `lastResult updated`. |
| (b) broken N+2 rolled back, skipped, "Check now" offers it | Pass after fix 1; a newer release cleared the skip. |
| (c) binary from another folder | Pass: `cannot_update(unmanaged_binary)`; CLI names the versions folder and release page. |
| (d) corrupted asset | Pass: `failed`, same pid/version, `bin/current` unchanged, `bin/tmp` empty. |
| (e) CLI `update --check` / `update` | Pass: installed 0.0.9004, restarted, pruned to 0.0.9002 + 0.0.9004. |
| Browser (workbench) | Seen: orange pill and dialog ("update failed; the daemon is back on 0.0.9002"), Settings → Daemon with "Single binary" and the rolled-back line. "Update and restart" not clicked. |

## Defects found and fixed
1. A rolled-back version was offered again at once: the helper writes `update-result.json` only after the rolled-back daemon answers, by then its own start check had offered the broken version (all install kinds, npm too). `update-service.ts` withdraws an automatic offer when a late result skips that version; a manual offer stays. Regression tests in `update-service.test.ts` (the first fails without the fix).
2. CI codesign: `codesign -s -` fails "is already signed" on darwin-x64 (found by the PR run, 141/004). `build-binary.mjs` calls `codesign --force -s -` via exported `codesignArgs()`, macOS-host-only; test pins the args.
3. Wrong Settings copy for a binary ("Ask npm…"): `autoCheckHelpText(kind)` says "Look for a newer release…" for the binary; test added.
Also: `build-binary.mjs` gained `--version <x.y.z>` and `--out-dir <dir>` (default build identical; the version rewrite of the three compiled `version.generated.js` is restored byte for byte, also on failure).

## Results
`node --test scripts/build-binary.test.mjs` 8 pass; vitest `packages/server/src/update` 204 pass; wave gate: 329 files / 4695 tests, typecheck, lint 0 errors.

## Acceptance
- [x] All rows recorded; defects fixed with tests.

## Not tried / observations
Update-and-restart click, a relay client, `not_writable`, arm64/macOS builds, the 6 h timer, an unmanaged binary sharing a home with a managed one, the SPA with the copy fix (built before it), npm daemons live for the skip behaviour. A broken version's folder stays until the next successful update prunes it; `pi-studio update` on an unmanaged binary still runs `pi update --extensions` first; a client reconnecting in the first ~0.5 s of a rolled-back daemon could briefly see `available`.
