# Task 006 — App and CLI binaries: backend choice at launch, `--secret-store`, `secretStore` in the views — Summary

- **Sprint:** sprints/sprint-113-desktop-secret-store
- **Completed:** 2026-11-21
- **Status:** done

## What was implemented
- **`secret_choice`** (new `crates/shell/src/secret_choice.rs`), used by the app and its CLI. `--secret-store file` never touches the keychain; `keychain` fails the launch with a message naming the option; with no option a check on its own thread, bounded to 2 s, opens the platform store, reads a missing item (`KeychainStore::probe`), then writes and deletes a throwaway item (the worker deletes it even if the launch stopped waiting). A failure, `Denied` or no answer in time means the file backend plus `Notice::SecretStoreFallback { reason }` (`unavailable`, `denied`, `failed`). The check starts before the Tauri builder and is collected once the configuration directory is known. An unreadable `secrets.json` (`Opened.reset`) becomes `Notice::FileReset`.
- **App binary:** no longer uses `MemoryStore` (closes the s113/t004 decision); `Bridge` is managed after the choice; the owner thread gets the choice's notices first. **CLI:** `run --config-dir` takes `--secret-store` (requires `--config-dir`; a usage error exits 2); its `secrets` dependency dropped.
- **Views:** `secretStore` in the registry view that `boot` and `daemons_changed` carry, and `ui.inspect` `connection: { secretStore }`.
- **Page:** `boot.ts` words `secret_store_fallback` by reason; `file_reset.keptAs` may be null (before, `boot` was rejected when the rename of a bad file had failed); `DaemonErrorCode` in `packages/workbench` and `CODES` in `host/daemons.ts` gain `secret_missing`, `secret_unavailable`, `secret_store_failed` (messages in `daemon-presentation.ts`); `daemon.remove` reads `notices` and `secret_not_removed` shows a toast through a new `tell` parameter of `createDesktopDaemons` and `createDesktopHost` (`main.tsx` supplies the toast).
- **Scripts:** `SECRET_STORE_ARG = "--secret-store=file"` (one `--flag=value` argument, as msedgedriver needs) in `macos.mjs`, `windows.mjs` (two sites) and `webview2-diagnostics.mjs` (two); a unit test scans those files. CLI tests pass `--secret-store file` whenever they pass `--config-dir`.
- Docs: `architecture.md` (two Decisions rows, one is the 30 s quit drop, the secrets paragraph, seam 5, the `boot` row), `control-protocol.md`, `development.md` (every command line passes `--secret-store file`; "Where the secrets go"), `desktop/AGENTS.md`, `swe/architecture/workbench-host-adapter.md` (`DaemonErrorCode`).
- Files: new `crates/shell/src/secret_choice.rs`, `scripts/platform-checks/app-process.test.mjs`; Rust `crates/engine/src/storage.rs`, shell `{lib,daemons,control,page,tests}.rs`, `tests/secret_guard.rs`, app `src-tauri/src/{main,bridge}.rs`, `commands/tests.rs`, CLI `{src/main.rs,tests/cli.rs,Cargo.toml}`, `Cargo.lock`; TS app `host/{boot,daemons,desktop-host}.ts` and tests, `main.tsx`, scripts; workbench `host/types.ts`, `daemon-presentation.ts` and its test. No new dependency (one removed).

## Results
```
cargo test: app 41, CLI 8, engine 60, shell 153 + secret_guard 1;  app npm: 120 tests;  workbench daemons: 147 passed;  build:workbench ok
live, debug binary, containers with scratch dirs (no real keychain touched):
  pi-desktop-xvfb --secret-store file: secretStore "file"; after daemon.add with a password secrets.json is mode 600 and holds it; daemons.json has hasPassword true and no secret; app log has none
  no option, no D-Bus: "file" plus the WARN line;  --secret-store keychain: exit 2 naming the option;  --secret-store memory: exit 2 (clap)
  pi-desktop-keyring, login collection unlocked, no option: "keychain"; no secrets.json; secret-tool shows exactly one item (the throwaway was not left behind)
  same, --secret-store keychain, add then remove: items 1 -> 2 -> 1
  keyring container, collection not unlocked (the wave-2 case): the read passes, the write is denied: "file", WARN "access to the secret store was denied", secrets.json created; with --secret-store keychain the launch exits 2
```

## Wave gate (orchestrator, combined tree, 2026-11-21)
```
$ (cd desktop && cargo xtask ci)     all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ npm run build && npm run typecheck && npm run lint && npm test     all exit 0; 291 files, 4132 tests passed
$ (cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)     exit 0; 120 tests passed
```

## Acceptance criteria
All five met (`boot` and the event were covered by tests; the live runs had no webview, so only `ui.inspect` was read from a running app).

## Follow-ups / TODO(verify)
- The toast and notice texts were not seen in a rendered page (unit tests only; `npm run snapshot` not run).
- A real macOS prompt and the macOS and Windows store crates: sprint 117.
- Keychain scope: the CLI hashes the `--config-dir` it is given while the app with its default directory uses scope `default`, so the CLI cannot reach the app's keychain secrets for that directory (documented; `file` on both avoids it). The CLI's default changed from always-file to keychain-else-file.
- A store job outstanding after the 30 s drain at quit is dropped and may leave an orphan item (now documented).
- `desktop/docs/platform-checks.md` and `desktop/README.md` were not touched here (task-008).
- Merging publishes a workbench release (`packages/workbench` changed).
