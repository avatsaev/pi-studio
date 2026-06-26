# Gateway architecture

The **daemon** is Pi-Studio's gateway: a single long-lived Node process that accepts client
connections over WebSocket (browser, CLI, mobile, MCP), authenticates and routes every frame, and
fans work out to feature services. The most important of those services is the **agent layer**,
which spawns and drives `pi` agent processes and streams their output back to every connected
client.

This document traces, end to end, **how an event enters the gateway from the outside** and **what
happens when a new user query (a chat prompt) arrives**.

> Source map: the gateway lives in `packages/server/src`. Key files are referenced inline as
> `ws/ws-server.ts`, `ws/router.ts`, `agent/agent-service.ts`, `agent/providers/pi/*`, etc.

---

## 1. The big picture

```mermaid
flowchart LR
  subgraph Outside["Outside the gateway"]
    Browser["Browser POC<br/>(poc/index.html)"]
    CLI["CLI<br/>(@av-pi-studio/cli)"]
    Mobile["Mobile / MCP"]
  end

  subgraph Daemon["Daemon process (the gateway)"]
    direction TB
    HTTP["HTTP server<br/>http/http-server.ts"]
    WS["WebSocket server<br/>ws/ws-server.ts"]
    Sec{{"Edge checks<br/>Host allowlist · auth"}}
    Sess["Session<br/>ws/session.ts"]
    Router["Frame router<br/>ws/router.ts"]
    Registry["Handler registry<br/>(type → handler)"]

    subgraph Services["Feature services"]
      Agent["AgentService"]
      Term["TerminalManager"]
      Proj["Projects / git"]
      Files["Files"]
      Orch["Chat / schedules / loops"]
    end
  end

  subgraph Providers["Agent providers"]
    Pi["pi --mode rpc<br/>(child process)"]
    Mock["mock provider"]
  end

  Browser & CLI & Mobile -- "WS upgrade + frames" --> HTTP
  HTTP --> Sec
  Sec -- "ok" --> WS
  WS --> Sess
  Sess --> Router
  Router --> Registry
  Registry --> Agent & Term & Proj & Files & Orch
  Agent -- "spawn + JSONL stdio" --> Pi
  Agent -. "in-process" .-> Mock
  Pi -- "events" --> Agent
  Agent -- "broadcast agent_stream" --> Sess
```

**Layers, from the edge inward:**

| Layer | File(s) | Responsibility |
| --- | --- | --- |
| Transport | `http/http-server.ts`, `ws/ws-server.ts` | TCP/HTTP listener; WebSocket upgrade. |
| Edge security | `http/host-allowlist.ts`, `auth/password-auth.ts` | Host-header allowlist (DNS-rebinding defense) + optional password auth, both enforced **at the upgrade**. |
| Handshake / session | `ws/ws-server.ts`, `ws/session.ts` | First frame must be `hello`; a `Session` object is created and capabilities are persisted. |
| Routing | `ws/router.ts` | Parse envelopes, answer `ping`, dispatch `session` messages by `type`, correlate replies/errors by `requestId`. |
| Handlers | `HandlerRegistry` | Map a message `type` to a feature handler. |
| Feature services | `agent/`, `terminal/`, `projects/`, `files/`, `orchestration/` | The actual business logic. |
| Providers | `agent/providers/pi`, `agent/providers/mock` | Drive the underlying agent runtime (a `pi` child process, or an in-process mock). |

---

## 2. How a connection is established

A client never speaks to a handler directly. It must first cross the edge and complete the handshake.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant H as HTTP server
  participant WSS as WebSocketServer
  participant S as Session
  participant Store as CapabilityStore

  C->>H: HTTP GET + "Upgrade: websocket"<br/>(Host header, optional bearer subprotocol)
  H->>WSS: "upgrade" event
  WSS->>WSS: hostCheck(Host) — host-allowlist.ts
  alt Host not allowed
    WSS-->>C: 403 Host not allowed, destroy socket
  else
    WSS->>WSS: auth.authenticateUpgrade(req) — password-auth.ts
    alt Auth fails
      WSS-->>C: 401 Unauthorized, destroy socket
    else
      WSS-->>C: 101 Switching Protocols (WS open)
      C->>WSS: 1st frame = hello {clientId, clientType, protocolVersion}
      alt First frame is not a valid hello
        WSS-->>C: close 1008
      else
        WSS->>Store: get/set capabilities by clientId
        WSS->>S: new Session(...) registered in sessions set
        S-->>C: status / server_info {serverId, features, capabilities}
        Note over C,S: Handshake complete — data path is open
      end
    end
  end
```

Key invariants (`ws/ws-server.ts`):

- **Host + auth are checked at the upgrade**, before any WebSocket frame is processed. A literal IP
  or `localhost`/`*.localhost` Host is always allowed; configured `hostnames` extend the list.
- **The first frame must be `hello`.** A binary or non-`hello` first frame closes the socket with
  code `1008`.
- The `hello.protocolVersion` is required; the server replies with a `server_info` payload that
  advertises `serverId` and the enabled `features`.
- Capabilities are **persisted per `clientId`** so a reconnecting client that omits them is
  rehydrated from the store.

---

## 3. How a frame is routed after the handshake

Every post-handshake frame is delivered to `onMessage` (wired in `bootstrap.ts`) and forwarded to
the router. Text frames are JSON **envelopes**; binary frames are terminal/file streams.

```mermaid
flowchart TD
  Frame["Incoming frame"] --> Kind{binary?}
  Kind -- yes --> Bin["routeBinaryFrame()<br/>→ terminal / file stream handler"]
  Kind -- no --> Parse["routeTextFrame(): JSON.parse"]
  Parse --> Env{"envelope.type"}
  Env -- "ping" --> Pong["reply pong<br/>(liveness; never closes socket)"]
  Env -- "pong" --> Ignore1["ignore (client ack)"]
  Env -- "session" --> Dispatch["dispatchSessionMessage()"]
  Env -- other --> Ignore2["ignore"]

  Dispatch --> Lookup{"registry.get(message.type)"}
  Lookup -- "missing & has requestId" --> RpcErr1["rpc_error: unknown_message_type"]
  Lookup -- "missing & no requestId" --> Drop["ignore"]
  Lookup -- "found" --> Run["await handler(ctx)"]
  Run -- "returns value" --> Reply["wrap + attach requestId<br/>→ session.send"]
  Run -- "throws" --> RpcErr2["rpc_error: handler_error<br/>(operation error, socket stays open)"]
```

Routing rules (`ws/router.ts`):

- **`ping` → `pong`** on the data path. Liveness is independent of any RPC; an RPC timeout is an
  *operation* failure and must **never** close the socket.
- A `session` envelope carries an inner `message` with a `type`. The router looks the type up in the
  `HandlerRegistry` (canonical dotted names plus legacy flat-name aliases).
- The handler's return value is wrapped back into a `session` envelope and **correlated by
  `requestId`** so the client can match the reply to its request.
- A handler that **throws** (including a timeout) yields an `rpc_error` correlated by `requestId` —
  the connection survives.
- Unknown types are an `rpc_error` only if a `requestId` was supplied; otherwise they are dropped.

---

## 4. What happens when a new user query arrives

This is the central flow: a chat prompt from the POC becomes a real `pi` turn whose output streams
back to **every** connected client.

The browser sends `create_agent_request` for the first message (it creates the agent *and* runs the
first turn), and `send_agent_prompt` for follow-ups. Both are registered by `AgentService`
(`agent/agent-service.ts`).

```mermaid
sequenceDiagram
  autonumber
  participant C as Client (POC chat)
  participant R as Router
  participant AS as AgentService
  participant M as AgentManager
  participant PC as PiAgentClient
  participant T as RPC transport
  participant Pi as pi --mode rpc (child)
  participant All as All sessions

  C->>R: session { create_agent_request, config:{provider:"pi", cwd}, initialPrompt, requestId }
  R->>AS: handleCreate(msg)

  AS->>M: add(record @ "initializing")
  AS-->>All: broadcast agent_update {status:"initializing"}

  AS->>PC: resolveClient("pi").createSession({provider,cwd})
  PC->>PC: isAvailable()? resolve bundled pi CLI
  PC->>T: spawn pi --mode rpc (createProcessTransport)
  AS->>M: attachSession + setStatus("idle")
  AS-->>All: broadcast agent_update {status:"idle"}

  Note over AS,Pi: initialPrompt present → run the first turn
  AS->>AS: runTurn(agentId, session, prompt)
  AS->>M: setStatus("running")
  AS-->>All: broadcast agent_update {status:"running"}
  AS->>AS: subscribe(session) → timeline.append + broadcast

  AS->>T: notify("prompt", {message: prompt})
  T->>Pi: {"type":"prompt","message":"…"}\n

  loop streamed events (JSONL on stdout)
    Pi-->>T: agent_start / message_update / tool_execution_* / agent_end
    T->>AS: onEvent(raw) → mapPiEvent(raw)
    AS->>AS: timeline.append(event)
    AS-->>All: broadcast session{ agent_stream, agentId, seq, event }
  end

  Pi-->>T: agent_end
  AS->>AS: run() promise resolves (turn_completed seen)
  AS->>M: setStatus("idle")
  AS-->>All: broadcast agent_update {status:"idle"}
  AS-->>C: create_agent_response { agentId } (correlated by requestId)
```

### Step-by-step

1. **Frame arrives & is routed.** The `create_agent_request` envelope reaches
   `dispatchSessionMessage`, which invokes `AgentService.handleCreate`.
2. **Agent record created.** `AgentManager.add` persists a record at status `initializing`, and an
   `agent_update` is broadcast to all sessions.
3. **Provider session created.** `resolveClient("pi")` returns a `PiAgentClient`. `createSession`:
   - checks `isAvailable()` (resolves the **bundled** `pi` CLI inside
     `@earendil-works/pi-coding-agent` — no global install needed; see
     `rpc-transport.ts › defaultPiCommand`);
   - spawns `node <pkg>/dist/cli.js --mode rpc` via `createProcessTransport`. A literal `~` cwd is
     expanded server-side (`expandHome`).
   - If pi can't be resolved, a clean `rpc_error` ("Pi provider unavailable…") is returned instead
     of crashing the daemon.
4. **Status → idle.** The session is attached to the manager and an `agent_update {idle}` is
   broadcast.
5. **Turn runs** (because `initialPrompt` was supplied). `runTurn`:
   - sets status `running` (+ broadcast);
   - **subscribes** to the session's event stream: each event is appended to the agent's **timeline**
     (monotonic `seq`) and broadcast to **all** sessions as an `agent_stream` frame;
   - guarantees exactly one canonical `user_message` (emitted by the provider, or synthesized if the
     provider doesn't);
   - sends the prompt to pi via `transport.notify("prompt", {message})`.
6. **pi streams events.** pi emits JSONL events on stdout; the transport frames them and calls
   `mapPiEvent`, which normalizes them to provider-neutral `AgentStreamEvent`s (see §5). Each becomes
   an `agent_stream` broadcast.
7. **Turn completes.** When `agent_end` (→ `turn_completed`) is seen, the `run()` promise resolves,
   status returns to `idle` (+ broadcast), and `handleCreate` finally returns
   `create_agent_response { agentId }`, correlated by `requestId`.

> **Why the response can lag the stream.** `create_agent_request` only resolves after the *entire*
> first turn finishes (it `await`s `runTurn`). A long turn can exceed a client's RPC timeout — but
> the UI is driven by the `agent_stream` **broadcasts**, not by the response. The POC therefore
> adopts the `agentId` from the first stream event and uses a long timeout for turn-running RPCs.

### Follow-up prompts

`send_agent_prompt` skips agent creation: it looks up the live session and calls the same `runTurn`
on the existing agent.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant AS as AgentService
  participant M as AgentManager
  participant Pi as pi (existing child)

  C->>AS: send_agent_prompt { agentId, prompt }
  AS->>M: get(agentId).session
  AS->>AS: runTurn(...) — same subscribe + broadcast loop
  AS->>Pi: notify("prompt", {message})
  Pi-->>AS: streamed events → agent_stream broadcasts
  AS-->>C: agent_prompt_response { status:"idle" }
```

---

## 5. The pi provider adapter (transport + event mapping)

The agent layer never reaches into pi internals; it talks to a small transport interface and a pure
event mapper. This is what makes the provider swappable (the `mock` provider implements the same
`AgentClient` contract).

```mermaid
flowchart LR
  subgraph Adapter["agent/providers/pi"]
    Client["PiAgentClient<br/>agent.ts"]
    Session["PiAgentSession<br/>agent.ts"]
    Transport["createProcessTransport<br/>rpc-transport.ts"]
    Mapper["mapPiEvent<br/>event-mapper.ts"]
  end
  Proc["pi --mode rpc<br/>child process"]

  Client -- "createSession" --> Session
  Session -- "notify(prompt/abort)" --> Transport
  Transport -- "JSON line on stdin" --> Proc
  Proc -- "JSON lines on stdout" --> Transport
  Transport -- "onEvent(raw)" --> Session
  Session -- "mapPiEvent(raw)" --> Mapper
  Mapper -- "AgentStreamEvent" --> Session
```

**Wire protocol** (`rpc-transport.ts`, per pi's `docs/rpc.md`):

- **Commands** are single JSON lines on stdin: `{"type":"prompt","message":"…","id?":"…"}`.
- **Request/response** is correlated by `id`; a reply is `{"type":"response","command","success","id","data?","error?"}`.
  `notify()` is fire-and-forget (used for `prompt` and `abort`); `request()` awaits the correlated
  response (used for `get_available_models`).
- **Events** are every other JSON line on stdout.
- **Framing is strict JSONL: split on `\n` only** (strip a trailing `\r`). Node's `readline` is
  deliberately avoided because it also splits on U+2028/U+2029, which are valid inside JSON strings.

**Event mapping** (`event-mapper.ts`) — raw pi events → neutral timeline events:

| pi event | `AgentStreamEvent` |
| --- | --- |
| `agent_start` | `turn_started` |
| `agent_end` | `turn_completed` |
| `message_update` (`text_delta`) | `assistant_message` (text delta) |
| `message_update` (`thinking_delta`) | `reasoning` |
| `message_update` (`toolcall_end`) | `tool_call` (status `started`) |
| `tool_execution_start` | `tool_call` (status `running`) |
| `tool_execution_end` | `tool_call` (status `completed` / `error`) |
| `extension_error` / `error` | `error` |
| `turn_start`/`turn_end`, `message_start`/`message_end`, `*_update`, `compaction_*`, `auto_retry_*` | ignored |

**Robustness:** a spawn failure (missing binary) emits an async `'error'` event on the child
process. The transport listens for it and converts it into a rejected request + an `error` stream
event, so a missing pi never crashes the daemon. The `pi` process tree is `treeKill`ed on `close`.

---

## 6. Broadcasting & the timeline

Two properties make the system feel live and consistent:

- **Every agent event is broadcast to every session.** `runTurn` calls `broadcast(getSessions(), …)`,
  so a prompt sent by one client streams to all connected clients (multi-device, multi-pane). The
  `broadcast` helper simply iterates `handle.ws.sessions` and calls `session.send`.
- **Every event is appended to a per-agent timeline** with a monotonic `seq` and timestamp
  (`agent/timeline-store.ts`). A late-joining or reconnecting client fetches history via
  `fetch_agent_timeline_request` and then follows the live `agent_stream` broadcasts — no events are
  lost across a reconnect.

```mermaid
flowchart LR
  Ev["AgentStreamEvent"] --> TL["timeline.append → {seq, timestamp, event}"]
  TL --> B["broadcast to all sessions"]
  TL --> Hist["history (fetch_agent_timeline_request)"]
  B --> S1["Session A"]
  B --> S2["Session B"]
  Hist --> Late["late / reconnecting client"]
```

---

## 7. Bootstrap & wiring

The gateway is assembled by `bootstrap()` (`daemon/bootstrap.ts`): identity + PID lock, config,
auth, host checker, HTTP server, WS server, and an **empty** `HandlerRegistry`. The clean-room
production bootstrap intentionally ships no feature handlers (that is its own sprint).

For the POC, `devBootstrap()` (`daemon/dev-bootstrap.ts`) reuses that base and registers **all**
feature services onto the live registry — agents, terminals, projects/git/worktrees, files, chat,
schedules, loops, providers — so a UI or CLI can exercise the daemon end to end. It also augments the
provider PATH (so the agent's own tools resolve) while still launching the **bundled** pi CLI.

```mermaid
flowchart TD
  Boot["bootstrap()"] --> Id["identity + PID lock"]
  Boot --> Cfg["loadConfig()"]
  Boot --> Auth["createPasswordAuth()"]
  Boot --> Host["createHostChecker()"]
  Boot --> HTTP["createHttpServer()"]
  Boot --> WS["createWebSocketServer(httpServer)"]
  Boot --> Reg["new HandlerRegistry() (empty)"]
  WS -- "onMessage" --> Route["routeTextFrame / routeBinaryFrame"]
  Route --> Reg

  Dev["devBootstrap()"] --> Boot
  Dev --> RegAll["register ALL feature services<br/>onto the same registry"]
  RegAll --> Reg
```

---

## 8. End-to-end summary

A new user query travels:

```
Client → WS upgrade (Host + auth) → hello/Session → router → registry
      → AgentService.handleCreate/runTurn → PiAgentClient → transport → pi --mode rpc
pi events → mapPiEvent → timeline.append → broadcast(agent_stream) → all Sessions → clients
```

- **Edge** rejects bad hosts/credentials before any frame is processed.
- **Router** correlates requests and replies by `requestId`; handler failures are operation errors,
  never dead sockets.
- **AgentService** owns the turn lifecycle, the per-agent timeline, and the broadcast fan-out.
- **The pi adapter** is a thin, swappable transport + pure event mapper over a strict-JSONL child
  process, with the CLI bundled so no global install is required.
