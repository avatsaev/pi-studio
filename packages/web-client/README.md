# `@av-pi-studio/web-client`

The production React/Vite browser UI for Pi-Studio — connects to a daemon over WebSocket
(`@av-pi-studio/client`) and renders chat sessions, agent-stream timelines, tool calls, terminals,
a file/diff viewer, and git status. Ships as a prebuilt static SPA (`dist/web`), served by
`pi-studio ui`, `docker/web-client.Dockerfile`, or any static file host.

---

## Brand configuration

The toolbar title and the browser favicon can be overridden **at build time**, with no source
changes — a reseller/operator can ship their own branded distribution of the web UI. This is
deliberately narrow: **no** theme, accent color, or logo overrides are part of this mechanism (see
[Scope](#scope) below).

With both variables unset, the build is byte-for-byte the default **Pi-Studio** distribution.

### Environment variables

| Variable | Default | Effect |
|---|---|---|
| `PI_STUDIO_BRAND_TITLE` | `Pi-Studio` | The document `<title>` and the connection bar's brand label |
| `PI_STUDIO_BRAND_ICON` | _(unset → `public/favicon.svg`)_ | Path to a `.svg`, `.png`, or `.ico` file that replaces the favicon |

Both are read once, at Vite config-eval time, by `vite.config.ts`'s `brandHtmlPlugin` (backed by
the pure resolver in `src/brand/build-brand.ts`) — they apply identically to `npm run dev`,
`npm run build:web`, and `npm run build:electron`.

### Usage

```bash
PI_STUDIO_BRAND_TITLE="Acme Coder" \
PI_STUDIO_BRAND_ICON="/path/to/acme-icon.svg" \
npm run build:web -w @av-pi-studio/web-client
```

Only the title, only the icon, or neither — each variable is independent:

```bash
# Title only, default favicon
PI_STUDIO_BRAND_TITLE="Acme Coder" npm run build:web -w @av-pi-studio/web-client

# Icon only, default "Pi-Studio" title
PI_STUDIO_BRAND_ICON="./brand/acme-icon.png" npm run build:web -w @av-pi-studio/web-client
```

Also honored by the dev server, so a branded checkout previews correctly locally:

```bash
PI_STUDIO_BRAND_TITLE="Acme Coder" PI_STUDIO_BRAND_ICON="./brand/acme-icon.svg" \
npm run dev -w @av-pi-studio/web-client
```

### Behavior

- `PI_STUDIO_BRAND_TITLE` is trimmed; blank/whitespace-only is treated as unset.
- `PI_STUDIO_BRAND_ICON` must point at an existing `.svg`, `.png`, or `.ico` file. A missing file
  or an unsupported extension **fails the build** with a clear error — it never falls back to the
  default icon silently.
- The icon is copied into the build output as `brand-icon.<ext>` and the favicon `<link>`'s
  `type` attribute is set from the extension automatically.

### Docker

`docker/web-client.Dockerfile` accepts `PI_STUDIO_BRAND_TITLE`/`PI_STUDIO_BRAND_ICON` as build
args, forwarded to `npm run build:web` inside the build stage:

```bash
docker build --build-arg PI_STUDIO_BRAND_TITLE="Acme Coder" \
  -f docker/web-client.Dockerfile -t acme-web-client .
```

`PI_STUDIO_BRAND_ICON` must be a path inside the build context (the Vite build runs inside the
image, not on the host) — `COPY` the icon in before `RUN npm run build:web` if you need one. The
higher-level `scripts/docker-publish.sh` (`npm run docker:publish`) does **not** expose these —
it always builds the default Pi-Studio branding; a branded release is a manual `docker build`/
`docker push` against a distinct tag (see `docker/README.md`'s Brand builds section for a worked
example), then `scripts/dokploy-deploy.sh web-client --tag <that-tag>`.

### Scope

Only the title and favicon are build-time-overridable today. `src/brand/config.ts` (a
`BrandConfig` shape covering accent colors, a logo triplet, links, and legal text) is a separate,
broader scaffold ported from an earlier clean-room spec — it has no loader wired to it
(`getActiveBrand()` always returns the built-in default) and is not part of this feature. See
`AGENTS.md`'s § Invariants "Build-time brand override" for the full rationale, and
`src/brand/build-brand.ts`/`src/brand/build-brand.test.ts` for the implementation.

---

## Development

```bash
npm run dev -w @av-pi-studio/web-client        # Vite dev server (proxies WS to a daemon)
npm run typecheck -w @av-pi-studio/web-client  # tsc --noEmit
npm run build:web -w @av-pi-studio/web-client  # browser build (dist/web)
npx vitest run packages/web-client
```

See `AGENTS.md` (architecture, source layout, invariants) and `DESIGN_SYSTEM.md` (theme/token
pipeline, primitives) for the rest of this package's documentation.
