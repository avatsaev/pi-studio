# Task 005 — OAuth presentation: `auth_url` + QR, `device_code` countdown — Summary

- **Sprint:** sprint-065-provider-auth-ui
- **Status:** done
- **Completed:** 2026-08-20

## Why this ran when it did

Reported from real use, not picked off the backlog: an Anthropic OAuth login showed only
*"Complete login in your browser, or paste the authorization code / redirect URL here:"* — no url, no
browser tab, nothing to paste. That is precisely the gap task-004 left open by design (the reducer
already stored `auth_url`; nothing rendered it), so the user's report is the acceptance test.

## What was built

- **`QrCode.tsx`** (+ CSS module): wraps `qrcode`'s browser `toDataURL`. Colours are left at the
  library default (black-on-white, quiet zone baked into the PNG) rather than themed — scanners
  expect dark-on-light, and a themed QR trades scan reliability for looks. A generation failure
  renders nothing rather than an error: there is always a link and a copy button, so the QR is an aid.
- **`auth_url` block** in `LoginDialog`: a primary "Open login page" action, the url with an
  icon-only copy button, and the QR with a "Scan on another device" caption. The action is an
  anchor (`target="_blank" rel="noreferrer"`) styled to match `Button`'s default variant, because
  it must be a real link — a scripted `window.open` is popup-blocked without a gesture, and
  `Button` renders only a `<button>`, losing middle-click and "copy link address".
- **`device_code` block**: the user code at a large mono rung, the verification link, the QR, and a
  countdown. The countdown is view-local `setInterval` — the reducer stays pure, holding only the
  daemon-sent expiry — and its cleanup covers both required stops (unmount, and `done` flipping
  `stopped`).
- Both blocks render **concurrently with** a live prompt, and are retired once the flow is terminal.
- **`qrcode`/`@types/qrcode` as web-client devDependencies** (it ships no runtime deps, only its
  prebuilt `dist`), plus a `vite.config.ts` `manualChunks` rule — see below.

### Visual design pass (second round of user feedback)

The first cut was rejected on sight ("this design looks horrible"), and fairly — the screenshot showed
the link, a bare-text "Copy link" button and the url each sitting at a *different* left indent, an
outlined panel nested inside the dialog's own border, and the provider's `auth_url` instructions
immediately followed by the `manual_code` prompt's label saying the same thing in different words
("Complete login in your browser…" twice, stacked). Fixed:

- One left edge for the whole action column; "Copy link" became an `IconButton` (`Copy` → `Check`
  on success) sitting *in* the url row, where a copy affordance belongs. A labelled text button read
  as a caption, not an action, and its own padding was what broke the alignment.
- The panel is now filled (`surface2`) instead of outlined — a second 1px frame inside the dialog's
  border read as a box-in-a-box.
- Duplicated guidance removed: `auth_url` instructions render only when no text prompt is live,
  since that prompt's own label carries the same sentence.
- The action column is vertically centred against the QR; top-aligning left an obvious block of dead
  space under the url.
- The device-code block got the same treatment, plus a copy button on the code itself — the
  alternative is retyping a hyphenated code by hand.
- QR sizing took two passes: shrunk to 7.5rem to stop it dominating, which the user then correctly
  called too small for the panel, so it is back to 10rem (bitmap regenerated at 2x = 320px) with the
  caption constrained to the same width so it wraps under the code rather than stretching the row.

## Bugs found and fixed (all found by verifying, not by reading)

1. **`qrcode` landed in the eager `vendor` chunk.** `manualChunks` funnels every unmatched
   `node_modules` id into `vendor`, so the AC would have shipped a QR encoder to every user who never
   opens Settings. Added a `return undefined` rule (the existing `@shikijs/langs` precedent) so
   Rollup co-locates it with its only importer. Verified: entry chunk 170760 → 171115 bytes.
2. **A prompt cancelled out of band left its input on screen.** The SDK's own contract comment says a
   view "re-dispatches `prompt`/`prompt_cancelled`/`done` from the callback/promise boundary" — but
   there was no seam to do it: `prompt_cancelled` rejects the driver's internal race and *discards*
   the view's promise, so `onEvent` never sees it and the view is never told. Added
   `ProviderAuthPromptUi.signal`, aborted for exactly that prompt (and on flow end);
   `LoginDialog` listens and drops the input. This is a `packages/client` contract addition, outside
   this task's nominal scope, but the AC is unmeetable without it.
3. **Submit was disabled on an empty input, making GitHub Copilot's OAuth flow impossible to
   advance.** Its first prompt is *"GitHub Enterprise URL/domain (blank for github.com)"* — blank is
   the normal answer. Removed the gate; the provider decides what it accepts, exactly as
   `pi-studio auth login` does (its `@inquirer/prompts` input carries no non-empty validation).
4. **An already-answered prompt kept rendering.** The reducer holds `state.prompt` until the next
   prompt or `done` (correct for a pure log), but the device-code step sits there for minutes — so
   the answered "GitHub Enterprise URL/domain" question and an empty box sat next to the code the
   user is meant to read. `LoginDialog` now tracks `answeredPromptId` and renders only the prompt
   still awaiting an answer.
5. **`lib/clipboard.ts`'s fallback copied nothing inside any Radix overlay — pre-existing, and it
   also affects the file-explorer's "Copy Path".** Appended to `document.body`, the overlay's focus
   trap synchronously pulls focus off the scratch textarea on `focus()`, collapsing the selection;
   `execCommand("copy")` then returns **`true`** having copied nothing, so the caller reports success
   with an empty clipboard. Observed directly: `activeElement` back on the button, selection `""`,
   return value `true`. It now hosts the textarea in the nearest `[role="dialog"]`/`[role="menu"]`,
   asserts the selection actually covers the text before trusting the return value, and restores
   focus. Only reachable on a non-secure context (plain-http LAN), where the fallback is the *only*
   path — the deployment this helper exists for.
6. A status line's link was squeezed beside a long message; message and links now stack.
7. `--pi-font-family-mono` does not exist (the real token is `--pi-font-mono`). Caught by
   `theme/token-integrity.test.ts`, which is exactly its job.

## Files changed

| File | Change |
|---|---|
| `web-client/features/provider-auth/QrCode.tsx` + `.module.css` | new |
| `web-client/features/provider-auth/LoginDialog.tsx` + `.module.css` | OAuth blocks; answered-prompt retirement; prompt-signal listener; Submit gate removed |
| `web-client/lib/clipboard.ts` | focus-scope host, selection post-condition, focus restore |
| `web-client/vite.config.ts` | `qrcode` kept out of the eager `vendor` chunk |
| `web-client/package.json` | `qrcode` + `@types/qrcode` devDependencies |
| `client/src/pistudio-client.ts` | `ProviderAuthPromptUi.signal` + per-prompt `AbortController` |
| `client/src/pistudio-client.test.ts` | asserts the signal exists, stays unaborted on a stale id, aborts on the matching `prompt_cancelled` |
| `web-client/AGENTS.md`, `client/AGENTS.md` | source layout, four invariants, provider-auth method table + login-flow section |

## Commands run + results

- `npm run clean && npm run typecheck` → clean. `npm run build:web-client` → clean (10.35 s).
- `npx oxlint` / `npx oxfmt --check` on all 8 changed files → clean.
- `npm test` → **2108/2108 pass**, 168 files.
- Bundle: `getSymbolSize` (a `qrcode` internal) appears in **`SettingsDialog-*.js` only** — zero hits
  across `index-*.js` and every `vendor-*.js`.

## Acceptance criteria

- [x] **Auth link, scannable QR, and a `manual_code` input at the same time** — verified live on the
      reported Anthropic flow: instructions, "Open login page" → the real
      `https://claude.ai/oauth/authorize?…` url, "Copy link", the ellipsized url, the QR, and the
      paste field with its `http://localhost:53692/callback` placeholder, all on screen together.
- [x] **The QR resolves to the same url as the link** — verified by **decoding the rendered pixels**,
      not by inspection: the image was drawn to a canvas and its 81×81 module grid sampled, then
      compared against `QRCode.create(url)`'s canonical matrix — 3347 dark modules, **0 mismatches**.
      A byte-compare of the data URL was tried first and correctly rejected as invalid (the browser
      build renders via canvas, Node via pngjs, so PNG bytes differ for the same symbol).
      **Not** verified by a physical phone scan — no phone available to this session.
- [x] **Copy-to-clipboard yields the exact url and confirms** — button flips to "Copied", and the
      text handed to the clipboard is byte-identical to the anchor's href (427/427 chars, selection
      `[0, 427]`, `activeElement` the textarea). This is what surfaced bug 5: before the fix the same
      assertion showed `activeElement: BUTTON`, selection `""`, `execCommand` → `true`.
      `navigator.clipboard` is denied in this headless browser, so the `execCommand` fallback is the
      path that was exercised — the one that was broken, and the one plain-http deployments use.
- [x] **`device_code` renders the user code, verification link, and a countdown that ticks and stops
      cleanly** — verified live on GitHub Copilot: code `EE94-6565`,
      `https://github.com/login/device`, QR, "Expires in 14:54" → "14:51" over ~3 s. Interval
      accounting via patched `setInterval`/`clearInterval`: baseline 1 → 2 while the block was up →
      back to **1** after Cancel, i.e. no interval left running.
- [x] **`prompt_cancelled` removes the manual-code input while the status/progress region stays
      intact** — forced by making the callback win the race (a request to the daemon host's real
      `127.0.0.1:53692/callback`) and sampling at 25 ms: at t=25 ms the input is **gone** while the
      auth-url block, QR and status region all **remain**, `done` still false — held for 7 frames
      (~175 ms) until the (fake) code failed its token exchange. Before bug 2's fix the input stayed.
- [x] **`qrcode` only in the lazily loaded chunk; initial bundle unchanged beyond noise** — 170760 →
      171115 bytes (+355 B, my own component code), `qrcode` internals in the lazy chunk only.
- [x] **All CSS from design tokens** — the only literals are `1px` hairline borders (the repo's
      dominant convention, 18 uses) and the QR's own `10rem` intrinsic box, which is a dimension, not
      a font size, so no `--pi-font-size-*` rung applies.

## Notes / follow-ups

- **The inherited `TODO(verify)` from sprint-054/055 is now CLOSED.** Anthropic's OAuth callback binds
  a **fixed** port: `CALLBACK_PORT = 53692`, host `127.0.0.1` (`PI_OAUTH_CALLBACK_HOST` overrides the
  host only, never the port), path `/callback`. So: **no collision with the daemon's own listener**
  (6767 by default) — but the port is fixed rather than ephemeral, so two concurrent Anthropic logins
  on one host *will* collide with each other, and anything else already holding 53692 breaks the
  callback leg. Worth stating in user-facing docs when remote OAuth is documented.
- **Callback-port lifecycle, measured.** Because that port is fixed, its release matters, so both
  termination paths were checked directly with `ss -ltnp` around a live flow: the port is bound while
  a flow is parked, and **released within seconds** both after an explicit `Cancel` and after a
  mid-flow socket drop (page reload) — i.e. sprint-055's disconnect-cancels-flow really does reach
  Pi's `finally`, which closes the server. Neither path leaks.
  One unexplained observation worth recording: after a long series of rapid overlapping Anthropic
  flows (reloads, a forced callback win, cancels) the daemon was found still holding 53692, and the
  *next* login then sat at "Starting…" indefinitely rather than reporting a bind failure — a restart
  cleared it. Not reproducible on demand afterwards, and not attributable to either normal path;
  the plausible mechanism is two flows contending for the fixed port, with the loser's `listen`
  error never surfacing as a flow error. Anyone extending this surface should treat "stuck on
  Starting…" as a possible EADDRINUSE on 53692 and check that port first.
- **Why the reported flow now works locally**: that callback binds on the **daemon** host, so with a
  localhost daemon the browser's redirect to `http://localhost:53692/callback` does reach it and the
  callback wins the race — no pasting needed. Over the relay to a headless box it cannot, which is
  exactly why the url, QR and paste field must all be visible at once.
- No real subscription login was completed: doing so would mint the session owner's own credential.
  Every flow driven here was cancelled or failed on a deliberately fake code, and
  `pi-studio auth status` afterwards shows their pre-existing `baseten`/`github-copilot`/`litellm.*`
  untouched (in particular, cancelling a Copilot device flow left its `oauth` credential intact —
  Pi only writes on success).
- `anthropic` remains unconfigured from the task-003 incident; the user has said they will
  re-authenticate it themselves, and this task's surface is what they will use to do it.
