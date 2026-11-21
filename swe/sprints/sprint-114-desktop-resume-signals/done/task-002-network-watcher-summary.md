# Task 002 — Network change detection — Summary

- **Sprint:** sprints/sprint-114-desktop-resume-signals
- **Completed:** 2026-11-21
- **Status:** done

## What was implemented
- **Pure detector** (`desktop/crates/shell/src/resume.rs`, wasm-clean): `NetworkWatcher::observe(now_ms, BTreeSet<IpAddr>) -> bool` and `is_settling()`, with `NETWORK_QUIET_MS = 1000` and `NETWORK_PERIOD_MS = 5000`. The first reading is the baseline; a differing reading starts or restarts the quiet timer; after 1 s with the same set it reports once, but only if the set differs from the baseline and still holds at least one address. An empty reading never signals (it becomes the baseline, so the first address that returns signals); a set that returns to the baseline within the quiet second is not a change; a backward steady clock restarts the quiet timer.
- **Rate limit defers, not drops** (found in review of the live check, fixed in the same task): when the shared 5 s limit refuses a signal it stays pending, once per reason, and goes out as soon as the limit allows (`take_pending(now)`, `pending_wait_ms(now)`); the wake ticker flushes every 2 s tick and the network thread shortens its wait to the limit's remaining time. Only emitted events are counted.
- **App thread** (`desktop/apps/pistudiodesktop/src-tauri/src/network.rs`, wired in `main.rs`): thread `network-watcher` reads every 5 s (1 s while settling) with `if_addrs::get_if_addrs`, keeping interfaces that are up and dropping loopback and link-local addresses; emits through `resume::emit(.., Reason::Network, ..)` so it shares the limit and `resumeSignals.network` counts it; a failed reading is skipped and logged once until a reading succeeds; the log says "the network addresses changed (N now)" and never prints addresses; stopped on `RunEvent::Exit`.
- **Dependency:** `if-addrs` 0.15.0 (MIT OR BSD-3-Clause; both licence files are in the package), in the workspace `Cargo.toml` and the app crate only (the shell crate stays wasm-clean); adds only itself to the lock (`libc`, `windows-sys` 0.61.2 were already there). Its code contains `unsafe`; ours does not.
- Docs: `desktop/docs/architecture.md` (resume paragraph, Threads), `desktop/AGENTS.md` (workspace map).

## Results
```
cargo test -p pistudiodesktop-shell -p pistudiodesktop   shell 179, app 55, secret_guard 1 (shell: 9 new for the detector and 4 for deferring; app: 6 new + 1)
live (pi-desktop-xvfb, --cap-add NET_ADMIN, host `ip` mounted, dummy interface dum0, --secret-store file, first version of the task, before the deferring fix):
  before {wake 0, network 0}; add 10.99.0.1/24 -> network 1; add 10.99.1.1, delete it 2 s later, add 10.99.2.1 -> network 3; remove both -> network 4
  log: "the network addresses changed (2 now)", then 3, 3, 1, each followed by "resume signal: network"; no address logged
one reading of get_if_addrs, 200 calls, release, Linux, 4 addresses: min 15 us, median 16 us, max 88 us
```

## Wave gate (orchestrator, combined tree, 2026-11-21)
```
$ (cd desktop && cargo xtask ci)     all 8 steps passed
$ (cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)     exit 0; 120 tests passed
```

## Acceptance criteria
All four met (the live check ran on the first version; the deferring change is covered by tests only: it was not repeated in a container).

## Follow-ups / TODO(verify)
- The macOS and Windows builds of `if-addrs` (the runners show them).
- "Two changes within 5 s give one event" (spec criterion): in the live check three flaps over a few seconds gave three events because each change was separated by more than the limit; the 114/t004 live check measures it.
- The page receiving the event: 114/t004.
