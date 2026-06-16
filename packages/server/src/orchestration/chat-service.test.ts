import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChatService, parseMentions } from "./chat-service.js";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "pi-studio-chat-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("parseMentions", () => {
  it("extracts unique @mention tokens", () => {
    expect(parseMentions("hi @alice and @bob, cc @alice")).toEqual(["alice", "bob"]);
    expect(parseMentions("no mentions here")).toEqual([]);
  });
});

describe("ChatService", () => {
  it("rejects creating two rooms with the same name (case-insensitive)", async () => {
    const svc = new ChatService({ home });
    await svc.createRoom({ name: "Planning" });
    await expect(svc.createRoom({ name: "planning" })).rejects.toThrow("duplicate_room_name");
  });

  it("posting extracts @mentions into mentionAgentIds; unknown mentions are dropped", async () => {
    const known = new Set(["alice", "bob"]);
    const svc = new ChatService({ home, resolveMention: (t) => (known.has(t) ? t : null) });
    const room = await svc.createRoom({ name: "room1" });
    const msg = await svc.postMessage({
      roomId: room.id,
      authorAgentId: "a1",
      body: "ping @alice @ghost @bob",
    });
    expect(msg.mentionAgentIds).toEqual(["alice", "bob"]); // @ghost dropped
  });

  it("rejects posting to a nonexistent room", async () => {
    const svc = new ChatService({ home });
    await expect(
      svc.postMessage({ roomId: "nope", authorAgentId: "a1", body: "x" }),
    ).rejects.toThrow("unknown_room");
  });

  it("reading with a cursor returns only messages after it", async () => {
    const svc = new ChatService({ home });
    const room = await svc.createRoom({ name: "room1" });
    await svc.postMessage({ roomId: room.id, authorAgentId: "a", body: "m1" });
    const first = await svc.readMessages(room.id, 0);
    expect(first.messages.map((m) => m.body)).toEqual(["m1"]);
    expect(first.cursor).toBe(1);

    await svc.postMessage({ roomId: room.id, authorAgentId: "a", body: "m2" });
    const next = await svc.readMessages(room.id, first.cursor);
    expect(next.messages.map((m) => m.body)).toEqual(["m2"]); // only after the cursor
  });

  it("wait returns immediately when new messages exist, else blocks until one arrives", async () => {
    const svc = new ChatService({ home });
    const room = await svc.createRoom({ name: "room1" });
    await svc.postMessage({ roomId: room.id, authorAgentId: "a", body: "existing" });

    // Immediate: messages already exist after cursor 0.
    const immediate = await svc.waitForMessages(room.id, 0, 1000);
    expect(immediate.messages.map((m) => m.body)).toEqual(["existing"]);

    // Blocking: cursor at end, then a post unblocks the waiter.
    const waitPromise = svc.waitForMessages(room.id, immediate.cursor, 2000);
    setTimeout(() => {
      void svc.postMessage({ roomId: room.id, authorAgentId: "b", body: "late" });
    }, 20);
    const blocked = await waitPromise;
    expect(blocked.messages.map((m) => m.body)).toEqual(["late"]);
  });

  it("wait times out to an empty result when nothing arrives", async () => {
    const svc = new ChatService({ home });
    const room = await svc.createRoom({ name: "room1" });
    const result = await svc.waitForMessages(room.id, 0, 30);
    expect(result.messages).toEqual([]);
  });

  it("deleting a room removes its messages", async () => {
    const svc = new ChatService({ home });
    const room = await svc.createRoom({ name: "room1" });
    await svc.postMessage({ roomId: room.id, authorAgentId: "a", body: "m1" });
    expect(await svc.deleteRoom(room.id)).toBe(true);
    expect(await svc.inspectRoom(room.id)).toBeNull();
    // Reload from disk to confirm messages are gone.
    const reloaded = new ChatService({ home });
    expect((await reloaded.listRooms()).length).toBe(0);
    expect((await reloaded.readMessages(room.id, 0)).messages).toEqual([]);
  });
});
