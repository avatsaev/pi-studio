# Feature — Web UI Agent Deep Link (`#agent=<agentId>`)

> **Status: shipped (sprint-082)**

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [app-navigation-screens.md](app-navigation-screens.md) (boot, pairing/onboarding),
> [../architecture/relay-e2ee.md](../architecture/relay-e2ee.md) (`#offer=` pairing fragment, which
> this must coexist with), [workspace-ui.md](workspace-ui.md) (tabs/panes a selected chat opens in),
> [agent-sessions.md](agent-sessions.md) (session restore on connect),
> [extension-ui-rpc.md](extension-ui-rpc.md) (the dialogs whose hand-off targets this link, D36)
> Source brief: [daemon-monitoring-dashboard.md](../../../pi-studio-dashboard/swe/grills/daemon-monitoring-dashboard.md)
> (D13, D24)

## Purpose

External clients (the Pi Studio Dashboard's "Open in web UI" button, D13/D24) need to send the user
straight to one agent's conversation in the web UI. Today the web client has no deep link: it reads
only `?host=&password=&cwd=&connect=1`, `?pair=` and a `#offer=` pairing fragment
(`packages/web-client/src/hooks/use-connection.ts`). This scope adds a URL **fragment** parameter
`agent=<urlencoded agentId>` — e.g. `http://localhost:4173/#agent=abc` — that selects that agent's
chat once the connection is open and the agent is known.

**No server change, no protocol change.** Web-client only.

## Current state (verified in code)

- `useConnectionBoot()` (`hooks/use-connection.ts`), run once from `app.tsx`'s `Boot`: if
  `location.hash` contains `offer=`, it connects immediately using `window.location.href` as the
  pairing URL; otherwise it reads `?host/?pair/?password/?cwd/?connect=1`; connects only for `?pair=`
  or `connect=1`. **There is no auto-connect for a bare URL**: the user must press Connect (the host
  field defaults to `ws://127.0.0.1:6767`, `stores/ui-store.ts`).
- `parsePairingUrl` (`packages/client/src/pairing.ts`) reads the fragment with `URLSearchParams`
  and takes `offer`, `relay`, `relayTls`, `host`; extra keys such as `agent` are ignored — the two
  parameters coexist in one fragment without changes to the parser.
- Nothing in `web-client/src` calls `history.replaceState`, reads `hashchange`, or strips the
  fragment; the `#offer=` fragment stays in the address bar today.
- Agent → session: `hooks/use-session-restore.ts` (`useSessionRestore`) runs **once** per connection
  after `status === "open"`: `list_agents_request {all:false}` → for each agent hydrates a
  `SessionEntry` (`id = "s-" + agentId.slice(0,12)`, `agentId` bound) via `session-store.hydrate`,
  then opens pane-claimed chats and (conditionally) the globally most recent one. Selecting a session
  = `useSessionStore.activate(sessionId)` + `useUiStore.setCwd(session.cwd)` +
  `openChatTab(session, homeDir)` (`features/sessions/open-chat-tab.ts`) — exactly what
  `SessionList.handleSelect` does. `findByAgentId(agentId)` resolves an entry.
- Archived agents are excluded by `list_agents_request {all:false}`, so an archived agent is
  indistinguishable from an unknown one at selection time.
- Toasts: `useToastStore.getState().show(content, opts)` (`stores/toast-store.ts`) is the existing
  non-blocking notice mechanism (`ToastViewport`).

## Public contract

### URL grammar

```
<web-ui-origin>/[?<existing query params>]#agent=<urlencoded agentId>[&<other fragment params>]
```

- The fragment is parsed with `URLSearchParams` (after stripping the leading `#`) exactly like the
  pairing fragment; `agent` is the **first value of the key `agent`**, URL-decoded. Empty value or
  value longer than 256 chars after decoding ⇒ ignored (treated as absent), no notice.
- Coexistence with pairing: `#offer=<b64>&host=<h>&agent=<id>` and `#agent=<id>&offer=<b64>` are both
  valid. The `offer` branch of `useConnectionBoot` is detected by `hash.includes("offer=")` and keeps
  its behavior; `agent` is independent. (Order-insensitive.)
- Coexistence with query params: `?host=ws://…&connect=1#agent=<id>` is the recommended complete
  link for a client that knows the daemon address (§ TODO(verify) on auto-connect). No password in
  any URL part is ever required or recommended.
- The `agentId` is an opaque daemon id (the dashboard takes it from `list_agents_response`); the web
  client does not validate its format beyond the length cap.

### Behavior contract (user-visible)

1. A deep link **never** forces a connection by itself and never overrides the connection flow: the
   existing rules (`connect=1`, `?pair=`, `#offer=`, manual Connect) decide when the connection
   opens.
2. Once the connection is `open` **and** the initial session restore has hydrated the agent list, the
   target agent's chat is selected and opened as in a sidebar click, in the focused pane of its
   workspace.
3. If the agent is not found after restore → one non-blocking toast `Agent not found: <id>` (or
   localized equivalent); the app otherwise behaves as if no deep link were present.
4. The deep link is applied **at most once per page load per distinct target** (consumed on first
   successful apply or on the unknown-agent notice).

## Behavior & algorithms

```
parseAgentDeepLink(hash: string) -> string | undefined:
    params = URLSearchParams(hash minus leading "#")
    v = params.get("agent")
    if v is empty or length(v) > 256: return undefined
    return v                                   # URLSearchParams already URL-decodes

DeepLinkStore (new, tiny zustand store, web-client/src/stores/deep-link-store.ts):
    pendingAgentId: string | undefined
    set(agentId) / consume()

Boot (new hook useAgentDeepLinkBoot, mounted in app.tsx's Boot BEFORE useSessionRestore,
      AFTER useConnectionBoot):
    once on mount:  id = parseAgentDeepLink(location.hash); if id: store.set(id)
    on window "hashchange":                    # same-tab navigation / pasted fragment
        id = parseAgentDeepLink(location.hash)
        if id: store.set(id); if connection already open and restore done: tryApply()
    fragment cleanup: see below

tryApply():                                    # called when BOTH are true:
    # (a) connection status == "open"  (b) initial restore finished (restore's `finally`
    #     path, i.e. runSessionRestore resolved — same signal that calls markHydrationSource("sessions"))
    id = store.pendingAgentId
    if not id: return
    entry = sessionStore.findByAgentId(id)
    if entry:
        sessionStore.activate(entry.id)
        uiStore.setCwd(entry.cwd)              # as SessionList.handleSelect
        openChatTab(entry, daemonHomeDir())    # tab-store.open → focused pane of the entry's workspace
    else:
        toast.show("Agent not found: " + id, variant "warning")
    store.consume()
```

Timing:

- `runSessionRestore` is the right hook point: it runs once per connection lifetime, awaits
  `list_agents_request` and every timeline fetch, and always reaches its `finally`. The deep-link
  apply runs **after** it, so it overrides the restore's default focus (`activate(inView ?? first)`
  and the "first" fallback tab) rather than racing it — the explicit user intent wins. Implementation:
  `useSessionRestore` calls the apply step after `runSessionRestore` settles (a deep-link-aware wrapper;
  no change to restore's own algorithm).
- Pane-layout hydration: opening the tab goes through `tab-store.open`, which already integrates with
  the layout store's pending-claim mechanism; the deep-link tab is opened after the claimed tabs
  have been reopened, so it lands in the focused pane and becomes the workspace's active tab.
- Reconnects (`status` flips open→connecting→open): restore does not re-run (`restoredRef`); a
  pending deep link not yet applied stays pending; a consumed one is not re-applied.
- If the connection never opens (user does not connect), the pending target is simply held for the
  page lifetime; nothing is shown. (A hint toast on boot was considered and rejected: it would nag
  users arriving without credentials.)
- An agent created **after** the restore (live `agent_update`/create) is not found by the one-shot
  apply and yields the unknown-agent notice; deep links target pre-existing agents.

Fragment cleanup policy:

- The `agent` parameter is **removed from the address bar after it is consumed** (applied or
  reported unknown) via `history.replaceState(null, "", url-without-agent-param)`, preserving all
  other fragment params and the query string. Rationale: otherwise a page reload would re-select the
  same agent and fight pane-layout restore.
- The `#offer=` pairing fragment keeps today's behavior (left in place). Cleanup only touches the
  `agent` key; if the fragment becomes empty the `#` is dropped too.
- Cleanup never fires on `hashchange` handlers in a way that re-triggers itself (replaceState does
  not emit `hashchange`).

## Data & persistence touchpoints

- No persistence; the pending target lives in memory only. The persisted pane layout
  (`pane-layout-persistence`) is affected only through the normal `tab-store.open` path.
- No server or protocol change; no new capability flag (nothing for a daemon to advertise). Clients
  cannot detect web-UI support remotely, so the dashboard opens the link unconditionally (an older
  web UI simply ignores the unknown fragment key).

## Error handling & edge cases

| Condition | Behavior |
|-----------|----------|
| Malformed/empty `agent=` | Ignored, no notice |
| Agent unknown, archived, or deleted | Toast `Agent not found: <id>`; fragment cleaned; no selection change |
| Agent exists on a different daemon than the one connected | Indistinguishable from unknown ⇒ same toast (the link carries no daemon identity; D24 builds it from the per-daemon web UI URL) |
| `#offer=…&agent=…` over the relay | Connects via relay; deep link applies after restore like any other |
| Connection fails (401/403/unreachable) | Existing connection error UI; pending target held, never applied |
| User already has the web UI open in the tab and navigates to a new `#agent=` | `hashchange` handler sets the target and applies immediately if open+restored |
| Same agent already open in a tab | `tab-store.open` activates the existing tab (same `tabIds.chat(session.id)`); no duplicate |
| Agent id with reserved characters | URL-encoded by the sender, decoded by `URLSearchParams`; `+` in a raw id must be sent as `%2B` (documented for clients) |
| Restore request itself fails | Restore's `catch` yields zero agents ⇒ unknown-agent toast (the honest outcome) |
| Very long hash | 256-char cap applies to the decoded value only |

## Non-functional

- Cost: one `URLSearchParams` parse at boot + on `hashchange`. No network.
- Security: the fragment never leaves the browser (not sent to the server); the agent id is only
  looked up in the already-hydrated local store, never interpolated into HTML (toast text is plain).
- Compatibility: unknown fragment keys are already tolerated by `parsePairingUrl`; an old web UI
  ignores `agent=`.
- Accessibility: the unknown-agent toast goes through the existing toast/announcer path.

## Dependencies on other specs

- [app-navigation-screens.md](app-navigation-screens.md) — boot sequence/pairing entry points.
- [../architecture/relay-e2ee.md](../architecture/relay-e2ee.md) — `#offer=` fragment grammar must
  stay parseable by `parsePairingUrl` with `agent=` present.
- [workspace-ui.md](workspace-ui.md) — tab/pane open semantics.
- Consumer: the dashboard's `agent.openInWebUi` command (D24); this spec is the contract it builds
  `<url>#agent=<urlencoded id>` against.

## Acceptance criteria

Unit tests on `parseAgentDeepLink` and the apply step (the project's vitest runs in plain Node, so
the hook itself is smoke-tested and the logic driven directly, as `use-session-restore.test.ts`
does).

- [ ] **Parse.** `#agent=abc` → `abc`; `#agent=a%20b%2Bc` → `a b+c`; `#offer=XYZ&agent=abc` and
  `#agent=abc&offer=XYZ&host=h` → `abc`; `#agent=` → undefined; no hash → undefined; 257-char value →
  undefined. (D24)
- [ ] **Pairing coexistence.** `parsePairingUrl("https://x/#offer=<valid>&agent=abc")` still returns
  the same `PairingOffer` as without `agent`; `useConnectionBoot` still connects immediately for
  such a URL. (D24)
- [ ] **Select after connect.** Given a daemon with agent `abc` and the page loaded at
  `…/?host=ws://…&connect=1#agent=abc`, when the connection opens and restore finishes, then the
  session whose `agentId` is `abc` is the active session, its workspace is the active workspace, and
  its chat tab is the active tab of the focused pane — even when another agent was more recently
  active. (D24)
- [ ] **No auto-connect.** Given `…/#agent=abc` with no connect params, then no connection is opened
  by the deep link; after the user connects manually, the agent is selected. (D24)
- [ ] **Unknown agent.** Given `#agent=nope`, when restore finishes, then exactly one toast
  `Agent not found: nope` is shown, no session selection changed, the fragment no longer contains
  `agent`. (D24)
- [ ] **Applied once.** After a successful apply, a reconnect (open→drop→open) does not re-select the
  agent, and reloading the page does not re-apply (the `agent` key was removed from the URL). (D24)
- [ ] **Fragment cleanup preserves siblings.** Given `#offer=XYZ&agent=abc`, after consumption the
  URL fragment is `#offer=XYZ`; given `#agent=abc` alone, the URL has no `#`. Query string is
  unchanged. (D24)
- [ ] **hashchange.** Given an already-connected, restored page, when the fragment changes to
  `#agent=abc`, then abc is selected without reload. (D24)
- [ ] **Already-open tab.** Given abc's chat already open in a background tab, then the apply
  activates that tab and opens no duplicate. (D24)
- [ ] **No server involvement.** The change touches no file under `packages/server` or
  `packages/protocol`, and no new WS message is sent as part of applying a deep link beyond the
  existing restore traffic. (D24)

## Out of scope

- Deep-linking to a workspace, file, terminal, or a specific timeline row.
- Auto-connecting to a default host from a bare fragment link.
- Carrying daemon identity (`serverId`) in the link to detect wrong-daemon targets.
- Desktop (Electron) custom-protocol handling of the same link.

## Resolved decisions

- **Bare-link UX:** the web UI does not auto-connect; the dashboard appends `?host=<ws url>&connect=1`.
- **Apply placement:** after `runSessionRestore` settles (after `markHydrationSource("sessions")`);
  covered by `features/sessions/apply-agent-deep-link.test.ts`.
- **Localization:** English literal (the web client has no i18n).
- **Archived agents:** same `Agent not found` toast.
