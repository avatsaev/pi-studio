# Task 005 — `file_link_markdown` capability + generalized instruction composition

- **Sprint:** sprint-051-file-link-rendering
- **Status:** done
- **Estimated size:** S
- **Depends on:** none

## Goal
Register the `file_link_markdown` capability flag, advertise it from the web-client, and generalize
the daemon's single-flag system-prompt ternary into an ordered, N-capability composition so both the
existing image instruction and the new file-link instruction compose deterministically.

## Background / why
`file-link-rendering.md` § Capability flag defines `file_link_markdown`, appended to the same
registry `inline_image_markdown` lives in (`packages/protocol/src/client-capabilities.ts`), read
through the same `supports(caps, flag)` helper — purely additive.

§ Composing multiple capability-gated instructions requires:
```
function composeSystemPrompt(callerPrompt, advertisedCapabilities):
    blocks = []
    for (flag, instructionText) in CAPABILITY_INSTRUCTIONS:   # ordered, stable list
        if advertisedCapabilities.supports(flag): blocks.append(instructionText)
    if blocks is empty: return callerPrompt
    return join([callerPrompt, *blocks], separator = blank line)
```
Today `agent-service.ts`'s `handleCreate` (~lines 151-163) hardcodes exactly one ternary for
`inline_image_markdown`. This task replaces it with the ordered N-capability form the spec requires
— the existing image instruction moves onto the new mechanism too, it is not left on the old
ternary beside a second one for file-link.

## Scope references
- `clean-room-scope/features/file-link-rendering.md` § Capability flag, § Agent instruction, §
  Composing multiple capability-gated instructions
- `packages/protocol/src/client-capabilities.ts` (`CLIENT_CAPS`)
- `packages/web-client/src/lib/connection/connection-store.ts:86-87` (`hello.capabilities`)
- `packages/server/src/agent/agent-service.ts:139-179` (`handleCreate`, ternary to replace)
- `packages/server/src/agent/inline-image-instructions.ts` (pattern to match)
- `packages/server/src/agent/create-run.test.ts:138-145` (`fakeSession` pattern to extend)
- `packages/server/src/daemon/bootstrap.test.ts:194-230` (end-to-end pattern to extend)

## What to build
- `client-capabilities.ts`: append
  ```ts
  /** Client renders markdown links (`[label](path)`) whose target is a local filesystem path as an
   * open-file action. */
  file_link_markdown: "file_link_markdown",
  ```
  Append-only.
- `connection-store.ts`: add `[CLIENT_CAPS.file_link_markdown]: true` alongside the existing
  `inline_image_markdown` entry, unconditional, same pattern.
- New `packages/server/src/agent/file-link-instructions.ts`, matching
  `inline-image-instructions.ts`'s doc-comment style (spawn-time binding caveat, cross-reference to
  `file-link-rendering.md` § Known Limitations), exporting `FILE_LINK_INSTRUCTIONS: string`.
  Content requirements (exact wording not contractual): states a referenced file/path can be made
  actionable; instructs `[label](path)` syntax; states `path` follows the same rules as image paths
  (workspace-relative, absolute, `~`-relative); constrains it to files that actually exist; short,
  same order of magnitude as `INLINE_IMAGE_INSTRUCTIONS`.
- New `packages/server/src/agent/compose-system-prompt.ts`:
  ```ts
  export const CAPABILITY_INSTRUCTIONS: ReadonlyArray<readonly [flag: string, text: string]> = [
    [CLIENT_CAPS.inline_image_markdown, INLINE_IMAGE_INSTRUCTIONS],
    [CLIENT_CAPS.file_link_markdown, FILE_LINK_INSTRUCTIONS],
  ];
  export function composeSystemPrompt(
    callerPrompt: string | undefined,
    supports: (flag: string) => boolean,
  ): string | undefined;
  ```
  Returns `callerPrompt` unchanged (including `undefined`) when no advertised capability has an
  instruction; otherwise joins `[callerPrompt, ...blocks]` with a blank-line separator,
  `callerPrompt` always first, never reordered/replaced/dropped.
- `agent-service.ts`: replace the `effectiveConfig` ternary with a call to
  `composeSystemPrompt(config.systemPrompt as string | undefined, (flag) => wsSession?.supports(flag)
  ?? false)`, still building a **new** `effectiveConfig` object (never mutating `config`).

## Out of scope
- Any client rendering/click/drag behavior (tasks 001-004).
- Recomposing the prompt when a different client later attaches to an existing session.

## Acceptance criteria
- [ ] Neither flag advertised: `effectiveConfig.systemPrompt === config.systemPrompt` (including
      `undefined` staying `undefined`).
- [ ] Only `inline_image_markdown` advertised: persisted `systemPrompt` is
      `[callerPrompt, INLINE_IMAGE_INSTRUCTIONS].join("\n\n")` (or just the instruction when no
      caller prompt) — same externally observable result as before this task, via the new mechanism.
- [ ] Only `file_link_markdown` advertised: persisted `systemPrompt` contains
      `FILE_LINK_INSTRUCTIONS` appended after any caller prompt, and does not contain the image
      instruction.
- [ ] Both advertised: both blocks present, in the stable order (image, then file-link), regardless
      of the `hello` frame's declaration order.
- [ ] A caller-supplied prompt is always first, never mutated/reordered, in every case above.
- [ ] CLI-created sessions (no capabilities advertised) are unaffected —
      `create-run.test.ts`'s existing "no capability" case still passes unchanged.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint` pass.

## Test / verification plan
- Unit: extend `create-run.test.ts` with a `describe` covering none/image-only/link-only/both
  against `composeSystemPrompt` directly (extend the existing `fakeSession` pattern to support both
  flags).
- Integration: extend `daemon/bootstrap.test.ts`'s two existing `inline_image_markdown` end-to-end
  cases with a third covering `file_link_markdown` (or both) through a real `hello` → `handleCreate`
  chain.
- Run: `npx vitest run packages/server/src/agent packages/server/src/daemon/bootstrap.test.ts`.

## Notes
Keep `CAPABILITY_INSTRUCTIONS`' declared order (image, then file-link) as the single source of
composition order — call-site iteration order of `wsSession.capabilities` must never leak into
output order.
