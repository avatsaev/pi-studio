# Task 005 — Live check of damaged files and the small fixes, and close of M5 — Summary

- **Sprint:** sprints/sprint-156-small-fixes-and-close-m5
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
The final live check of M5, on a worktree of committed HEAD `da95c870` (throwaway homes, spare ports 47441–47447, only the `litellm` key copied; no Pi turn, no money spent), and the documentation close-out.

## Live results
| # | Check | Seen |
|---|---|---|
| 1 | Truncated `config.json`: `start`, `set-password`, `restart`, `--json start`, `--json restart` | each exited 1; plain text names the file ("it has not been changed"); `--json` printed one `{"up":false,"host":"127.0.0.1","port":47441,"error":"config_unreadable"}` line; file byte-identical (`cmp`), nothing listened, no PID file; with the file removed the daemon started, `status` and `stop` worked |
| 2 | `workspaces.json` with 3 good records and 1 bad; a garbage agent record; a dangling symlink in the agents dir; a garbage `viewer-settings.json` | the daemon recovered; the agents dir kept the good record, `garbage.json.corrupt-<ts>` was made; log lines "agent record skipped: dangling symlink" and "damaged file set aside"; after `list_workspaces_request` the set-aside file was byte-identical to the original and the new file held the 3 valid records ("1 of 4 records invalid"); after `viewer_settings_get_request` the file was set aside and the answer was `{version:1,viewers:{}}` |
| 3 | Garbage `daemon-keypair.json` (mode 644), garbage and empty `server-id`, `rotate-key` on a 644 file | key pair replaced at mode 600, original kept as `.corrupt-<ts>`, one error line ("pairing links are revoked"), `daemon pair` made a working link; a non-empty garbage `server-id` is accepted as an id (any non-empty value is valid); an empty one was set aside and a new UUID written; `rotate-key` exit 0, key changed, mode 600, no temp files |
| 4 | Symlink delete; `/`, the home dir, `~`, `…/hm/../hm/`; `file_read` of a FIFO, `/dev/zero`, a 5 MiB + 1 file, a 5 MiB file, a small file, a directory | link removed, target directory and both files stayed; the four protected deletes answered `protected_path` in 0–1 ms; FIFO and `/dev/zero` answered `not_a_file` in 0–1 ms; 5 MiB + 1 answered `file_too_large` (5242881 > 5242880); the 5 MiB and small files read; the directory answered `is_directory` |
| 5 | Extension install failure with a token-bearing source, live and with PATH shims for `git` and `npm install` that print `https://user:SECRETTOKEN@…/pkg?token=SECRETQUERY` and fail | 0 occurrences of `SECRET` in the client answer, `extensions-state.json` and the daemon log in both runs; stored text `…/pkg?token=***`; reasons `unauthorized` and `install_failed`. The installed git and npm already mask URL credentials, so the daemon's own redaction was proven by the shims |
| 6 | Update check on connect, auto-check ON, a fake npm registry (503 until told to serve 9.9.9) and a node TCP relay standing in for `ssh -L`, run for real | the start-up check made request 1 (503) and logged `update: check found no release` (`by: automatic`, `failure: offline`); clients A (direct) and B (relay) at +15 s and +20 s made no request; with the registry serving 9.9.9, client C connected through the relay 10 min 12 s after the last attempt: request 2 (200) came 90 ms after the connect and C got a pushed `daemon_update_status` at +111 ms (`cannot_update`, `reason: source`, `version: 9.9.9`); clients D and E a few seconds later made no request and read 9.9.9; three requests in all |
| 7 | `cargo test -p pistudiodesktop-model -p pistudiodesktop-shell` | 52 + 354 + 1 passed, 0 failed (includes the start-failure reason tests) |
| 8 | `npm run build:binary -- --target linux-x64` and `npm run test:binary`; the binary daemon with a `sleep 311` terminal and a `trap '' HUP TERM INT; sleep 312` terminal, then `kill_terminal_request` and `daemon stop` | build 3.8 s, smoke test passed in 3 s; after `kill_terminal_request` only the HUP/TERM-ignoring `sleep 312` was left (its terminal was not killed yet); after `daemon stop` neither `sleep` remained, the PID file was gone, the port was free |

## Docs
Root `AGENTS.md` (the persistence layout now names `server-id`, `daemon-keypair.json` and agent records as set aside as `.corrupt-<timestamp>`, and says `config.json` is never rewritten), `packages/server/docs/daemon-update-live-results.md` (a dated entry for the connect check). Already truthful and left alone: `packages/server/AGENTS.md`, `swe/architecture/persistence.md`, `packages/cli/README.md`, `packages/cli/AGENTS.md`, `fern/pages/cli/daemon-and-auth.mdx`. The orchestrator updated the handoff (improvements 5, 6, 8; the M5 row) and `PLAN.md`.

## Build & test results
```
Final gate: see the sprint close (build, typecheck, lint, npx vitest run twice, cargo xtask ci)
```

## Acceptance criteria
- [x] Each check seen on a real process; no bug found
- [x] Docs truthful; handoff and PLAN updated

## Follow-ups / TODO(verify)
- **Not checked:** the desktop Daemons screen in a running app (no display); the connect check with the compiled binary and a `PI_STUDIO_DAEMON_UPDATE_URL` channel (the live run used the npm channel on a source install; the shared path is unit-tested); real `git`/`npm` printing a raw token; a pairing link actually used after a key replacement; a two-window web client.
- A non-empty garbage `server-id` is accepted as the id (documented as valid).
- Disclosure: the check's shell briefly kept sandbox `HOME` and `PI_STUDIO_*` values (reset); `/tmp/livecheck/setup.sh` read `~/.pi/agent/auth.json` and `models.json` for four throwaway homes, copying only the `litellm` key; the binary smoke test used its own free port 34411.
