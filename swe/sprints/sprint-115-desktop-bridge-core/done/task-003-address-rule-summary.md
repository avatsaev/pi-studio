# Task 003 — The address rule in Rust, with test vectors shared with the workbench — Summary

- **Sprint:** sprint-115-desktop-bridge-core
- **Completed:** 2026-11-22
- **Status:** done

## What was built
- `normalize_daemon_url` in `desktop/crates/model/src/address_rule.rs`: the Rust twin of the workbench's `normalizeDaemonUrl`. Whitespace trimming follows JavaScript's `trim` set (Rust's differs: U+0085 and U+FEFF); the scheme match is ASCII-case-insensitive like the workbench's `/i`.
- `address_matches(page_url, stored)`: exact equality against the rule applied to the stored address; false when the stored address normalises to nothing (so an empty page URL never matches an entry with no usable address — a deliberate deviation from plain equality).
- 59 shared `{input, expected}` vectors in `packages/workbench/src/lib/connection/normalize-url.vectors.json` (not shipped: the package's `files` is `dist`); the workbench test and the Rust tests read the same file.

## Files changed
New: `desktop/crates/model/src/address_rule.rs`, `packages/workbench/src/lib/connection/normalize-url.vectors.json`. Edited: `desktop/crates/model/src/lib.rs`, `packages/workbench/src/lib/connection/normalize-url.test.ts`, `desktop/AGENTS.md`, `desktop/README.md`, `desktop/docs/architecture.md`, `packages/workbench/AGENTS.md`.

## Commands run
- `npx vitest run packages/workbench/src/lib/connection`: 26 passed. `cargo test -p pistudiodesktop-model`: 27 passed (6 new). Clippy clean (one `is_multiple_of` lint fixed), wasm32 check ok, `cargo fmt --check` clean, oxfmt/oxlint clean.

## Wave gate (orchestrator, combined tree)
- `cargo xtask ci` in `desktop/`: all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm).
- Root `npm run build && npm run typecheck && npm run lint && npm test`: exit 0; 291 files, 4,133 tests passed.

## Acceptance criteria
- [x] Both tests pass over the same file; editing one vector made Rust's `matches_every_shared_vector` and `address_matches_every_normalised_vector` and the workbench's shared-vector test fail (then restored).
- [x] The Rust function never panics on arbitrary input: 20,000 generated combinations, 2,000 lossy-UTF-8 byte strings, a 1 MiB input and a 1 MiB run of slashes.
- [x] `cargo xtask ci` and the root gates pass (wave gate).

## Follow-ups / TODO(verify)
- Nothing applies the "only `ws:`/`wss:` are dialled" check here (dial does); the command of 116/t001 combines them.
- `packages/workbench` changed (a test and a data file): merging to `main` releases a workbench version, as any change there does.
