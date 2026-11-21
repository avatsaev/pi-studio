# Task 003 — The address rule in Rust, with test vectors shared with the workbench

- **Sprint:** sprint-115-desktop-bridge-core
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/model, packages/workbench
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-112/task-007 (the gate passed)

## Goal
Rust turns a stored address into the same URL the workbench does, proven by one set of vectors both sides test against.

## Context / why
P9: Rust dials only the current entry's address, so it must recognise the URL the page hands it. The workbench normalises what the user typed (`http` to `ws`, a bare host gets `ws://`); two implementations drift unless they share their cases.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 2 (the `url` rule), decision P9
- `packages/workbench/src/lib/connection/normalize-url.ts` (`normalizeDaemonUrl`), `resolve-connect-target.ts`
- `desktop/crates/model/src/`

## What to build
- A JSON file of vectors beside the workbench's function (`input`, `expected`), covering each branch: the four schemes, a bare host with and without a port, trailing slashes, surrounding spaces, an unknown scheme, a path and a query, upper-case schemes, an empty string.
- A workbench test that runs `normalizeDaemonUrl` over the file, and a Rust function in the model crate with a test that reads the same file.
- A second pure function: whether a URL from the page equals the rule applied to a stored address.

## Out of scope
- Using it in a command (sprint 116).
- Changing the workbench's rule.

## Acceptance criteria
- [ ] Both tests pass over the same file; a vector changed on one side only fails the other's test.
- [ ] The Rust function never panics on arbitrary input (a generated-input test).
- [ ] The root gates and `cargo xtask ci` pass.

## Test / verification plan
- `npx vitest run packages/workbench/src/lib/connection`
- `cargo test -p pistudiodesktop-model`
- `cargo xtask ci` in `desktop/`

## Notes
- The vectors file lives under `packages/workbench`, so this task changes that package: merging it to `main` publishes an npm release like any workbench change. If that is unwanted, keep the file under `desktop/` and have the workbench test read it from there; say which was chosen.
