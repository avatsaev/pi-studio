# Task 005 — Timeline & composer parity (Paseo)

- **Sprint:** sprint-036-paseo-ux-parity
- **Status:** done
- **Estimated size:** L
- **Depends on:** task-001 (tokens)

## Reference (Paseo)
- `components/agent-stream/*` (message rows, turn footer, strategy), `composer/*`,
  `provider-usage/*` (composer footer usage widget), `docs/design.md`.
- Pi-Studio: `packages/app/src/components/timeline/*`, `packages/app/src/timeline/*`,
  `packages/app/src/components/timeline/Composer.tsx`, `packages/app/src/composer/*`.

## What to build
- **Message rows**: user vs assistant treatment matching Paseo (spacing, bubble/plain, markdown
  rendering, code blocks with syntax highlight, muted metadata/turn footer). Quiet, spacious.
- **Tool-call cards / diffs / permission prompts**: Paseo card language (single border, header row,
  status color only where earned).
- **Composer**: the input IS the surface; model selector (`Combobox`), attach, send; provider-usage
  footer widget; `MAX_CONTENT_WIDTH` for readable lines while the pane fills the rest.
- Streaming rendering (token deltas) with the same calm treatment.

## Acceptance criteria
- [ ] User/assistant messages, tool cards, and the composer visually match Paseo.
- [ ] Markdown + code highlighting render correctly; streaming updates smoothly.
- [ ] Composer model selector + attachments + send match Paseo; usage footer present.
- [ ] App typecheck + vitest + `build:web` pass.

## Test / verification plan
- Visual: screenshot a conversation with a code block + a tool call; compare to Paseo.
