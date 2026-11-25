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
├── agents/{sanitized-cwd}/{id}.json    # one file per agent (the record; the timeline is not stored)
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
| `provider` | string | `pi` |
| `cwd` | string | working directory |
| `createdAt`, `updatedAt` | ISO 8601 | |
| `lastActivityAt`, `lastUserMessageAt` | ISO 8601? | |
| `title` | string? | user-visible |
| `labels` | Record<string,string> | default `{}`; `pi-studio.parent-agent-id` set for subagents |
| `lastStatus` | `initializing`/`idle`/`running`/`error`/`closed` | |
| `config` | SerializableConfig? | title, model, thinkingOptionId, featureValues, extra, systemPrompt |
| `runtimeInfo` | RuntimeInfo? | provider, sessionId, model, thinkingOptionId, extra |
| `features` | AgentFeature[]? | toggle/select provider features |
| `persistence` | PersistenceHandle? | provider, sessionId, nativeHandle, metadata |
| `lastError` | string? (nullable) | |
| `internal` | boolean? | system-internal agent |
| `archivedAt` | ISO 8601? | soft-delete timestamp |

`AgentFeature` is a discriminated union on `type`: **toggle** `{ type, id, label, description?,
tooltip?, icon?, value: boolean }` or **select** `{ ..., value: string|null, options:
AgentSelectOption[] }`.

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

function loadStore(path, schema, defaults, logger):
    if not exists: return defaults                  # silent: the ordinary first-boot state
    read the file; any other read error → throw     # not known to be damaged: never replaced
    parse JSON; schema.safeParse
    if either fails:
        rename path → {path}.corrupt-<UTC timestamp>    # -1, -2… if that name is taken
        log an error with the path, the new path and the reason
        return defaults                              # the next save writes a fresh file
    return value

function loadRegistry(path, recordSchema, logger):  # projects.json, workspaces.json
    items = loadStore(path, array of anything)      # not JSON / not an array: set aside, empty
    valid = the items that pass recordSchema
    if some were invalid:
        rename path → {path}.corrupt-<UTC timestamp>, log an error with the number dropped
        atomicWriteJson(path, valid)                 # the valid records are kept
    return valid
```
- **No versioned migrations.** Legacy provider entries are normalized inline on load
  (`persisted-config.ts`, `migrateProviderSettings`). Forward-compat = optional fields + defaults.

## Client-side stores (app)
- **Draft store** (AsyncStorage key `pi-studio-drafts`, v2): `{ drafts: Record<draftKey, { input: {
  text, images }, lifecycle: active|abandoned|sent, updatedAt, version } >, createModalDraft }`.
- **Attachment store (web)** (IndexedDB `pi-studio-attachment-bytes`, store `attachments`): binary blobs
  keyed by attachment id.
- `AttachmentMetadata`: `{ id, mimeType, storageType, storageKey, createdAt, fileName?, byteSize? }`.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Missing store file | Return defaults, silently |
| Corrupt/partial JSON, or a file that fails its schema | Set aside as `<name>.corrupt-<UTC timestamp>`, log an error, return defaults; the next save writes a fresh file and never overwrites the damaged one; never crash the daemon |
| Registry (`projects.json`, `workspaces.json`) with some invalid records | The original is set aside, the valid records are kept and written back, the number dropped is logged |
| Agent record that is damaged | Set aside and logged; the other agents load |
| Entry in `agents/` that cannot be read (dangling symlink, directory called `x.json`, permissions) | Logged as an error and skipped; recovery goes on |
| File that cannot be read at all (permissions, a directory) | The read throws; the file is not replaced |
| Legacy field shapes | Normalize inline on load |
| Concurrent writes | Atomic rename prevents torn files; writes to one path run one at a time; a registry's read-modify-write runs under one lock |
| Crash mid-write | Temp file discarded; previous file intact |

`config.json` is not loaded with `loadStore`: a damaged one is never set aside; it stops the daemon
from starting (`packages/server/AGENTS.md` § Persistence).

## Dependencies
- Internal: every feature that owns state; bootstrap opens the stores.
- External: Zod, Node fs.

## Acceptance Criteria
- [ ] Each agent persists to `agents/{sanitized-cwd}/{id}.json` and round-trips through Zod.
- [ ] A crash during write never leaves a corrupt primary file (atomic rename).
- [ ] Unknown/optional fields are tolerated on load (no migration needed).
- [ ] Project registry deduplicates by normalized `rootPath`, preferring remote-keyed ids.

## TODO(verify)
- [ ] Exact `PersistedConfigSchema` defaults per field.
- [ ] Which stores are atomic vs. plain.
