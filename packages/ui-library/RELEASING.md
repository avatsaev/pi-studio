# Releasing `@av-pi-studio/ui-library`

Normal releases go through `scripts/publish.sh` / `.github/workflows/release.yml` together with
the other packages (order: protocol → relay → client → ui-library → web-client → server → cli).

## One-time first publish

npm Trusted Publishing can only be configured for a package that already exists, so do this
**before merging** the branch that adds the package:

1. Build locally (`npm run build -w packages/ui-library`) and publish a placeholder/initial
   version with a token: `npm publish -w packages/ui-library --access public`.
2. On npmjs.com, open `@av-pi-studio/ui-library` → Settings → Trusted Publisher and register
   `.github/workflows/release.yml` (repo `avatsaev/pi-studio`).
3. Merge. The release workflow then publishes subsequent versions via OIDC.

## Rollback

Revert the merge commit, then `npm deprecate @av-pi-studio/ui-library@<version> "<reason>"`
(published versions cannot be unpublished reliably).
