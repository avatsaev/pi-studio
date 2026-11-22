import { beforeEach, describe, expect, it } from "vitest";
import { installHost, resetHostForTests } from "../host/install.js";
import { useTransferActivityStore } from "../stores/transfer-activity-store.js";
import { activityText } from "../stores/transfer-activity-text.js";
import { createTestHost, type TestHost } from "../test/test-host.js";
import { saveToDiskActivity } from "./use-file-transfer.js";

const store = () => useTransferActivityStore.getState();

let host: TestHost;

beforeEach(() => {
  resetHostForTests();
  useTransferActivityStore.setState({ activities: [], lastResult: null });
  host = createTestHost({ holdTransfers: true });
  installHost(host);
});

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("saveToDiskActivity", () => {
  it("has no activity while the host has called nothing, one from the first callback, none after", async () => {
    const saved = saveToDiskActivity("/w/docs/report.pdf");
    await settle();
    expect(host.transfers).toHaveLength(1);
    expect(store().activities).toEqual([]);

    host.transfers[0]?.progress(25, 100);
    expect(store().activities).toHaveLength(1);
    expect(store().activities[0]).toMatchObject({
      kind: "save",
      label: "Downloading report.pdf",
      percent: 25,
    });
    expect(activityText(store().activities[0]!)).toBe("Downloading report.pdf… 25%");

    host.transfers[0]?.finish();
    await saved;
    expect(store().activities).toEqual([]);
    expect(store().lastResult).toMatchObject({ text: "Downloaded report.pdf", error: false });
  });

  it("registers at the first state change as well", async () => {
    const saved = saveToDiskActivity("/w/a.bin");
    await settle();
    host.transfers[0]?.state("queued");
    expect(activityText(store().activities[0]!)).toBe("Downloading a.bin… waiting");
    host.transfers[0]?.state("running");
    host.transfers[0]?.progress(1, 2);
    expect(store().activities).toHaveLength(1);
    host.transfers[0]?.finish();
    await saved;
  });

  it("registers one activity however many callbacks come", async () => {
    const saved = saveToDiskActivity("/w/a.bin");
    await settle();
    host.transfers[0]?.progress(1, 4);
    host.transfers[0]?.progress(2, 4);
    host.transfers[0]?.state("running");
    expect(store().activities).toHaveLength(1);
    expect(store().activities[0]?.percent).toBe(50);
    host.transfers[0]?.finish();
    await saved;
  });

  it("takes a restart back to its percentage: waiting, then progress from zero", async () => {
    const saved = saveToDiskActivity("/w/a.bin");
    await settle();
    const line = (): string => activityText(store().activities[0]!);
    host.transfers[0]?.progress(90, 100);
    expect(line()).toBe("Downloading a.bin… 90%");
    host.transfers[0]?.state("waiting");
    expect(line()).toBe("Downloading a.bin… waiting for the connection");
    host.transfers[0]?.progress(0, 100);
    expect(line()).toBe("Downloading a.bin… 0%");
    host.transfers[0]?.finish();
    await saved;
  });

  it("shows no percentage when the size is unknown", async () => {
    const saved = saveToDiskActivity("/w/a.bin");
    await settle();
    host.transfers[0]?.progress(10);
    expect(store().activities[0]?.percent).toBeNull();
    expect(activityText(store().activities[0]!)).toBe("Downloading a.bin…");
    host.transfers[0]?.finish();
    await saved;
  });

  it("leaves no result when the call settles without a callback (a dismissed dialog)", async () => {
    const saved = saveToDiskActivity("/w/a.bin");
    await settle();
    host.transfers[0]?.finish();
    await saved;
    expect(store().activities).toEqual([]);
    expect(store().lastResult).toBeNull();
  });

  it("Cancel aborts the host's signal and rejects with the AbortError", async () => {
    const saved = saveToDiskActivity("/w/a.bin");
    const rejected = saved.then(
      () => null,
      (e: unknown) => e,
    );
    await settle();
    host.transfers[0]?.progress(1, 10);
    expect(host.transfers[0]?.options?.signal?.aborted).toBe(false);

    store().activities[0]?.cancel();
    const error = await rejected;

    expect(host.transfers[0]?.options?.signal?.aborted).toBe(true);
    expect(error).toMatchObject({ name: "AbortError" });
    expect(store().activities).toEqual([]);
    expect(store().lastResult).toMatchObject({ text: "Download cancelled", error: false });
  });

  it("ends with the failure's message as an error, and rejects with it", async () => {
    const saved = saveToDiskActivity("/w/a.bin");
    const rejected = saved.then(
      () => null,
      (e: unknown) => e,
    );
    await settle();
    host.transfers[0]?.progress(1, 10);
    host.transfers[0]?.fail(new Error("no space left"));
    expect(await rejected).toMatchObject({ message: "no space left" });
    expect(store().activities).toEqual([]);
    expect(store().lastResult).toMatchObject({
      text: "Download failed: no space left",
      error: true,
    });
  });

  it("reports a failure that came before any callback", async () => {
    const saved = saveToDiskActivity("/w/a.bin");
    const rejected = saved.catch((e: unknown) => e);
    await settle();
    host.transfers[0]?.fail(new Error("denied"));
    await rejected;
    expect(store().activities).toEqual([]);
    expect(store().lastResult).toMatchObject({ text: "Download failed: denied", error: true });
  });

  it("holds two saves and a batch at once, oldest first, each with its own cancel", async () => {
    const first = saveToDiskActivity("/w/one.bin").catch(() => {});
    const second = saveToDiskActivity("/w/two.bin").catch(() => {});
    await settle();
    host.transfers[0]?.progress(1, 10);
    store().add({ kind: "upload", label: "Uploading 2 files", cancel: () => {} });
    host.transfers[1]?.progress(1, 10);

    const { activities } = store();
    expect(activities.map((a) => a.label)).toEqual([
      "Downloading one.bin",
      "Uploading 2 files",
      "Downloading two.bin",
    ]);

    activities[2]?.cancel();
    await second;
    expect(host.transfers[0]?.options?.signal?.aborted).toBe(false);
    expect(host.transfers[1]?.options?.signal?.aborted).toBe(true);
    expect(store().activities.map((a) => a.label)).toEqual([
      "Downloading one.bin",
      "Uploading 2 files",
    ]);
    host.transfers[0]?.finish();
    await first;
  });
});
