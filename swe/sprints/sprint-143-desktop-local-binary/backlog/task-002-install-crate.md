# Task 002 — Desktop crate `install`: download, verify, unpack, version layout

- **Sprint:** sprints/sprint-143-desktop-local-binary
- **Status:** backlog
- **Type:** feature
- **Area:** desktop (new crate `install`, L8, native only)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-140/task-001

## Goal
A crate that downloads an archive with progress and a stall limit, checks its SHA-256, keeps it in the
archive cache, unpacks it safely into `bin/versions/<v>`, checks `--version`, switches `current`, and
removes old versions.

## Context / why
S8, S9, P3, P9, P10. The shell has no HTTP client; the layer rules place network code at L8.

## Scope references
- `swe/features/single-binary-daemon.md` § The local entry, § Data & persistence touchpoints, S8, S9
- `desktop/docs/architecture.md` (layers table; add the crate), `desktop/xtask/src/layers.rs` (`TABLE`)
- Create: `desktop/crates/install/` (`pistudiodesktop-install`); dependencies `reqwest` (rustls, stream; the version the updater already brings), `sha2`, `tar`, `flate2`

## What to build
- `download(url, expected_sha256, size, dest, stall, progress) -> Result<(), DownloadError>`: streams
  to `dest.part`, hashes on the way, renames on success, removes on any failure.
- `ArchiveCache { dir }`: `path(version, target)`, `get_or_download(…)`, `retain_only(version)`.
- `install_version(archive, bin_dir, version) -> Result<(), InstallError>`: unpack into
  `bin/tmp/<random>/`, refuse an entry outside it or a link pointing outside it, run `<dir>/pi-studio
  --version` (15 s), rename into `versions/<version>`, switch `current` atomically (symlink
  `current.new`, rename), empty `bin/tmp`.
- `current_version(bin_dir)`, `prune(bin_dir, keep: [&str])`.
- No `unwrap`/`expect`/`panic` outside tests; nothing logs a URL's query or a path's content.

## Out of scope
When to install (task-003).

## Acceptance criteria
- [ ] Tests against a local HTTP server: success; checksum mismatch; stall; server error; a `../`
      entry; a symlink escaping; a binary answering another version; `current` switch atomic; prune
      keeps the given versions.
- [ ] `cargo xtask ci` green, the crate in the layers table.

## Test / verification plan
- `cargo test -p pistudiodesktop-install`; `cargo xtask ci`

## Notes
Use a test archive built in the test (a script named `pi-studio` that prints a version), not a real binary.
