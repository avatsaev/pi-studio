# Structured Generation (Daemon-side Metadata) — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [features/agent-sessions.md](../features/agent-sessions.md),
> [features/git-checkout.md](../features/git-checkout.md), [config.md](config.md),
> [features/agent-providers.md](../features/agent-providers.md)

## Purpose

The daemon performs small LLM-backed metadata generation tasks itself — generated agent titles,
commit messages, PR title/body, and branch names — using a configurable fallback order of providers
rather than the agent's own session. This keeps these utility generations cheap and avoids creating
scratch provider sessions when a top-level provider API exists.

## Public Contract

### Tasks
| Task | Where used |
|------|-----------|
| Generated agent title | Agent creation / titling (`create-agent-title.ts`) |
| Commit message | Git checkout commit flow |
| PR title/body | GitHub PR create flow |
| Branch name | Worktree/branch creation (`worktree-branch-name-generator.ts`) |

### Provider selection
- Driven by `agents.metadataGeneration.providers: [{ provider, model?, thinkingOptionId? }]`.
- Order of resolution: configured entries first (in order), then dynamically-discovered defaults,
  then the current selection when available.

## Behavior & Algorithms
```
function generate(task, context):
    candidates = config.metadataGeneration.providers
              ++ discoveredDefaults
              ++ [currentSelection]
    for candidate in candidates:
        if available(candidate):
            result = candidate.structuredGenerate(prompt(task, context), schema(task))
            if valid(result): return result
    return deterministicFallback(task, context)   # e.g. truncated prompt as title
```
- Prefer provider top-level APIs (`listModels`/structured generation) over creating a throwaway
  `AgentSession` — scratch sessions can appear as empty native sessions in provider import/history
  UIs.
- Generated agent titles respect length limits (`agent-title-limits.ts`,
  `MAX_EXPLICIT_AGENT_TITLE_CHARS`).

## Data & Persistence
- Generated title is stored on the agent record (`title` / `config.title`).
- Commit message / PR text / branch name are transient inputs to git operations, not separately
  persisted by this subsystem.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| No configured provider available | Fall through to discovered defaults, then current selection |
| All providers fail | Use a deterministic fallback (e.g. derived-from-prompt title) |
| Provider returns invalid structured output | Skip to next candidate |

## Dependencies
- Internal: provider registry, structured-generation-providers, agent metadata generator.
- External: configured agent providers.

## Acceptance Criteria
- [ ] Metadata tasks try `metadataGeneration.providers` in configured order first.
- [ ] A failing/unavailable provider falls through to the next candidate.
- [ ] No throwaway agent session is created when a top-level provider API suffices.
- [ ] Generated titles never exceed the title character limit.

## TODO(verify)
- [ ] Exact prompt/schema per task.
- [ ] The deterministic final fallback for each task type.
