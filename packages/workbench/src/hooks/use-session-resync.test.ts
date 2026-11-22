import { beforeEach, describe, expect, it } from "vitest";
import type { AgentStreamEventMeta, PiStudioClient } from "@av-pi-studio/client";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { runSessionResync } from "./use-session-resync.js";
import { useSessionStore, type SessionEntry } from "../stores/session-store.js";
import { applyStreamEvent, EMPTY_TIMELINE } from "../timeline/reducer.js";

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

function userMessage(text: string): AgentStreamEvent {
  return { kind: "user_message", text } as AgentStreamEvent;
}

interface Page {
  items: unknown[];
  hasNewer: boolean;
  endCursor: string | null;
  seqEnd: number;
}

type StreamHandler = (event: AgentStreamEvent, meta: AgentStreamEventMeta) => void;

interface FakeDaemon {
  client: PiStudioClient;
  requests: string[];
  fetched: string[];
  /** Handlers attached through `timeline.subscribe`, per agent. */
  handlers: Map<string, Set<StreamHandler>>;
  /** Called while the timeline fetch of `agentId` is in flight, before its page is returned. */
  duringFetch: (agentId: string) => void;
}

/** One page per agent: the daemon's whole timeline, covering source rows up to `seqEnd`. */
function makeFakeDaemon(
  timelines: Record<string, { texts: string[]; seqEnd: number } | "unreadable">,
  agents: Array<{ agentId: string; status?: string }> | "unreadable",
): FakeDaemon {
  const fake: FakeDaemon = {
    client: null as unknown as PiStudioClient,
    requests: [],
    fetched: [],
    handlers: new Map(),
    duringFetch: () => {},
  };
  const client = {
    connection: {
      request(type: string): Promise<unknown> {
        fake.requests.push(type);
        return agents === "unreadable"
          ? Promise.reject(new Error("closed"))
          : Promise.resolve({ agents });
      },
    },
    agent(agentId: string) {
      return {
        timeline: {
          fetch(): Promise<Page> {
            fake.fetched.push(agentId);
            fake.duringFetch(agentId);
            const timeline = timelines[agentId];
            if (!timeline || timeline === "unreadable") {
              return Promise.reject(new Error("closed"));
            }
            return Promise.resolve({
              items: timeline.texts.map((text) => ({ kind: "other", event: userMessage(text) })),
              hasNewer: false,
              endCursor: String(timeline.seqEnd),
              seqEnd: timeline.seqEnd,
            });
          },
          subscribe(handler: StreamHandler): () => void {
            const set = fake.handlers.get(agentId) ?? new Set<StreamHandler>();
            fake.handlers.set(agentId, set);
            set.add(handler);
            return () => set.delete(handler);
          },
        },
      };
    },
  };
  fake.client = client as unknown as PiStudioClient;
  return fake;
}

function rowTexts(sessionId: string): string[] {
  const rows = useSessionStore.getState().sessions[sessionId]?.timeline.rows ?? [];
  return rows.map((row) => (row.kind === "user" ? row.text : `<${row.kind}>`));
}

describe("runSessionResync (the connection opened again)", () => {
  it("replaces a session's timeline with what the daemon has now", async () => {
    const stale = applyStreamEvent(EMPTY_TIMELINE, userMessage("before the sleep"));
    useSessionStore.getState().hydrate(hydrated({ timeline: stale, userMessageCount: 1 }));
    const daemon = makeFakeDaemon(
      { a1: { texts: ["before the sleep", "sent from another client"], seqEnd: 2 } },
      [{ agentId: "a1", status: "idle" }],
    );

    await runSessionResync(daemon.client);

    expect(rowTexts("s1")).toEqual(["before the sleep", "sent from another client"]);
    expect(useSessionStore.getState().sessions["s1"]?.userMessageCount).toBe(2);
  });

  it("takes each session's status from the daemon, so a turn that ended meanwhile stops showing as running", async () => {
    useSessionStore.getState().hydrate(hydrated({ status: "running" }));
    useSessionStore.getState().hydrate(hydrated({ id: "s2", agentId: "a2", status: "idle" }));
    const daemon = makeFakeDaemon({ a1: { texts: [], seqEnd: 0 }, a2: { texts: [], seqEnd: 0 } }, [
      { agentId: "a1", status: "idle" },
      { agentId: "a2", status: "running" },
      { agentId: "unknown-here", status: "running" },
    ]);

    await runSessionResync(daemon.client);

    const { sessions } = useSessionStore.getState();
    expect(sessions["s1"]?.status).toBe("idle");
    expect(sessions["s2"]?.status).toBe("running");
    expect(Object.keys(sessions).toSorted()).toEqual(["s1", "s2"]);
  });

  it("keeps a live event that arrived during the fetch and is newer than the fetched page", async () => {
    useSessionStore.getState().hydrate(hydrated());
    const daemon = makeFakeDaemon({ a1: { texts: ["one", "two"], seqEnd: 2 } }, []);
    daemon.duringFetch = (agentId) => {
      for (const handler of daemon.handlers.get(agentId) ?? []) {
        // Already inside the page (seq 2): applying it again would show it twice.
        handler(userMessage("two"), { seq: 2 });
        // Appended after the daemon built the page: only the live copy carries it.
        handler(userMessage("three"), { seq: 3 });
        // Live-only, no `seq`: nothing to carry over.
        handler({ kind: "queue_update", queued: [] } as unknown as AgentStreamEvent, {});
      }
    };

    await runSessionResync(daemon.client);

    expect(rowTexts("s1")).toEqual(["one", "two", "three"]);
    // The collector is detached once the replace is done.
    expect(daemon.handlers.get("a1")?.size).toBe(0);
  });

  it("keeps the shown timeline when the fetch fails, and still resyncs the other sessions", async () => {
    const shown = applyStreamEvent(EMPTY_TIMELINE, userMessage("still here"));
    useSessionStore.getState().hydrate(hydrated({ timeline: shown, userMessageCount: 1 }));
    useSessionStore.getState().hydrate(hydrated({ id: "s2", agentId: "a2" }));
    const daemon = makeFakeDaemon(
      { a1: "unreadable", a2: { texts: ["fresh"], seqEnd: 1 } },
      "unreadable",
    );

    await runSessionResync(daemon.client);

    expect(rowTexts("s1")).toEqual(["still here"]);
    expect(rowTexts("s2")).toEqual(["fresh"]);
    expect(daemon.handlers.get("a1")?.size).toBe(0);
  });

  it("asks the daemon nothing when no session has an agent yet", async () => {
    useSessionStore.getState().hydrate(hydrated({ agentId: null }));
    const daemon = makeFakeDaemon({}, []);

    await runSessionResync(daemon.client);

    expect(daemon.requests).toEqual([]);
    expect(daemon.fetched).toEqual([]);
  });
});
