# Task 001 — Memory and rates for relay and SSH transfers, and the checklist — Summary

- **Sprint:** sprint-130-desktop-relay-ssh-close
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- Release build of `6a4b22d` from a clean worktree, WebKitGTK in `pi-desktop-xvfb`, one container per kind; a host-side `/proc` sampler every 150 ms; the daemon PID picked by its environment.
- Rates (MiB/s), 1 GiB up/save and 4 GiB up/save: relay 163.8/151.5 and 163.7/148.3; SSH with the 2 MiB window 597.4/724.2 and 489.4/644.3; SSH with the 8 MiB window 595.7/781.1 and 580.1/634.4; hashes equal everywhere. `peakHeld` 32 768 after the first upload and 1 048 640 (1 MiB + 64) after every save; `opens` 1, `restarts` 0, no `.part` left, no reload.
- App Rust process RSS, peak of 4 GiB minus peak of 1 GiB: relay +2.1/+2.7 MiB, SSH (2 MiB) +7.4/+4.8, SSH (8 MiB) +8.3/+7.5 (mark: below 32 MiB); the largest growth in one transfer +6.2 MiB. Daemon: relay 168.5 -> 246.1 MiB on the first upload (+77.6) then 241-252; SSH 200.7 -> 247.4 (+46.7) then up to 299; no step follows the size.
- SSH channel window: russh defaults were 2 MiB window, 32 KiB packet; at a 40 ms round trip (`tc netem` on the sshd port) saves ran 24-25 MiB/s with 2 MiB, 56-64 with 8 MiB (2.3-2.6x), 16 MiB and a 64 KiB packet gained nothing more. `CHANNEL_WINDOW` is now 8 MiB (`client_config`); the packet size stays at russh's. The terminal's median echo over the delayed link stayed at 90-92 ms.
- Results and recipe in `desktop/docs/platform-checks.md` (§ Transfers: memory and rates) and `desktop/docs/development.md` (§ The 4 GiB comparison for relay and SSH entries).

## Files changed
`desktop/crates/ssh/src/session.rs` (`CHANNEL_WINDOW`), `session/tests.rs` (`every_hop_gets_the_channel_window_and_the_keepalive_of_the_limits`), `desktop/docs/{platform-checks.md,development.md,architecture.md}`, `desktop/AGENTS.md`

## Build & test results
```
live run as above; cd desktop && cargo xtask ci -> all 8 steps passed; npm run build, typecheck ok; npm test -> 4268 passed
Desktop release workflow (manual, publishes nothing) on 6a4b22d: Version, Bundle linux-x64, windows-x64, macos-universal success, Release skipped (run 45081989872)
```

## Acceptance criteria
- [x] Hashes equal; `peakHeld` <= 1 MiB + 64; the Rust process grows less than 32 MiB more for 4 GiB than for 1 GiB (at most +8.3 MiB); rates recorded.

## Follow-ups
- Not measured: a real WAN (one fixed 40 ms model, no loss), the relay over a delay, a jump host, macOS and Windows.
- After a 4 GiB save the sampler's last RSS samples were low (page cache?); peaks were used.
- Daemon memory has no mark (the 94 MiB first-upload growth of milestone 3 is the same effect).
