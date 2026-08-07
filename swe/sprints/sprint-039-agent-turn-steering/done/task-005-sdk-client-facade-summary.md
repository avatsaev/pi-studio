# Task 005 Summary — SDK client facade steer/followUp

- **Status:** done
- **Verified:** `npm run build` (client), `npm run typecheck`; built `packages/client/dist/pistudio-client.d.ts` exports both methods.

## What was implemented
In `packages/client/src/pistudio-client.ts`, on the agent-scoped handle (interface + impl):
- `steer(message, opts?: { clientMessageId?; images? })` →
  `daemon.request("steer_agent_request", { agentId, message, clientMessageId, images })`.
- `followUp(message, opts?)` → `daemon.request("follow_up_agent_request", { ... })`.
- Documented in the handle method-name table (mirrors `send`/`interrupt`).

## Deviations from the task spec
- None.

## Tests
- Exercised indirectly by the CLI tests (task-006), which drive the built SDK against a fake
  transport and assert the emitted RPC type + params.
