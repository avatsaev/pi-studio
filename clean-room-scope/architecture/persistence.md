# Persistence (File-Based JSON Stores) — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [agent-lifecycle.md](agent-lifecycle.md), [config.md](config.md),
> all feature scopes that own data

## Purpose

Pi-Studio uses **file-based JSON persistence** instead of a database. All data is Zod-validated at
runtime. Most stores write atomically (write temp file in the target directory, then rename); a few
use plain writes. There is **no migration framework** — forward compatibility comes from optional
fields with defaults/transforms, plus a small amount of inline normalization for legacy entries.

## Public Contract

All server stores live under `$PI_STUDIO_HOME` (default `~/.pi-studio`).

```
$PI_STUDIO_HOME/
├── config.json                         # Daemon config (PersistedConfigSchema)
├── server-id                           # "srv_<base64url>" (plain text)
├── daemon-keypair.json                 # { v:2, publicKeyB64, secretKeyB64 } mode 0600
├── pi-studio.pid                           # { pid, startedAt, ... }
├── daemon.log                          # pino output (rotating)
├── agents/{sanitized-cwd}/{id}.json    # one file per agent (record + timeline rows)
├── schedules/{id}.json                 # one file per schedule (id = 8 hex)
├── chat/rooms.json                     # all rooms + messages
├── loops/loops.json                    # all loops (non-atomic, queued)
├── projects/projects.json              # project registry
└── projects/workspaces.json            # workspace registry
```

`sanitized-cwd` is derived from the agent `cwd` by stripping the filesystem root and replacing path
separators with `-` (Windows drive letters become a `C-`-style prefix).

## Data shapes (field tables)

### Agent record (`agents/{cwd}/{id}.json`)
| Field | Type | Notes |
|-------|------|-------|
| `id` | string (UUID) | primary key |
| `provider` | string | `pi` (or a custom `extends:"pi"` profile id) |
| `cwd` | string | working directory |
| `createdAt`, `updatedAt` | ISO 8601 | |
| `lastActivityAt`, `lastUserMessageAt` | ISO 8601? | |
| `title` | string? | user-visible |
| `labels` | Record<string,string> | default `{}`; `pi-studio.parent-agent-id` set for subagents |
| `lastStatus` | `initializing`/`idle`/`running`/`error`/`closed` | |
| `lastModeId` | string? | |
| `config` | SerializableConfig? | title, modeId, model, thinkingOptionId, featureValues, extra, systemPrompt, mcpServers |
| `runtimeInfo` | RuntimeInfo? | provider, sessionId, model, thinkingOptionId, modeId, extra |
| `features` | AgentFeature[]? | toggle/select provider features |
| `persistence` | PersistenceHandle? | provider, sessionId, nativeHandle, metadata |
| `lastError` | string? (nullable) | |
| `internal` | boolean? | system-internal agent (loop workers, etc.) |
| `archivedAt` | ISO 8601? | soft-delete timestamp |

`AgentFeature` is a discriminated union on `type`: **toggle** `{ type, id, label, description?,
tooltip?, icon?, value: boolean }` or **select** `{ ..., value: string|null, options:
AgentSelectOption[] }`.

### Schedule (`schedules/{id}.json`)
`{ id (8 hex), name?, prompt, cadence, target, status: active|paused|completed, createdAt,
updatedAt, nextRunAt?, lastRunAt?, pausedAt?, expiresAt?, maxRuns?, runs: ScheduleRun[] }`.
- `cadence`: `{ type:"every", everyMs }` or `{ type:"cron", expression, timezone? }` (absent
  timezone = UTC).
- `target`: `{ type:"agent", agentId }` or `{ type:"new-agent", config:{ provider, cwd, modeId?,
  model?, thinkingOptionId?, title?, approvalPolicy?, sandboxMode?, networkAccess?, webSearch?,
  extra?, systemPrompt?, mcpServers? } }`.
- `ScheduleRun`: `{ id, scheduledFor, startedAt, endedAt?, status: running|succeeded|failed,
  agentId?, output?, error? }`.

### Loop (`loops/loops.json`)
Array of loop records (non-atomic write, serialized through an in-memory queue). Fields include
`id` (8-char), `name?`, `prompt`, `cwd`, `provider`, `model?`, `modeId?`, worker/verifier overrides,
`verifyPrompt?`, `verifyChecks: string[]`, `archive`, `sleepMs`, `maxIterations?`, `maxTimeMs?`,
`status: running|succeeded|failed|stopped`, timestamps, `iterations: LoopIteration[]`,
`logs: LoopLogEntry[]`, `nextLogSeq`, `activeIteration?`, `activeWorkerAgentId?`,
`activeVerifierAgentId?`. See [features/loops.md](../features/loops.md) for nested shapes.

### Chat (`chat/rooms.json`)
`{ rooms: ChatRoom[], messages: ChatMessage[] }`.
- `ChatRoom`: `{ id (UUID), name (unique, case-insensitive), purpose?, createdAt, updatedAt }`.
- `ChatMessage`: `{ id (UUID), roomId, authorAgentId, body, replyToMessageId?, mentionAgentIds:
  string[], createdAt }`.

### Project registry (`projects/projects.json`)
Array of `{ projectId, rootPath, kind: git|non_git, displayName, createdAt, updatedAt,
archivedAt: string|null }`. Active git projects are unique by normalized `rootPath`; startup
reconciliation repairs duplicates, preferring remote-keyed ids like
`remote:github.com/owner/repo`.

### Workspace registry (`projects/workspaces.json`)
Array of `{ workspaceId, projectId, cwd, kind: local_checkout|worktree|directory, displayName,
createdAt, updatedAt, archivedAt: string|null }`.

## Behavior & Algorithms
```
function atomicWriteJson(path, data):
    validate data with its Zod schema
    write to {path}.tmp in the SAME directory
    fsync + rename {path}.tmp → {path}        # atomic on POSIX

function loadStore(path, schema):
    if not exists: return defaults
    parse JSON; schema.safeParse; normalize legacy entries; return value or defaults
```
- **No versioned migrations.** Legacy provider entries are normalized inline on load
  (`persisted-config.ts`, `migrateProviderSettings`). Forward-compat = optional fields + defaults.
- Loop store writes are direct (not atomic) and queued; on startup, `running` loops → `stopped`.

## Client-side stores (app)
- **Draft store** (AsyncStorage key `pi-studio-drafts`, v2): `{ drafts: Record<draftKey, { input: {
  text, images }, lifecycle: active|abandoned|sent, updatedAt, version } >, createModalDraft }`.
- **Attachment store (web)** (IndexedDB `pi-studio-attachment-bytes`, store `attachments`): binary blobs
  keyed by attachment id.
- `AttachmentMetadata`: `{ id, mimeType, storageType, storageKey, createdAt, fileName?, byteSize? }`.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Missing store file | Return defaults |
| Corrupt/partial JSON | Reject or fall back to defaults; never crash the daemon |
| Legacy field shapes | Normalize inline on load |
| Concurrent writes | Atomic rename prevents torn files; loop store serializes via queue |
| Crash mid-write | Temp file discarded; previous file intact |

## Dependencies
- Internal: every feature that owns state; bootstrap opens the stores.
- External: Zod, Node fs.

## Acceptance Criteria
- [ ] Each agent persists to `agents/{sanitized-cwd}/{id}.json` and round-trips through Zod.
- [ ] A crash during write never leaves a corrupt primary file (atomic rename).
- [ ] Unknown/optional fields are tolerated on load (no migration needed).
- [ ] Loop records with `status:"running"` become `stopped` after a restart.
- [ ] Project registry deduplicates by normalized `rootPath`, preferring remote-keyed ids.

## TODO(verify)
- [ ] Exact `PersistedConfigSchema` defaults per field.
- [ ] Which stores are atomic vs. plain (loop store confirmed plain/queued).
