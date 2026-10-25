import { describe, expect, it } from "vitest";

import type { InstallSpawn } from "../extensions/sync-executor.js";
import { redactSource, runSpawn } from "./spawn-runner.js";

/**
 * `redactSource`/`runSpawn` (sprint-076/task-003). `redactSource` is pure; `runSpawn` is tested
 * against a fake `InstallSpawn` — the same seam `ExtensionsService`'s sync executor uses — never
 * a real child process.
 */

describe("redactSource", () => {
  it("fully redacts a userinfo credential and a token query value", () => {
    expect(redactSource("git:https://user:tok@host/r?access_token=x")).toBe(
      "git:https://host/r?access_token=***",
    );
  });

  it("strips a bare username (no password) before @", () => {
    expect(redactSource("https://user@host/repo.git")).toBe("https://host/repo.git");
  });

  it("masks a plain token= query value alongside other params", () => {
    expect(redactSource("https://host/r?foo=bar&token=secret&baz=1")).toBe(
      "https://host/r?foo=bar&token=***&baz=1",
    );
  });

  it("leaves a source with no credentials or tokens unchanged", () => {
    expect(redactSource("npm:some-package@1.2.3")).toBe("npm:some-package@1.2.3");
  });

  it("leaves an ssh shorthand source (no scheme) unchanged", () => {
    expect(redactSource("git@host:owner/repo.git")).toBe("git@host:owner/repo.git");
  });
});

function fakeSpawn(result: {
  exitCode: number | null;
  stderr: string;
  timedOut?: boolean;
}): InstallSpawn {
  return () => Promise.resolve(result);
}

const throwingSpawn: InstallSpawn = () => Promise.reject(new Error("ENOENT"));

describe("runSpawn", () => {
  it("reports ok:true on a clean exit", async () => {
    const outcome = await runSpawn(fakeSpawn({ exitCode: 0, stderr: "" }), ["pi", "x"], {}, 1000);
    expect(outcome).toEqual({ ok: true, exitCode: 0, stderr: "" });
  });

  it("reports ok:false with no `error` on a plain nonzero exit", async () => {
    const outcome = await runSpawn(
      fakeSpawn({ exitCode: 1, stderr: "boom" }),
      ["pi", "x"],
      {},
      1000,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeUndefined();
    expect(outcome.exitCode).toBe(1);
    expect(outcome.stderr).toBe("boom");
  });

  it("reports error:'timeout' and proceeds when the seam reports timedOut", async () => {
    const outcome = await runSpawn(
      fakeSpawn({ exitCode: null, stderr: "killed", timedOut: true }),
      ["pi", "x"],
      {},
      1000,
    );
    expect(outcome).toEqual({ ok: false, error: "timeout", exitCode: null, stderr: "killed" });
  });

  it("reports error:'spawn_failed' when the seam throws", async () => {
    const outcome = await runSpawn(throwingSpawn, ["pi", "x"], {}, 1000);
    expect(outcome).toEqual({ ok: false, error: "spawn_failed", exitCode: null, stderr: "" });
  });

  it("redacts and bounds the stderr tail", async () => {
    const longTail = "x".repeat(3000);
    const outcome = await runSpawn(
      fakeSpawn({ exitCode: 1, stderr: `https://user:tok@host/r?token=secret ${longTail}` }),
      ["pi", "x"],
      {},
      1000,
    );
    expect(outcome.stderr).not.toContain("user:tok@");
    expect(outcome.stderr).not.toContain("secret");
    expect(outcome.stderr.length).toBe(2048);
  });
});
