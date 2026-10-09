# Task 008 — Web-client composer: compacting gate, Stop-cancels, `/compact` built-in

- **Sprint:** sprint-074-context-compaction
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (features/chat)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-007

## Goal

The composer knows about compaction. Sending is blocked while a compaction runs (Pi would reject
the prompt), Stop cancels it, and `/compact [instructions]` typed in the composer runs the shared
compact action instead of being sent to Pi.

## Context / why

- Pi rejects prompts during compaction (`Cannot submit a prompt while compaction is in
  progress…`), and today the composer would send one and surface a failure.
- `/compact` is a Pi **TUI** built-in. `get_commands` never lists it, and the `prompt` RPC does
  not run built-ins, so typing it today sends the literal text to the model. The TUI matches
  `/compact` before any extension command (`interactive-mode.js:2650`). Intercepting client-side
  matches that precedence.
- Decision: compaction is disabled while the agent is running. A `/compact` draft must not be
  routed to steer.

## Scope references

- `swe/features/context-compaction.md` § Public contract › Web-client (`/compact` built-in, Composer
  gating), § Error handling & edge cases (`/compact` rows)
- `packages/web-client/src/features/chat/Composer.tsx:160-213` (running/busy/canSubmit), `:259-263`
  (menu open), `:328-345` (`submit`), `:396` (Stop → interrupt), `:577-581` (button)
- `packages/web-client/src/features/chat/composer-busy.ts:21-23` + `composer-busy.test.ts`
- `packages/web-client/src/features/chat/slash-commands.ts:16-22` (`SlashCommand`), `:32-39`
  (`parseSlashToken`), `:52-72` (`commandOptions`), `:96` (`knownCommandSpan`) + test
- `packages/web-client/src/features/chat/CommandMenu.tsx`; `ui/combobox.ts:6-16`
  (`ComboboxOption.disabled` exists and highlight movement skips disabled rows)
- `stores/compaction-store.ts` (`compactSession`, `cancelCompaction`), `useIsCompacting` (task-007)
- Pi built-in description: `node_modules/@earendil-works/pi-coding-agent/dist/core/slash-commands.js:23`

## What to build

- **Built-ins.** In `slash-commands.ts`, a `CLIENT_BUILTIN_COMMANDS` list with one entry
  `{name:"compact", description:"Manually compact the session context", source:"builtin"}`, merged
  ahead of Pi's commands in `commandOptions`. A same-named Pi command is shadowed (dropped from the
  list). It also counts for `knownCommandSpan` highlighting. A pure
  `parseBuiltinInvocation(text)` → `{name:"compact", args: string | undefined} | null` uses Pi's
  exact, case-sensitive token grammar (`/compact`, `/compact focus on X`; not `/Compact` or
  `/compactx`).
- **Submit.** In `submit`, before any send/steer branch: if `parseBuiltinInvocation` matches, call
  `compactSession(sessionId, args)`, clear the draft only on success, and keep it and show the
  store's inline error on refusal or failure. Never call `send`/`steer` and never add an optimistic
  user row.
- **Gating.** Extend `isComposerBusy` (or the `canSubmit` derivation, whichever keeps the pure
  function testable) so that:
  - compacting → Send disabled for every draft, and the Stop button is shown and calls
    `cancelCompaction`.
  - running → a `/compact` draft cannot be submitted (Send disabled, Enter is a no-op, not routed to
    steer). Other drafts keep today's steer behavior.
  - no `agentId` → a `/compact` draft cannot be submitted.
  - the CommandMenu `compact` row is `disabled` while running, compacting or agent-less, if
    `CommandMenu` can render disabled rows. If not, add the minimal disabled styling here; the
    submit gate stays authoritative either way.
- Docs: `packages/web-client/AGENTS.md` composer section (client built-ins, interception rule,
  compacting gate); `swe/features/composer-ui.md` slash-command section gains the built-in note.

## Out of scope

- Any other Pi TUI built-in (`/session`, `/model`, …).
- Toasts.

## Acceptance criteria

- [x] `/compact` and `/compact focus on X` submitted on an idle agent issue one
      `agent_compact_request` (instructions `undefined` / `"focus on X"`), with no
      `send_agent_prompt` and no user row.
- [x] `/Compact` and `/compactx` are not intercepted (they go through the normal send path).
- [x] While compacting: Send is disabled for any draft, Stop is visible, and Stop cancels the
      compaction (`Compaction canceled` divider).
- [x] While running: a `/compact` draft cannot be submitted and is never sent as a steer, while a
      normal draft still steers.
- [x] The picker lists `compact` first with its description, and a Pi extension command named
      `compact` does not appear twice.
- [x] In a browser (dev daemon): all of the above observed, plus a failed `/compact` keeps the draft
      and shows the error.

## Test / verification plan

- Tests: `slash-commands.test.ts` (built-in merge and shadowing, `parseBuiltinInvocation` grammar
  boundaries), `composer-busy.test.ts` (compacting/running × draft-kind matrix).
- Run: `npx vitest run packages/web-client` and `npm run build:web-client`.
- Manual: browser check above. Record it.
