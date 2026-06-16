import { z } from "zod";

/**
 * Shared validation conventions for Pi-Studio.
 *
 * Every wire frame and every on-disk JSON document is parsed through Zod before it is trusted
 * (MAIN-SCOPE.md §9). These helpers are the backbone of "validate at every boundary" and are
 * reused by the protocol message schemas and the file-based persistence stores.
 *
 * ## Append-only compatibility rules (always)
 *
 * Schemas are **append-only**. A 6-month-old client must still parse new-daemon messages and
 * vice-versa. Concretely:
 *
 * - **New fields are optional with a default or transform.** Use {@link optionalWithDefault} so a
 *   missing field deserializes to a known value instead of `undefined`.
 * - **Never flip `optional` → `required`.** Once a field is optional it stays optional.
 * - **Never remove a field.** Stop *sending* it if you must, but keep *reading* it.
 * - **Never narrow a type** (e.g. `string` → enum, `nullable` → non-null). New enum values are
 *   gated at serialization behind capability flags so old clients only ever receive values they
 *   advertised support for.
 *
 * ## COMPAT(name) convention
 *
 * Back-compat shims are tagged so a single grep (`COMPAT(`) lists all pending cleanup work. Each
 * tag records the version the shim was added in and the date it may be removed. Use {@link COMPAT}
 * at the call site of a shim, e.g.:
 *
 * ```ts
 * // COMPAT(legacy-provider-key): added 1.2.0, remove by 2026-12-31
 * const normalized = COMPAT({ name: "legacy-provider-key", addedIn: "1.2.0", removeBy: "2026-12-31" });
 * ```
 */

/** Metadata describing a back-compat shim. Grep `COMPAT(` to enumerate cleanup work. */
export interface CompatTag {
  /** Stable identifier for the shim (kebab-case). */
  readonly name: string;
  /** Version the shim was introduced in (semver). */
  readonly addedIn: string;
  /** ISO date (YYYY-MM-DD) after which the shim may be removed. */
  readonly removeBy: string;
}

/**
 * Marks a back-compat shim. Returns the tag unchanged so it can be used inline; its real value is
 * the grep-able `COMPAT(` token and the structured metadata it carries.
 */
export function COMPAT(tag: CompatTag): CompatTag {
  return tag;
}

/**
 * Append-only field helper: declares a schema field that is optional on the wire/disk but always
 * resolves to a concrete default once parsed. This is the sanctioned way to add new fields without
 * breaking older producers that omit them.
 */
export function optionalWithDefault<S extends z.ZodTypeAny>(
  schema: S,
  defaultValue: z.infer<S>,
): z.ZodDefault<z.ZodOptional<S>> {
  return schema.optional().default(defaultValue);
}

/**
 * Parse `value` with `schema`, returning the parsed value on success or `defaults` on any failure.
 * Used by the file-based stores so corrupt/partial JSON falls back to defaults instead of crashing
 * the daemon (architecture/persistence.md — "Corrupt/partial JSON → fall back to defaults").
 */
export function safeParseOrDefault<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  defaults: z.infer<S>,
): z.infer<S> {
  const result = schema.safeParse(value);
  return result.success ? (result.data as z.infer<S>) : defaults;
}

// ---------------------------------------------------------------------------
// Shared primitive schemas
// ---------------------------------------------------------------------------

/**
 * ISO-8601 timestamp string (UTC `Z` or explicit offset), e.g. `2026-06-11T15:00:00.000Z`.
 * Timeline row timestamps are canonical, daemon-owned strings (MAIN-SCOPE.md §9).
 */
export const isoTimestampSchema = z.string().datetime({ offset: true });

/** RFC-4122 UUID string (the primary key shape for agents, chat rooms, messages, etc.). */
export const uuidSchema = z.string().uuid();

/**
 * base64url character set with no padding (`A–Z a–z 0–9 - _`). The encoding used for stable ids
 * like the daemon `server-id` (`srv_<base64url>`).
 */
export const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/, "expected base64url");

/** Returns true if `value` is a non-empty base64url string. */
export function isBase64Url(value: string): boolean {
  return base64UrlSchema.safeParse(value).success;
}

/**
 * Schema for a prefixed base64url id of the form `${prefix}_<base64url>` (e.g. `srv_AbC-123`).
 */
export function prefixedIdSchema(prefix: string): z.ZodString {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return z
    .string()
    .regex(new RegExp(`^${escaped}_[A-Za-z0-9_-]+$`), `expected ${prefix}_<base64url> id`);
}
