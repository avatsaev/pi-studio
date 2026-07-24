/**
 * Pure ordering helper for `ModelMenu` (sprint-043) — kept out of the `.tsx` file so it's
 * unit-testable under the root vitest config (which only discovers `.test.ts` files under a node
 * environment; `.tsx` component files are not picked up there).
 */

export interface ModelLike {
  id: string;
}

/** Move the model whose `id` matches `currentModel` to the front; keep the rest in server order. */
export function sortCurrentFirst<T extends ModelLike>(models: T[], currentModel?: string): T[] {
  if (!currentModel) return models;
  const current = models.find((m) => m.id === currentModel);
  if (!current) return models;
  return [current, ...models.filter((m) => m.id !== currentModel)];
}

/**
 * Drop later entries that repeat an earlier `id`. Real provider model lists can list the same
 * underlying model twice under different display groupings (observed live against the `pi`
 * provider: two entries both reporting id `claude-sonnet-5`) — `id` is what selection and React's
 * list `key` both rely on, so a duplicate silently causes a key collision and a stale/misplaced
 * row once the list is filtered. Call after `sortCurrentFirst` so, if the current model itself has
 * a duplicate elsewhere in the list, the kept occurrence is the one already sorted to the front.
 */
export function dedupeById<T extends ModelLike>(models: T[]): T[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}
