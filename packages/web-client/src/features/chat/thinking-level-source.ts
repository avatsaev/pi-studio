/**
 * Pure level-source selection for the composer's `ThinkingMenu` (sprint-070/task-005) — kept
 * out of the `.tsx` file so it's unit-testable under the root vitest config (node environment;
 * `.tsx` components are not picked up there, following `model-menu-sort.ts`'s precedent).
 *
 * Two sources, one decision: a LIVE session answers `agent_thinking_levels_request`
 * (authoritative per Pi's current model); a draft answers from the already-cached
 * `list_provider_models` catalogue (per-model `thinkingLevels`, derived server-side from Pi's
 * `thinkingLevelMap`). The catalogue lookup falls back to Pi's full ladder whenever the model
 * is missing from the list or carries no derivation — Pi clamps at apply time and the
 * effective level comes back in the set response / `agent_update` broadcast, so offering too
 * much is always safe; offering too little is not.
 */

/** Pi's full thinking-level ladder (pi-ai `EXTENDED_THINKING_LEVELS`) — the fallback offered
 * when no per-model derivation is available. Deliberately `string[]`, not a union: levels are
 * dynamic per model/proxy (repo convention, protocol `messages.ts`). */
export const FALLBACK_THINKING_LEVELS: string[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** The per-model fields the draft-time lookup reads off the cached provider model list. */
export interface ModelThinkingInfo {
  id: string;
  thinkingLevels?: string[];
}

/**
 * The levels a draft's `ThinkingMenu` should offer for `modelId`, reading ONLY the cached
 * catalogue (no extra RPC): the model's own derived list when present and non-empty, else the
 * full fallback ladder (model absent from the list, or a daemon too old to derive).
 */
export function levelsForModel(
  modelId: string | undefined,
  models: ModelThinkingInfo[] | undefined,
): string[] {
  if (!modelId) return FALLBACK_THINKING_LEVELS;
  const match = models?.find((m) => m.id === modelId);
  if (match?.thinkingLevels && match.thinkingLevels.length > 0) return match.thinkingLevels;
  return FALLBACK_THINKING_LEVELS;
}
