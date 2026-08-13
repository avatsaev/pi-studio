import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { DaemonClient, Transport } from "@av-pi-studio/client";
import type {
  ExtensionPackInfo,
  ExtensionPacksListResponse,
  ExtensionPacksSetResponse,
} from "@av-pi-studio/protocol";

import {
  buildEntryRows,
  exitCodeForSetResponse,
  EXTENSIONS_SYNC_TIMEOUT_MS,
  listExtensions,
  listExtensionsLocal,
  renderExtensionsList,
  renderSyncReport,
  selectExtensions,
  syncExtensions,
} from "./extensions-commands.js";
import { type CliContext, EXIT_ERROR, EXIT_OK } from "./cli-core.js";
import { connectDaemon } from "./connection.js";

/**
 * A realistic curated `ExtensionPackInfo[]` fixture, matching the real wire shape
 * (`packages/protocol/src/messages.ts`) — five `core` entries, one already failed.
 */
function packsFixture(opts: { failWebAccess?: boolean } = {}): ExtensionPackInfo[] {
  const names = [
    "npm:@99percentpeople/pi-background-tasks",
    "npm:pi-memctx",
    "npm:@juicesharp/rpiv-todo",
    "npm:pi-web-access",
    "npm:pi-powerline-footer",
  ];
  return [
    {
      id: "core",
      title: "Baseline",
      description: "Recommended for everyone",
      packages: names.map((source) => {
        const identity = source.replace(/^npm:/, "");
        const failed = Boolean(opts.failWebAccess) && source.includes("pi-web-access");
        return {
          source,
          identity,
          addedIn: "0.0.73",
          status: failed ? "failed" : "installed",
          ...(failed
            ? {
                lastError: {
                  at: "2026-08-13T00:00:00.000Z",
                  attempts: 2,
                  reason: "not_found",
                  message: "npm error 404 Not Found\nmore detail on a second line",
                },
              }
            : {}),
        };
      }),
    },
  ];
}

// ─── Scripted fake daemon transport (flat extension_packs_* fields — the real wire shape) ──

interface FakeOptions {
  features?: Record<string, boolean>;
  listResponse?: Record<string, unknown>;
  setResponse?: (msg: Record<string, unknown>) => Record<string, unknown>;
}

function makeFakeDaemon(options: FakeOptions = {}): {
  transport: Transport;
  requests: Array<{ type: string; msg: Record<string, unknown> }>;
} {
  const requests: Array<{ type: string; msg: Record<string, unknown> }> = [];
  let open = false;
  const transport: Transport = {
    onMessage: null,
    onClose: null,
    onError: null,
    get isOpen() {
      return open;
    },
    connect: () => {
      open = true;
      return Promise.resolve();
    },
    sendText: (data) => {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      if (parsed.type === "hello") {
        queueMicrotask(() =>
          transport.onMessage?.(
            JSON.stringify({
              type: "status",
              payload: {
                status: "server_info",
                serverId: "s",
                capabilities: {},
                features: options.features ?? { extensionPacks: true },
              },
            }),
          ),
        );
        return;
      }
      if (parsed.type !== "session") return;
      const msg = parsed.message as Record<string, unknown>;
      const reqType = msg.type as string;
      const requestId = msg.requestId as string;
      requests.push({ type: reqType, msg });

      let reply: Record<string, unknown>;
      if (reqType === "extension_packs_list_request") {
        reply = {
          type: "extension_packs_list_response",
          requestId,
          autoSync: true,
          selected: [],
          packs: packsFixture(),
          ...options.listResponse,
        };
      } else if (reqType === "extension_packs_set_request") {
        reply = options.setResponse
          ? { type: "extension_packs_set_response", requestId, ...options.setResponse(msg) }
          : {
              type: "extension_packs_set_response",
              requestId,
              autoSync: true,
              selected: (msg.packs as string[] | undefined) ?? [],
              packs: packsFixture(),
              ok: true,
              report: {
                at: "2026-08-13T00:00:00.000Z",
                outcome: "ok",
                installed: packsFixture()[0]!.packages.map((p) => p.source),
                failures: [],
              },
            };
      } else {
        reply = { type: `${reqType}_response`, requestId };
      }
      queueMicrotask(() =>
        transport.onMessage?.(JSON.stringify({ type: "session", message: reply })),
      );
    },
    sendBinary: () => {},
    close: () => {
      open = false;
    },
  };
  return { transport, requests };
}

async function connectedClient(
  transport: Transport,
): Promise<{ client: DaemonClient; ctx: CliContext; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    connect: (opts) => connectDaemon(opts),
    sink: { write: (l) => out.push(l), error: (l) => err.push(l) },
    rpcTimeoutMs: 500,
    connectOverrides: { transport, clientId: "cli-test" },
  };
  const { client } = await connectDaemon({ ...connectOptsFrom(ctx) });
  return { client, ctx, out, err };
}

function connectOptsFrom(ctx: CliContext) {
  return {
    url: "ws://mock/ws",
    clientId: ctx.connectOverrides?.clientId ?? "cli-test",
    clientType: "cli" as const,
    transport: ctx.connectOverrides?.transport,
  };
}

// ─── Pure rendering helpers ───────────────────────────────────────────────────────

describe("buildEntryRows", () => {
  it("one row per curated entry; failed row carries reason, truncated message, and attempts when > 1", () => {
    const rows = buildEntryRows(packsFixture({ failWebAccess: true }));
    expect(rows).toHaveLength(5);
    const failedRow = rows.find((r) => r.source === "npm:pi-web-access");
    expect(failedRow?.status).toBe("failed");
    expect(failedRow?.reason).toBe("not_found");
    expect(failedRow?.message).toBe("npm error 404 Not Found"); // first line only
    expect(failedRow?.attempts).toBe(2);
    const okRow = rows.find((r) => r.source === "npm:pi-memctx");
    expect(okRow?.status).toBe("installed");
    expect(okRow?.reason).toBeUndefined();
    expect(okRow?.attempts).toBeUndefined();
  });

  it("omits attempts when exactly 1 (not worth a column)", () => {
    const packs = packsFixture({ failWebAccess: true });
    const failingEntry = packs[0]?.packages.find((p) => p.lastError);
    if (failingEntry?.lastError) failingEntry.lastError.attempts = 1;
    const rows = buildEntryRows(packs);
    expect(rows.find((r) => r.status === "failed")?.attempts).toBeUndefined();
  });
});

describe("renderSyncReport", () => {
  it("ok sync: installed count only, no failure lines, no retry footer", () => {
    const lines = renderSyncReport({ installed: ["a", "b"], failures: [] });
    expect(lines).toEqual(["installed 2 of 2 recommended extensions"]);
  });

  it("partial sync: one line per failure (source, pack, reason, message-first-line) plus the retry footer", () => {
    const lines = renderSyncReport({
      installed: ["a"],
      failures: [
        { source: "npm:pi-web-access", pack: "core", reason: "not_found", message: "404\nmore" },
      ],
    });
    expect(lines[0]).toBe("installed 1 of 2 recommended extensions");
    expect(lines[1]).toBe("✗ npm:pi-web-access (core): not_found — 404");
    expect(lines[2]).toContain("pi-studio extensions sync");
  });
});

function setResponseFixture(patch: Partial<ExtensionPacksSetResponse>): ExtensionPacksSetResponse {
  return {
    type: "extension_packs_set_response",
    requestId: "r",
    autoSync: true,
    selected: [],
    packs: [],
    ok: true,
    ...patch,
  };
}

describe("exitCodeForSetResponse", () => {
  it("ok/noop ⇒ 0; partial/failed/skipped ⇒ EXIT_ERROR; ok:false ⇒ EXIT_ERROR", () => {
    for (const outcome of ["ok", "noop"]) {
      const res = setResponseFixture({
        report: { at: "2026-08-13T00:00:00.000Z", outcome, installed: [], failures: [] },
      });
      expect(exitCodeForSetResponse(res)).toBe(EXIT_OK);
    }
    for (const outcome of ["partial", "failed", "skipped"]) {
      const res = setResponseFixture({
        report: { at: "2026-08-13T00:00:00.000Z", outcome, installed: [], failures: [] },
      });
      expect(exitCodeForSetResponse(res)).toBe(EXIT_ERROR);
    }
    expect(exitCodeForSetResponse(setResponseFixture({ ok: false, error: "nope" }))).toBe(
      EXIT_ERROR,
    );
  });
});

// ─── extensions list (daemon path) ─────────────────────────────────────────────────

describe("listExtensions", () => {
  it("renders a table with one row per curated entry, correct statuses; failed row shows reason/message/attempts", async () => {
    const { transport } = makeFakeDaemon({
      listResponse: { packs: packsFixture({ failWebAccess: true }) },
    });
    const { client, ctx, out } = await connectedClient(transport);
    const code = await listExtensions(client, ctx, {});
    expect(code).toBe(EXIT_OK);
    const table = out.join("\n");
    expect(table).toContain("npm:pi-web-access");
    expect(table).toContain("failed");
    expect(table).toContain("not_found");
    client.close();
  });

  it("--json emits the raw payload", async () => {
    const { transport } = makeFakeDaemon();
    const { client, ctx, out } = await connectedClient(transport);
    await listExtensions(client, ctx, { json: true });
    const parsed = JSON.parse(out[0]!) as { autoSync: boolean; packs: unknown[] };
    expect(parsed.autoSync).toBe(true);
    expect(parsed.packs).toHaveLength(1);
    client.close();
  });

  it("missing extensionPacks server feature ⇒ actionable message, EXIT_ERROR, no request attempted", async () => {
    const { transport, requests } = makeFakeDaemon({ features: {} });
    const { client, ctx, err } = await connectedClient(transport);
    const code = await listExtensions(client, ctx, {});
    expect(code).toBe(EXIT_ERROR);
    expect(err[0]).toContain("update the host");
    expect(requests).toHaveLength(0);
    client.close();
  });
});

// ─── extensions select / sync ───────────────────────────────────────────────────────

describe("selectExtensions / syncExtensions", () => {
  it("select sends extension_packs_set_request WITH packs and a 600000ms timeout", async () => {
    const { transport, requests } = makeFakeDaemon();
    const { client, ctx } = await connectedClient(transport);
    const spy = vi.spyOn(client, "request");
    await selectExtensions(client, ctx, ["core"], {});
    expect(requests[0]).toEqual({
      type: "extension_packs_set_request",
      msg: expect.objectContaining({ packs: ["core"] }),
    });
    expect(spy).toHaveBeenCalledWith(
      "extension_packs_set_request",
      { packs: ["core"] },
      EXTENSIONS_SYNC_TIMEOUT_MS,
    );
    client.close();
  });

  it("sync sends extension_packs_set_request WITHOUT packs, same timeout, never writes the selection", async () => {
    const { transport, requests } = makeFakeDaemon();
    const { client, ctx } = await connectedClient(transport);
    const spy = vi.spyOn(client, "request");
    await syncExtensions(client, ctx, {});
    expect(requests[0]!.msg).not.toHaveProperty("packs");
    expect(spy).toHaveBeenCalledWith("extension_packs_set_request", {}, EXTENSIONS_SYNC_TIMEOUT_MS);
    client.close();
  });

  it("an ok sync prints the installed count; exit 0", async () => {
    const { transport } = makeFakeDaemon();
    const { client, ctx, out } = await connectedClient(transport);
    const code = await syncExtensions(client, ctx, {});
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toContain("installed 5 of 5 recommended extensions");
    client.close();
  });

  it("a partial sync prints one line per failure plus the retry footer; exit EXIT_ERROR", async () => {
    const { transport } = makeFakeDaemon({
      setResponse: (msg) => ({
        autoSync: true,
        selected: (msg.packs as string[] | undefined) ?? [],
        packs: packsFixture({ failWebAccess: true }),
        ok: true,
        report: {
          at: "2026-08-13T00:00:00.000Z",
          outcome: "partial",
          installed: ["a", "b", "c", "d"],
          failures: [
            {
              identity: "pi-web-access",
              source: "npm:pi-web-access",
              pack: "core",
              reason: "not_found",
              message: "npm error 404 Not Found",
            },
          ],
        },
      }),
    });
    const { client, ctx, out } = await connectedClient(transport);
    const code = await syncExtensions(client, ctx, {});
    expect(code).toBe(EXIT_ERROR);
    const text = out.join("\n");
    expect(text).toContain("✗ npm:pi-web-access (core): not_found — npm error 404 Not Found");
    expect(text).toContain("retried automatically");
    client.close();
  });

  it("ok:false (unknown slug) ⇒ prints the daemon's error and exits EXIT_ERROR; no success line", async () => {
    const { transport } = makeFakeDaemon({
      setResponse: () => ({
        autoSync: true,
        selected: [],
        packs: packsFixture(),
        ok: false,
        error: "unknown pack: bogus",
      }),
    });
    const { client, ctx, out, err } = await connectedClient(transport);
    const code = await selectExtensions(client, ctx, ["bogus"], {});
    expect(code).toBe(EXIT_ERROR);
    expect(err[0]).toBe("unknown pack: bogus");
    expect(out.join("")).not.toContain("installed");
    client.close();
  });

  it("missing extensionPacks feature ⇒ actionable message, EXIT_ERROR, no request attempted", async () => {
    const { transport, requests } = makeFakeDaemon({ features: {} });
    const { client, ctx, err } = await connectedClient(transport);
    const code = await syncExtensions(client, ctx, {});
    expect(code).toBe(EXIT_ERROR);
    expect(err[0]).toContain("update the host");
    expect(requests).toHaveLength(0);
    client.close();
  });
});

// ─── extensions list --local ────────────────────────────────────────────────────────

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-studio-cli-ext-"));
}

describe("listExtensionsLocal", () => {
  it("works with no daemon running, honours --pi-home, prints the table, and writes nothing", async () => {
    const home = await tempHome();
    const piHome = join(home, "custom-pihome");
    const piHomeAgentDir = join(piHome, "agent");
    await mkdir(piHomeAgentDir, { recursive: true });
    await writeFile(
      join(piHomeAgentDir, "settings.json"),
      JSON.stringify({ packages: [] }),
      "utf8",
    );

    const out: string[] = [];
    const ctx: CliContext = {
      connect: () => {
        throw new Error("must never connect a daemon for --local");
      },
      sink: { write: (l) => out.push(l), error: () => {} },
      connectOverrides: { home },
    };

    const beforeSettings = await readFile(join(piHomeAgentDir, "settings.json"), "utf8");
    const beforeDirEntries = readdirSync(home).toSorted();

    const code = await listExtensionsLocal(ctx, { piHome });
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toContain("core");
    expect(out[0]).toContain("pending"); // fresh state, nothing offered yet ⇒ pending

    const afterSettings = await readFile(join(piHomeAgentDir, "settings.json"), "utf8");
    expect(afterSettings).toBe(beforeSettings);
    expect(readdirSync(home).toSorted()).toEqual(beforeDirEntries); // no extensions-state.json created
  });

  it("output equals renderExtensionsList(payload) — the exact function the daemon path also calls, so the two can never render different tables for the same data", async () => {
    const home = await tempHome();
    const piHome = join(home, "pihome");
    const piHomeAgentDir = join(piHome, "agent");
    await mkdir(piHomeAgentDir, { recursive: true });
    await writeFile(
      join(piHomeAgentDir, "settings.json"),
      JSON.stringify({ packages: ["npm:pi-memctx"] }),
      "utf8",
    );

    const localOut: string[] = [];
    const localCtx: CliContext = {
      connect: () => {
        throw new Error("no daemon for --local");
      },
      sink: { write: (l) => localOut.push(l), error: () => {} },
      connectOverrides: { home },
    };
    await listExtensionsLocal(localCtx, { piHome });

    // `npm:pi-memctx` was already present in settings.json before Pi-Studio ever "offered" it —
    // the planner reports that as `user_modified` (never installed over), matching sprint-056's
    // adopt-don't-install rule; the other four core entries are `pending` (offline environment).
    expect(localOut[0]).toContain("user_modified");
    const memctxLine = localOut[0]!.split("\n").find((l) => l.includes("npm:pi-memctx"));
    expect(memctxLine).toContain("user_modified");

    // Reconstruct the exact wire payload `--local` must have built (same entries, same statuses)
    // and feed it through `renderExtensionsList` directly — the identical function `listExtensions`
    // (the daemon path) calls. Equal output proves `--local` produced a correctly wire-shaped
    // payload and used the shared renderer, not a hand-rolled second table format.
    const packs = packsFixture();
    const memctx = packs[0]!.packages.find((p) => p.identity === "pi-memctx")!;
    memctx.status = "user_modified";
    for (const p of packs[0]!.packages) {
      if (p !== memctx) p.status = "pending";
    }
    const expected: ExtensionPacksListResponse = {
      type: "extension_packs_list_response",
      requestId: "local",
      autoSync: true,
      selected: [],
      packs,
    };
    expect(localOut[0]).toBe(renderExtensionsList(expected));
  });
});
