# Task 004 — Login dialog: prompt inputs, status region, terminal states — Summary

- **Sprint:** sprint-065-provider-auth-ui
- **Status:** done
- **Completed:** 2026-08-20

## What was built

**`packages/web-client/src/features/provider-auth/LoginDialog.tsx`** (+ CSS module) — a `Dialog`
overlay driving one login flow end to end. Mounted unconditionally from `SettingsDialog`; renders
nothing until the store's `pendingLogin` is set by `ModelProvidersPanel`'s `Log in`.

- **State** is `useReducer(applyLoginFlowEvent, initialLoginFlowState(...))` (task-002). The
  component adds no ordering logic of its own.
- **Prompt rendering** (`PromptInput`): `secret` → `type="password"`; `text`/`manual_code` →
  `type="text"` with the prompt's `placeholder`; `select` → a click-to-answer option list
  (`label` + optional `description`). The pending prompt's resolver lives in a **ref**, not reducer
  state, keeping task-002 pure; it is rejected on unmount so the SDK cancels rather than leaking.
- **Status region**: `info`/`progress` lines straight off reducer state, with `AuthInfoLink`s
  rendered as real anchors.
- **Terminal states**: `done ok` → invalidate the provider list, "Signed in. Closing…", auto-close
  after 1.2 s; `done !ok` → the error message plus `Close` and `Try again`.
- **Retry** = a genuinely fresh flow: `provider-auth-store.ts` gained `retryLogin()` (new
  `AbortController`, `attempt` bumped) and `LoginDialog` keys the inner flow component on
  `provider:authType:attempt`, so a retry remounts it — new reducer state, new resolver ref, new
  `loginProvider()` call. Nothing from the dead flow survives.
- `provider-auth-store.ts` also gained `providerName`, so the dialog title reads "Log in to
  Amazon Bedrock" rather than the raw provider id; `ModelProvidersPanel` passes it through.

### Bugs found and fixed during this task

1. **`done` was permanently swallowed under StrictMode** (the significant one). The flow-start
   effect guarded re-entry with a `startedRef` (needed: the phantom remount would otherwise call
   `loginProvider()` twice and throw "a provider-auth login is already in progress"), but gated its
   terminal `dispatch` on a per-closure `live` flag. StrictMode's phantom cleanup set `live = false`
   on the very closure owning the running flow, so `done` was never dispatched: prompts still
   rendered and answered, the credential even landed in `auth.json`, and the dialog sat forever on
   the last prompt. Fixed by tracking liveness in a `mountedRef` that the phantom remount restores
   and only a real unmount leaves false. Caught live, not by inspection.
2. **Closing the login dialog closed the Settings dialog with it** (user-reported). The two Radix
   dialogs are DOM siblings (each portals to `body`), so a pointerdown inside the login dialog reads
   as an outside-interaction on Settings. Radix also *defers* a non-mouse `pointerdown` to the
   following `click`, so by dispatch time `cancelLogin()` had already unmounted the login layer and
   cleared `pendingLogin` — a guard keyed on "is a login pending" tested false and let the dismissal
   through. Fixed with two rules in `SettingsDialog`: suppress while a login is pending, **and**
   suppress when the interaction's original target is no longer `isConnected` (it belonged to a
   layer that closed as a result of this very interaction). Required a small, reusable addition to
   the `Dialog` primitive: `onInteractOutside`/`onEscapeKeyDown` passthrough to `Dialog.Content`.
   Diagnosed by instrumenting the handler after `page.on('console')` proved unable to deliver
   messages in this environment (a `window` log sink was used instead).
3. **Auto-close never fired / list re-invalidated every render**: `onSuccess` was an inline arrow,
   so the success effect's dependency changed every render, restarting the 1.2 s timer each pass.
   Wrapped in `useCallback`.
4. **Submit and Cancel straddled body and footer** (user-reported). Submit moved into the footer
   beside Cancel, associated to the body form via the HTML `form` attribute so Enter-in-the-input
   and the footer click remain one submit path. A `select` prompt contributes no Submit.
5. **Body content flush against the dialog edges** (user-reported, with screenshot). `Dialog`'s own
   `.body` carries no padding — every dialog body supplies its own; this one didn't. Added
   `--pi-spacing-14`, matching `SettingsDialog`/`OpenWorkspaceDialog`.
6. **Password-manager overlay covering the input/button**: added `data-1p-ignore`/`data-lpignore`/
   `data-bwignore` on secret inputs (`autoComplete="off"` alone is ignored by modern Chrome on
   password fields).
7. **A status line's link was squeezed beside a long message**: message and links now stack.

## Files changed

| File | Change |
|---|---|
| `features/provider-auth/LoginDialog.tsx` + `.module.css` | new |
| `features/provider-auth/provider-auth-store.ts` | `providerName`, `attempt`, `retryLogin()` |
| `features/provider-auth/ModelProvidersPanel.tsx` | passes `provider.name` to `requestLogin` |
| `features/settings/SettingsDialog.tsx` | mounts `LoginDialog`; stacked-dismiss suppression |
| `components/primitives/Dialog.tsx` | `onInteractOutside`/`onEscapeKeyDown` passthrough |

## Commands run + results

- `npm run build:web-client` → clean (10.07 s).
- `npm run clean && npm run typecheck` → clean.
- `npx oxlint <changed files>` → clean. `npx oxfmt --check <changed files>` → all correctly
  formatted. (Repo-wide `fmt:check` still reports the 61 pre-existing markdown files, none mine.)
- `npm test` → **2108/2108 pass**, 168 files. No new unit tests: this task added a component, and
  the project's convention is thin components verified in a real browser (no jsdom). The logic worth
  testing is task-002's reducer, already covered.
- Chunk isolation: entry chunk `index-BTkySv7B.js` contains **zero** matches for `Model Providers`,
  `Not configured`, `Select Amazon Bedrock`, `Signed in. Closing`, `provider-auth-prompt-form`.
  `LoginDialog` rides the `SettingsDialog-*.js` lazy chunk, as intended.

## Acceptance criteria

- [x] **API-key login completes in a real browser against a production-bootstrap daemon** — verified
      three times (Ant Ling, DeepSeek, Amazon Bedrock): open → masked/text input → submit →
      "Signed in. Closing…" → auto-close → row badge flips to `API key` with `Re-login`/`Log out`,
      no page reload.
- [x] **Credential visible to `pi-studio auth status` on the daemon host** — `amazon-bedrock  Amazon
      Bedrock  api key  stored credential`, and `~/.pi/agent/auth.json` (mode 0600) gained the
      matching entry: the exact file a daemon-spawned `pi --mode rpc` agent reads.
- [x] **A `select` prompt renders labels + descriptions and answering advances the flow** — verified
      live with Amazon Bedrock's three-option method picker; answering "AWS profile" advanced to an
      `info` line (with its `AWS credential provider chain` anchor, correct href) and then a `text`
      prompt, i.e. `type="text"`, not the secret field. **Caveat:** no shipped provider populates
      `description` — Bedrock's and Google Vertex's select options are label-only — so the
      `description` span is implemented to the `AuthPrompt` contract but could not be exercised
      against a real provider.
- [x] **`Try again` after a failed flow starts a new flow and can succeed** — verified as one
      sequence: daemon stopped mid-prompt → `connection_lost` error state → daemon restarted →
      reconnect → `Try again` → fresh select prompt → answered → submitted → success → auto-close →
      badge flipped. Separately, the debug daemon logged two distinct `flowId`s for two attempts.
- [x] **Cancel and Esc terminate the flow server-side; dialog closes with no unhandled rejection** —
      verified against a `PI_STUDIO_LOG_LEVEL=debug` daemon; each produced its own flow:
      `flow started → prompt(select) → flow ended {ok:false, error:"cancelled"}` for two distinct
      flowIds (`13448c8e` = Cancel button, `0e669aa7` = Esc). `window.unhandledrejection` collected
      **zero** events across every run.
- [x] **Closing mid-prompt leaves no dangling handler** — the same two log entries show the flow
      settling cleanly while parked on a prompt; no console warnings, no leaked subscription.
- [x] **A secret appears nowhere outside the submitting request** — post-login sweep for every value
      submitted (`sk-test-fake…`, `sk-antling-fake…`, `pi-studio-test-profile`,
      `retry-success-profile`): 0 hits in `localStorage` (only key: `pi-studio-pane-layout`), 0 in
      `sessionStorage`, 0 in `document.documentElement.outerHTML`, 0 in the daemon logs, and every
      live `input.value` empty. The value exists only in `auth.json`.
- [x] **All CSS from design tokens; no raw px/hex** — colors/spacing/font-sizes/radii are all
      `--pi-*` tokens. The one literal is `border: 1px solid var(--pi-color-border)`, the repo's
      dominant hairline convention (18 uses vs 5 of the `--pi-border-width-1` form).

## Notes / follow-ups

- **Test-credential hygiene**: every credential created during verification was a fake value on a
  provider that was `Not configured` beforehand, and each was logged out afterward. Final state:
  `auth.json` holds only the user's real `github-copilot`; `auth status` shows only their
  pre-existing `baseten`/`github-copilot`/`litellm.*`. Net zero change apart from `anthropic`, which
  the previous task's incident logged out and which the user has said they will re-authenticate
  themselves.
- **Dev-only caveat worth knowing**: editing `LoginDialog.tsx` while a flow is mid-prompt makes Fast
  Refresh re-run the effect — cleanup rejects the resolver while the reducer state survives, so the
  dialog appears stuck on a prompt that no longer has a resolver. Not a production path (the
  `startedRef` guard deliberately does not restart a flow), but it cost time to distinguish from
  bug 1 above; hard-reload before verifying a flow.
- `auth_url`/QR/`device_code` rendering remains task-005 as planned; those events are already stored
  by the reducer and simply not rendered yet.
- `local-daemon` (port 6767) and `web-client-dev` (port 5173) are still running for task-005.
