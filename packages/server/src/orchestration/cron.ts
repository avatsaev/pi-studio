/**
 * Minimal cron + interval next-time computation (features/schedules-heartbeats.md § Behavior).
 * Supports standard 5-field cron (`min hour dom month dow`) with `*`, lists (`a,b`), ranges (`a-b`),
 * and steps (`*​/n`, `a-b/n`). An IANA `timezone` makes recurrence follow local wall-clock (DST-aware
 * via `Intl.DateTimeFormat`); absent timezone = UTC.
 */

export class CronParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronParseError";
  }
}

interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

const RANGES: Record<string, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  dom: [1, 31],
  month: [1, 12],
  dow: [0, 6],
};

function parseField(field: string, name: keyof typeof RANGES): Set<number> {
  const [lo, hi] = RANGES[name] as [number, number];
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number.parseInt(stepPart, 10) : 1;
    if (!Number.isInteger(step) || step < 1) throw new CronParseError(`bad step in "${field}"`);

    let start = lo;
    let end = hi;
    if (rangePart && rangePart !== "*") {
      const bounds = rangePart.split("-");
      start = Number.parseInt(bounds[0] as string, 10);
      end = bounds[1] !== undefined ? Number.parseInt(bounds[1], 10) : start;
      if (Number.isNaN(start) || Number.isNaN(end)) throw new CronParseError(`bad range "${part}"`);
    }
    // dow: normalize 7 → 0 (Sunday).
    if (name === "dow") {
      start = start === 7 ? 0 : start;
      end = end === 7 ? 0 : end;
    }
    if (start > end) throw new CronParseError(`inverted range "${part}"`);
    for (let v = start; v <= end; v += step) {
      if (v < lo || v > hi) throw new CronParseError(`value ${v} out of range for ${name}`);
      values.add(v);
    }
  }
  return values;
}

export function parseCron(expression: string): CronFields {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new CronParseError(`expected 5 cron fields, got ${fields.length}: "${expression}"`);
  }
  const [min, hour, dom, month, dow] = fields as [string, string, string, string, string];
  return {
    minute: parseField(min, "minute"),
    hour: parseField(hour, "hour"),
    dom: parseField(dom, "dom"),
    month: parseField(month, "month"),
    dow: parseField(dow, "dow"),
    domRestricted: dom !== "*",
    dowRestricted: dow !== "*",
  };
}

/** Validate a cron expression (throws `CronParseError` if invalid). */
export function assertValidCron(expression: string): void {
  parseCron(expression);
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const year = Number.parseInt(parts.year as string, 10);
  const month = Number.parseInt(parts.month as string, 10);
  const day = Number.parseInt(parts.day as string, 10);
  let hour = Number.parseInt(parts.hour as string, 10);
  if (hour === 24) hour = 0; // some environments render midnight as 24
  const minute = Number.parseInt(parts.minute as string, 10);
  // Day-of-week from the wall-clock calendar date.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, minute, weekday };
}

function matches(fields: CronFields, p: ZonedParts): boolean {
  if (!fields.minute.has(p.minute)) return false;
  if (!fields.hour.has(p.hour)) return false;
  if (!fields.month.has(p.month)) return false;
  // Classic crontab: when both dom and dow are restricted, match if EITHER matches.
  if (fields.domRestricted && fields.dowRestricted) {
    return fields.dom.has(p.day) || fields.dow.has(p.weekday);
  }
  if (!fields.dom.has(p.day)) return false;
  if (!fields.dow.has(p.weekday)) return false;
  return true;
}

/**
 * Next cron fire strictly after `after`, in the given timezone (default UTC). Steps minute-by-minute
 * up to ~366 days; returns null if no match within the window.
 */
export function nextCronTime(expression: string, after: Date, timezone?: string): Date | null {
  const fields = parseCron(expression);
  const tz = timezone ?? "UTC";
  // Start at the next whole minute after `after`.
  const start = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  const maxIterations = 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    const candidate = new Date(start.getTime() + i * 60_000);
    if (matches(fields, zonedParts(candidate, tz))) return candidate;
  }
  return null;
}

/** Next interval fire after `from`. */
export function nextEveryTime(everyMs: number, from: Date): Date {
  return new Date(from.getTime() + everyMs);
}
