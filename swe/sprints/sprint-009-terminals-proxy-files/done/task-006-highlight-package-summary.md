# Task 006 — Highlight package (server-side syntax highlighting) — Summary

- **Sprint:** sprint-009-terminals-proxy-files
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/highlight/src/highlight.ts` — a pure-JS, dependency-free tokenizer:
- **`detectLanguage(pathOrHint)`** — maps extensions (`ts/tsx/mts/.../js/jsx/.../json`) and direct
  language-name hints to a `Language`; unknown → `plaintext`.
- **`highlight(source, hint)`** → `{ language, tokens: HighlightToken[] }` where each token is
  `{ type, value }` (`keyword | string | comment | number | punctuation | identifier | text`).
  Regex-based tokenizer for TS/JS (comments, strings incl. template literals, numbers, keyword
  classification, punctuation, identifiers) and JSON (string/number/literal/punctuation); whitespace
  + unknown chars are preserved as `text`.
- **Lossless:** concatenating `tokens[].value` in order exactly reproduces the source — a stable,
  serializable shape reusable by file preview + diff rendering.
- **Plain-text fallback:** unknown languages return a single `text` token (empty source → `[]`).
- The package is standalone (no server-internal deps) and builds in the layered build.

## Files created / changed
| File | Change |
|------|--------|
| `packages/highlight/src/highlight.ts` | created |
| `packages/highlight/src/index.ts` | modified (re-export) |
| `packages/highlight/src/highlight.test.ts` | added — 7 tests |

## Build & test results
```
$ npm run build:highlight                                     → exit 0
$ npx vitest run packages/highlight/src/highlight.test.ts     → 7 passed
$ npx oxlint / oxfmt --check packages/highlight                → clean
```

## Acceptance criteria
- [x] Highlighting a known language returns tokenized spans; an unknown language falls back to plain
      text.
- [x] The output shape is serializable and stable (lossless reassembly) for reuse by preview + diff.
- [x] The package builds in the layered build with no dependency on server internals.

## Follow-ups / TODO(verify)
- The original package's exact highlighter library / grammar set (modeled with a lightweight
  regex tokenizer covering TS/JS/JSON + plain-text fallback). Client rendering of spans is sprint-012.
