# Task 004 — Linux live checks of a relay entry in the real webview — Summary

- **Sprint:** sprint-126-desktop-relay-wiring
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- Ran the release app built from a clean worktree at `5dec876` in the `pi-desktop-xvfb` image: a relay on the Docker bridge, a loopback-only paired daemon on the host, scripts inside the container, a throwaway fake model server for chat. Everything removed afterwards (container, daemons, relay, scratch, worktree and target dir). No link or password written anywhere.
- Results (rows L1-L7 in `desktop/docs/platform-checks.md` § Milestone 4, recipe in `desktop/docs/development.md` § The relay entry in Rust in the real webview): L1 connect, chat (`PONG from the fake model`), terminal (`RELAY_42_OK`), one `open` transport, the page's only socket `ws://127.0.0.1:<port>/<64 hex>`, the daemon log `"via":"relay"` - pass except `ui.inspect` has no `via`; L2 zero hits for the link, the offers and the relay host in answers, page, files and log (`secret_guard` passes); L3 wrong key: `lastError` `wrong_key`, "Pairing link no longer valid" with Replace link; L4 daemon killed: offline message at +3.7 s, back `connected` at +30.4 s with no input or reload; L5 host-hint link connects with no relay traffic; L6 1 GiB upload 6.5 s and save 7.0 s, three SHA-256 equal, terminal answered 19 of 19 (max 142 ms), app +12 MiB / +2 MiB, `peakHeld` 32 768 and 1 048 640 bytes; L7 app stopped 90 s and a 30 s network cut during an upload and a save: each restarted once, finished, equal hash, no reload.
- No app bug found; no code changed.

## Files changed
`desktop/docs/platform-checks.md`, `desktop/docs/development.md`

## Build & test results
```
cargo test -p pistudiodesktop-shell --test secret_guard -> 1 passed; release build in the worktree 1m30s; the live run as above
```

## Acceptance criteria
- [x] Every relay criterion seen, except `ui.inspect`'s `transports[i].via`, which does not exist until 128/t005 (recorded; evidence for L1 was the entry id, the relay log and the daemon's `via`).

## Follow-ups
- Tick `via` for relay after 128/t005 (130/t001 re-reads it).
- The wrong-key daemon was built by swapping the daemon's key pair (the CLI cannot make a wrong link).
- The repository's daemon reports 0.0.126: the page showed "expects 0.0.127 or newer" throughout (resolved by the release).
