// What a run found: one result per check, facts that are printed but not asserted, and the
// Markdown summary of both.

/** Thrown by a check that does not apply to this run; recorded as `skip`, not as a failure. */
export class Skip extends Error {}

export function formatDuration(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** A table cell: no pipes or line breaks. */
function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export class Report {
  /** @type {{id: string, title: string, status: "pass" | "fail" | "skip", notes: string[], error?: string, ms: number}[]} */
  results = [];
  /** @type {{name: string, lines: string[]}[]} */
  facts = [];
  /** Called with each line as it is recorded (the console, in a real run). */
  #log;

  constructor(log = () => {}) {
    this.#log = log;
  }

  /** A fact: something the run prints and nobody asserts, e.g. a path or a duration. */
  fact(name, ...lines) {
    this.facts.push({ name, lines });
    this.#log(`fact  ${name}: ${lines.join(" | ")}`);
  }

  /**
   * Run one check. `body` gets `{ note(text) }` for lines worth keeping next to the result. A
   * throw is a failure, except `Skip`. Returns whether the check passed.
   */
  async run(id, title, body) {
    const notes = [];
    const began = Date.now();
    let status = "pass";
    let error;
    try {
      await body({ note: (text) => notes.push(text) });
    } catch (e) {
      status = e instanceof Skip ? "skip" : "fail";
      error = e instanceof Error ? e.message : String(e);
    }
    const result = { id, title, status, notes, ms: Date.now() - began, ...(error === undefined ? {} : { error }) };
    this.results.push(result);
    this.#log(`${status.padEnd(5)} ${id}: ${title}${error === undefined ? "" : ` -- ${error}`}`);
    return status === "pass";
  }

  /** Record checks that cannot run because an earlier one they depend on did not pass. */
  skipAll(checks, because) {
    for (const { id, title } of checks) {
      this.results.push({ id, title, status: "skip", notes: [], error: because, ms: 0 });
      this.#log(`skip  ${id}: ${title} -- ${because}`);
    }
  }

  get failed() {
    return this.results.some((r) => r.status === "fail");
  }
}

/** The job summary: a table of results, then every fact. */
export function renderSummary(heading, report) {
  const lines = [`## ${heading}`, ""];
  const counts = { pass: 0, fail: 0, skip: 0 };
  for (const result of report.results) counts[result.status] += 1;
  lines.push(`${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped.`, "");
  lines.push("| Result | Check | Time | Detail |", "|---|---|---|---|");
  for (const r of report.results) {
    const detail = [r.error, ...r.notes].filter((text) => text !== undefined && text !== "").join("; ");
    lines.push(`| ${r.status.toUpperCase()} | \`${r.id}\` ${cell(r.title)} | ${formatDuration(r.ms)} | ${cell(detail)} |`);
  }
  if (report.facts.length > 0) {
    lines.push("", "### Printed, not asserted", "");
    for (const fact of report.facts) {
      lines.push(`- **${fact.name}**`);
      for (const line of fact.lines) lines.push(`  - ${line.length > 0 ? `\`${line.replace(/`/g, "'")}\`` : ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
