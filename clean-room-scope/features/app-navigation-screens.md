# App Navigation & Screens — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [../architecture/client-app-runtime.md](../architecture/client-app-runtime.md),
> [../architecture/design-system.md](../architecture/design-system.md),
> [workspace-ui.md](workspace-ui.md), [../architecture/relay-e2ee.md](../architecture/relay-e2ee.md)

## Purpose

Defines the Pi-Studio app's navigation shell and every non-workspace screen: the route grammar, the
boot/startup resolver, onboarding & device pairing, the per-host "home" and session-history screens, the
new-workspace creation screen, the settings information architecture (app-level + per-host + per-project),
the global left sidebar, and how routing wires into the host-runtime and per-session state. The agent
workspace surface itself is specified in [workspace-ui.md](workspace-ui.md); the composer in
[composer-ui.md](composer-ui.md).

## Public Contract

### Routing technology
- File-based routing (reference: Expo Router over a native stack). A single root stack with no native
  header — **every screen draws its own header**. Stack animation disabled; background = `surface0`.
- The root mounts a fixed provider stack (outer→inner): gesture root → query client → safe-area →
  keyboard → portal provider (must sit *inside* app context so portaled sheets can read query/theme) →
  bottom-sheet provider → runtime providers (host-runtime bootstrap, push-notification router, toast,
  voice, desktop window-control sync, deep-link listener, per-host session managers) → app shell
  (sidebar animation, horizontal-scroll context, open-project listener, sidebar + root stack).

### Route map
All `serverId` and `workspaceId` path segments are URL-encoded; workspace IDs that aren't URL-safe are
base64url-encoded with a `b64_` prefix. Route builders/slug constants are a shared module that every
screen and the sidebar agree on.

| Path | Params | Renders | Purpose |
|------|--------|---------|---------|
| `/` | — | boot resolver (splash or redirect) | Startup routing (see Behavior) |
| `/welcome` | — | Welcome screen | Onboarding / add first host |
| `/pair-scan` | `?source=settings\|onboarding` | QR scan (native only) | Device pairing camera |
| `/h/[serverId]` | `serverId` | redirect → `/h/{id}/open-project` | Host root |
| `/h/[serverId]/open-project` | `serverId` | Open-project ("home") | Host landing tiles |
| `/h/[serverId]/sessions` | `serverId` | Sessions | Agent/session history |
| `/h/[serverId]/new` | `serverId`; `?dir,name,projectId` | New-workspace | Create worktree + first prompt |
| `/h/[serverId]/agent/[agentId]` | `serverId`,`agentId` | resolver (renders nothing) | Maps agent→its workspace tab, then redirects |
| `/h/[serverId]/workspace/[workspaceId]` | `serverId`,`workspaceId`; `?open` | Workspace deck | Main agent workspace |
| `/h/[serverId]/settings` | `serverId` | legacy redirect | → host settings or app settings |
| `/settings` | — | settings root (compact) / redirect to `/settings/general` (wide) | App settings entry |
| `/settings/[section]` | `section` slug | settings detail | App-level settings section |
| `/settings/projects` | — | projects list | Cross-host project list |
| `/settings/projects/[projectKey]` | `projectKey` | project settings | Per-project config |
| `/settings/hosts/[serverId]` | `serverId` | redirect | → first host section |
| `/settings/hosts/[serverId]/[hostSection]` | `serverId`,`hostSection` slug | host settings | Per-host settings section |

- **App settings section slugs:** `general`, `daemon`, `appearance`, `shortcuts`, `integrations`,
  `permissions`, `diagnostics`, `about`. Unknown → `general`. (`daemon`, `shortcuts`, `integrations`,
  `permissions` are **desktop-only** and filtered out otherwise.)
- **Host section slugs:** `connections`, `agents`, `workspaces`, `providers`, `host`. Legacy aliases
  normalized (`orchestration→agents`, `daemon→host`). Unknown → `connections`.
- **`?open=` workspace intent** (kind:payload): `agent:<id>`, `terminal:<id>`, `file:<base64path>`,
  `draft:<id>`, `setup:<workspaceId>`. Only `agent` intents pin the tab.
- All `h/*` routes self-guard: they render a boot splash until the host-runtime store is ready, then
  validate `serverId` against the known host list (unknown → redirect to first host, or `/welcome` if
  none). App-level settings/welcome/pair routes are guarded by a "store ready" latch.

## Behavior & Algorithms

### Boot / startup resolver (`/`)
Renders the splash only while waiting. Once the last-workspace selection has hydrated and the path is `/`:
1. If a remembered last-workspace selection exists and a host is online → redirect to that workspace.
2. Else if any host is online → redirect to the earliest-connected host's root (→ open-project).
3. Else if bootstrap "gave up" waiting (≈5s timer) → redirect to `/welcome`.
4. Else show the startup splash.

The "store ready" flag is **latched**: true once any of {online host, splash error, gave-up} occurs, and
stays true. On desktop, a daemon-start error surfaces a splash **error screen** (logo, "Something went
wrong", error text + daemon log path + scrollable logs, actions: Copy logs / Open issue / Docs / Retry).

### Onboarding & pairing
- **Welcome:** centered logo + title + subtitle and platform-dependent actions — web: Direct connection
  (primary), Paste pairing link; native: Scan QR (primary), Direct connection, Paste pairing link. Footer:
  Settings link + version. Saving a host replaces to `/h/{serverId}`. If a host is already online it
  auto-redirects away (you can't get stuck on welcome with a live host).
- **Pair-scan:** native only (web shows an unsupported message + back). Requests camera permission;
  scans a QR carrying an encrypted connection offer (`#offer=` URL fragment), validates + probes the
  daemon, upserts the connection, then routes by `source` (onboarding → host root; settings → host
  settings). Deep-link pairing also works app-wide via a global `#offer=` URL listener. See
  [relay-e2ee.md](../architecture/relay-e2ee.md) for the offer/pairing crypto.

### Open-project (host home)
Borderless menu header; centered body with logo and a wrap of tiles: **Add a project** (accent; opens the
project picker), **Import session**, **Setup providers** (→ host providers settings), **Pair device**
(local daemon only). On desktop (non-compact) it opens the left sidebar (agent list) on mount. Tiles are
full-width stacked on phone, fixed-width cards on wide. A community-links row is pinned near the bottom.

### Sessions
Header "Sessions"; agent/session history sorted by last-activity desc. States: loading spinner, "No
sessions yet" empty + back, or a list with pull-to-refresh and a "Load more" footer when more exist
(background revalidation must not show the spinner). Reached from the sidebar.

### New-workspace
Creates a git worktree-based workspace and optionally sends a first prompt. Uses the shared composer with
a custom footer containing: a **project picker** (only worktree-capable projects), a **ref picker**
(branch or GitHub PR, searchable + debounced), the agent **mode control**, and an optional **checkout-PR
hint** badge. Submit:
- Empty → create empty worktree, navigate to the workspace.
- With text/attachments → ensure worktree, stage a pending draft, navigate to a prepared draft tab.
Errors show a toast + inline text and disable controls while pending. Supports image drops.

### Settings information architecture
Settings is one view-model-driven surface with a discriminated view: `root | section | host | projects |
project`. Each route file is thin (parse params → render the settings view).

- **Sidebar groups:** an **App** group (General, Projects, Daemon*, Appearance, Shortcuts*, Integrations*,
  Permissions*, Diagnostics, About — `*` = desktop-only) and a **Host** group (a host picker that lists
  the local host first tagged "Local" plus an always-present "Add host" row, then Connections, Agents,
  Workspaces, Providers, Host). With no hosts, the host group collapses to a single "Add host" button.
- **Section content:** General (default send behavior, service URLs [desktop], terminal scrollback),
  Daemon [desktop], Appearance (theme picker + fonts + font size with a live preview), Shortcuts [desktop],
  Integrations [desktop], Permissions [desktop], Diagnostics (audio test), About (version, update row
  [desktop], connected-host versions with mismatch warning, community links); host pages
  (Connections, Agents, Workspaces, Providers, Host = rename/remove). Host pages show "host not found"
  when unknown and gate agent/workspace content behind connection.
- **Responsive split:**
  - **Wide:** two-pane — a ~320px sidebar (owns the desktop titlebar drag region + window-control padding,
    has a top "Back to workspace" row) beside a detail pane (icon-badge header + scrollable, ≤720px-centered
    content). `/settings` redirects to `/settings/general` so a section is always shown. Section/host/project
    selection uses **replace** (no stack growth).
  - **Compact:** `view:root` is a full-screen list (back header + sidebar as a scroll list); detail views are
    full-screen (back header titled by section). Selection uses **push** (builds a back stack). Detail back
    returns to the settings root, except project-detail which backs out to the workspace.
- Switching host on a host detail route swaps only the host segment, keeping the section. "Add host" is a
  small modal flow (method chooser → direct / paste-link / scan). Removing a host routes back to settings.

### Projects screens
- **Projects list:** cross-host (`useProjects`), with loading spinner, "No projects yet" empty, or a card
  list of project rows (icon + name + chevron); a red banner reports per-host load errors. Row press →
  project settings. The selected project highlights in the wide split.
- **Project settings:** per-project config keyed by project key; resolves an **editable host** (filters
  hosts; host switcher when several; "no editable copy" message otherwise). Reads/writes the per-project
  config (revision-based mutations). Sections: worktree lifecycle commands, scripts/services, and
  per-project metadata-generation prompt overrides (agent titles, branch names, commit messages, PRs). See
  [worktrees.md](worktrees.md), [../architecture/config.md](../architecture/config.md),
  [../architecture/structured-generation.md](../architecture/structured-generation.md).

### Global navigation shell
- **Chrome gating:** the left sidebar renders only when the store is ready AND the current path resolves to
  a known host. Settings and welcome routes have no sidebar.
- **Left sidebar placement:** wide = pinned, resizable column (hidden in focus mode); compact = absolute
  overlay opened by an edge-swipe gesture (web: only the leftmost ~32px starts it; vertical scroll cancels).
- **Sidebar content:** active host resolution from path (else first host); a grouped workspace list (with a
  grouping selector, refresh, initial-load skeleton, per-workspace shortcut indices); footer icon buttons
  (Add project, Home, Settings, host switcher) and a new-workspace button.
- **Host switching:** translates the current route onto the new host (settings→host settings,
  sessions→sessions, open-project→open-project, workspace→same workspace id, agent→same agent path, else host
  root), then navigates.
- **Always-mounted overlay singletons:** floating-panel portal host, download toast, various callouts, a
  command palette, the project-picker modal, provider-settings host, workspace setup dialog, keyboard-
  shortcuts dialog, quitting overlay.

### Routing ↔ runtime wiring
- A global host-runtime store tracks per-host snapshots (connection status `idle|connecting|online|offline|
  error`, active client, last error/online time, probe state). Hooks expose the host list, the active
  client, connection status, and the earliest-online host.
- A per-host session provider mounts for **every** host (not per-route) so session state stays warm across
  navigation; it pipes daemon stream messages into the session store.
- The agent-detail route is a **resolver** (renders nothing): look up the agent's cwd → owning workspace →
  navigate to a prepared workspace tab; unresolvable → host root or `/`.
- A last-workspace selection (`{serverId, workspaceId}`) persists in client storage and is hydrated at
  startup; `navigateToWorkspace` remembers it and optionally focuses the attention-worthy agent's tab;
  `navigateToLastWorkspace` returns there (used by settings "back to workspace").
- A push/notification router resolves a notification → `{serverId, agentId}` and navigates (pinning the
  agent tab) on tap.

## Data & Persistence
- Client stores: last-workspace selection, saved host profiles, sidebar grouping preference, appearance
  settings, preferred editor. See [persistence.md](../architecture/persistence.md) and
  [client-app-runtime.md](../architecture/client-app-runtime.md).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Path `/` with no online host, before give-up | Show splash; never flash welcome prematurely |
| Desktop daemon start error | Splash error screen with logs + retry |
| Unknown `serverId` in an `h/*` route | Redirect to first host's open-project, or `/welcome` |
| Web visiting `/pair-scan` | Unsupported message + back to settings |
| Host removed while viewing it | Route back to settings root/general |
| Missing daemon feature flag | "Update the host" affordance, no degraded fallback |

## Dependencies
- Pinned library versions: see [../architecture/design-system.md](../architecture/design-system.md) § UI technology stack.
- Internal: host-runtime store, session context, route grammar module, design system, projects/worktrees
  config, relay pairing.
- External: file-based router + native stack, camera (native pairing), deep-linking.

## Acceptance Criteria
- [ ] The boot resolver routes to the remembered workspace, else an online host, else welcome (after
      give-up), and shows the splash meanwhile.
- [ ] Every `h/*` route shows the splash until the store is ready and redirects unknown hosts.
- [ ] Settings renders as a 320px+detail split on wide (replace-nav) and as list→detail screens on compact
      (push-nav); desktop-only sections are hidden off-desktop.
- [ ] The left sidebar appears only on known-host routes; compact opens it via edge-swipe, wide pins it
      (hidden in focus mode).
- [ ] Host switching preserves the equivalent route on the new host.
- [ ] New-workspace creates a worktree (empty or with a first prompt) and navigates into it.

## TODO(verify)
- [ ] Full project-settings toolbar/menu actions (rename/icon edit, save/discard UX).
- [ ] Host connections page: connection add/remove, latency probe display, remove-host confirmation.
- [ ] Exact compact give-up timeout value.
