import { beforeEach, describe, expect, it } from "vitest";
import { parseSavedServers, useSavedServersStore } from "./saved-servers-store.js";

beforeEach(() => {
  useSavedServersStore.setState({ servers: [] });
});

describe("parseSavedServers — tolerant load of the persisted blob", () => {
  it("returns [] for null, invalid JSON, and non-array shapes", () => {
    expect(parseSavedServers(null)).toEqual([]);
    expect(parseSavedServers("not json {")).toEqual([]);
    expect(parseSavedServers(JSON.stringify({ servers: [] }))).toEqual([]);
    expect(parseSavedServers(JSON.stringify("a string"))).toEqual([]);
  });

  it("round-trips a valid server list, trimming name and url", () => {
    const raw = JSON.stringify([
      { id: "a", name: "  puma-hpc ", url: " ws://puma:6767 ", password: "s3cret" },
      { id: "b", name: "local", url: "127.0.0.1:6767" },
    ]);
    expect(parseSavedServers(raw)).toEqual([
      { id: "a", name: "puma-hpc", url: "ws://puma:6767", password: "s3cret" },
      { id: "b", name: "local", url: "127.0.0.1:6767" },
    ]);
  });

  it("drops entries with missing or blank id / name / url", () => {
    const raw = JSON.stringify([
      { name: "no-id", url: "ws://x" },
      { id: "a", url: "ws://x" },
      { id: "b", name: "   ", url: "ws://x" },
      { id: "c", name: "no-url" },
      { id: "d", name: "blank-url", url: "  " },
      "not-an-object",
      null,
      { id: "ok", name: "ok", url: "ws://ok" },
    ]);
    expect(parseSavedServers(raw)).toEqual([{ id: "ok", name: "ok", url: "ws://ok" }]);
  });

  it("keeps a non-empty password and drops blank or non-string passwords", () => {
    const raw = JSON.stringify([
      { id: "a", name: "a", url: "ws://a", password: "pw" },
      { id: "b", name: "b", url: "ws://b", password: "   " },
      { id: "c", name: "c", url: "ws://c", password: 42 },
    ]);
    expect(parseSavedServers(raw)).toEqual([
      { id: "a", name: "a", url: "ws://a", password: "pw" },
      { id: "b", name: "b", url: "ws://b" },
      { id: "c", name: "c", url: "ws://c" },
    ]);
  });
});

describe("saved-servers store actions", () => {
  it("addServer appends a trimmed entry with a generated id and returns it", () => {
    const server = useSavedServersStore
      .getState()
      .addServer({ name: "  puma-hpc ", url: " ws://puma:6767 ", password: "" });

    expect(server.id).toBeTruthy();
    expect(server).toEqual({ id: server.id, name: "puma-hpc", url: "ws://puma:6767" });
    expect(useSavedServersStore.getState().servers).toEqual([server]);
  });

  it("addServer keeps a provided password", () => {
    const server = useSavedServersStore
      .getState()
      .addServer({ name: "puma", url: "ws://puma:6767", password: "s3cret" });
    expect(useSavedServersStore.getState().servers[0]).toEqual({
      id: server.id,
      name: "puma",
      url: "ws://puma:6767",
      password: "s3cret",
    });
  });

  it("updateServer patches only the matching entry and only the given fields", () => {
    const { addServer } = useSavedServersStore.getState();
    const a = addServer({ name: "a", url: "ws://a" });
    const b = addServer({ name: "b", url: "ws://b", password: "pw" });

    useSavedServersStore.getState().updateServer(a.id, { url: "wss://a2" });

    const { servers } = useSavedServersStore.getState();
    expect(servers).toEqual([
      { id: a.id, name: "a", url: "wss://a2" },
      { id: b.id, name: "b", url: "ws://b", password: "pw" },
    ]);
  });

  it("updateServer sets and clears the password (blank clears)", () => {
    const { addServer } = useSavedServersStore.getState();
    const a = addServer({ name: "a", url: "ws://a" });

    useSavedServersStore.getState().updateServer(a.id, { password: "pw" });
    expect(useSavedServersStore.getState().servers[0]?.password).toBe("pw");

    useSavedServersStore.getState().updateServer(a.id, { password: "   " });
    expect(useSavedServersStore.getState().servers[0]).toEqual({
      id: a.id,
      name: "a",
      url: "ws://a",
    });
  });

  it("removeServer deletes only the targeted entry", () => {
    const { addServer } = useSavedServersStore.getState();
    const a = addServer({ name: "a", url: "ws://a" });
    const b = addServer({ name: "b", url: "ws://b" });

    useSavedServersStore.getState().removeServer(a.id);

    expect(useSavedServersStore.getState().servers).toEqual([
      { id: b.id, name: "b", url: "ws://b" },
    ]);
  });
});
