# Task 002 — Pure helpers: `relativeRefPath`, `formatRefToken`, `planInsertion`

- **Sprint:** sprint-081-composer-path-drop
- **Status:** backlog
- **Type:** feature
- **Area:** packages/web-client (features/chat)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Every text decision a drop makes is a pure, Node-tested function, so the composer wiring stays thin.

## Context / why

web-client has no jsdom (`packages/web-client/AGENTS.md` § "Framework-free testing convention").
The path, quoting and spacing rules (D6, D7, D8, D13) carry the feature's edge cases, so they are
pinned here before any DOM work.

## Scope references

- swe/features/composer-path-drop.md § Public contract 5, § Behavior & algorithms (`relativeRefPath`,
  `formatRefToken`, `planInsertion`, Root resolution)
- swe/grills/drag-file-into-composer.md D1, D3, D6, D7, D8, D13
- packages/web-client/src/lib/paths.ts (`relativeToRoot`: **not** reused — see Notes)
- packages/web-client/src/features/sessions/workspace-grouping.ts (`normalizeCwd`)

## What to build

Create `packages/web-client/src/features/chat/composer-path-drop.ts` with `composer-path-drop.test.ts`
beside it:

- `refRoot(sessionCwd: string, homeDir: string | null) → string | null`:
  `normalizeCwd(cwd || "~", homeDir)` with any trailing `/` stripped. Returns `null` when the result
  still starts with `~` or is empty.
- `relativeRefPath(absPath: string, root: string | null) → string | null`: strict segment-boundary
  containment, as in the spec's pseudocode. A trailing `/` on the input (directory) is preserved on
  the output. The root itself, a sibling prefix (`/repo2/x` against `/repo`), an empty or `null`
  root, and a `~` root all yield `null`.
- `formatRefToken(rel: string) → string`: bare unless the path contains whitespace (any `\s`) or a
  backtick. Otherwise it is wrapped as a CommonMark code span: the fence is one backtick longer than
  the longest backtick run inside, padded with a space on both sides when the path starts or ends
  with a backtick.
- `planInsertion(text, selStart, selEnd, token) → { start, end, insert, caret }`: D13 smart spacing.
  Judge spacing from the characters outside `[selStart, selEnd)`. Clamp out-of-range or reversed
  offsets to `[0, text.length]`, with `start ≤ end`.

## Out of scope

- The drag MIME and payload (task-003)
- Any React or DOM code (task-005)
- Fixing `lib/paths.ts` `relativeToRoot`, or the tree's *Copy Relative Path* (follow-up; spec TODO #4)

## Acceptance criteria

- [ ] `refRoot`: `~` without `homeDir` → `null`; `~/p` with `homeDir` `/h` → `/h/p`; a trailing `/`
      is stripped; an empty cwd falls back to `~`
- [ ] `relativeRefPath`: inside → relative; nested folder with trailing `/` → relative with `/`;
      sibling prefix → `null`; equal to root (with and without `/`) → `null`; `null`/empty/`~` root →
      `null`
- [ ] `formatRefToken`: `src/a.ts` bare; `my docs/a.md` → `` `my docs/a.md` ``; a tab or newline
      inside → wrapped; ``a`b`` → ` ``a`b`` `; leading or trailing backtick → padded
- [ ] `planInsertion`: empty draft → `token + " "`, caret at the end; glued after a word → leading
      space; before an existing space → no trailing space; start of a line (after `\n`) → no leading
      space; a selection is replaced and spacing is judged outside it; reversed or out-of-range
      offsets are clamped

## Test / verification plan

- `npx vitest run packages/web-client/src/features/chat/composer-path-drop.test.ts`: all pass
- `npm run build:web-client` and `npm run typecheck` succeed; `npx oxfmt` on the two new files

## Notes

- `relativeToRoot` returns its input unchanged when the path is outside the root (which would
  insert an absolute path, violating D8) and has no segment-boundary check. Hence the separate
  strict helper.
