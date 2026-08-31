import { beforeEach, describe, expect, it } from "vitest";
import type { PiStudioClient } from "@av-pi-studio/client";
import { handleAgentTimelineReset, isAgentTimelineReset } from "./use-timeline-reset-watch.js";
import { useSessionStore, type SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { EMPTY_TIMELINE } from "@pi-studio-ui/timeline/reducer.js";

beforeEach(() => {
  useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
});

function hydrated(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id: "s1",
    agentId: "a1",
    title: "Restored",
    status: "idle",
    cwd: "/work",
    timeline: EMPTY_TIMELINE,
    userMessageCount: 0,
    ...overrides,
  };
}

/** Minimal stub of the `PiStudioClient` surface `handleAgentTimelineReset` touches. */
interface FakeClient {
  agentCalls: string[];
  cursorsRequested: Array<string | undefined>;
  agent(agentId: string): {
    timeline: {
      fetch(opts: {
        direction: string;
        cursor?: string;
        limit?: number;
      }): Promise<{ items: unknown[]; hasNewer: boolean; endCursor?: string | null }>;
    };
  };
}

/** Two pages: page one hands back one hydrated user-message event and reports more to come; page
 * two (fetched with the returned cursor) is empty and terminal. Item shape mirrors the real
 * `fetch_agent_timeline` wire shape `events.ts`'s `flattenTimelineItems` consumes. */
function makeFakeClient(): FakeClient {
  const agentCalls: string[] = [];
  const cursorsRequested: Array<string | undefined> = [];
  return {
    agentCalls,
    cursorsRequested,
    agent(agentId) {
      agentCalls.push(agentId);
      return {
        timeline: {
          fetch(opts) {
            cursorsRequested.push(opts.cursor);
            if (opts.cursor === undefined) {
              return Promise.resolve({
                items: [
                  {
                    kind: "other",
                    event: { kind: "user_message", text: "hello from the forked branch" },
                    timestamp: "2026-08-26T00:00:00.000Z",
                  },
                ],
                hasNewer: true,
                endCursor: "cursor-2",
              });
            }
            return Promise.resolve({ items: [], hasNewer: false, endCursor: null });
          },
        },
      };
    },
  };
}

describe("isAgentTimelineReset", () => {
  it("accepts a well-formed agent_timeline_reset message", () => {
    expect(
      isAgentTimelineReset({ type: "agent_timeline_reset", agentId: "a1", reason: "fork" }),
    ).toBe(true);
  });

  it("accepts a message with no reason (reason is opaque/optional to this client)", () => {
    expect(isAgentTimelineReset({ type: "agent_timeline_reset", agentId: "a1" })).toBe(true);
  });

  it("accepts an unrecognised reason — the reset still triggers (reason is opaque)", () => {
    expect(
      isAgentTimelineReset({ type: "agent_timeline_reset", agentId: "a1", reason: "clone" }),
    ).toBe(true);
  });

  it("rejects other message types, a missing agentId, and non-objects", () => {
    expect(isAgentTimelineReset({ type: "agent_update" })).toBe(false);
    expect(isAgentTimelineReset({ type: "agent_timeline_reset" })).toBe(false);
    expect(isAgentTimelineReset({ type: "agent_timeline_reset", agentId: 5 })).toBe(false);
    expect(isAgentTimelineReset(null)).toBe(false);
    expect(isAgentTimelineReset(undefined)).toBe(false);
    expect(isAgentTimelineReset("agent_timeline_reset")).toBe(false);
  });
});

describe("handleAgentTimelineReset (sprint-072/task-001, fork resync)", () => {
  it("drops cached rows and replaces the timeline with a from-scratch refetch, paging to completion", async () => {
    useSessionStore.getState().hydrate(hydrated({ userMessageCount: 5 }));
    const client = makeFakeClient();

    await handleAgentTimelineReset(client as unknown as PiStudioClient, "a1");

    const entry = useSessionStore.getState().sessions["s1"];
    expect(entry?.timeline.rows).toHaveLength(1);
    expect(entry?.timeline.rows[0]).toMatchObject({
      kind: "user",
      text: "hello from the forked branch",
    });
    expect(entry?.userMessageCount).toBe(1);
    // Paged to completion: two fetches, second one following the endCursor from the first.
    expect(client.cursorsRequested).toEqual([undefined, "cursor-2"]);
  });

  it("never reuses a cursor from before the reset — the refetch always starts at cursor: null", async () => {
    useSessionStore.getState().hydrate(hydrated());
    const client = makeFakeClient();

    await handleAgentTimelineReset(client as unknown as PiStudioClient, "a1");

    expect(client.cursorsRequested[0]).toBeUndefined();
  });

  it("clears pending optimistic user rows for the agent as a side effect of the full replace", async () => {
    useSessionStore.getState().hydrate(hydrated());
    useSessionStore.getState().addOptimisticUserMessage("s1", "cm-1", "still pending");
    expect(useSessionStore.getState().sessions["s1"]?.timeline.rows).toHaveLength(1);

    const client = makeFakeClient();
    await handleAgentTimelineReset(client as unknown as PiStudioClient, "a1");

    // The optimistic row is gone; only the server-truth row from the refetch remains.
    const rows = useSessionStore.getState().sessions["s1"]?.timeline.rows ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: "hello from the forked branch" });
  });

  it("is a silent no-op for an agent this client has no cached timeline for — no fetch issued", async () => {
    const client = makeFakeClient();

    await handleAgentTimelineReset(client as unknown as PiStudioClient, "unknown-agent");

    expect(client.agentCalls).toHaveLength(0);
    expect(useSessionStore.getState().sessions).toEqual({});
  });
});
