import { afterEach, describe, expect, it } from "vitest";

import { MOCK_REBIND_ENTRY_ID } from "../agent/providers/mock/mock-provider.js";
import { silentLogger } from "../logging/logger.js";
import {
  connectTestClient,
  listeningPort,
  messageOf,
  type TestClient,
} from "../test-support/daemon-test-client.js";
import { startDevDaemon, type DevBootstrapHandle } from "./dev-bootstrap.js";

/**
 * Proves the mock producers added for the external-client fixtures (sprint-083/task-002) reach the
 * wire through the real dev daemon: `#stream` recipes as `agent_stream` frames, and a rebinding
 * mock fork as `agent_timeline_reset`. Also exercises the shared `daemon-test-client` helper.
 */

let handle: DevBootstrapHandle | undefined;
let client: TestClient | undefined;

afterEach(async () => {
  await client?.close();
  await handle?.close();
  client = undefined;
  handle = undefined;
});

async function boot(): Promise<{ client: TestClient; agentId: string }> {
  handle = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
  client = await connectTestClient(await listeningPort(handle.httpServer));
  const created = await client.rpc("create_agent_request", {
    config: { provider: "mock", cwd: "/tmp" },
    initialPrompt: "hello",
  });
  return { client, agentId: (created.payload as { agentId: string }).agentId };
}

function streamKind(kind: string): (frame: Record<string, unknown>) => boolean {
  return (frame) => {
    const m = messageOf(frame);
    return m.type === "agent_stream" && (m.event as { kind?: string }).kind === kind;
  };
}

describe("mock stream producers over the dev daemon (sprint-083/task-002)", () => {
  it("handshake returns the status frame", async () => {
    const { client: c } = await boot();
    expect(c.status.type).toBe("status");
  });

  it.each([
    ["reasoning", "#stream reasoning"],
    ["turn_failed", "#stream fail"],
    ["error", "#stream error"],
  ])("a %s agent_stream frame is observed for `%s`", async (kind, prompt) => {
    const { client: c, agentId } = await boot();
    await c.rpc("send_agent_prompt", { agentId, prompt });
    const frame = await c.waitFor(streamKind(kind));
    expect(messageOf(frame).agentId).toBe(agentId);
  });

  it("a fork to MOCK_REBIND_ENTRY_ID broadcasts agent_timeline_reset", async () => {
    const { client: c, agentId } = await boot();
    await c.rpc("agent_fork_request", { agentId, entryId: MOCK_REBIND_ENTRY_ID });
    const frame = await c.waitFor((f) => messageOf(f).type === "agent_timeline_reset");
    expect(messageOf(frame)).toMatchObject({ agentId, reason: "fork" });
  });

  it("a fork to any other entry does not reset", async () => {
    const { client: c, agentId } = await boot();
    await c.rpc("agent_fork_request", { agentId, entryId: "mock-entry-0" });
    expect(c.frames.some((f) => messageOf(f).type === "agent_timeline_reset")).toBe(false);
  });
});
