# Task 005 — `file_link_markdown` capability + generalized instruction composition — Summary

- **Sprint:** sprint-051-file-link-rendering
- **Completed:** 2026-08-05
- **Status:** done

## What was implemented
Registered the `file_link_markdown` capability flag alongside `inline_image_markdown`, advertised it
unconditionally from the web-client, and replaced `agent-service.ts`'s single-flag system-prompt
ternary with an ordered, N-capability composition (`composeSystemPrompt` + `CAPABILITY_INSTRUCTIONS`)
so the existing image instruction and the new file-link instruction compose deterministically through
one mechanism.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/client-capabilities.ts` | added `file_link_markdown` to `CLIENT_CAPS` (append-only) |
| `packages/web-client/src/lib/connection/connection-store.ts` | advertises `CLIENT_CAPS.file_link_markdown: true` alongside `inline_image_markdown` |
| `packages/server/src/agent/file-link-instructions.ts` | new — `FILE_LINK_INSTRUCTIONS`, mirrors `inline-image-instructions.ts`'s doc style |
| `packages/server/src/agent/compose-system-prompt.ts` | new — `CAPABILITY_INSTRUCTIONS` (ordered image, then file-link) + `composeSystemPrompt(callerPrompt, supports)` |
| `packages/server/src/agent/agent-service.ts` | `handleCreate` now calls `composeSystemPrompt` instead of the single-flag ternary; removed now-dead `CLIENT_CAPS`/`INLINE_IMAGE_INSTRUCTIONS` imports |
| `packages/server/src/agent/create-run.test.ts` | `fakeSession` extended to `{ supportsInlineImages?, supportsFileLinks? }`; added a `describe` covering none/image-only/link-only/both against `composeSystemPrompt` |
| `packages/server/src/daemon/bootstrap.test.ts` | added an end-to-end case: a `hello` advertising `file_link_markdown` produces a persisted record whose `systemPrompt` contains `FILE_LINK_INSTRUCTIONS` |

## How it satisfies the scope
Matches `file-link-rendering.md` § Capability flag and § Composing multiple capability-gated
instructions exactly: `composeSystemPrompt` returns the caller prompt unchanged (including
`undefined`) when no advertised capability has an instruction; otherwise joins
`[callerPrompt, ...blocks]` with a blank-line separator, in `CAPABILITY_INSTRUCTIONS`' declared order
(image, then file-link) regardless of the `hello` frame's capability declaration order, never
mutating `config` (a new `effectiveConfig` object is built each time). CLI-created sessions advertise
no capabilities, so `composeSystemPrompt` returns `callerPrompt` unchanged — `create-run.test.ts`'s
pre-existing "no capability" case passes unmodified.

## Build & test results
```
$ npm run typecheck
tsc -b — success, zero errors

$ npm run build:protocol && npm run build:server
tsc -b packages/protocol — success
tsc -b packages/server — success

$ npm run lint
oxlint — 0 errors (pre-existing repo-wide warning baseline unaffected by this task's files)

$ npx vitest run packages/server/src/agent packages/server/src/daemon/bootstrap.test.ts
Test Files  20 passed (20)
     Tests  228 passed (228)
```

## Acceptance criteria
- [x] Neither flag advertised: `effectiveConfig.systemPrompt === config.systemPrompt` (including
      `undefined` staying `undefined`) — verified by `create-run.test.ts`'s "none" case.
- [x] Only `inline_image_markdown` advertised: persisted `systemPrompt` is
      `[callerPrompt, INLINE_IMAGE_INSTRUCTIONS].join("\n\n")` — same externally observable result as
      before, via the new mechanism — verified by `create-run.test.ts`.
- [x] Only `file_link_markdown` advertised: persisted `systemPrompt` contains
      `FILE_LINK_INSTRUCTIONS` after any caller prompt, no image instruction — verified by
      `create-run.test.ts` and `bootstrap.test.ts`.
- [x] Both advertised: both blocks present, in stable order (image, then file-link), regardless of
      `hello` declaration order — verified by `create-run.test.ts`'s "both" case.
- [x] A caller-supplied prompt is always first, never mutated/reordered, in every case — verified by
      all four `create-run.test.ts` cases.
- [x] CLI-created sessions (no capabilities advertised) are unaffected — `create-run.test.ts`'s
      existing "no capability" case passes unchanged.
- [x] `npm run build`, `npm run typecheck`, `npm run lint` pass (protocol + server scoped builds;
      full-workspace `npm run build` runs once at sprint end per task-006).

## Follow-ups / TODO(verify)
- None.
