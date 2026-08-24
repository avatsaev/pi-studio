/**
 * Pure ordering helpers for `ModelMenu` (sprint-043) — kept out of the `.tsx` file so they're
 * unit-testable under the root vitest config (which only discovers `.test.ts` files under a node
 * environment; `.tsx` component files are not picked up there).
 */

export interface ModelLike {
  id: string;
  /** The model's own underlying LLM provider (e.g. `"anthropic"`) — the picker's grouping key,
   * and half of a model's real identity (see `dedupeByModelKey`). */
  provider?: string;
}

/**
 * Move the model the session is currently on to the front; keep the rest in server order. Since
 * the picker groups by provider, hoisting also decides which provider band renders first, so
 * `currentProvider` disambiguates when the same `id` is offered by more than one provider — an
 * id-only match could otherwise hoist (and check-mark) the wrong provider's copy.
 */
export function sortCurrentFirst<T extends ModelLike>(
  models: T[],
  currentModel?: string,
  currentProvider?: string,
): T[] {
  if (!currentModel) return models;
  const matches = models.filter((m) => m.id === currentModel);
  const current =
    (currentProvider === undefined
      ? undefined
      : matches.find((m) => m.provider === currentProvider)) ?? matches[0];
  if (!current) return models;
  // Identity, not id: other providers' copies of the same id are distinct rows that stay put.
  return [current, ...models.filter((m) => m !== current)];
}

/**
 * Drop later entries that repeat an earlier `provider/id` pair. Real provider model lists can
 * list the same underlying model twice (observed live against the `pi` provider: two entries both
 * reporting id `claude-sonnet-5`), which silently collides React list keys and leaves a
 * stale/misplaced row once the list is filtered. The key is `provider/id`, not `id` alone: the
 * same model reachable through two providers is two genuinely different choices (different
 * credentials and billing, and `setModel` takes the provider), and grouping renders them under
 * their own headers rather than as an unexplained duplicate. Call after `sortCurrentFirst` so the
 * kept occurrence of the current model is the one already sorted to the front.
 */
export function dedupeByModelKey<T extends ModelLike>(models: T[]): T[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    const key = `${m.provider ?? ""}/${m.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
