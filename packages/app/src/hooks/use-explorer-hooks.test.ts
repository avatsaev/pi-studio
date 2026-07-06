/**
 * Explorer & git hooks tests — sprint-023 / task-002
 */

import { describe, it, expect, vi } from "vitest";
import {
  EXPLORER_QUERY_KEYS,
  subscribeFileWriteInvalidation,
} from "./use-explorer-hooks.js";

describe("EXPLORER_QUERY_KEYS", () => {
  it("generates directory key correctly", () => {
    const key = EXPLORER_QUERY_KEYS.directory("srv1", "/home/user");
    expect(key).toEqual(["explorer", "dir", "srv1", "/home/user"]);
  });

  it("generates git status key correctly", () => {
    const key = EXPLORER_QUERY_KEYS.gitStatus("srv1", "/home/user/proj");
    expect(key).toEqual(["git", "status", "srv1", "/home/user/proj"]);
  });

  it("generates git diff key correctly", () => {
    const key = EXPLORER_QUERY_KEYS.gitDiff("srv1", "/proj", "src/main.ts");
    expect(key).toEqual(["git", "diff", "srv1", "/proj", "src/main.ts"]);
  });

  it("generates PR activity key correctly", () => {
    const key = EXPLORER_QUERY_KEYS.prActivity("srv1", "/proj");
    expect(key).toEqual(["git", "pr", "srv1", "/proj"]);
  });
});

describe("subscribeFileWriteInvalidation", () => {
  it("invalidates git status cache on edit tool_call", () => {
    let handler: ((msg: unknown) => void) | undefined;

    const mockClient = {
      connection: {
        onSessionMessage: (h: (msg: unknown) => void) => {
          handler = h;
          return () => {};
        },
      },
    };

    const invalidateQueries = vi.fn();
    const mockQc = { invalidateQueries } as never;

    subscribeFileWriteInvalidation(mockClient, mockQc);

    handler?.({
      type: "agent_stream",
      agentId: "a1",
      event: {
        type: "tool_call",
        detail: { kind: "edit", filePath: "src/main.ts" },
      },
    });

    // Should have invalidated git status and explorer dir
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["git", "status"] }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["explorer", "dir"] }),
    );
  });

  it("does not invalidate cache on non-file-write events", () => {
    let handler: ((msg: unknown) => void) | undefined;

    const mockClient = {
      connection: {
        onSessionMessage: (h: (msg: unknown) => void) => {
          handler = h;
          return () => {};
        },
      },
    };

    const invalidateQueries = vi.fn();
    const mockQc = { invalidateQueries } as never;

    subscribeFileWriteInvalidation(mockClient, mockQc);

    handler?.({
      type: "agent_stream",
      agentId: "a1",
      event: {
        type: "tool_call",
        detail: { kind: "shell", command: "ls" },
      },
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("does not invalidate cache on non-agent-stream events", () => {
    let handler: ((msg: unknown) => void) | undefined;

    const mockClient = {
      connection: {
        onSessionMessage: (h: (msg: unknown) => void) => {
          handler = h;
          return () => {};
        },
      },
    };

    const invalidateQueries = vi.fn();
    const mockQc = { invalidateQueries } as never;

    subscribeFileWriteInvalidation(mockClient, mockQc);

    handler?.({ type: "agent_update", agentId: "a1", status: "idle" });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("returns an unsubscribe function", () => {
    const unsubFn = vi.fn();
    const mockClient = {
      connection: {
        onSessionMessage: () => unsubFn,
      },
    };

    const unsub = subscribeFileWriteInvalidation(mockClient, { invalidateQueries: vi.fn() } as never);
    unsub();
    expect(unsubFn).toHaveBeenCalled();
  });

  it("invalidates cache on write tool_call kind", () => {
    let handler: ((msg: unknown) => void) | undefined;
    const invalidateQueries = vi.fn();

    subscribeFileWriteInvalidation(
      { connection: { onSessionMessage: (h) => { handler = h; return () => {}; } } },
      { invalidateQueries } as never,
    );

    handler?.({
      type: "agent_stream",
      event: { type: "tool_call", detail: { kind: "write" } },
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });
});
