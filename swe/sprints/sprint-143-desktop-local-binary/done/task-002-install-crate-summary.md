# Task 002 — The `install` crate — Summary

- **Sprint:** sprint-143-desktop-local-binary
- **Completed:** 2026-11-24
- **Status:** done

## What was built
`desktop/crates/install` (`pistudiodesktop-install`, L8, native only, empty on wasm32): `download(&Asset{url,sha256,size}, dest, stall, progress)` (async; `.part`, hashes, renames only on matching size and SHA-256, removes the partial on failure or drop; `stall` per piece; errors never contain the URL), `ArchiveCache`, `install_version(archive, bin_dir, version)` (blocking; unpack into `bin/tmp/<random>/`; refuses `..`, absolute, hard links, devices, escaping symlinks, setuid/group-other-write bits; caps 50 000 entries / 2 GiB; `--version` 15 s must equal; rename into `versions/<v>`; atomic `current` switch), `current_version`, `prune` (never removes what `current` points to), `binary_version`. In the xtask TABLE (only apps may use it), `desktop/AGENTS.md`, `desktop/docs/architecture.md`; `reqwest` 0.13.5 (`rustls-no-provider`, ring + platform-verifier), `rustls`, `tar`, `flate2`.

## Results
`cargo test -p pistudiodesktop-install` 50 passed (~20 repeats; one flaky atomic-switch test fixed); clippy `-D warnings` clean; `cargo xtask layers` ok (no aws-lc); full `cargo xtask ci` green (8 steps).

## Acceptance
- [x] Local-server tests for every listed case. [x] `cargo xtask ci`, crate in the layers table.

## Follow-ups for 143/003
`download` is async, the rest block (`spawn_blocking`); throttle `progress` to 250 ms; the link switch is unix only.
