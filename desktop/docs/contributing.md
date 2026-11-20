# Contributing

Read `AGENTS.md` first: it states the rules. This page walks through the most common change.

## Add a command

A feature is not done until it is a command.

1. **Choose the id**: `<area>.<verb>` in camelCase (`settings.set`, `daemon.switch`). Ids are public
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
   - Change state only through a `Session` method (`set_setting` validates the value, then
     writes the file), so a bad value changes nothing.
   - Give `enabled` a reason that explains itself. It is the disabled menu item's tooltip and the
     error an agent reads.
   - Write the `params` string for a reader who has nothing else: types, defaults, units.
5. **Test it in the same module**: the behaviour, the disabled state, and bad
   params returning `Err` with the state unchanged.
6. **If it needs a value only the platform can ask for** (a file): it is collected in
   `menus::invoke` in the shell, through a `Services` hook. A command never opens UI.
7. **Run `cargo xtask ci`.** `panic_hunt` covers the new command with no extra work.

## Other changes

- **A crate**: write its manifest in one step (`crates/*` is a glob, so a half-written
  `Cargo.toml` breaks every build), start `src/lib.rs` with the `forbid(unsafe_code)` and clippy
  `deny` lines the other crates carry, add it to `[workspace.dependencies]` and to `TABLE` in
  `xtask/src/layers.rs`.
- **UI**: change it in `packages/workbench` (see its `AGENTS.md`), where the browser client gets it
  too. Something the platform must do for the UI is a member of the workbench host; this package
  supplies the host. Render with `npm run snapshot` and look at the image before calling it done.
- **A shortcut or a menu item**: set `shortcut` or `menu` on the `CommandSpec`. Nothing else.
- **A stored file** (`settings.json`, `daemon-state/<entry>.json`): a new optional field gets
  `#[serde(default)]`; a change an older build must not misread bumps `VERSION` in `crates/model`
  and adds a migration arm in its `decode_*`. Extend the hostile-file tests.
- **A bug**: reproduce it as a failing test at the lowest layer that shows it, and fix the cause
  where it is. For a crash, the test must have panicked before the fix.

## Style

- Rust: rustfmt at 160 columns (`cargo fmt --all`); clippy with `-D warnings`. One error enum per
  crate (`thiserror`); no `anyhow` in libraries. No `unwrap`, `expect`, `panic!`, `unreachable!`,
  `todo!` or `unimplemented!` outside tests, and no `unsafe`.
- TypeScript and React: strict TypeScript, checked by `tsc -b` and linted by oxlint
  (`npm run lint`, rules in `apps/pistudiodesktop/.oxlintrc.json`): no `fetch`, no socket, no
  storage and no Tauri API in this package's own code.

## Pull requests

- Keep fixes narrow and tested: fix what the issue describes, where the bug is, with a test that
  fails without the fix.
- Review your own diff before opening the pull request.
- Report only what ran: say what you tested and what you could not.
- Do not change CI in a feature or fix pull request.
- Keep secrets and personal details out of the repository, logs and requests.
