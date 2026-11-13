# Task 002 — `LogTap`: pino destination, 1000-line ring, truncation, sanitizer; `createLogger({tap})`

- **Sprint:** sprint-085-daemon-log-streaming
- **Status:** done
- **Type:** feature
- **Area:** packages/server (logging)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal

A tap receives every line the daemon logger writes and keeps the last 1000 in a sanitised,
size-capped form. stdout and file output stay byte-for-byte unchanged.

## Context / why

`createLogger` (`logging/logger.ts:66-101`) builds `pino(base, multistream(streams))`, where every
entry needs its own `level` (comment :72-74). `silent` returns before any stream (:69).
`stdoutStream` is already an option (:55), which makes the byte-identity test possible.

## Scope references

- swe/features/daemon-log-streaming.md § Tapping pino without touching file logging, § Source of
  the backlog, § Line cap and sanitization, § Redaction expectations, § TODO(verify) (one line per
  write; sanitizer `tokens` exemption)
- packages/server/src/logging/logger.ts

## What to build

- `packages/server/src/logging/log-tap.ts`, `LogTap`:
  - `stream`: a `Writable` that splits chunks on `\n`;
  - per line:
    - truncate at tap time if over 8192 bytes (`msg` to 2048 chars, string fields to 1024,
      `err.stack` to 2048, depth over 4 becomes `"[truncated]"`, `fields.truncated: true`);
    - sanitise: redact the values of keys in the spec's key family to `"[redacted]"` at depth 4
      or less, and mask `pi-studio.bearer.<…>`;
    - non-JSON becomes an info line with the receipt time;
  - push to a 1000-entry ring;
  - fast numeric level read;
  - fan out to registered listeners `(line, levelNum)`.
  - `backlog(minLevelNum, n)`: the newest-first scan, returned oldest first.
  - `toLogLine(raw)`: level number to name; strip `level/time/msg/pid/hostname/v` into `fields`,
    which is omitted when empty.
  - `effectiveLevel`: the logger level the tap was attached at, or `"silent"` when unattached.
  - The tap never throws into pino.
- `CreateLoggerOptions.tap?: LogTap`: when set and the level is not silent, push one extra
  multistream entry at the same resolved level. Nothing else changes.
- Sanitizer key matching: match whole key names (case-insensitive) so usage counters such as
  `tokens`/`inputTokens` are **not** redacted. This resolves the spec TODO. Note in the summary
  any existing call site found that logs under a matching key.

## Acceptance criteria

- [ ] With the same log calls and a captured `stdoutStream` plus a temp `logDir`, stdout bytes and
  file bytes are identical with and without a tap.
- [ ] 1500 lines logged leaves the 1000 newest in the ring. `backlog(warn, 200)` returns only
  warn+, oldest first.
- [ ] A 100 KB string field yields a ring line of 8 KiB or less with `fields.truncated: true`.
- [ ] A raw-text chunk becomes an info line. A three-line chunk becomes three entries.
- [ ] `{password:"hunter2"}`, `{apiKey:"k"}` and `msg` containing `pi-studio.bearer.s3cr3t` are
  redacted or masked in the tap only. `{inputTokens: 12}` is not redacted.
- [ ] Verified against the installed pino: one serialised line per `write` (spec TODO), with the
  split rule kept as a safety net.

## Test / verification plan

- `npx vitest run packages/server/src/logging`; `npm run build:server`
