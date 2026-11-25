# Task 006 — Live check of the closed door, and close of M1 — Summary

- **Sprint:** sprints/sprint-146-close-the-door
- **Completed:** 2026-11-24
- **Status:** done

## What was implemented
No source change. Every M1 behaviour was exercised on throwaway processes (temporary `PI_STUDIO_HOME`/`PI_STUDIO_PI_HOME`, ports 47341–47372 and 5173; the owner's daemon on :6767 was not touched and was still listening afterwards). Everything was stopped and its temp files removed.

## Live results
| # | Check | Seen |
|---|---|---|
| 1 | Upgrade with `Origin: https://evil.example` | `HTTP/1.1 403 Origin not allowed`; daemon log `ws upgrade rejected: origin not allowed` |
| 1 | Upgrade with no `Origin` | `101 Switching Protocols` |
| 1 | `/api/health` with an evil `Origin` | `{"status":"ok","version":"0.0.132"}` (still served) |
| 2 | `pi-studio -H 127.0.0.1:47341 ls` (the task said `agent list`; the command is `ls`) | `(no results)`, exit 0 |
| 3 | `PI_STUDIO_LISTEN=0.0.0.0:47342`, no password | exit 1, `unprotected_bind` error naming `PI_STUDIO_PASSWORD`; `ss` shows nothing listening |
| 3 | `pi-studio -H 0.0.0.0:47342 daemon start`, no password | message on stderr, exit 1; with `--json`: `{"up":false,...,"error":"unprotected_bind"}` |
| 3 | Same bind with `PI_STUDIO_PASSWORD=pw` | listening on `0.0.0.0:47342`; CLI without the password: `connection error`, exit 2; with `--password pw`: works |
| 4 | Production web build (`vite preview`), no link | Lite UI, one "Pairing link" field, no password field |
| 4 | Type `ws://127.0.0.1:47352` and Connect | red pill "Pi Studio Lite connects with a pairing …", nothing connects |
| 4 | Open the pairing link (fresh load) against a local relay + daemon with relay enabled | `ws://127.0.0.1:47351 · connected`, file tree listed, no page errors, `localStorage.password` is `null` |
| 4 | The page's own `new WebSocket("ws://127.0.0.1:47352")` from the web origin | refused |
| 5 | `vite` on :5173 (proxy to dev daemon :47361) | `ws://127.0.0.1:5173/daemon-ws · connected`, no page errors |
| 6 | Desktop Rust dial (`pistudiodesktop_net::dial::dial`, a throwaway example, deleted afterwards) to a loopback daemon with no password | `DIAL OK` |
| 6 | Same to a `0.0.0.0` daemon with the right / wrong password | `DIAL OK` / `unauthorized ... refused the password (401)` |

## Build & test results
```
Full gates on the combined tree (after tasks 001-005):
$ npm run build      -> exit 0
$ npm run typecheck  -> exit 0
$ npm run lint       -> exit 0 (existing warnings only)
$ npm test           -> 329/330 files, 4727/4728 tests pass
   The one failure, packages/server/src/daemon/bootstrap.test.ts "extension packs RPC ... full round trip",
   fails identically on a pristine HEAD a6efaa9a (temporary worktree), so it is not caused by this sprint.
$ npm run fmt:check  -> 25 files; the 8 docs/compose files this sprint touched were already unformatted at HEAD
$ cd desktop && cargo fmt --all --check && cargo xtask ci
   -> CI summary: all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
```

## Acceptance criteria
- [x] All six checks recorded with what was seen. Check 6 is partial: the desktop Rust dial and the desktop gate pass, but the app window itself (local and direct entries in the real app, or `npm run snapshot`, which cannot connect because the connection runs in Rust) was not run.
- [ ] Gates green: all green except the one pre-existing test failure above.

## Follow-ups / TODO(verify)
- Pre-existing red test: the extension-packs round trip expects every non-failing curated entry to be `installed`; it fails on HEAD (the curated pack now also lists `git:github.com/avatsaev/pi-molagent` from 0.0.130 — not confirmed as the cause). Not in this sprint's scope; needs an owner decision.
- The throwaway daemon with default settings installed the three recommended extensions into its temp Pi home over the network (extension auto-sync); nothing outside the temp directory was written.
- A refused direct address also raises an uncaught page error in the web client (the pill shows the message); cosmetic.
- Real desktop-app window check (local entry, direct entry) still to do by the owner or `docs/platform-checks.md`.
