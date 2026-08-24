# Rebrand migration plan: pi-studio → pi-ade

> **pi-ade** — Pi Agentic Development Environment.
> The `pi-studio` name is already taken; this document is the full migration plan.
>
> Status: **plan approved, not yet executed.** Decisions below are final (2026-08-21).

---

## Decisions (locked)

| Question | Decision |
|---|---|
| npm scope | `@pi-ade/*` (org confirmed free on npm — claim it before anything else) |
| CLI binary | `pi-ade` |
| Compat policy | One-time auto-migration of `~/.pi-studio` → `~/.pi-ade` and web-client localStorage keys; `PI_ADE_*` env vars fall back to `PI_STUDIO_*` with a deprecation warning for **1–2 releases**, then the fallback is deleted |
| Historical docs | `swe/sprints/` (≈249 files) keeps the old name — historical record. Only living docs are renamed |
| Production domains | Unchanged — `relay.molagent.ai` / `app.molagent.ai` are platform-branded, not product-branded |
| Version | First `@pi-ade` release is **0.1.0** (old scope tops out at `@av-pi-studio/*@0.0.94`) |
| Old packages | No tombstone release; `npm deprecate` on all 8 with a pointer to `@pi-ade/*` |
| Wire compat | None needed — project is pre-public; the WS bearer subprotocol is hard-renamed with no dual-accept (decided 2026-08-21) |
| Docker Hub | `avatsaev/pi-ade-{daemon,relay,web-client}` |
| Git history | **Fresh** — the rebranded tree ships as a single initial commit in the new repo (`git@github.com:avatsaev/pi-ade.git`, local checkout `~/DEV/avatsaev/pi-ade`); the pi-studio history is NOT carried over (Phase 4) |
| Paseo | Every mention of "Paseo" (the design reference app) is scrubbed from the tree — **including `swe/sprints/`**, unlike the pi-studio name (§ 1.8) |

## Measured blast radius (2026-08-21, v0.0.94)

- Full spelling census (occurrence counts, whole tree, `swe/sprints/` included):
  `pi-studio` ×2036, `PI_STUDIO` ×664, `Pi-Studio` ×301, `PiStudio` ×255,
  **`pistudio` ×140** (the no-separator form: `pistudio-client.ts` + three wire RPC
  names, see below), `piStudio` ×11, `PI-STUDIO`/`Pi Studio`/`PI-Studio` ×4 stray prose.
  ~730 files total; **249 are `swe/sprints/` (excluded)**, leaving ~480 in scope — the
  overwhelming majority pure find/replace.
- 8 npm packages + private root, all `@av-pi-studio/*@0.0.94`.
- ~25 `PI_STUDIO_*` env vars (daemon config, relay, docker, brand, worktree hooks).
- **Wire protocol carries the brand in two places** (both hard-renamed — pre-public, no
  cross-version compat needed): the WS auth subprotocol `pi-studio.bearer.<password>`
  (§ 1.5) and three worktree RPC message-name pairs containing `pistudio_` (§ 1.2).
  Everything else in `packages/protocol` is comments + the `PROTOCOL_PACKAGE` marker.
- User state on every tester machine: `~/.pi-studio/` (agents, projects, chat, keypair,
  config, logs) + browser `localStorage` keys.
- **Paseo mentions: 28 files** (20 in `swe/sprints/`, 5 in `packages/web-client` —
  theme/CSS comments only, no identifiers — 3 in `swe/features|architecture`). All prose/
  comments; zero code symbols.

---

## Phase 0 — Land-grab (mostly DONE, 2026-08-21)

1. ~~Create the `pi-ade` org on npm~~ — **done**:
   https://www.npmjs.com/settings/pi-ade/packages. The npm auth token already has write
   access to **both** the old `av-pi-studio` packages and the new org, so Phase 5's
   publish and deprecate steps run under one credential with no re-login.
2. ~~Create the GitHub repo~~ — **done**: `git@github.com:avatsaev/pi-ade.git` (a NEW
   empty repo, not a rename — deliberate, so no old history leaks via redirects). Local
   checkout initialized at `/home/avatsaev/DEV/avatsaev/pi-ade`.
3. **Create Docker Hub repos** `avatsaev/pi-ade-daemon`, `avatsaev/pi-ade-relay`,
   `avatsaev/pi-ade-web-client` — still TODO; `docker login` with push access.

---

## Phase 1 — Mechanical in-repo rename

All Phase 1–3 work happens **in the current pi-studio checkout** (full tooling, git
safety net); the finished tree is exported to the new repo in Phase 4 — intermediate
rename commits therefore never pollute the fresh history. Case-sensitive sweep of every
spelling in the census above: `@av-pi-studio` → `@pi-ade`, `pi-studio` → `pi-ade`,
`PI_STUDIO` → `PI_ADE`, `PiStudio` → `PiAde`, `pistudio` → `piade`, `piStudio` → `piAde`,
`Pi-Studio`/`Pi Studio`/`PI-Studio`/`PI-STUDIO` → `pi-ade` (prose). The Phase 3 audit
greps case-insensitively for `pi[-_. ]?studio`, so any spelling missed here still gets
caught. **Exclude `swe/sprints/` from the pi-studio sweeps** (the Paseo sweep in § 1.8
has no such exclusion).

### 1.1 Packages & lockfile

- All 9 `package.json` (8 packages + private root): `name`, internal
  `dependencies`/`devDependencies`, `description`.
- `packages/cli/package.json`: `"bin": { "pi-ade": "dist/cli.js" }`.
- `packages/cli/package.json` `repository.url` →
  `git+https://github.com/avatsaev/pi-ade.git` (only package with the field; keep
  `repository.directory`).
- Set every package's `version` to `0.1.0` in this same commit (release ships `--no-bump`).
- `npm install` to regenerate `package-lock.json`. Never hand-edit the lockfile.
- Checkpoint: `npm run clean && npm run build` green.

### 1.2 Code identifiers (LSP renames, not sed)

- `PiStudioClient` → `PiAdeClient` (`packages/client/src/pistudio-client.ts` → rename file
  too; it is re-exported — use `lsp rename` + `rename_file` so every callsite in
  `client`, `web-client`, `cli` moves).
- `PROTOCOL_PACKAGE` constant value in `packages/protocol/src/index.ts` (+ its test).
- **Worktree RPC wire names** — three request/response pairs embed `pistudio_`:
  `create_pistudio_worktree_request/response`, `pistudio_worktree_list_request/response`,
  `pistudio_worktree_archive_request/response`. Sites: registrations in
  `packages/server/src/projects/worktree-service.ts:126-150`, the CLI's `FEATURE_RPC`
  map in `packages/cli/src/feature-commands.ts:56-58` (+ its test and
  `packages/cli/AGENTS.md`'s RPC table). Hard rename, no aliases (pre-public).
  **Recommendation: de-brand instead of re-brand** — `worktree_create_request`,
  `worktree_list_request`, `worktree_archive_request` (flat snake_case per the protocol
  convention; the names collide with nothing) — so wire names never need touching in any
  future rename. Fallback if de-branding is rejected: `piade_` substitution.
- Bare-specifier literals that a sweep can miss because they are **runtime strings, not
  imports** — verify each explicitly:
  - `packages/cli/src/daemon-control.ts:120` — `import.meta.resolve("@av-pi-studio/server")`
  - `packages/cli/src/relay-control.ts:86` — `import.meta.resolve("@av-pi-studio/relay/server")`
  - `packages/cli/src/web-server.ts:39` — `import.meta.resolve("@av-pi-studio/web-client/package.json")`
  - `packages/cli`'s `PACKAGE_NAME` constant (drives `pi-ade update`'s
    `npm install -g` target — `update-commands.ts`/`update-control.ts`)
- `docker/daemon.Dockerfile`, `relay.Dockerfile`, `web-client.Dockerfile`:
  `npm ci --workspace @av-pi-studio/…` / `npm run build:web -w …` flags.

### 1.3 Filenames & paths

- PID files: `pi-studio.pid` → `pi-ade.pid`, `pi-studio-relay.pid` → `pi-ade-relay.pid`
  (`packages/cli/src/relay-control.ts`; migration in Phase 2 covers stale-PID handling).
- `.dockerignore` entry for the PID file.
- Default home: `~/.pi-studio` → `~/.pi-ade` (`packages/server/src/daemon/bootstrap.ts:116`
  `resolveHome`, plus the CLI's `client-id.ts` `resolveHome` and every doc mention).

### 1.4 Env vars (paired with the Phase 2 fallback — never rename alone)

Rename `PI_STUDIO_*` → `PI_ADE_*` at every read site:

| Area | File(s) | Vars |
|---|---|---|
| Daemon config overlay | `packages/server/src/config/daemon-config.ts` (`overlayEnv`) | `LISTEN`, `PASSWORD`, `PI_HOME`, `HOSTNAMES`, `RELAY_ENABLED/_ENDPOINT/_USE_TLS/_PUBLIC_*`, `APP_BASE_URL`, `SERVICE_PROXY_*`, `EXTENSIONS_AUTOSYNC`, `EXTENSION_PACKS` |
| Daemon entrypoints | `daemon/bootstrap.ts`, `daemon/main.ts`, `daemon/dev-main.ts`, `daemon/index.ts` | `HOME`, `LISTEN`, `SERVER_ID`, `PASSWORD`, `HOSTNAMES`, `MOCK_TURN_DELAY_MS` |
| Logging | `logging/logger.ts` | `LOG_LEVEL` |
| Service proxy | `proxy/service-proxy.ts` | `SERVICE_PROXY_LISTEN/_PUBLIC_BASE_URL/_ENABLED` |
| Worktree setup-script contract | `projects/worktree-service.ts:284` | `WORKTREE_PATH`, `SOURCE_CHECKOUT_PATH` — **user-facing**: existing setup scripts read the old names; export **both** old and new names to the child env during the compat window |
| Relay | `packages/relay` (`RELAY_LISTEN`) | `RELAY_LISTEN` |
| CLI | daemon/relay spawn paths forwarding `PI_STUDIO_PI_HOME` etc. | all forwarded vars |
| Web-client build | `vite.config.ts` brand resolver | `BRAND_TITLE`, `BRAND_ICON` |
| Docker | all Dockerfiles, `docker-compose.yml`, `docker-compose.models.yml`, `web-client.nginx.conf.template` (`DAEMON_UPSTREAM`), compose port vars (`DAEMON_PORT`, `RELAY_PORT`, `WEB_PORT`, `INSTALL_GH`, `PROJECTS`, `PI_CONFIG`) | all |

### 1.5 User-facing strings & branding

- CLI help text, QR/pairing output, log messages, error strings
  (e.g. extensions-service.ts's `PI_STUDIO_EXTENSIONS_AUTOSYNC=false` hint).
- Web-client default brand title `Pi-Studio` → `pi-ade` (title, favicon alt, any
  `<title>`/manifest defaults in `index.html` + brand resolver defaults).
- `docker-compose.yml` `name: pi-studio` → `name: pi-ade`; local image tags.
- WS bearer subprotocol: `pi-studio.bearer.<password>` → `pi-ade.bearer.<password>` —
  hard rename, no dual-accept (pre-public, no installed base to protect). Three sites:
  `packages/server/src/auth/password-auth.ts:18` (`WS_BEARER_SUBPROTOCOL_PREFIX`),
  `packages/cli/src/connection.ts:64`, and
  `packages/web-client/src/lib/connection/connection-store.ts:79`. Old clients cannot
  authenticate against new password-protected daemons after this — acceptable per the
  decision above; testers update client + daemon together.

### 1.6 Release plumbing

All three scripts hardcode names — update in one pass:

- `scripts/publish.sh` — scope in the publish loop, the internal-dep rewrite regex, the
  jsDelivr URL template (`cdn.jsdelivr.net/npm/@pi-ade/<pkg>@<version>/assets/…`).
- `scripts/docker-publish.sh` — local image names + `avatsaev/pi-ade-*` push targets.
- `scripts/dokploy-deploy.sh` — the image references it pins into the Dokploy compose
  stacks (`avatsaev/pi-ade-relay`, `avatsaev/pi-ade-web-client`).
- `scripts/release.sh` — any name mentions in output.
- Root `package.json` script names stay (`docker:publish` etc.), only strings change.

### 1.7 Living docs

Update: root `README.md`, root `AGENTS.md`, all 8 `packages/*/AGENTS.md` + `README.md`,
`CONTRIBUTING.md`, `BETA_TESTERS_README.md` (rewrite install/update commands),
`docker/README.md`, `docs/*.md`, `swe/MAIN-SCOPE.md`, `swe/architecture/`,
`swe/features/`, `.omp/skills/publish-and-release/SKILL.md`, `.omp/rules/docs-sync.md`
(the `PI_STUDIO_*` mention). **Not** `swe/sprints/`.

### 1.8 Paseo scrub (whole tree, sprints included)

"Paseo" is the design-reference app pi-studio's UI was ported from; the name must not
ship in the public repo. 28 files, all prose/comments, no identifiers:

- `packages/web-client` (5): theme comments in `theme/colors.ts`, `theme/variants.ts`
  (including `~/DEV/paseo/...` path references), `timeline/markdown.module.css`, and the
  `ScreenTitle` component's header comments. Rewrite as neutral "the reference design" /
  drop the upstream file paths; the token values themselves are ours and stay.
- `swe/features/keyboard-shortcuts.md` (`@paseo:keyboard-shortcut-overrides` AsyncStorage
  key), `swe/features/desktop-app.md`, `swe/architecture/design-system.md` (reference-app
  framing + comparison-table column) — reword to "the reference app".
- `swe/sprints/` (20): **unlike the pi-studio name, these ARE scrubbed** — same neutral
  rewording, nothing else in those files changes.
- Audit: `grep -rIi paseo --exclude-dir={node_modules,dist,.git} .` → zero matches.

---

## Phase 2 — Compatibility layer

The load-bearing engineering. Three pieces, each small and independently testable. Every
shim carries a `COMPAT()` marker (`docs/validation-conventions.md` convention) with
`addedIn: "0.1.0"` and an explicit `removeBy` two releases out.

### 2.1 Home-directory migration

In `resolveHome`'s callers (daemon bootstrap + CLI local paths), before first use:

- If the resolved home (`~/.pi-ade` or `$PI_ADE_HOME`) **does not exist** and the legacy
  default `~/.pi-studio` **does** → `rename()` it (atomic on the same filesystem; fall back
  to copy+keep-original across filesystems) and log one info line.
- Never migrate when the new dir already exists (no clobbering, no merging).
- Migration only targets the *default* legacy path; a custom `PI_STUDIO_HOME` is handled by
  the env fallback (2.2), not by guessing directories.
- Stale `pi-studio.pid` inside a migrated home is renamed with the dir — the daemon's
  existing stale-PID handling covers the rest.

### 2.2 Env-var fallback

One helper, used at every env read site from § 1.4:

```ts
// reads PI_ADE_X, falls back to PI_STUDIO_X with a once-per-var deprecation warning
readCompatEnv(env, "X"): string | undefined
```

- New name always wins when both are set.
- Warning text names the exact old var, the new var, and the removal release.
- `overlayEnv` in `daemon-config.ts` is the main consumer; entrypoints, logger, proxy,
  relay, and CLI spawn paths use the same helper.
- Worktree setup scripts (2.1's inverse direction — we *write* env): export **both**
  `PI_ADE_WORKTREE_PATH` and `PI_STUDIO_WORKTREE_PATH` (+ `SOURCE_CHECKOUT_PATH`) into the
  child env during the window.

### 2.3 Web-client localStorage migration

In `providers/kv-store.ts` (single choke point — both stores read through it):

- On `get(key)` for a `pi-ade-*` key with no value: read the corresponding `pi-studio-*`
  key; if present, rewrite under the new key, delete the old, return it.
- Known keys: `pi-studio-appearance` (`theme/appearance-store.ts`),
  `pi-studio-pane-layout` (`lib/pane-layout-persistence.ts`), plus any connection-state
  keys found during implementation (sweep `localStorage.setItem` callers).

### 2.4 Explicitly NOT migrated

- `config.json` contents, `daemon-keypair.json`, `server-id`, agent/chat/project records —
  all move wholesale with the home dir; no field inside them is brand-bearing.
- Pi's own home (`~/.pi` / `PI_ADE_PI_HOME`) — untouched; it belongs to the Pi CLI.
- `relay://` endpoint URLs in existing pairing links — scheme is brand-free.
- The WS bearer subprotocol — hard-renamed in § 1.5, deliberately without compat
  (pre-public decision, see Decisions table).

---

## Phase 3 — Verification gates (in order, all must pass)

1. **Static**: `npm run clean && npm run build && npm run typecheck && npm run lint &&
   npm run fmt:check && npm test` — zero errors. (Clean first: a rename this size makes
   incremental `.tsbuildinfo` unreliable.)
2. **Home migration smoke**: copy a real `~/.pi-studio` into a temp `$HOME`, run
   `pi-ade daemon start`, confirm the dir became `~/.pi-ade` and agents/projects/chat all
   list correctly; second boot does not re-migrate.
3. **Env fallback smoke**: start the daemon with only legacy vars set
   (`PI_STUDIO_RELAY_ENABLED=true PI_STUDIO_RELAY_ENDPOINT=… pi-ade daemon start`) —
   works + one deprecation warning per var. Then set both old and new → new wins.
4. **Browser smoke** (`pi-ade ui`): appearance + pane layout survive from old localStorage
   keys; connect with a password (exercises the renamed bearer subprotocol end to end);
   run a mock-provider agent turn.
5. **Docker**: `cd docker && docker compose up --build` — all three healthchecks green;
   UI reachable on :8080, daemon :6767 `/api/health`, relay :7000 `/health`.
6. **Sweep audit** (case-insensitive, catches every spelling incl. `pistudio`/`piStudio`):
   `grep -rIiE 'pi[-_. ]?studio' --exclude-dir={node_modules,dist,.git} .`
   returns only `swe/sprints/**`, intentional compat-shim sites (2.1–2.3), and historical
   changelog/doc lines that explicitly narrate the rename.
   `grep -rIi paseo` (same excludes) returns **nothing**.

---

## Phase 4 — Repo migration (fresh git history)

The rebranded tree moves to the new repo as a **single initial commit** — no pi-studio
history, no rename commits, no Paseo mentions anywhere in reachable history.

1. In the old checkout, land the final Phase 1–3 state on the working branch and get
   Phase 3 fully green **before** exporting.
2. Export **tracked files only** — this is what guarantees a clean snapshot (no
   `node_modules`, `dist`, `.tsbuildinfo`, stray local files):
   `git archive HEAD | tar -x -C /home/avatsaev/DEV/avatsaev/pi-ade`
   (the target already has its fresh `.git/`; `git archive` never includes one).
3. Audit the exported tree, not the source: re-run Phase 3.6's two sweeps inside
   `~/DEV/avatsaev/pi-ade`.
4. `npm install` in the new checkout, then re-run Phase 3.1 there (proves the export is
   complete — a missed file fails the build here, not after publish).
5. Single commit: `pi-ade 0.1.0 — initial commit`; push to
   `git@github.com:avatsaev/pi-ade.git` as `main`.
6. Old repo: archive on GitHub (read-only) once the new repo builds; the old local
   checkout stays untouched as a reference until the release is out.
7. All subsequent work — including Phase 5 — happens in `~/DEV/avatsaev/pi-ade`.

---

## Phase 5 — Release & production cutover (from the NEW checkout)

1. **Publish npm** at the pinned version: `npm run publish -- --no-bump` (versions were
   set to `0.1.0` in Phase 1.1; the script's clean-tree check passes trivially on the
   fresh single-commit repo). The existing npm token already has write access to the
   `pi-ade` org — no re-login.
2. **Docker**: `npm run docker:publish -- --tag 0.1.0` → pushes to the three new
   `avatsaev/pi-ade-*` repos (script smoke-tests web-client before pushing).
3. **Deploy**: `npm run docker:deploy` — pins the Dokploy `relay`/`web-client` stacks to
   the new image name **and** tag. The image-name change guarantees Dokploy sees a real
   compose diff (the safe direction of the known `:latest` staleness trap).
4. **Post-deploy checks**:
   `npm view @pi-ade/server version` → `0.1.0`;
   `curl -sf https://relay.molagent.ai/health` → `ok`;
   `curl -sfo /dev/null -w "%{http_code}" https://app.molagent.ai/` → `200`.
5. **Deprecate the old scope** (all 8):
   `npm deprecate @av-pi-studio/<pkg>@'*' "Renamed to pi-ade — install @pi-ade/<pkg>"`.
6. **Tester communication**: `BETA_TESTERS_README.md` (already rewritten in 1.7) +
   announcement. Migration one-liner:
   `npm rm -g @av-pi-studio/cli && npm i -g @pi-ade/cli` — daemon state, env vars, and
   browser settings carry over automatically.

---

## Phase 6 — Post-rebrand cleanup (scheduled, not optional)

Tracked by the `COMPAT()` markers' `removeBy` (target: two releases after 0.1.0):

- Delete the `PI_STUDIO_*` env fallback + its warnings.
- Stop exporting legacy worktree-script env names.
- Delete the localStorage read-fallback.
- Delete the home-dir migration only after telemetry/anecdata says testers have all
  crossed (cheap to keep one release longer than planned).

---

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Old `pi-studio update` on tester machines self-updates the **old** package forever | Testers stuck on 0.0.94 silently | `npm deprecate` message (npm prints it on install) + direct announcement; migration is a one-liner |
| Runtime string specifiers (`import.meta.resolve`, `PACKAGE_NAME`) escape a type-checked rename | `pi-ade daemon start` / `ui` / `update` break at runtime only | Explicit checklist in § 1.2; Phase 3.2–3.4 exercise all three paths live |
| Stale `.tsbuildinfo` hides type errors after mass rename | False-green typecheck | Phase 3 starts with `npm run clean` |
| Dokploy compose stacks reference old image names | Deploy poll "succeeds" against a stale stack | Image-name change forces a real diff; Phase 5.4 curls production endpoints regardless |
| Home migration mid-flight failure (cross-filesystem copy interrupted) | Partial state dir | Copy-then-verify before any delete; rename path is atomic; original never removed on the copy path |
| jsDelivr README image URLs point at the old scope | Broken screenshots on npmjs.com | `publish.sh` URL template updated in § 1.6; the script's existing guard aborts if `assets/` is referenced but unpublished |
| Export to the new repo misses files (`git archive` only ships tracked files) | Build breaks in the new checkout, or worse, after publish | Phase 4.4 re-runs the full static gate inside the new checkout before anything is pushed or published |
| Paseo survives in an overlooked file | Reference-app name ships in the public repo | § 1.8 audit is case-insensitive over the whole tree and re-run against the exported tree in Phase 4.3 |

## Estimate

Phases 1–3: ~1 focused day (rename is scripted + checkpointed; compat layer is three
small, individually testable pieces). Phase 4 is an hour of export + re-verification.
Phase 5 is the standard release pipeline. Phase 0 is nearly done — only the Docker Hub
repos remain.
