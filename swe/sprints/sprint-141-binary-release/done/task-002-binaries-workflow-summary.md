# Task 002 — The binaries workflow — Summary

- **Sprint:** sprint-141-binary-release
- **Completed:** 2026-11-24
- **Status:** done

## What was built (by the orchestrator)
`.github/workflows/daemon-binaries.yml`: `workflow_call` (version, ref, publish) and `pull_request` on `packages/**`, the build/smoke/manifest scripts, root manifests and the workflow. Matrix: `linux-x64` `ubuntu-24.04`, `linux-arm64` `ubuntu-24.04-arm`, `darwin-arm64` `macos-15`, `darwin-x64` `macos-15-intel` (replaces the retired `macos-13`; recorded, not yet run). Each: checkout `inputs.ref || github.sha`, `npm ci`, `npm run build`, `build:binary`, smoke test (10 min), upload the archive. `publish` needs `build`, `if: ${{ !cancelled() && inputs.publish && needs.build.result == 'success' }}`: download, `daemon-manifest.mjs`, `gh release create daemon-v<v> --latest=false` (or upload `--clobber`), create `daemon-updates` if missing, upload `latest.json --clobber`.
`release.yml`: the release job outputs `version` and `commit` (step `bump`); a `binaries` job calls the workflow with `publish: true` when the commit output exists, so npm and Docker never wait for it.

## Results
`actionlint` (docker `rhysd/actionlint`) clean on both. Nothing has run yet: the PR run is 141/004; the publish path first runs after your merge (142/006).

## Acceptance
- [x] actionlint clean. [x] Publish condition names the build result. [ ] PR run builds four targets and publishes nothing: 141/004.
