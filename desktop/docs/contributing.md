# Contributing

Read `AGENTS.md` first: it states the rules. This page is the checklist for the most common change.

## Add a command

A feature is not done until it is a command.

1. **Choose the id**: `<area>.<verb>` in camelCase (`item.setDone`, `file.saveAs`). Ids are public
   API for scripts and agents; never rename one after a release.
2. **Put the logic in the lowest crate that fits.** A domain algorithm belongs in an L2 crate with
   its own unit tests. The command only reads params, calls that code inside `Session::edit`, and
   shapes the result.
3. **Write the command** in `crates/engine/src/<area>_cmds.rs`: a `CommandSpec` in `specs()` and a
   `fn(&mut Session, &Value) -> Result<Value>`. For a new module, add one
   `v.extend(crate::<area>_cmds::specs());` line to `build()` in `commands.rs` and a `mod` line in
   `lib.rs`.
4. **Follow the four habits:**
   - Read params with the helpers in `params.rs`. A missing key is `None`; a wrong type is a
     `BadParams` that names the key.
   - Change the model only through `Session::edit`. The command is then one undo step and cannot
     half-apply.
   - Give `enabled` a reason that explains itself. It is the disabled menu item's tooltip and the
     error an agent reads.
   - Write the `params` string for a reader who has nothing else: types, defaults, units.
5. **Test it in the same module**: the behaviour, undo and redo, the disabled state, and bad
   params returning `Err` without recording a history step.
6. **If it needs a value from the user**: a value typed or chosen in the window travels as params
   of `engine.execute` from the component that collected it. A value only the platform can ask for
   (a file) is collected in `menus::invoke` in the shell, through a `Services` hook. A command
   never opens UI.
7. **Run `cargo xtask ci`.** `panic_hunt` covers the new command with no extra work.

## Other changes

- **A crate**: write its manifest in one step (`crates/*` is a glob, so a half-written
  `Cargo.toml` breaks every build), start `src/lib.rs` with the `forbid(unsafe_code)` and clippy
  `deny` lines the other crates carry, add it to `[workspace.dependencies]` and to `TABLE` in
  `xtask/src/layers.rs`.
- **UI**: a component reads the view it is given and calls `backend.control("engine.execute", …)`.
  State automation should see is a field on `UiState` in `crates/shell`; a colour or a radius is a
  variable in `apps/pistudiodesktop/src/tokens.css`; a platform capability is an optional hook on
  `Services`. Test the component with a fake backend, render with `npm run snapshot`, and look at
  the image before calling it done.
- **A shortcut or a menu item**: set `shortcut` or `menu` on the `CommandSpec`. Nothing else.
- **The file format**: a new optional field gets `#[serde(default)]`; a change an older build must
  not misread bumps `VERSION` in `crates/format` and adds a migration arm in `decode`. Extend the
  hostile-file test.
- **A bug**: reproduce it as a failing test at the lowest layer that shows it, and fix the cause
  where it is. For a crash, the test must have panicked before the fix.

## Style

- Rust: rustfmt at 160 columns (`cargo fmt --all`); clippy with `-D warnings`. One error enum per
  crate (`thiserror`); no `anyhow` in libraries. No `unwrap`, `expect`, `panic!`, `unreachable!`,
  `todo!` or `unimplemented!` outside tests, and no `unsafe`.
- TypeScript and React: strict TypeScript, checked by `tsc --noEmit` and linted by oxlint
  (`npm run lint`, rules in `apps/pistudiodesktop/.oxlintrc.json`). Function components take the
  backend and the data they draw as props; a component's styles are a CSS Module beside it; an
  effect that subscribes cleans up; no colour literals outside `tokens.css`; no `fetch`, no storage
  and no Tauri API outside `src/lib/backend.ts`.

## Pull requests

- Keep fixes narrow and tested: fix what the issue describes, where the bug is, with a test that
  fails without the fix.
- Review your own diff before opening the pull request.
- Report only what ran: say what you tested and what you could not.
- Do not change CI in a feature or fix pull request.
- Keep secrets and personal details out of the repository, logs and requests.
