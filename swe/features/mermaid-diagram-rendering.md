# Mermaid Diagram Rendering (Chat Timeline) — Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [timeline-rendering.md](timeline-rendering.md),
> [inline-image-rendering.md](inline-image-rendering.md),
> [file-link-rendering.md](file-link-rendering.md), [agent-sessions.md](agent-sessions.md),
> [agent-providers.md](agent-providers.md),
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md)

> **Render stack:** DOM clients only (web-client + the Electron shell that hosts the same bundle).
> Markdown rendering is `react-markdown` + `remark-gfm`; diagrams render via the `mermaid` npm
> package, dynamically imported so its parser/renderer is never paid for by a session that never
> renders one. Nothing in this feature adds an RPC message type, an HTTP route, or a new binary
> opcode.

> **Sibling feature to [inline-image-rendering.md](inline-image-rendering.md) and
> [file-link-rendering.md](file-link-rendering.md)** — same shape (capability flag → system-prompt
> instruction → markdown node-override), applied to a fenced code block's language tag instead of
> an image/link node. Substantially simpler than both: rendering is synchronous and local (no
> daemon round trip, no fetch, no cache, no click-to-open target), so this doc only needs the
> sections that differ.

## Purpose

An agent narrating architecture, control flow, or a state machine in prose produces something a
diagram would communicate far better — but until now it had no way to render one; the closest it
could do was an ASCII approximation in a code fence. This feature makes a fenced
` ```mermaid ... ``` ` block render as a real diagram (flowcharts, sequence diagrams, state
machines, ER diagrams, class diagrams, Gantt charts — anything the mermaid grammar covers), and
makes the agent aware that it *should* use that syntax — but only when the connected client can
actually display it.

Two halves, deliberately independent, mirroring the sibling features:

- **Render half (client only).** Any fenced code block tagged `language-mermaid` in a finalized
  assistant/reasoning markdown block is parsed and rendered as an inline SVG diagram instead of
  syntax-highlighted text.
- **Instruction half (protocol + daemon).** A client advertises a `mermaid_diagram_markdown`
  capability in its handshake; the daemon appends a short instruction to the agent session's system
  prompt at spawn time when the creating client advertised it.

## Public Contract

### Capability flag

A new client→daemon capability flag, advertised in the `hello` handshake's `capabilities` map,
independent of and composable with `inline_image_markdown`/`file_link_markdown`:

| Flag | Direction | Meaning |
|------|-----------|---------|
| `mermaid_diagram_markdown` | client → daemon | This client renders `language-mermaid` fenced code blocks as a live diagram. |

Appended to the client-capability registry (`CLIENT_CAPS`); the registry's existing
`supports(caps, flag)` helper is the only read path. Purely additive — a client that omits it
behaves exactly as today (the block still renders as syntax-highlighted plaintext via Shiki, since
the client-side render dispatch is unconditional — see § Behavior below).

Advertised by: web-client (and therefore the Electron desktop shell, which loads the same bundle).
Not advertised by: CLI, MCP.

### Agent instruction

When the client that issues an agent-creation request advertises `mermaid_diagram_markdown`, the
daemon appends a short instruction block (`MERMAID_DIAGRAM_INSTRUCTIONS`,
`packages/server/src/agent/mermaid-diagram-instructions.ts`) to that session's system prompt,
composed via the same `compose-system-prompt.ts`/`CAPABILITY_INSTRUCTIONS` mechanism the sibling
features use — declared order is image, then file-link, then mermaid; this is the single source of
composition order regardless of the `hello` frame's own capability-declaration order.

Content requirements (exact wording is not contractual, these properties are):

- States that the session's output is displayed in a surface that renders `language-mermaid`
  fenced code blocks as diagrams.
- Names the diagram kinds worth reaching for it (flowcharts, sequence diagrams, state machines,
  ER/class diagrams, Gantt charts).
- Warns that invalid Mermaid syntax degrades to a visible error, so the agent should double-check
  syntax rather than guess.
- Short — a handful of lines. It rides on every turn of the session's context for the session's
  entire life.

Mechanics are identical to the sibling features: appended (never replacing a caller-supplied
prompt), persisted in the agent record's config, read from the per-connection session state already
threaded through agent-creation.

## Behavior & Algorithms

### Render dispatch

`markdown.tsx`'s existing `code` node-override (`CodeRenderer`) already branches on the fenced
block's `language-xxx` class before this feature; the only change is one more branch:

```
language-mermaid  -> MermaidBlock (this feature)
any other language -> CodeBlock (existing Shiki path, unchanged)
```

This dispatch is **unconditional on the client** — a client always attempts to render a
`language-mermaid` block as a diagram, regardless of what any connection advertised. The capability
flag only gates the *agent instruction*; a client that renders diagrams but never advertised the
flag (impossible today — only web-client renders, and it always advertises) would still render one
correctly if a model happened to emit one anyway.

### Diagram render pipeline

```
finalized assistant/reasoning markdown block, a ```mermaid fenced code block inside it
  -> MermaidBlock (dynamic `import("mermaid")` — same lazy-chunk rationale as `@molviewer/core`)
  -> mermaid.initialize({ theme: "base", themeVariables: <resolved from pi-studio's live theme>,
                           securityLevel: "strict" })
  -> mermaid.render(uniqueId, code)
       success -> inline SVG, `dangerouslySetInnerHTML` (mermaid's own sanitized output, not raw
                  user HTML — `securityLevel: "strict"` is mermaid's built-in sanitizer; the only
                  untrusted input is the diagram source text, parsed strictly as diagram grammar)
       failure -> raw fenced code shown verbatim, plus mermaid's own error message, so an invalid
                  diagram never loses the rest of the message
```

### Theming — a real color resolution step, not a passthrough

Unlike `<MolViewer>`'s theme override (`features/files/molecule-theme.ts`), which hands the
component raw `var(--pi-color-*)` CSS custom-property *references* that the browser resolves later
through the normal cascade, mermaid's theme engine (`khroma`) computes derived shades
(lighten/darken, contrast text) from each theme color **in JavaScript, at render time**, before any
CSS reaches the DOM. `khroma` cannot parse a `var()` reference as a color. `mermaid-theme.ts`
therefore reads pi-studio's live theme off `document.documentElement`'s **computed** custom
properties (`getComputedStyle(...).getPropertyValue(...)`) and hands mermaid concrete resolved
color strings (hex). This is read once per diagram mount; a diagram already on screen does not
retheme without remounting if the user switches theme mid-session — the same accepted trade-off as
`RowShell`'s hover-reveal timestamp opacity.

`mermaid-theme.ts` splits the CSS-var → mermaid-key mapping (`resolveMermaidThemeVariables`, pure,
unit-tested without touching `document`) from the `document`-touching read (`readMermaidThemeVariables`),
mirroring `molecule-source.ts`'s split from `@molviewer/core`.

## Data & Persistence

- **Client:** nothing persisted. A rendered diagram's SVG lives only in component state; nothing
  enters the timeline store, so no timeline row gains a new field.
- **Daemon:** the composed system prompt (caller-supplied text plus the appended mermaid
  instruction, alongside any image/file-link instructions) is stored in the agent record's config,
  exactly as the sibling features' instructions already are. No new persisted entity.
- **Wire:** no new message type, no new binary opcode. One added capability flag string.

## Error Handling & Edge Cases

| Condition | Expected behavior |
|---|---|
| Invalid Mermaid syntax (model hallucinates grammar) | Error message plus the raw fenced code shown verbatim underneath; rest of the message renders normally |
| Client does not advertise the capability | No instruction is appended; agent output is unchanged. The block still renders as a diagram client-side if a model emits one anyway (render dispatch is unconditional, see § Behavior) |
| `language-mermaid` block still streaming (not yet finalized) | Not rendered as a diagram — assistant/reasoning rows render raw text with the shared block caret while streaming, same as every other block; mermaid parsing begins only once the block finalizes, exactly like Shiki highlighting today |
| User switches theme after a diagram is already rendered | Diagram keeps its render-time colors until remounted (see § Theming); accepted, not fixed in this scope |
| Very large/complex diagram | Rendered in full; horizontal overflow scrolls inside the chat column (`overflow-x: auto`) rather than overflowing it. No complexity cap in this scope |

## Known Limitations (accepted)

**The instruction is fixed at agent spawn time.** Same asymmetry as the sibling features: a session
created from the CLI and later opened in a capable browser client has no mermaid instruction; one
created from the browser and later driven from the CLI still has it, even though the CLI shows the
fenced block as plain text. Accepted for the same reasons documented in
[inline-image-rendering.md](inline-image-rendering.md) § Known Limitations.

**No live retheme.** A diagram rendered before a theme switch keeps its original colors until its
row remounts. Fixing this would require either watching theme changes from every mounted
`MermaidBlock` or a global re-render trigger; not worth the complexity for a cosmetic-only gap.

## Dependencies

- Internal (client): the shared markdown renderer and its `code` node-override map (the same one
  `CodeBlock`/Shiki and the sibling features' `img`/`a` overrides already use); the live theme's
  CSS custom properties on `document.documentElement`.
- Internal (daemon/protocol): the client-capability registry and its `supports` helper; the
  per-connection session state carried on each RPC dispatch; `compose-system-prompt.ts`'s
  `CAPABILITY_INSTRUCTIONS` list; the agent session config's system-prompt field.
- External: `mermaid` (npm), dynamically imported.

## Acceptance Criteria

- [x] `CLIENT_CAPS.mermaid_diagram_markdown` exists, tested in `client-capabilities.test.ts`.
- [x] `compose-system-prompt.ts`'s `CAPABILITY_INSTRUCTIONS` includes the mermaid flag/instruction
      pair in stable order after image and file-link; tested in `create-run.test.ts` (capability
      composed alone, and alongside the other two, with and without a caller-supplied prompt).
- [x] The real hello → session → `handleCreate` chain composes the instruction end-to-end; tested
      in `daemon/bootstrap.test.ts` against a live WS connection and a real persisted record.
- [x] web-client's `connection-store.ts` advertises the flag unconditionally in every `hello` frame.
- [x] `language-mermaid` fenced blocks render as a live SVG diagram in the chat timeline, themed to
      match pi-studio's current appearance (light/dark, any accent tint) — verified manually
      against a real daemon session.
- [x] Invalid diagram syntax degrades to an error message plus the raw code, never a blank block or
      a thrown render error that takes down the rest of the message.
- [ ] End-to-end browser verification of the live retheme edge case (theme switch after mount) —
      not exercised; documented as accepted in § Known Limitations rather than tested.
