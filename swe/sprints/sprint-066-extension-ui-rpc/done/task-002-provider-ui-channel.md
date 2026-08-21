# Task 002 — Provider UI channel: contract members + Pi adapter (replace the auto-cancel stub) + mock emitter

- **Sprint:** sprint-066-extension-ui-rpc
- **Status:** done
- **Type:** feature
- **Area:** packages/server/src/agent (provider layer)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal

Add the provider-neutral UI channel (`onUiRequest` / `respondToUi`) to `AgentSession`, replace the
Pi adapter's auto-cancel POC stub with a real translation onto that channel, and give the mock
provider a scripted emitter so the family is testable with no `pi` process.

## Context / why

`packages/server/src/agent/providers/pi/agent.ts:127-142` intercepts every `extension_ui_request`
and answers the four dialog methods with `{ cancelled: true }` — its own comment says it is a POC
safe default — while the five fire-and-forget methods fall through the same `return` and are
silently dropped. That single block is why every interactive extension is inert under Pi-Studio.

**All Pi-specific knowledge stays in the Pi adapter — that is the whole design.** The service
(task-003) must see only a generic struct, so the adapter owns four things the layers above must
never learn:

1. **Which methods block.** `select`/`confirm`/`input`/`editor` (`rpc.md` § Extension UI Protocol).
2. **Namespaced surface keys.** `setStatus → "status:" + statusKey`, `setWidget → "widget:" +
   widgetKey`, `setTitle → "title"`. **The prefix is mandatory, not cosmetic.** Pi's own docs use
   the *same* key for both kinds — `statusKey: "my-ext"` (`rpc.md:1273`) and `widgetKey: "my-ext"`
   (`rpc.md:1289`) — because the natural pattern is an extension naming everything after itself.
   Un-namespaced, an extension's status tick silently deletes its own widget, which is exactly
   `rpiv-todo`'s panel, the flagship case this sprint exists to fix.
3. **Clear-by-omission.** `statusText` absent clears a status entry; `widgetLines` absent clears a
   widget (`rpc.md:1278`, `:1295`). The adapter maps those to `removed: true` so the service can
   delete the key instead of retaining a husk forever.
4. **Envelope stamping order.** `extension_ui_response` routes purely by `id` ("The `id` must match
   the request", `rpc.md:1325`), and the client-supplied response body is deliberately passthrough.
   Spread the body **first**, stamp `id` **after** — `{ ...response, id }`. Written the other way
   round, a client that puts `id` in its response body answers one dialog while resolving a
   different one.

## Scope references

- `swe/features/extension-ui-rpc.md` § Provider contract extension (all four adapter
  responsibilities), § Behavior & algorithms (the `PiAgentSession` pseudocode), § Public contract
  (envelope-stamping rule)
- `swe/features/agent-providers.md` — provider isolation; root `AGENTS.md` § Key invariants #3
- `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md` §§ 1155-1345 — the authoritative
  request/response shapes for all nine methods
- `packages/server/src/agent/provider-contract.ts` — `Unsubscribe` (line 17), `AgentSession`
  (lines 173-237); the optional-member convention (`steer?`, `compact?`, …) is the model
- `packages/server/src/agent/providers/pi/agent.ts` — `PI_CAPABILITIES` (lines 50-58), the stub to
  replace (lines 127-142), `transport.notify` usage (line 139)
- `packages/server/src/agent/providers/pi/rpc-transport.ts` — `PiRpcTransport` (`notify`, `onEvent`)
- `packages/server/src/agent/providers/mock/mock-provider.ts` — `MOCK_CAPABILITIES` (line 29),
  `MockAgentSession` (line 49), the `getPendingPermissions`/`respondToPermission` stubs (lines
  180-186) as the shape to sit beside

## What to build

**`packages/server/src/agent/provider-contract.ts`** — two optional `AgentSession` members plus
their two types. Optional so every existing provider keeps compiling and opt-out is silent:

```ts
onUiRequest?(cb: (req: ProviderUiRequest) => void): Unsubscribe;
respondToUi?(providerRequestId: string, response: ProviderUiResponse): void;

interface ProviderUiRequest {
  requestId: string;        // provider-scoped id (Pi's `id`) — NEVER a daemon-global key
  method: string;           // verbatim
  expectsResponse: boolean;
  payload: Record<string, unknown>;
  surfaceKey?: string;      // already namespaced by the adapter
  removed?: boolean;        // true ⇒ delete the retained surface
  timeoutMs?: number;
}
interface ProviderUiResponse { value?: string; confirmed?: boolean; cancelled?: boolean }
```

Document on `requestId` that it is provider-scoped and must not be used as a daemon-global map key —
task-003 mints its own wire id, and this comment is what stops a later change from "simplifying"
that away.

**`packages/server/src/agent/providers/pi/agent.ts`** — replace lines 127-142:

- A module-level `DIALOG_METHODS` constant (`select`, `confirm`, `input`, `editor`) — the single
  place the blocking set is encoded.
- In the `transport.onEvent` handler, on `type === "extension_ui_request"`: build a
  `ProviderUiRequest` (payload = the raw record minus `type`/`id`/`method`; `timeoutMs = raw.timeout`;
  `surfaceKey`/`removed` per the rules above) and fan it out to the `onUiRequest` subscribers.
  **Write no response here** — the daemon answers, or nobody does.
- Non-UI events keep falling through to `eventMapper` exactly as today.
- `respondToUi(providerRequestId, response)` → `transport.notify("extension_ui_response",
  { ...response, id: providerRequestId })`.
- `PI_CAPABILITIES.supportsExtensionUi = true`.

**`packages/server/src/agent/providers/mock/mock-provider.ts`** — implement the same two members:

- `onUiRequest` subscriber set + `respondToUi` that **records** answers so a test can assert what
  the provider received.
- A scripted emitter (e.g. `emitUiRequest(partial: Partial<ProviderUiRequest>)`) that pushes a
  request to subscribers with sensible defaults, so tasks 003-004 can drive the whole family with no
  child process.
- `MOCK_CAPABILITIES.supportsExtensionUi = true`.

## Out of scope

- `AgentUiService`, the pending map, surface retention, broadcast, wire-id minting (task-003).
- RPC handlers, the attach hook, bootstrap wiring (task-004); MCP tools (task-005).
- Any change to `getPendingPermissions`/`respondToPermission` — the dormant permission family stays
  exactly as it is.
- Buffering UI events emitted before the first subscriber attaches — see the sprint's open question;
  only add it if task-006's live run proves the race is real.

## Acceptance criteria

- [x] The auto-cancel block at `providers/pi/agent.ts:127-142` is gone; no code path writes an
      `extension_ui_response` except `respondToUi`.
- [x] A fixture `extension_ui_request` for each of the **nine** documented methods translates to the
      correct `expectsResponse`: true for `select`/`confirm`/`input`/`editor`, false for `notify`,
      `setStatus`, `setWidget`, `setTitle`, `set_editor_text`.
- [x] `setStatus{statusKey:"my-ext"}` → `surfaceKey === "status:my-ext"`;
      `setWidget{widgetKey:"my-ext"}` → `"widget:my-ext"`; `setTitle` → `"title"`. The two `"my-ext"`
      cases are asserted **together** in one test, proving they do not collide.
- [x] `notify` and `set_editor_text` produce **no** `surfaceKey`.
- [x] `setStatus` without `statusText` and `setWidget` without `widgetLines` set `removed: true`;
      with them present, `removed` is falsy.
- [x] `payload` excludes `type`/`id`/`method` and retains every other field verbatim (e.g. `options`,
      `notifyType`, `widgetPlacement`, `widgetLines`).
- [x] `timeoutMs` is populated from Pi's `timeout` when present, absent otherwise.
- [x] `respondToUi` writes `extension_ui_response` with the entry's own `id`, and a response body
      containing `id`/`type` keys **cannot** override it (asserted against a fake transport).
- [x] An unknown method (`"someFutureThing"`) still emits with `expectsResponse: false` and no
      `surfaceKey`, and does not throw.
- [x] `onUiRequest`'s returned `Unsubscribe` actually detaches the callback.
- [x] The mock provider emits scripted requests, records `respondToUi` calls, and both providers
      advertise `supportsExtensionUi: true`.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>` and `npx oxfmt --check <changed files>` clean.
- Tests: add a Pi-adapter translation test driven by a **fake `PiRpcTransport`** (no `pi` process, no
  child process) covering all nine methods, the two-`"my-ext"` collision case, the clear forms, the
  unknown method, and the stamping-order attack; extend the mock-provider test for the emitter and
  the recorder. Run `npx vitest run packages/server/src/agent`; all pass.
- Manual check: none — this task has no reachable surface yet by design (task-004 wires it).

## Notes

- Field names (`statusKey`, `statusText`, `widgetKey`, `widgetLines`, `widgetPlacement`,
  `notifyType`, `timeout`) are confirmed against the **installed** build's `docs/rpc.md`, not
  upstream docs. If a future pi bump renames one, this adapter is the only file that changes.
- `ctx.ui.custom()` never reaches the daemon (Pi returns `undefined` in-process), so there is
  nothing to translate — do not add a branch for it.
- Keep the dialog-method set as a constant, not an inline `||` chain: task-006 and any future Pi
  release need exactly one place to edit.
