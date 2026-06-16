# Validation conventions

Every wire frame and on-disk JSON document in Pi-Studio is parsed through **Zod** before it is
trusted (MAIN-SCOPE.md §9). The shared helpers live in `@av-pi-studio/protocol`
(`packages/protocol/src/validation.ts`) and are reused by the protocol message schemas and the
file-based persistence stores.

## Append-only compatibility rules (always)

Schemas are **append-only**. A 6-month-old client must still parse new-daemon messages and
vice-versa.

- **New fields are optional with a default/transform.** Use `optionalWithDefault(schema, default)`
  so a missing field deserializes to a known value instead of `undefined`.
- **Never flip `optional` → `required`.** Once optional, always optional.
- **Never remove a field.** Stop _sending_ it if you must, but keep _reading_ it.
- **Never narrow a type** (`string` → enum, `nullable` → non-null). New enum values are gated at
  serialization behind capability flags so old clients only receive values they advertised.

## `COMPAT(name)` shims

Back-compat shims are tagged so one grep (`COMPAT(`) lists all pending cleanup work. Each tag
records the version it was added in and the date it may be removed:

```ts
import { COMPAT } from "@av-pi-studio/protocol";

// COMPAT(legacy-provider-key): added 1.2.0, remove by 2026-12-31
COMPAT({ name: "legacy-provider-key", addedIn: "1.2.0", removeBy: "2026-12-31" });
```

## Shared primitives

| Export                                        | Validates                                     |
| --------------------------------------------- | --------------------------------------------- |
| `isoTimestampSchema`                          | ISO-8601 timestamp string (UTC `Z` or offset) |
| `uuidSchema`                                  | RFC-4122 UUID                                 |
| `base64UrlSchema` / `isBase64Url`             | base64url charset, no padding                 |
| `prefixedIdSchema(prefix)`                    | `${prefix}_<base64url>` ids (e.g. `srv_…`)    |
| `safeParseOrDefault(schema, value, defaults)` | parse-or-fallback used by stores              |
| `optionalWithDefault(schema, default)`        | append-only optional field with default       |
