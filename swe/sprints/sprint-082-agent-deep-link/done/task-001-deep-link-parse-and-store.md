# Task 001 — Pure deep-link helpers and the pending-target store

- **Sprint:** sprint-082-agent-deep-link
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client (lib, stores); packages/client (pairing test only)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

The fragment grammar and the URL cleanup rule exist as pure, Node-tested functions, and a tiny
store holds the one pending target.

## Context / why

Everything with branches in this feature is string handling. Keeping it out of the hook means the
vitest suite (plain Node, no jsdom) can prove every grammar rule. `parsePairingUrl` already ignores
unknown fragment keys; this task pins that with a test so a later pairing change cannot break the
link.

## Scope references

- swe/features/web-ui-agent-deep-link.md § Public contract › URL grammar, § Behavior & algorithms
  (`parseAgentDeepLink`, `DeepLinkStore`), § Fragment cleanup policy
- packages/client/src/pairing.ts (`parsePairingUrl`, fragment read with `URLSearchParams`)
- packages/web-client/src/stores/ (zustand store conventions, e.g. `fork-store.ts`)

## What to build

- `packages/web-client/src/lib/agent-deep-link.ts`:
  - `parseAgentDeepLink(hash: string): string | undefined`: `URLSearchParams` over the hash minus
    its leading `#`, first `agent` value, already decoded. Empty, or longer than 256 characters
    after decoding, returns `undefined`.
  - `stripAgentParam(href: string): string`: the same URL with every `agent` key removed from the
    fragment. Other fragment keys keep their order and encoding, the query string is untouched, and
    an emptied fragment drops the `#`.
- `packages/web-client/src/stores/deep-link-store.ts`: `{ pendingAgentId?: string; set(id);
  consume(): string | undefined }`. In memory only, never persisted.

## Out of scope

- Reading `window.location`, `hashchange`, applying the selection (task-002).

## Acceptance criteria

- [ ] `#agent=abc` → `abc`; `#agent=a%20b%2Bc` → `a b+c`; `#offer=XYZ&agent=abc` and
  `#agent=abc&offer=XYZ&host=h` → `abc`; `#agent=` → `undefined`; `""` → `undefined`; a 257-char
  value → `undefined`; a 256-char value is returned.
- [ ] `stripAgentParam("https://x/?host=ws%3A%2F%2Fh&connect=1#offer=XYZ&agent=abc")` →
  `https://x/?host=ws%3A%2F%2Fh&connect=1#offer=XYZ`; `#agent=abc` alone → no `#` at all; a URL
  with no `agent` key comes back unchanged.
- [ ] `parsePairingUrl("https://x/#offer=<valid>&agent=abc")` deep-equals the result without
  `&agent=abc` (new case in the client package's pairing test).
- [ ] Store: `set` then `consume` returns the id and clears it; a second `consume` returns
  `undefined`.

## Test / verification plan

- `npx vitest run packages/web-client/src/lib/agent-deep-link.test.ts
  packages/web-client/src/stores/deep-link-store.test.ts packages/client/src/pairing.test.ts`
- `npm run build:web-client`

## Notes

- `+` in a raw id must arrive as `%2B`. `URLSearchParams` decodes a bare `+` to a space. That is
  sender-side guidance for the docs (task-003), not something to work around here.
