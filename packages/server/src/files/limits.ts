/**
 * The single source of truth for `file_read_request`'s inline-read ceiling (previously a
 * `512 * 1024` literal duplicated verbatim across `bootstrap.ts` and `dev-bootstrap.ts`).
 *
 * Above this size, clients fall back to the chunked binary download path (`file-transfer.ts`),
 * which is unbounded — so raising this number is a tradeoff between inline-read convenience and
 * JSON round-trip cost (four-ish full-size copies: `JSON.stringify` → WS text frame → client
 * `JSON.parse` → TanStack cache entry, doubled again over the relay's NaCl box), not a hard
 * technical limit. 5 MiB covers essentially every real source file and most logs while keeping
 * that round trip cheap.
 */
export const MAX_INLINE_FILE_READ_BYTES = 5 * 1024 * 1024;
