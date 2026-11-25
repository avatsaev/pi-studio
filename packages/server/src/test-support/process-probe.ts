import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { vi } from "vitest";

/**
 * Helpers for tests that start real child processes (`sleep`, a shell that ignores SIGTERM) and must
 * prove they are gone: a child writes its pid to a file, the test reads it and probes the process.
 * Tests only; not part of the daemon runtime.
 */

/**
 * Whether a live process with `pid` exists. A zombie (exited, not yet reaped by its parent, which is
 * `init` once the real parent is gone) is dead: it runs nothing and holds nothing.
 */
export function isAlive(pid: number): boolean {
  try {
    return !execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" })
      .trim()
      .startsWith("Z");
  } catch {
    return false; // `ps` exits 1 when no such process
  }
}

/** Waits for `file` to hold a pid, written by the child itself (`echo $$ > file`). */
export function readPid(file: string): Promise<number> {
  return vi.waitFor(
    async () => {
      const pid = Number.parseInt(await readFile(file, "utf8"), 10);
      if (!Number.isInteger(pid)) throw new Error(`no pid in ${file} yet`);
      return pid;
    },
    { timeout: 10_000, interval: 20 },
  );
}

/** SIGKILL, ignoring a process that is already gone. For test cleanup. */
export function killQuietly(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/** The command line of `pid` (for an assertion message); empty when it is gone. */
export function commandOf(pid: number): string {
  try {
    return execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/** Every process below `root` in the process tree (children, their children, …), `root` excluded. */
export function descendantsOf(root: number): number[] {
  const childrenOf = new Map<number, number[]>();
  const table = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  for (const line of table.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || ppid === undefined || Number.isNaN(pid) || Number.isNaN(ppid))
      continue;
    childrenOf.set(ppid, [...(childrenOf.get(ppid) ?? []), pid]);
  }
  const found: number[] = [];
  const queue = [root];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const child of childrenOf.get(next) ?? []) {
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}
