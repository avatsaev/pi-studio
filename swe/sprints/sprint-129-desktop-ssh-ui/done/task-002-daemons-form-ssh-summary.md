# Task 002 — Daemons form: the SSH kind and the hosts of `~/.ssh/config` — Summary

- **Sprint:** sprint-129-desktop-ssh-ui
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- SSH kind in the Add and Edit form: name, host, user, port, key file, jump host, daemon port (empty = 6767), SSH password, key passphrase, daemon password. An edit starts from the saved settings and never carries a saved secret; each secret has the saved marker, Clear and Keep (a typed secret wins over a pending Clear; Clear on an unsaved secret sends nothing).
- A select of the `~/.ssh/config` hosts above Host (from `sshHosts()` when an SSH form opens; absent when the config does not parse); choosing one sets the host and, when empty, the name; the config's user, port, key and jump host show as placeholders when the typed host matches an alias.
- Validation: blank host, bad port and daemon port in the form; the host's refusals land on their own fields (`invalid_host`, `invalid_user`, `invalid_port` (daemon-port refusals under Port), `invalid_path`, `invalid_jump`).
- Behaviour change for every kind: saving the current entry reconnects for any change except a rename.

## Files changed
`packages/workbench/src/features/daemons/{daemon-form.ts,daemon-form.test.ts,DaemonForm.tsx}`

## Build & test results
```
npx vitest run packages/workbench/src/features/daemons -> 156 passed; npm run build:workbench ok (check-dist ok); oxlint clean; tsc --noEmit clean
```

## Acceptance criteria
- [x] Pure `buildNewDaemon`/`buildPatch` tests for SSH incl. clearing; the list choice filling the form (`chooseSshHost` and placeholders).

## Follow-ups
- Not looked at in a browser: the form is only drawn when `host.daemons` exists (the desktop host), so the browser client is unchanged by construction; the desktop webview check is 129/t005.
