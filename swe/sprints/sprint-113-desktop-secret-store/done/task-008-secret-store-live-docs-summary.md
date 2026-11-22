# Task 008 — Linux live checks and documents for the secret store — Summary

- **Sprint:** sprints/sprint-113-desktop-secret-store
- **Completed:** 2026-11-21
- **Status:** done

## What was run
A debug build of `pistudiodesktop` (one build, a private copy under `/tmp/secretlive/bin`), driven through WebKitWebDriver in `pi-desktop-xvfb` and `pi-desktop-keyring` on the host network with a scratch `--config-dir` each time. A scratch production daemon (password `hunter2pw`, `PI_STUDIO_PASSWORD`) and a scratch relay; ports from the OS; nothing touched the real keychain. Everything was removed afterwards; only the screenshot `/tmp/secretlive-daemons-screen.png` was kept.

**Check 1: a version 1 file migrates** (no `--secret-store`, no Secret Service). The v1 `daemons.json` held `local`, a direct entry "Direct box" with a password and a relay entry "Relay box" with a pairing link from `pi-studio --json daemon pair`. Afterwards `daemons.json` was version 2, mode 600, `hasPassword` true on the password entry and false elsewhere, no `hunter2pw`, no `pairingLink`; `secrets.json` mode 600 held `<id>/password` and `<id>/pairingLink`; no `*.corrupt-*`; `boot` answered `secretStore: "file"` with three entries and no secret. The page showed "Direct box · connected" on the password-protected daemon straight after boot; switching to "Relay box" showed "Relay box · connected" (the relay logged a paired connection, `timeToPairMs` 2); neither the daemon log nor the relay log contained the password.

**Check 2: a Secret Service** (`pi-desktop-keyring`, no option, unlock-then-start gnome-keyring). `boot`: `secretStore: "keychain"`, no notices. Through the page's `engine_command`, with `secret-tool search --all service com.avatsaev.pi-studio` after each step:

| Step | Items |
|---|---|
| add direct (`pw-one`) | one item `573d1016f50d4d45/<id>/password` = `pw-one` |
| add relay | a second item, `.../pairingLink` = the link |
| edit password | `pw-two` |
| rename only | unchanged |
| clear (`password: null`) | password item gone, `hasPassword: false` |
| set again | `pw-one` |
| remove direct | password item gone |
| remove relay | no items |

`daemons.json` held no secret at any point (0 matches for `pw-one`, `pw-two`, `SECRETLINK`) and no `secrets.json` was created.

**Check 3: no Secret Service.** `boot` said `secretStore: "file"`, `secrets.json` mode 600; the screenshot shows the Daemons screen with the line "Passwords and pairing links are kept in a file only this user can read, because no keychain is available." and the page showed the one-time notice that no keychain could be reached.

## Documents changed
`desktop/docs/platform-checks.md` (R4 covers the secret store: a keychain run for macOS and Windows, a `--secret-store file` run, the account format and the prompt note; N1 allows `secrets.json`; the automated row says scripts pass `--secret-store file`), `desktop/README.md`, `desktop/docs/development.md` (a recipe for the secret store in the real webview), `swe/features/desktop-daemon-registry.md` (D13/D27 carried out in milestone 2; section 1 shows version 2 and points to the bridge spec section 5; the persistence table has a row for secrets), `swe/features/desktop-transport-bridge.md` (the version 1 migration criterion and the no-keychain criterion ticked with evidence; the keychain criterion left open with the Linux evidence; the migration text now says the file stays byte for byte and secrets are served from memory with a `secrets_not_moved` notice; a relay entry with `hasPassword: true` is a wrong shape; two TODO(verify) closed). `desktop/AGENTS.md` and `desktop/docs/architecture.md` were already correct (tasks 004-006).

## Gates
```
cargo xtask layers   ok (11 crates);  rg over desktop docs, specs and swe/architecture: no document says a secret is in daemons.json except history, version 1 and *.corrupt-* copies
```

## Wave gate (orchestrator, combined tree, 2026-11-21)
```
$ (cd desktop && cargo xtask ci)     all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ (cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)     exit 0; 120 tests passed
```
(No file under `packages/` changed in this wave; the root gates of wave 4 stand.)

## Acceptance criteria
All four met. The keychain criterion stays unticked on purpose (macOS and Windows open); the secret-guard criterion is not covered until the bridged connect exists (sprint 116).

## Follow-ups / TODO(verify)
- `xvfb-run` hung under `--user` inside the container; the recipe starts `Xvfb :99` explicitly.
- Add, edit and remove went through the webview's `engine_command`, not by clicking the edit form; the Daemons screen and the switcher were clicked for check 1.
- Not examined: a keychain prompt, a locked collection with a display, an unsigned macOS build, Windows file mode, the macOS and Windows keychain crates (sprint 117).
