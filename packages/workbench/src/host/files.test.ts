import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FileTransferClient } from "@av-pi-studio/client";
import { createBrowserFiles } from "./browser-files.js";
import { installHost, resetHostForTests } from "./install.js";
import { type UploadSource } from "./types.js";
import { uploadSources, type UploadStatus } from "../features/files/upload-sources.js";
import { type FileDownload, supersedeDownload } from "../hooks/use-file-download.js";
import { uploadAndRefresh } from "../hooks/use-file-transfer.js";
import { createTestHost } from "../test/test-host.js";

const source = (name: string): UploadSource => ({ name });

beforeEach(() => resetHostForTests());
afterEach(() => vi.unstubAllGlobals());

describe("upload through the host", () => {
  it("uploads through the host, then refreshes the explorer listing", async () => {
    const host = createTestHost();
    installHost(host);
    const order: string[] = [];
    const invalidateQueries = vi.fn(async () => void order.push("refresh"));
    host.files.upload = async (dir, s) => void order.push(`upload ${dir}/${s.name}`);

    await uploadAndRefresh({ invalidateQueries }, "/work", source("a.txt"));

    expect(order).toEqual(["upload /work/a.txt", "refresh"]);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["explorer"] });
  });

  it("does not refresh when the host rejects the upload", async () => {
    installHost(createTestHost({ uploadFails: "disk full" }));
    const invalidateQueries = vi.fn(async () => {});

    await expect(uploadAndRefresh({ invalidateQueries }, "/work", source("a.txt"))).rejects.toThrow(
      "disk full",
    );
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("reports a rejected upload on the status line", async () => {
    const statuses: UploadStatus[] = [];
    await uploadSources("/work", [source("a.txt")], {
      existing: new Set(),
      confirm: async () => true,
      upload: async () => Promise.reject(new Error("disk full")),
      setStatus: (s) => statuses.push(s),
    });

    expect(statuses).toEqual([
      { text: "Uploading 1 file…", error: false },
      { text: "Upload failed: disk full", error: true },
    ]);
  });

  it("uploads nothing when an overwrite is declined", async () => {
    const upload = vi.fn(async () => {});
    const confirm = vi.fn(async () => false);
    await uploadSources("/work", [source("a.txt"), source("b.txt")], {
      existing: new Set(["a.txt"]),
      confirm,
      upload,
      setStatus: () => {},
    });

    expect(confirm).toHaveBeenCalledWith("Overwrite this file? a.txt");
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("view URLs", () => {
  function download(url: string): FileDownload & { release: ReturnType<typeof vi.fn> } {
    return { objectUrl: url, release: vi.fn() };
  }

  it("releases the previous URL when a new one supersedes it, never the current one", () => {
    const first = download("u1");
    const second = download("u2");

    let current = supersedeDownload(null, first);
    current = supersedeDownload(current, first);
    expect(first.release).not.toHaveBeenCalled();

    current = supersedeDownload(current, second);
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(second.release).not.toHaveBeenCalled();
    expect(current).toBe(second);
  });

  it("browser host: a view URL is an object URL revoked once, on release", async () => {
    let n = 0;
    const revoked: string[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: () => `blob:v${++n}`,
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    const transfer = {
      download: vi.fn(async () => ({ bytes: new Uint8Array([1]), mimeType: "image/png" })),
    } as unknown as FileTransferClient;
    const files = createBrowserFiles(() => transfer);

    const view = await files.openForView("/work/a.png");
    expect(view).toMatchObject({ url: "blob:v1", mimeType: "image/png" });

    view.release();
    view.release();
    expect(revoked).toEqual(["blob:v1"]);
  });
});
