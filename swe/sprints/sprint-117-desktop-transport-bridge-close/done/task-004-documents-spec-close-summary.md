# Task 004 — Documents and spec close for milestone 2 — Summary

- **Sprint:** sprint-117-desktop-transport-bridge-close
- **Completed:** 2026-11-22
- **Status:** done

## What was done
- **Spec** `swe/features/desktop-transport-bridge.md`: status header (built and checked; what is open), every Bridge, Secrets, Resume and Gates criterion ticked with its evidence or left open with the reason (open: the 1 GiB criterion's `bufferedAmount` pause; the five-minute sleep on a real machine), the TODO(verify) items answered or carried forward, and the desktop version note.
- **`desktop/` documents.** Most were updated by the tasks that changed the code (AGENTS.md rule 10 and "Where it stands", the workspace map with `secrets`, `net` and `ipc-bench`, README, development.md, control-protocol.md, platform-checks.md). Changed here: `desktop/docs/architecture.md` (the window bullet, the "which host the window uses" decision, the `connect-src` row — why `ws:` stays: the page's leg to `ws://127.0.0.1:<port>/<token>` on a port that changes per connection, and a relay entry's own socket — and three decision rows: the loopback proxy instead of the channel design, Rust dialling before it answers with the host reporting a refused open as a close (1006), what Rust holds).
- **Root `AGENTS.md`:** the `desktop/` paragraph describes the proxy, the secret store (no secret in `daemons.json`), the crates `secrets` and `net`, and milestones 1 and 2.
- **`swe/features/desktop-daemon-registry.md`:** the secrets rule (a password never reaches the webview; a relay entry's pairing link does until milestone 4), `resolveCurrent` without a password for local and direct entries (a missing password shows at `transport_open`), the page-commands paragraph with `transport_open`, "Not in this feature" updated.
- **`swe/architecture/workbench-host-adapter.md`:** the `ConnectIntent` and `createTransport` rows, and a `connection` paragraph in the desktop host section (`createTransport`, `onResume`, `timers`, `secretStore`).
- **Handoff** `docs/desktop-client-handoff.md`: the table row for the desktop client, milestone 2's state (what was built, live and runner results, what is open, what milestones 3 and 4 can use — the milestone 4 remarks are marked as inference).
- **`swe/MAIN-SCOPE.md`** row and **`swe/sprints/PLAN.md`** (index paragraphs for sprints 115–117 and the built notes).
- **Version decision.** The desktop app is 0.1.0. A release that carries this milestone should be **0.2.0** (a minor bump: the first change to what the app does since 0.1.0). The number is not changed in `desktop/Cargo.toml`: it is set when the release is tagged, which needs the owner's word. Recorded in the spec's status header.

## Commands run (combined tree, orchestrator)
- Root `npm run build && npm run typecheck && npm run lint && npm test`: exit 0, 291 files, 4,134 tests. `cargo xtask ci` in `desktop/`: all 8 steps passed. App: `npm run check` ok, `lint` clean, `npm test` 24 files, 195 tests.
- A search of `desktop/`, `docs/`, the root `AGENTS.md`, `swe/features/` and `swe/architecture/` for "still opens the WebSocket" and "live only in `daemons.json`" finds nothing; the handoff's remaining sentence "keeps secrets in a user-only file until the keychain in milestone 2" describes milestone 1's state.

## Acceptance criteria
- [x] No document says the webview opens the socket for a local or direct entry, or that a secret is in `daemons.json`, except where it describes history.
- [x] The spec's open items match the summaries of the tasks that left them open (1 GiB `bufferedAmount` pause; the real-machine sleep; the unsigned macOS prompts; the firewall prompt; the HTTP proxy note P6).
- [x] `cargo xtask ci` passes; the root `npm run lint` passes.

## Follow-ups
- `secretStore` is typed `"keychain" | "file"` in `types.ts` and `daemons-view.ts`, so the page never sees `memory`; documented as absent in that case.
- Pending outside the plan: sprint-117/task-003 (a person), sprint-106/task-002 and sprint-111/task-002 (milestone 1's manual macOS/Windows checklist), `VERSION_TIMEOUT` 5 s or 15 s, the owner's confirmation that the web client looks unchanged (116/t005 changed `shortConnectionReason` in `packages/workbench`), and the merge itself (it publishes an npm release).
