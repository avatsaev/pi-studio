# `@av-pi-studio/app` — AGENTS.md

Cross-platform Expo / React Native client for Pi-Studio.

> **Status: placeholder — implementation planned for a later sprint.**
> The current source exports only a package identifier constant.

---

## Intended purpose

`app` is the **mobile and web client** for Pi-Studio — a React Native application built with Expo
(Metro bundler). It connects to a daemon either directly (LAN) or via the relay transport, and
exposes the full Pi-Studio experience on iOS, Android, and web.

It builds on `@av-pi-studio/client` (DaemonClient + PiStudioClient) and
`@av-pi-studio/protocol` (wire types) and renders the UI using the Expo/React Native component
ecosystem.

---

## Planned responsibilities

- **Connection management**: direct WS (`ws://…`) or relay (`relay://…`) via the injected
  `Transport` abstraction; QR-scan pairing flow.
- **Agent views**: create agents, stream live events, render timelines (assistant messages,
  reasoning, tool calls), send follow-up prompts, manage permissions.
- **Terminal views**: render PTY output from binary terminal frames via `TerminalStreamRouter`;
  send `Input` / `Resize` frames.
- **Project / workspace views**: open projects, browse worktrees, git status.
- **Chat rooms**: post and read agent↔agent / human↔agent messages.
- **File explorer**: directory listing, text/binary preview using `HighlightResult` tokens.
- **Schedules and loops**: create/view/manage.

---

## Dependency graph

```
app  →  @av-pi-studio/client  →  @av-pi-studio/protocol
app  →  @av-pi-studio/protocol (direct, for wire types + binary codecs)
```

`app` must **not** import `@av-pi-studio/server`, `@av-pi-studio/cli`, or
`@av-pi-studio/relay` (relay transport is injected, not imported directly by the app layer).

---

## Current source

```
src/
  index.ts    export const APP_PACKAGE = "@av-pi-studio/app"
```

---

## When implementing this sprint

1. Read `clean-room-scope/architecture/client-app-runtime.md` for the layered client library
   design and the app runtime controller.
2. Read the relevant `features/` specs for each view you are building.
3. The `DaemonClient` and `PiStudioClient` from `@av-pi-studio/client` are the only networking
   surface — never open raw WebSockets in app components.
4. Binary terminal frames are decoded in `@av-pi-studio/protocol` and demuxed by
   `TerminalStreamRouter` from `@av-pi-studio/client`; the app renders the byte stream with a
   terminal emulator component.
5. Do not introduce Node-only APIs (`fs`, `path`, `child_process`, `node-pty`, …). This package
   runs entirely in the Hermes/V8 JS environment.

---

## Key invariants (for future implementation)

- **No Node-only APIs.** This package runs in the browser/Hermes JS environment.
- **Transport-injected.** Relay vs direct is decided at connection time; the app itself doesn't
  import `@av-pi-studio/relay`.
- **Client-only.** No server-side code, no `@av-pi-studio/server` imports.
- **Protocol append-only.** The app must handle unknown `type` values in session messages
  gracefully (ignore, don't crash).
