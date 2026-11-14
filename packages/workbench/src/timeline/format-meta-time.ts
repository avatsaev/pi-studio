/**
 * Meta-line timestamp formatting for `UserRow`/`AssistantRow`/`ReasoningRow` (e.g. `"Aug 17,
 * 14:32"`). Always includes the date — a chat session commonly spans multiple days, and a
 * time-only label is ambiguous once that happens. 24-hour, zero-padded, local time; no seconds
 * (unnecessary precision for a chat meta line) and no locale-dependent month/AM-PM strings, so
 * the format is fixed rather than left to `Intl.DateTimeFormat`'s locale defaults.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format an ISO-8601 timestamp as `"Mon D, HH:MM"` in the viewer's local time zone. */
export function formatMetaTime(timestamp: string | undefined): string | undefined {
  if (!timestamp) return undefined;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
