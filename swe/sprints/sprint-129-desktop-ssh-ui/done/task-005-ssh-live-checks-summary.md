# Task 005 — Linux live checks of SSH entries in the real webview — Summary

- **Sprint:** sprint-129-desktop-ssh-ui
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- Live run on Linux in one `pi-desktop-xvfb` container with three sshd instances (A 127.0.0.1:2222, a jump host 127.0.0.1:2223, the final host 127.0.0.2:22; iptables let only the jump host reach the final host), a loopback-only daemon, an app built from a clean worktree at `c59f025` plus the working-tree `transfers.ts`. Recipe: `desktop/docs/development.md` § The SSH entry in the real webview; results S1-S7 in `desktop/docs/platform-checks.md` § Milestone 4.
- S1 key file, encrypted key with the stored passphrase, ssh-agent, stored password and a config alias each gave `via:"ssh"`, `ssh:{state:"open",hops:0,channels:1}`; through the jump host `hops:1` (the same entry without it: `unreachable`); chat and terminal answered. S2 the native dialog showed host, port, key type and a fingerprint equal to `ssh-keygen -lf`, a jump hop shows "Role: jump host"; OK stored the key (mode 600); Cancel asked nothing more until reload; a changed key gave `host_key_changed` with no dialog and no login. S3 daemon stopped: the screen opened by itself with Start; Start gave `running` in about 1 s. S4 absent: "not installed" with `npm install -g @av-pi-studio/cli` and Copy put exactly that on the clipboard; `pi-studio` only on the interactive-shell PATH: found, Start worked; too old: version plus the same command. S5 the Add form listed `jumpbox`, `cfgalias`, `finalhost` and not the wildcard; choosing `cfgalias` stored only the alias and connected with the config's key. S6 1 GiB: through a 50 MiB/s proxy upload 19.0 s, save 17.9 s; unthrottled 2.2 s (462 MiB/s) and 1.7 s (613 MiB/s); SHA-256 equal across three copies; `peakHeld` 1 048 640 (1 MiB + 64); no new SSH login during the transfer; terminal 18/18 and 19/20; RSS app +1.2/+1.6 MiB, web process +8.6/+8.8 MiB, daemon +66 MiB first upload then +8.3 MiB. S7 never reloaded; every transfer `restarts:1` and equal hash: stop 90 s -> `running` 0.6 s after the continue, no new login; 30 s cut: session survived; 75 s cut: keepalive dropped the channel at 45 s, re-login about 2 s after the path returned, transfer resumed; killing the sshd sessions: back in 1.1 s with one login.
- Secrets scan: neither the SSH password nor the passphrase is in the debug log, `daemons.json`, `settings.json`, `known_hosts` or `ui.inspect`; `secrets.json` has each once.
- Bug found and fixed in the main tree (S2, S3): a page whose first connect failed never started its reconnection manager, so `connection_resume` after Trust or after a remote Start did nothing until Retry. Fix: a closed connection whose manager never started now reconnects with the same action as the bar's Retry (page connected 293 ms after OK). `packages/client/src/reconnect.ts` (`isActive` getter), `packages/workbench/src/lib/connection/{resume-action.ts,resume-handler.ts}`, `src/shell/WorkbenchBoot.tsx`, tests `resume-action.test.ts`, `host/connection.test.ts`, docs `packages/workbench/AGENTS.md`, `packages/client/AGENTS.md`. NOTE: the browser host's `online` and `visibilitychange` events take the same path, so a web-client page that failed its first connect now also reconnects on them.

## Files changed
`desktop/docs/{platform-checks.md,development.md}`, `packages/client/src/reconnect.ts`, `packages/workbench/src/lib/connection/{resume-action.ts,resume-action.test.ts,resume-handler.ts}`, `src/host/connection.test.ts`, `src/shell/WorkbenchBoot.tsx`, `packages/{client,workbench}/AGENTS.md`

## Build & test results
```
live run as above; cd desktop && cargo xtask ci -> all 8 steps passed; npm run build, typecheck ok; lint 0 errors; npm test -> 297 files / 4268 tests passed
```

## Acceptance criteria
- [x] The four logins and the jump host; chat, terminal, `via: "ssh"`; the host-key dialog and a changed key; Start from stopped; not installed with Copy; nvm-like PATH; the config host list; 1 GiB transfers with equal hashes; stop/cont and network cuts.

## Follow-ups
- macOS and Windows not run (owner's decision).
- The jump-host chat and terminal were not repeated on the fixed build.
- Every run used a stand-in `pi-studio` answering `--version` 0.0.127 (the repository's CLI says 0.0.126).
- The unthrottled S6 daemon RSS was not read (wrong PID in the script; fixed for later runs).
- The reconnect fix changes the web-client's behaviour on `online`/`visibilitychange` after a failed first connect: the owner checks the web-client before merging.
