# Task 002 — LogTap + createLogger({tap}) — Summary

- **Sprint:** sprints/sprint-085-daemon-log-streaming
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`LogTap` (`packages/server/src/logging/log-tap.ts`): Writable pino destination splitting on `\n`; per line JSON parse, redaction (whole-key match, case-insensitive; `pi-studio.bearer.*` masked), truncation to <= 8192 bytes (msg 2048, strings 1024, `err.stack` 2048, depth > 4 -> `"[truncated]"`, `truncated: true`, core-keys fallback for pathologically wide lines), non-JSON -> info line, 1000-entry ring, listeners `(raw, levelNum)`, `backlog(minLevelNum, n)`, `toLogLine(raw)`, `attach(level)`/`effectiveLevel`. `CreateLoggerOptions.tap` adds one extra multistream entry at the resolved level (none when silent).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/logging/log-tap.ts` | created |
| `packages/server/src/logging/log-tap.test.ts` | created (10 tests) |
| `packages/server/src/logging/logger.ts` | `tap` option |
| `packages/server/src/logging/index.ts` | export `LogTap`, `LogTapListener` |
| `packages/server/AGENTS.md` | layout + logging section |

## How it satisfies the scope
Spec TODO resolved: sanitizer matches whole key names so `tokens`/`inputTokens` are not redacted. Grep of `packages/server/src` found no existing call site logging under a matching key. Pino version installed emits exactly one `\n`-terminated line per `write` (asserted by test); the split rule remains as a safety net. Deviation (stricter): redaction applies at every depth, not only <= 4. Byte-identity test uses fake `Date` and normalises `err.stack` (differs by call site only).

## Build & test results
```
$ npx vitest run packages/server/src/logging -> 16 passed, 0 failed
$ npm run build:server                        -> success
$ npx oxlint / oxfmt (changed files)          -> clean
```

## Acceptance criteria
- [x] stdout and file bytes identical with/without tap
- [x] 1500 lines -> 1000 newest; `backlog(warn,200)` warn+ oldest first
- [x] 100 KB field -> <= 8 KiB line with `truncated: true`
- [x] raw text -> info line; 3-line chunk -> 3 entries
- [x] password/apiKey/bearer redacted in tap only; `inputTokens` kept
- [x] one line per write verified against installed pino

## Follow-ups / TODO(verify)
- Bootstrap wiring (create tap before logger) is task-004.
