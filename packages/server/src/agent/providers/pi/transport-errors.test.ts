import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PiAgentClient } from "./agent.js";
import { createProcessTransport, defaultPiCommand, resolveBundledPiCli } from "./rpc-transport.js";

/**
 * Regression coverage for the daemon-crash bug: a missing `pi` binary used to emit an unhandled
 * `'error'` event on the spawned ChildProcess and crash the whole daemon. The transport must turn
 * spawn failures into a rejected request (operation error), and the client must fail fast with a
 * clear message when the binary is not resolvable.
 */

describe("createProcessTransport — spawn failure handling", () => {
  it("rejects pending requests instead of crashing when the binary is missing", async () => {
    const transport = createProcessTransport({
      args: ["definitely-not-a-real-binary-xyz-123", "--mode", "rpc"],
      cwd: ".",
      env: {},
    });
    // Must reject (not throw an unhandled 'error' event that kills the process).
    await expect(transport.request("list_models")).rejects.toThrow();
    await transport.close();
  });

  it("surfaces the spawn failure as an `error` stream event", async () => {
    const transport = createProcessTransport({
      args: ["definitely-not-a-real-binary-xyz-123"],
      cwd: ".",
      env: {},
    });
    const event = await new Promise<Record<string, unknown>>((resolve) => {
      transport.onEvent((e) => resolve(e as Record<string, unknown>));
      // Trigger a request so a pending entry exists too (its rejection is awaited below).
      transport.request("x").catch(() => {});
    });
    expect(event.type).toBe("error");
    expect(String(event.error)).toMatch(/not found on PATH|ENOENT/i);
    await transport.close();
  });

  it("folds captured stderr into the `error` stream event on a non-zero exit with commands in flight", async () => {
    const transport = createProcessTransport({
      args: [
        process.execPath,
        "-e",
        "process.stderr.write('boom: something broke\\n'); process.exit(1);",
      ],
      cwd: ".",
      env: {},
    });
    const event = await new Promise<Record<string, unknown>>((resolve) => {
      transport.onEvent((e) => resolve(e as Record<string, unknown>));
      transport.request("x").catch(() => {});
    });
    expect(event.type).toBe("error");
    expect(String(event.error)).toContain("boom: something broke");
    await transport.close();
  });
});

describe("PiAgentClient — fail fast when unavailable", () => {
  it("createSession rejects with a clear message when pi is not resolvable", async () => {
    const client = new PiAgentClient({
      command: ["definitely-not-a-real-binary-xyz-123", "--mode", "rpc"],
      // Resolver that always reports "not found".
      binaryResolver: () => false,
    });
    await expect(client.createSession({ provider: "pi", cwd: "." })).rejects.toThrow(
      /Pi provider unavailable/,
    );
  });

  it("isAvailable reflects the resolver", () => {
    expect(new PiAgentClient({ binaryResolver: () => true }).isAvailable()).toBe(true);
    expect(new PiAgentClient({ binaryResolver: () => false }).isAvailable()).toBe(false);
  });
});

describe("bundled pi CLI resolution (no global install required)", () => {
  it("resolves the pi binary bundled inside @earendil-works/pi-coding-agent", () => {
    const cli = resolveBundledPiCli();
    expect(cli).toBeTruthy();
    expect(cli).toMatch(/pi-coding-agent[/\\]dist[/\\]cli\.js$/);
    expect(existsSync(cli as string)).toBe(true);
  });

  it("defaultPiCommand launches the bundled CLI via the current node executable", () => {
    const cmd = defaultPiCommand();
    // [node, <pkg>/dist/cli.js, --mode, rpc]
    expect(cmd[0]).toBe(process.execPath);
    expect(cmd[1]).toMatch(/pi-coding-agent[/\\]dist[/\\]cli\.js$/);
    expect(cmd.slice(2)).toEqual(["--mode", "rpc"]);
  });
});
