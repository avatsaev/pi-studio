# Task 003 — Workbench: save a daemon file into a target the shell supplies, range by range

- **Sprint:** sprint-104-desktop-dialogs-links-save
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench (host)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
`createBrowserHost` accepts an optional save target. With one, "Download" streams the file into it with bounded memory and waits for each write; without one it behaves as today.

## Context / why
The desktop app must write a saved file through Rust, but the SDK's file-transfer client is private to the workbench, so the desktop frontend cannot run the download itself. The SDK's `downloadTo` sink is synchronous by contract: a consumer that must wait has to ask for ranges one after the other. This task puts that loop in the workbench, behind a small target interface the shell implements.

## Scope references
- `swe/features/desktop-native-host.md` § Save to disk, § Error handling (save rows)
- `swe/features/desktop-client-protocol-followups-2.md` § 1 (ranges, `ifUnchanged`, a `length` past the end is clamped)
- `packages/workbench/src/host/browser-files.ts` (`createBrowserFiles`, `downloadAsBlob`), `host/browser-host.ts` (`BrowserHostOptions`), `host/types.ts`, `host/files.test.ts`
- `packages/client/src/file-transfer-client.ts` (`downloadTo`: synchronous sink, `DownloadOptions`, `DownloadResult`)
- `packages/workbench/src/index.ts` (exported host types), `packages/workbench/README.md` § The host

## What to build
```ts
interface SaveTarget {
  write(chunk: Uint8Array): Promise<void>;
  finish(): Promise<void>;
  discard(): Promise<void>;
}
// BrowserHostOptions gains:
saveTarget?: (suggestedName: string) => Promise<SaveTarget | null>;
```
- With `saveTarget`, `files.saveToDisk(path)`:
  1. asks for a target with the path's file name; `null` means the user cancelled: resolve, nothing else happens;
  2. downloads the file in ranges of 8 MiB. The first range learns the file's size and modification time; every later range sends them as `ifUnchanged`;
  3. after each range, awaits `write` for its chunks in order, then asks for the next range;
  4. after the last range, awaits `finish`.
  On any failure (download refused, `changed`, connection lost, a `write` that rejects) it awaits `discard` once and rejects with the original error. An empty file is one `finish` with no `write`.
- Without `saveTarget`: the current Blob and anchor path, unchanged.
- Export `SaveTarget` from the package root; document the option in the README's host section.

## Out of scope
- The Tauri-backed target (task-007) and the Rust that writes the file (task-005).
- `openForView` and `upload`.

## Acceptance criteria
- [ ] With a fake transfer client and a recording target: writes arrive in file order and their bytes equal the file.
- [ ] The next range is not requested until the previous range's writes have resolved; no more than one range is held.
- [ ] A `null` target makes no download request and resolves.
- [ ] A failure in range 3 of 5 calls `discard` exactly once, never `finish`, and rejects with that failure.
- [ ] A file changed between ranges rejects with the daemon's `changed` error and discards.
- [ ] A zero-byte file calls `finish` once.
- [ ] Without `saveTarget`, the existing save tests pass unchanged.

## Test / verification plan
- `npx vitest run packages/workbench/src/host`
- `npm run build:workbench && npm run build:web-client`
- `npx oxfmt <changed files>`; `npm run lint`

## Notes
- **Found at planning time:** the spec's "send each chunk and wait" cannot be done inside `downloadTo`'s sink (it is synchronous). Ranges are the SDK's documented way to pace; 8 MiB is chosen, not measured (spec TODO: save throughput).
- Depends on task-001 only because both edit `host/browser-host.ts` and `host/types.ts`.
- A daemon without `fileDownloadRanges` makes `downloadTo` reject; that message is shown as any other save failure.
