import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FileWatchService } from "./file-watch-service.js";

// `~` expansion needs a controllable home directory — mock `node:os`'s `homedir()` only, keeping
// every other export (notably `tmpdir()`, used below for scratch directories) real. The mocked
// `homedir` is a closure over `fakeHomeDir` below; it is only *called* during a test, by which
// point the module's own top-level body (which assigns `fakeHomeDir`) has already run — module
// dependency evaluation always precedes the importing module's own body, so this ordering is safe
// even though `vi.mock` itself is hoisted above these imports.
let fakeHomeDir = "";
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => fakeHomeDir };
});
fakeHomeDir = mkdtempSync(join(tmpdir(), "file-watch-home-"));

/** Fast but real: production uses 150 ms (`FILE_WATCH_COALESCE_MS`); tests use a much shorter
 *  window so "10 ms apart" / "500 ms apart" style assertions run quickly while staying genuinely
 *  event-driven (poll-to-completion via `vi.waitFor`, never a fixed sleep standing in for a check). */
const TEST_COALESCE_MS = 40;

function mkScratchDir(): string {
  return mkdtempSync(join(tmpdir(), "file-watch-test-"));
}

const noop = (): void => {};

describe("FileWatchService", () => {
  const services: FileWatchService[] = [];
  function makeService(): FileWatchService {
    const service = new FileWatchService({ coalesceMs: TEST_COALESCE_MS });
    services.push(service);
    return service;
  }
  afterEach(() => {
    for (const s of services.splice(0)) s.close();
  });

  it("subscribing to a file and modifying it in place pushes exactly once", async () => {
    const dir = mkScratchDir();
    const file = join(dir, "mol.pdb");
    writeFileSync(file, "v1");
    const service = makeService();
    const events: number[] = [];
    service.subscribe(file, () => events.push(1));

    writeFileSync(file, "v2");
    await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 2000 });

    // Give the coalescing window plenty of room to have fired a stray second push if the
    // in-place-write path were somehow double-firing.
    await new Promise((r) => setTimeout(r, TEST_COALESCE_MS * 3));
    expect(events).toHaveLength(1);
  });

  it("subscribing to a file and saving it via write-temp + rename keeps pushing across repeated saves", async () => {
    const dir = mkScratchDir();
    const file = join(dir, "mol.pdb");
    writeFileSync(file, "v1");
    const service = makeService();
    const events: number[] = [];
    service.subscribe(file, () => events.push(1));

    // Atomic save #1: write to a temp name, then rename over the target — the pattern that
    // replaces the inode and is exactly why this design watches the *directory*, not the file.
    const tmp1 = join(dir, ".mol.pdb.tmp");
    writeFileSync(tmp1, "v2");
    renameSync(tmp1, file);
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });

    // Atomic save #2 — the regression this design exists for: a watcher bound to the original
    // file's inode would have stopped firing after save #1.
    const tmp2 = join(dir, ".mol.pdb.tmp");
    writeFileSync(tmp2, "v3");
    renameSync(tmp2, file);
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
  });

  it("subscribing to a directory pushes on a child being created, deleted, and renamed", async () => {
    const dir = mkScratchDir();
    const service = makeService();
    const events: number[] = [];
    service.subscribe(dir, () => events.push(1));

    writeFileSync(join(dir, "a.txt"), "x");
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });

    rmSync(join(dir, "a.txt"));
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });

    writeFileSync(join(dir, "b.txt"), "x");
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(3), { timeout: 2000 });
    renameSync(join(dir, "b.txt"), join(dir, "c.txt"));
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(4), { timeout: 2000 });
  });

  it("a modification to an unrelated sibling file does not notify a file subscriber", async () => {
    const dir = mkScratchDir();
    const watched = join(dir, "watched.pdb");
    const sibling = join(dir, "sibling.pdb");
    writeFileSync(watched, "v1");
    writeFileSync(sibling, "v1");
    const service = makeService();
    const events: number[] = [];
    service.subscribe(watched, () => events.push(1));

    writeFileSync(sibling, "v2");
    await new Promise((r) => setTimeout(r, TEST_COALESCE_MS * 3));
    expect(events).toHaveLength(0);

    // Sanity: the watched file itself still works on the same service/directory watch.
    writeFileSync(watched, "v2");
    await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 2000 });
  });

  it("coalesces writes inside the debounce window into one push, and separates writes outside it", async () => {
    const dir = mkScratchDir();
    const file = join(dir, "traj.xyz");
    writeFileSync(file, "v1");
    const service = makeService();
    const events: number[] = [];
    service.subscribe(file, () => events.push(Date.now()));

    // Two writes well inside the coalescing window collapse to one push.
    writeFileSync(file, "v2");
    await new Promise((r) => setTimeout(r, TEST_COALESCE_MS / 4));
    writeFileSync(file, "v3");
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
    // Let the window fully settle before asserting no extra push snuck in.
    await new Promise((r) => setTimeout(r, TEST_COALESCE_MS * 3));
    expect(events).toHaveLength(1);

    // A write well outside the window (after the previous push already fired) is a second push.
    writeFileSync(file, "v4");
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    expect(events).toHaveLength(2);
  });

  it("unsubscribing stops pushes, and releases the fs.watch handle once the last subscriber leaves", async () => {
    const dir = mkScratchDir();
    const fileA = join(dir, "a.pdb");
    const fileB = join(dir, "b.pdb");
    writeFileSync(fileA, "v1");
    writeFileSync(fileB, "v1");
    const service = makeService();
    const eventsA: number[] = [];
    const eventsB: number[] = [];
    const unsubA = service.subscribe(fileA, () => eventsA.push(1));
    const unsubB = service.subscribe(fileB, () => eventsB.push(1));
    expect(service.watchedDirectoryCount).toBe(1); // one shared directory watch, ref-counted

    unsubA();
    writeFileSync(fileA, "v2");
    await new Promise((r) => setTimeout(r, TEST_COALESCE_MS * 3));
    expect(eventsA).toHaveLength(0); // stopped
    expect(service.watchedDirectoryCount).toBe(1); // B still needs the shared watch

    writeFileSync(fileB, "v2");
    await vi.waitFor(() => expect(eventsB).toHaveLength(1), { timeout: 2000 }); // B still works

    unsubB();
    await vi.waitFor(() => expect(service.watchedDirectoryCount).toBe(0), { timeout: 2000 }); // released
  });

  it("subscribing to a nonexistent path neither throws nor kills the session, and its unsubscribe is safe", async () => {
    const dir = mkScratchDir();
    const service = makeService();
    const listener = vi.fn();
    let unsub: () => void = noop;
    expect(() => {
      unsub = service.subscribe(join(dir, "does", "not", "exist.pdb"), listener);
    }).not.toThrow();
    expect(() => unsub()).not.toThrow();
    expect(() => unsub()).not.toThrow(); // idempotent
    expect(listener).not.toHaveBeenCalled();
  });

  it("expands a `~`-prefixed path server-side before watching", async () => {
    const events: number[] = [];
    const service = makeService();
    service.subscribe("~/mol.pdb", () => events.push(1));

    writeFileSync(join(fakeHomeDir, "mol.pdb"), "v1");
    await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
  });
});
