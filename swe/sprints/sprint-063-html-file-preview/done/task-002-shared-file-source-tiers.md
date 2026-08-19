# Task 002 — Shared file-source size ladder (`use-file-source`)

- **Sprint:** sprint-063-html-file-preview
- **Status:** done
- **Type:** refactor
- **Area:** web-client / hooks
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
Extract `TextViewer`'s three-tier source-loading ladder (inline read → streamed download → too
large) into one reusable hook, so the markdown and HTML viewers get the same behavior instead of
failing outright on files over the daemon's 5 MiB inline read cap.

## Context / why
The ladder exists only inside `TextViewer` (`TextViewer.tsx:42-49` + the pure
`text-viewer-state.ts` selector): tier 1 `useFileRead`, tier 2 `useFileText` when
`FileTooLargeError.size <= MAX_DISPLAY_BYTES`, tier 3 a terminal download-only state. Every other
text-shaped viewer re-implements tier 1 alone — `MarkdownFileViewer.tsx:22` is a bare `useFileRead`,
so a 6 MiB markdown file renders the string `file_too_large` as an error instead of streaming.

Task 003's HTML viewer cannot ship without tier 2: coverage reports, benchmark dashboards and
plot dumps — precisely the files worth previewing — routinely exceed 5 MiB
(`packages/server/src/files/limits.ts`, `MAX_INLINE_FILE_READ_BYTES`).

## Scope references
- `swe/features/html-file-preview.md` § Source loading (size tiers)
- `packages/web-client/src/features/files/TextViewer.tsx` (extraction source; must end up thinner,
  not behaviorally different)
- `packages/web-client/src/features/files/text-viewer-state.ts`,
  `text-viewer-state.test.ts` (the existing pure selector + its tests)
- `packages/web-client/src/hooks/use-file-read.ts` (`FileTooLargeError`),
  `use-file-text.ts`, `use-file-download.ts`
- `packages/web-client/src/features/files/MarkdownFileViewer.tsx` (first new consumer)

## What to build
- New `packages/web-client/src/hooks/use-file-source.ts`: composes `useFileRead`, the
  `FileTooLargeError` classification, `useFileText`, and the on-demand `useFileDownload` into one
  hook returning a discriminated state, e.g.
  ```ts
  type FileSourceState =
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; content: string; streamed: boolean }
    | { kind: "too-large"; size: number; requestDownload(): void; download: ... };
  ```
  Reuse the existing pure decision logic rather than writing a second one: keep
  `selectTextViewerState` (rename/relocate only if it stays pure and its tests move with it) as the
  hook's decision core, so the tier policy has exactly one implementation and stays unit-testable
  without React.
- `TextViewer` re-expressed on top of the hook: identical rendered states, identical copy, identical
  `MAX_DISPLAY_BYTES` semantics. No behavior change is permitted in this task.
- `MarkdownFileViewer` switched onto the hook: a file over the inline cap now streams and previews
  (with the same muted "streamed" affordance the text viewer shows), instead of erroring.

## Out of scope
- Changing `MAX_DISPLAY_BYTES` or the server's inline cap.
- Any change to `useFileDownload`'s object-URL ownership/revocation policy.
- The HTML viewer itself (task-003).

## Acceptance criteria
- [ ] `use-file-source.ts` exists and is the only place the tier decision is made; `TextViewer`
      contains no tier branching of its own.
- [ ] The pure tier selector keeps unit tests covering all three tiers (moved, not deleted) and they
      pass unchanged in substance.
- [ ] `TextViewer`'s observable states are unchanged: normal file, over-inline-cap streamed file
      (with the streamed note), over-display-cap terminal state with a working download action.
- [ ] A markdown file larger than 5 MiB previews via the streamed tier instead of showing
      `file_too_large`.
- [ ] `npm run build:web-client` and `npm run typecheck` pass.

## Test / verification plan
- Unit: `npx vitest run packages/web-client/src/features/files packages/web-client/src/hooks`.
- Manual: with the production daemon (`npm start` — the binary download path is registered only in
  the production bootstrap, not `dev:daemon`), open a >5 MiB text file and a >5 MiB markdown file;
  both render, the note says streamed. Open a >30 MiB file; the terminal state offers a download.
- Build/typecheck as above.

## Notes
`useFileText` decodes over the download's object URL and is keyed on it (`rpcKeys.fileText(path,
objectUrl)`), so a live refetch already re-decodes automatically — do not add a second invalidation
path for it.
