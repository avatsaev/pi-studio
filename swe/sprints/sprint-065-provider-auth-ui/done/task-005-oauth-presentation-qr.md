# Task 005 — OAuth presentation: `auth_url` + QR, `device_code` countdown

- **Sprint:** sprint-065-provider-auth-ui
- **Status:** done
- **Type:** feature
- **Area:** web-client / features/provider-auth
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004

## Goal
Render the subscription/OAuth half of a flow: a prominent auth link with copy + QR, and a device-code
block with its verification link and expiry countdown — shown **alongside** a live `manual_code`
prompt, not instead of it.

## Context / why
Subscription login (Claude, Codex) is the case that motivated the whole feature, and over the relay
it has a hard constraint: any localhost callback server a Pi flow opens binds on the **daemon host**
and will never receive the remote user's browser redirect. Pi's contract is built for exactly this —
it emits `auth_url` and races a `manual_code` prompt against the callback, cancelling the prompt via
`prompt_cancelled` if the callback wins. So the url and the code input must be visible *at the same
time*; the reducer already keeps both (task-002).

QR matters for the same reason relay users already scan a pairing QR: the browser showing this dialog
is often not on the machine that can complete the redirect. **No QR component exists in web-client**
— `qrcode` is used daemon/CLI-side for terminal rendering only — so a small browser one is new here.

## Scope references
- `swe/features/provider-auth-ui.md` § Web UI surface (`auth_url` / `device_code` rows), and the
  resolved TODO on QR reuse
- `swe/features/provider-auth-rpc.md` § Behavior & Algorithms (the remote-OAuth reality note:
  `auth_url` + `manual_code` race, `prompt_cancelled`)
- `packages/web-client/src/features/provider-auth/LoginDialog.tsx` (task-004)
- `packages/web-client/src/features/provider-auth/login-flow.ts` (task-002 — `authUrl`, `deviceCode`)
- `packages/cli/src/qr.ts` (the terminal renderer — the reference for *which* library, not code to reuse)
- `packages/web-client/package.json` (dependency addition)

## What to build
- `packages/web-client/src/features/provider-auth/QrCode.tsx` (+ CSS module): a minimal component
  taking a string and rendering a QR image via `qrcode`'s browser `toDataURL`, with an accessible
  label. Add `qrcode` (and its types) as a **devDependency** — web-client ships no runtime deps, only
  its prebuilt `dist`, and Vite bundles it into the code-split chunk.
- `auth_url` rendering inside the login dialog: a prominent "Open in browser" link
  (`target="_blank"`, `rel="noreferrer"`), a copy-to-clipboard button with confirmation, the QR, and
  the event's `instructions` when present.
- `device_code` rendering: the `userCode` at a large, easily-read rung, the verification link (with QR
  where it helps), and a countdown when `expiresInSeconds` was provided — the countdown is view-local
  (`setInterval`), never reducer state, and stops on unmount and on `done`.
- Both blocks render **concurrently with** an active prompt: a `manual_code` input stays usable while
  the url/QR is on screen, and a `prompt_cancelled` (callback won the race) removes only the input,
  leaving the flow's progress visible.
- The QR component and `qrcode` must load only inside the lazy provider-auth chunk.

## Out of scope
- Any change to prompt input rendering or flow lifecycle (task-004 owns those).
- Reusing/extracting a shared QR component for the pairing UI — pairing renders its QR daemon-side
  today; unifying them is a separate, unforced change.

## Acceptance criteria
- [ ] An OAuth-shaped flow renders the auth link, a scannable QR, and a `manual_code` input at the
      same time; pasting the code completes the flow (stub provider acceptable).
- [ ] The QR scans correctly on a phone and resolves to the same url as the link (verified by scan,
      not by inspection).
- [ ] Copy-to-clipboard yields the exact url and shows a confirmation.
- [ ] A `device_code` event renders the user code, the verification link, and a countdown that ticks
      down and stops cleanly on `done` and on unmount (no interval left running — asserted in devtools).
- [ ] `prompt_cancelled` removes the manual-code input while the status/progress region stays intact.
- [ ] `qrcode` appears only in the lazily loaded provider-auth chunk — the initial bundle is unchanged
      in size beyond noise (`npm run build:web-client` output compared before/after).
- [ ] All CSS values come from design tokens; no raw px/hex literals.

## Test / verification plan
- Manual (real browser, production-bootstrap daemon): drive an OAuth-shaped flow; scan the QR with a
  phone; complete via the manual-code path; separately force a callback win (or a stubbed
  `prompt_cancelled`) and confirm the input disappears while the flow continues.
- Bundle: `npm run build:web-client` before/after, comparing chunk names and initial-chunk size.
- Typecheck/lint/format: `npm run typecheck`, `npm run lint`, `npx oxfmt <changed files>`.

## Notes
Inherited `TODO(verify)` from sprint-054/055, still open and **not** resolvable here without a real
provider account: whether any bundled OAuth flow binds a fixed localhost callback port that could
collide with the daemon's own listener. If a real subscription login is exercised during this task,
record the observed callback port in the task summary — that is the cheapest chance to close it.
