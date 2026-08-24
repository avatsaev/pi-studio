/**
 * Per-model thinking-level derivation for the Pi provider (sprint-070/task-001).
 *
 * Mirrors `getSupportedThinkingLevels` from `@earendil-works/pi-ai` (bundled Pi's
 * `node_modules/@earendil-works/pi-ai/dist/models.js`): `!reasoning → ["off"]`; otherwise
 * filter the 7-level ladder by the `thinkingLevelMap` tristate — a `null` entry removes the
 * level; `xhigh`/`max` are opt-in (require a non-null map entry); the remaining levels are
 * included unless mapped to `null`.
 *
 * NOT importable by the daemon — pi-ai lives in `@earendil-works/pi-coding-agent`'s nested
 * transitive dependencies — so the Pi adapter mirrors it here as a documented, unit-tested
 * pure function. Any drift self-corrects at set time: Pi clamps authoritatively
 * (`set_thinking_level` / model switch) and the daemon writes the EFFECTIVE level back
 * (sprint-070/task-003), so this mirror only feeds the level lists a client offers, never
 * the level actually applied.
 *
 * Raw Pi `Model` objects are untyped records at this layer, so the derivation tolerates
 * absent/malformed `reasoning`/`thinkingLevelMap` (absent `reasoning` ⇒ non-reasoning,
 * matching Pi's own `if (!model.reasoning)`).
 */

/** Pi's full thinking-level ladder (pi-ai `EXTENDED_THINKING_LEVELS`, models.js). Deliberately
 * `string[]`, not a union — levels are dynamic per model/proxy (repo convention,
 * `messages.ts`' agentSessionConfigSchema comment). */
const EXTENDED_THINKING_LEVELS: string[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Derive the thinking levels a raw Pi `Model` object supports (see module header). */
export function deriveThinkingLevels(model: unknown): string[] {
  const rec = (typeof model === "object" && model !== null ? model : {}) as Record<string, unknown>;
  if (!rec.reasoning) return ["off"];
  const rawMap = rec.thinkingLevelMap;
  const map = (typeof rawMap === "object" && rawMap !== null ? rawMap : undefined) as
    | Record<string, unknown>
    | undefined;
  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = map?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}
