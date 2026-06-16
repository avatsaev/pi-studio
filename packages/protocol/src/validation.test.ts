import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  base64UrlSchema,
  COMPAT,
  isBase64Url,
  isoTimestampSchema,
  optionalWithDefault,
  prefixedIdSchema,
  safeParseOrDefault,
  uuidSchema,
} from "./validation.js";

describe("isoTimestampSchema", () => {
  it("accepts ISO-8601 UTC and offset timestamps", () => {
    expect(isoTimestampSchema.safeParse("2026-06-11T15:00:00.000Z").success).toBe(true);
    expect(isoTimestampSchema.safeParse("2026-06-11T15:00:00+02:00").success).toBe(true);
  });

  it("rejects non-timestamps and date-only strings", () => {
    expect(isoTimestampSchema.safeParse("not-a-date").success).toBe(false);
    expect(isoTimestampSchema.safeParse("2026-06-11").success).toBe(false);
    expect(isoTimestampSchema.safeParse(1718118000000).success).toBe(false);
  });
});

describe("uuidSchema", () => {
  it("accepts a valid UUID", () => {
    expect(uuidSchema.safeParse("123e4567-e89b-12d3-a456-426614174000").success).toBe(true);
  });

  it("rejects malformed UUIDs", () => {
    expect(uuidSchema.safeParse("123e4567-e89b-12d3-a456").success).toBe(false);
    expect(uuidSchema.safeParse("nope").success).toBe(false);
  });
});

describe("base64url helpers", () => {
  it("accepts the base64url charset and rejects padding/invalid chars", () => {
    expect(base64UrlSchema.safeParse("AbC-123_xyz").success).toBe(true);
    expect(isBase64Url("AbC-123_xyz")).toBe(true);
    expect(base64UrlSchema.safeParse("has padding==").success).toBe(false);
    expect(base64UrlSchema.safeParse("has space").success).toBe(false);
    expect(base64UrlSchema.safeParse("plus+slash/").success).toBe(false);
  });

  it("validates prefixed ids like srv_<base64url>", () => {
    const serverId = prefixedIdSchema("srv");
    expect(serverId.safeParse("srv_AbC-123_xyz").success).toBe(true);
    expect(serverId.safeParse("srv_").success).toBe(false);
    expect(serverId.safeParse("agt_AbC123").success).toBe(false);
  });
});

describe("safeParseOrDefault", () => {
  const schema = z.object({ count: z.number(), label: z.string() });
  const defaults = { count: 0, label: "default" };

  it("returns the parsed value on valid input", () => {
    expect(safeParseOrDefault(schema, { count: 7, label: "ok" }, defaults)).toEqual({
      count: 7,
      label: "ok",
    });
  });

  it("returns defaults on invalid input", () => {
    expect(safeParseOrDefault(schema, { count: "nope" }, defaults)).toEqual(defaults);
    expect(safeParseOrDefault(schema, null, defaults)).toEqual(defaults);
    expect(safeParseOrDefault(schema, undefined, defaults)).toEqual(defaults);
  });
});

describe("optionalWithDefault (append-only field helper)", () => {
  const schema = z.object({
    // A field added later: absent producers still parse to the default.
    retries: optionalWithDefault(z.number(), 3),
  });

  it("fills the default when the field is omitted", () => {
    expect(schema.parse({})).toEqual({ retries: 3 });
  });

  it("uses the provided value when present", () => {
    expect(schema.parse({ retries: 9 })).toEqual({ retries: 9 });
  });
});

describe("COMPAT", () => {
  it("returns the tag metadata unchanged (grep-able shim marker)", () => {
    const tag = COMPAT({ name: "legacy-provider-key", addedIn: "1.2.0", removeBy: "2026-12-31" });
    expect(tag).toEqual({
      name: "legacy-provider-key",
      addedIn: "1.2.0",
      removeBy: "2026-12-31",
    });
  });
});
