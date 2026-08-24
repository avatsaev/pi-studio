# Task 006 — Summary: live E2E verification + docs close

**Sprint:** sprint-070-thinking-level-selector
**Status:** done
**Type:** docs
**Depends on:** task-001 … task-005

## What was verified

Every acceptance-criteria row in `swe/features/thinking-level-selector.md` was proven against a
**real production daemon** (`npm start`, `studio-daemon-6767`), a **real `pi` provider** (no mocks),
and a **real headless browser** (two independent windows against `packages/web-client`'s dev server)
— not simulated. All eight boxes are now checked in the spec.

1. **Pick level → visible in Pi.** `pi-studio agent update --thinking high` against a live agent
   (`14a48e7c…`) wrote `thinking_level_change: "high"` into Pi's own session JSONL
   (`~/.pi/agent/sessions/…`), not just the daemon's record — confirmed by reading the file
   directly after the RPC returned.
2. **Reload the web client → selector shows the persisted level.** Picked `low` on a draft, sent
   the first turn, then did a **full page reload** (not a soft nav) and reconnected: the composer's
   Thinking trigger showed `low` immediately, no menu opened, no extra RPC needed beyond the
   existing `list_agents`/session-restore path (screenshot evidence).
3. **Daemon restart + resume → level survives.** Restarted `studio-daemon-6767` (real process
   restart, not a reconnect), ran `agent reload <id>`, and confirmed `record.config.thinkingOptionId`
   on disk survived unchanged. Traced the code path (`agent-service.ts` `spawnOrResumeSession`) to
   confirm *why* no new JSONL entries appear on a true resume — Pi restores its own level from the
   session history directly, matching the documented "config and JSONL cannot diverge" invariant.
   The **first-spawn** replay-after-model ordering (the part of this criterion that actually
   executes new code) is exercised and proven by item 5 below.
4. **Model switch to non-reasoning → `off` in a second window, live.** Two independent browser
   tabs/connections open on the same session; switched the model to `amazon.nova-lite-v1:0`
   (`reasoning: false`) in window 1 — the Thinking trigger flipped to `off` in **both** windows
   without either reloading, confirming the `agent_update` broadcast converges every connected
   client (two before/after screenshots captured).
5. **Draft pick → first send runs with the level.** Opened a brand-new "New chat" draft (no
   process yet), opened the Thinking menu (levels resolved from the cached model catalogue — no
   live-session RPC, no spawn), picked `low`, typed a real prompt, and sent. Daemon log showed
   `agent session spawned (deferred draft), firstSpawn: true` immediately followed by a real turn
   that completed successfully (`"DONE"`, real token usage). The session's JSONL shows Pi's own
   bootstrap `model_change`/`thinking_level_change` pair, immediately superseded by a **second**
   pair — `model_change: azure_ai/claude-opus-4-8` then `thinking_level_change: low` — proving the
   replay fires strictly model-then-thinking and lands the actual picked value, not a default.
6. **CLI bug fix.** Same evidence as item 1 — `pi-studio agent update --thinking <level>` against a
   live agent now actually changes Pi's running state (previously silently accepted and dropped).
7. **`thinkingLevelMap` TODO(verify), resolved.** Queried the live `list_provider_models` RPC
   (164 models, 6 providers) and cross-checked `@earendil-works/pi-ai`'s on-disk provider JSON.
   `thinkingLevelMap` **is present** on real shipping models — `ant-ling`'s `Ring-2.6-1T`
   (`{off,minimal,low,medium: null; high,xhigh: mapped}` — genuinely restrictive), `huggingface`'s
   `thinkingmachines/Inkling`, and `baseten`'s `Inkling`/`Inkling Small` (full identity maps). Most
   models still omit it (the base-5-level fallback is the common case), but the field is live,
   present, and actively pruning the ladder for multiple shipping models — not dead code for a
   hypothetical future model. Full findings written into the spec's former TODO(verify) section.

## Incidental findings (not code changes — logged per the task's own "out of scope" rule)

- One test send during verification (against `au.anthropic.claude-opus-5`, a Bedrock alias) failed
  with an empty assistant response / zero token usage. Traced to the session JSONL: a genuine
  provider/credential-side failure (Bedrock region/access), unrelated to thinking-level plumbing —
  the `thinking_level_change: medium` entry was still written correctly before the failure. No
  action taken; not a thinking-level-selector defect.
- Confirmed a stale assumption of my own mid-verification: `thinkingmachines/inkling-small` is
  **not** a non-reasoning model (all catalogue entries across every provider that hosts it report
  `reasoning: true`) — had to pick `amazon.nova-lite-v1:0` instead for the non-reasoning clamp test.

## Gates

`npm run build`, `npx tsc -b --force` (after `npm run clean`), `npx vitest run`
(197 files / 2607 tests, all passing), `npx oxlint packages/`, and scoped `npx oxfmt --check` on
every file touched across sprint-070 — all clean, zero warnings/errors in touched files.

## Docs

- `swe/features/thinking-level-selector.md`: all 8 acceptance-criteria boxes checked; TODO(verify)
  replaced with the concrete `thinkingLevelMap` findings above.
- Root `AGENTS.md`, `packages/{server,client,web-client,protocol}/AGENTS.md`, `swe/sprints/PLAN.md`:
  reviewed for staleness — already accurate from tasks 001–005 (no "not yet verified"/"pending"
  language found referencing sprint-070's task-006; nothing needed changing).

## Follow-ups

None. Sprint-070 is complete (all six tasks done).
