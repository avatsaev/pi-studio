/**
 * Output rendering for the CLI (features/cli.md § Behavior — "render output (table/json) to stdout").
 * Every command renders either a human-friendly table or machine-readable JSON, selected by the
 * global `--json` flag.
 */

export type OutputFormat = "table" | "json";

export interface OutputSink {
  write(line: string): void;
  error(line: string): void;
}

/** Default sink writes to process stdout/stderr. */
export const consoleSink: OutputSink = {
  write: (line) => process.stdout.write(`${line}\n`),
  error: (line) => process.stderr.write(`${line}\n`),
};

/** Render a value as pretty JSON. */
export function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Render an array of row objects as a fixed-width text table. `columns` selects/orders the fields;
 * when omitted, the union of keys (in first-seen order) is used. Missing cells render empty.
 */
export function renderTable(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns?: string[],
): string {
  if (rows.length === 0) return "(no results)";

  const cols = columns ?? unionKeys(rows);
  if (cols.length === 0) return "(no columns)";

  const cells = rows.map((row) => cols.map((c) => formatCell(row[c])));
  const widths = cols.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i]!.length)));

  const header = cols.map((c, i) => c.toUpperCase().padEnd(widths[i]!)).join("  ");
  const body = cells.map((r) => r.map((cell, i) => cell.padEnd(widths[i]!)).join("  "));
  return [header, ...body].join("\n").trimEnd();
}

/**
 * Render any RPC result for a single-object response as aligned `key: value` lines (used by
 * `inspect`-style commands).
 */
export function renderObject(value: Record<string, unknown>): string {
  const keys = Object.keys(value);
  if (keys.length === 0) return "(empty)";
  const width = Math.max(...keys.map((k) => k.length));
  return keys.map((k) => `${k.padEnd(width)}  ${formatCell(value[k])}`).join("\n");
}

/** Format a single value for a table/object cell. */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function unionKeys(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!set.has(key)) {
        set.add(key);
        seen.push(key);
      }
    }
  }
  return seen;
}
