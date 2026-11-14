# Releasing `@av-pi-studio/workbench`

Normal releases go through `scripts/publish.sh` / `.github/workflows/release.yml` together with
the other packages (order: protocol → relay → client → ui-library → workbench → web-client →
server → cli). `web-client` bundles the workbench from source, so the workbench is published for
**other** consumers (the desktop app), not for `web-client`'s own build.

## One-time first publish

npm Trusted Publishing can only be configured for a package that already exists, so do this
**before merging** the branch that adds the package (every push to `main` runs the whole release):

1. Build locally (`npm run build -w packages/workbench`) and publish a placeholder/initial
   version with a token: `npm publish -w packages/workbench --access public`. A version already
   on npm is skipped later (`publish.sh` checks `npm view`), so use the version currently in the
   repository (lockstep, e.g. `0.0.117`) — the release then publishes the next one.
2. On npmjs.com, open `@av-pi-studio/workbench` → Settings → Trusted Publisher and register
   `.github/workflows/release.yml` (repo `avatsaev/pi-studio`).
3. Merge. The release workflow then publishes subsequent versions via OIDC.

## Before merging a branch that changes the package set

Rehearse `npm run publish -- --dry-run` in a **throwaway git worktree** with a temporary commit.
It bumps every package, rewrites `@av-pi-studio/*` ranges, runs `npm install`, then builds,
typechecks, tests and dry-run-publishes in order. Any private workspace package outside
`ALL_PACKAGES` that pins a workspace version range (instead of `*`) fails the lockfile sync with
`ETARGET` — that is how the 0.0.117 release first failed.

## Rollback

Revert the merge commit, then `npm deprecate @av-pi-studio/workbench@<version> "<reason>"`
(published versions cannot be unpublished reliably).
