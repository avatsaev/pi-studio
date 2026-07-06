import { describe, it, expect } from "vitest";
import {
  createMemoryAttachmentStore,
  bytesToBase64,
  parseGitHubUrl,
  detectGitHubUrlsInText,
  gitHubRefToAttachment,
  extractImageFiles,
  extractImagesFromItems,
  attachmentPillKind,
  attachmentLabel,
  attachmentId,
  openLightbox,
  closeLightbox,
  INITIAL_LIGHTBOX,
  buildSendAttachments,
  newImageStorageKey,
  type StoredImage,
} from "./attachments.js";
import type { DraftAttachmentMeta } from "./draft-store.js";

// ─── bytes / base64 ────────────────────────────────────────────────────────

describe("bytesToBase64", () => {
  it("encodes bytes matching Buffer's base64", () => {
    const bytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("pads correctly for 1- and 2-byte tails", () => {
    expect(bytesToBase64(new Uint8Array([1]))).toBe(Buffer.from([1]).toString("base64"));
    expect(bytesToBase64(new Uint8Array([1, 2]))).toBe(Buffer.from([1, 2]).toString("base64"));
  });
});

// ─── memory bytes store ───────────────────────────────────────────────────────

describe("createMemoryAttachmentStore", () => {
  it("puts, gets, and deletes image bytes", async () => {
    const store = createMemoryAttachmentStore();
    const key = newImageStorageKey();
    const img: StoredImage = { mimeType: "image/png", data: "AAAA" };
    await store.put(key, img);
    expect(await store.get(key)).toEqual(img);
    await store.delete(key);
    expect(await store.get(key)).toBeUndefined();
  });
});

// ─── GitHub URL detection ──────────────────────────────────────────────────

describe("parseGitHubUrl", () => {
  it("parses an issue URL", () => {
    const ref = parseGitHubUrl("https://github.com/org/repo/issues/123");
    expect(ref).toMatchObject({ kind: "github_issue", owner: "org", repo: "repo", number: 123 });
  });

  it("parses a pull request URL", () => {
    const ref = parseGitHubUrl("https://github.com/org/repo/pull/42");
    expect(ref).toMatchObject({ kind: "github_pr", number: 42 });
  });

  it("returns null for non-GitHub URLs", () => {
    expect(parseGitHubUrl("https://example.com/foo")).toBeNull();
    expect(parseGitHubUrl("just text")).toBeNull();
  });
});

describe("detectGitHubUrlsInText", () => {
  it("finds all unique refs embedded in text", () => {
    const text = "see https://github.com/o/r/issues/1 and https://github.com/o/r/pull/2 and again https://github.com/o/r/issues/1";
    const refs = detectGitHubUrlsInText(text);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.number)).toEqual([1, 2]);
  });

  it("gitHubRefToAttachment builds the right pill kind", () => {
    const ref = parseGitHubUrl("https://github.com/o/r/pull/7")!;
    const att = gitHubRefToAttachment(ref, "o/r");
    expect(att.kind).toBe("github_pr");
  });
});

// ─── paste / drop extraction ────────────────────────────────────────────────

describe("image extraction", () => {
  const fakeFile = (type: string, name = "f") => ({ type, name }) as unknown as File;

  it("extractImageFiles filters to image types", () => {
    const files = [fakeFile("image/png"), fakeFile("text/plain"), fakeFile("image/jpeg")];
    expect(extractImageFiles(files as unknown as File[])).toHaveLength(2);
    expect(extractImageFiles(null)).toEqual([]);
  });

  it("extractImagesFromItems collects image files from clipboard items", () => {
    const items = [
      { kind: "file", type: "image/png", getAsFile: () => fakeFile("image/png") },
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "image/gif", getAsFile: () => fakeFile("image/gif") },
    ];
    expect(extractImagesFromItems(items)).toHaveLength(2);
  });
});

// ─── pills ──────────────────────────────────────────────────────────────────

describe("attachment pills", () => {
  const image: DraftAttachmentMeta = { kind: "image", storageKey: "k1", mimeType: "image/png", name: "a.png" };
  const pr: DraftAttachmentMeta = { kind: "github_pr", number: 9, title: "Fix", url: "u" };
  const review: DraftAttachmentMeta = { kind: "review", label: "Review comment" };

  it("classifies pill kinds", () => {
    expect(attachmentPillKind(image)).toBe("image");
    expect(attachmentPillKind(pr)).toBe("github");
    expect(attachmentPillKind(review)).toBe("workspace");
  });

  it("labels attachments", () => {
    expect(attachmentLabel(image)).toBe("a.png");
    expect(attachmentLabel(pr)).toBe("#9 Fix");
    expect(attachmentLabel(review)).toBe("Review comment");
  });

  it("gives stable ids", () => {
    expect(attachmentId(image, 0)).toBe("k1");
    expect(attachmentId(pr, 1)).toBe("gh:github_pr:9");
  });
});

// ─── lightbox ─────────────────────────────────────────────────────────────────

describe("lightbox state", () => {
  it("open/close transitions", () => {
    expect(INITIAL_LIGHTBOX.open).toBe(false);
    const opened = openLightbox("k1", "a.png");
    expect(opened).toEqual({ open: true, storageKey: "k1", label: "a.png" });
    expect(closeLightbox().open).toBe(false);
  });
});

// ─── send serialization ───────────────────────────────────────────────────────

describe("buildSendAttachments", () => {
  it("serializes images from resolved bytes and groups github refs", () => {
    const atts: DraftAttachmentMeta[] = [
      { kind: "image", storageKey: "k1", mimeType: "image/png", name: "a.png" },
      { kind: "image", storageKey: "missing", mimeType: "image/png", name: "b.png" },
      { kind: "github_pr", number: 3, title: "PR", url: "up" },
      { kind: "github_issue", number: 4, title: "Issue", url: "ui" },
    ];
    const resolved = { k1: { mimeType: "image/png", data: "AAAA" } };
    const payload = buildSendAttachments(atts, resolved);
    // missing bytes are skipped, not crashed
    expect(payload.images).toEqual([{ mimeType: "image/png", data: "AAAA" }]);
    expect(payload.attachments.prs).toHaveLength(1);
    expect(payload.attachments.issues).toHaveLength(1);
  });
});
