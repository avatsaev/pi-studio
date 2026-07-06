// Composer attachment system — image bytes storage, GitHub URL detection,
// paste/drop extraction, pill labels, lightbox state, and send serialization.
//
// The React glue (paste/drop listeners, file picker, lightbox overlay) lives in
// the Composer component; everything here is framework-agnostic and unit
// tested in the node environment.
//
// clean-room-scope/features/composer-ui.md § Attachments
// clean-room-scope/features/feature-panels-ui.md § Element selector (browser capture)

import type { DraftAttachmentMeta } from "./draft-store.js";
import { randomUUID } from "../util/uuid.js";

// ─── Image bytes store ─────────────────────────────────────────────────────────

/** Stored image payload: raw bytes + mime type. */
export interface StoredImage {
  mimeType: string;
  /** Base64-encoded bytes (transport-ready). */
  data: string;
}

/**
 * Binary attachment store. Metadata (storage key, name, mime) travels in the
 * draft; the bytes live here. Web uses IndexedDB; tests use the in-memory impl.
 */
export interface AttachmentBytesStore {
  put(key: string, image: StoredImage): Promise<void>;
  get(key: string): Promise<StoredImage | undefined>;
  delete(key: string): Promise<void>;
}

export function createMemoryAttachmentStore(): AttachmentBytesStore {
  const map = new Map<string, StoredImage>();
  return {
    async put(key, image) {
      map.set(key, image);
    },
    async get(key) {
      return map.get(key);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

export function newImageStorageKey(): string {
  return `img-${randomUUID()}`;
}

const IDB_DB_NAME = "pi-studio-attachments";
const IDB_STORE = "images";

/**
 * IndexedDB-backed attachment store for the browser. Falls back to the
 * in-memory store when IndexedDB is unavailable (SSR / node / sandbox).
 */
export function createIndexedDbAttachmentStore(): AttachmentBytesStore {
  const idb: IDBFactory | undefined =
    typeof indexedDB !== "undefined" ? indexedDB : undefined;
  if (!idb) return createMemoryAttachmentStore();

  function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = idb!.open(IDB_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(IDB_STORE, mode);
      const req = run(transaction.objectStore(IDB_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    async put(key, image) {
      await tx("readwrite", (s) => s.put(image, key));
    },
    async get(key) {
      return (await tx<StoredImage | undefined>("readonly", (s) => s.get(key) as IDBRequest<StoredImage | undefined>)) ?? undefined;
    },
    async delete(key) {
      await tx("readwrite", (s) => s.delete(key));
    },
  };
}

// ─── base64 (cross-platform) ────────────────────────────────────────────────

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Encode raw bytes to base64 without relying on Buffer or btoa. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b2 & 63] : "=";
  }
  return out;
}

/** Read an image File into a transport-ready StoredImage (base64). */
export async function fileToStoredImage(file: File): Promise<StoredImage> {
  const buf = await file.arrayBuffer();
  return { mimeType: file.type || "application/octet-stream", data: bytesToBase64(new Uint8Array(buf)) };
}

// ─── GitHub URL detection ──────────────────────────────────────────────────────

export interface GitHubRef {
  kind: "github_issue" | "github_pr";
  owner: string;
  repo: string;
  number: number;
  url: string;
}

const GITHUB_URL_RE =
  /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/i;

/** Parse a single GitHub issue/PR URL. Returns null if it isn't one. */
export function parseGitHubUrl(url: string): GitHubRef | null {
  const m = GITHUB_URL_RE.exec(url.trim());
  if (!m) return null;
  const [, owner, repo, kindToken, num] = m;
  return {
    kind: kindToken!.toLowerCase() === "pull" ? "github_pr" : "github_issue",
    owner: owner!,
    repo: repo!,
    number: Number(num),
    url: m[0]!,
  };
}

/** Find all GitHub issue/PR references embedded in a block of text. */
export function detectGitHubUrlsInText(text: string): GitHubRef[] {
  const re = new RegExp(GITHUB_URL_RE.source, "gi");
  const refs: GitHubRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) {
    const ref = parseGitHubUrl(m[0]!);
    if (ref && !seen.has(ref.url)) {
      seen.add(ref.url);
      refs.push(ref);
    }
  }
  return refs;
}

/** Build a draft attachment from a resolved GitHub reference. */
export function gitHubRefToAttachment(ref: GitHubRef, title: string): DraftAttachmentMeta {
  return ref.kind === "github_pr"
    ? { kind: "github_pr", number: ref.number, title, url: ref.url }
    : { kind: "github_issue", number: ref.number, title, url: ref.url };
}

// ─── Paste / drop extraction ────────────────────────────────────────────────

/** Filter a FileList/File[] down to image files. */
export function extractImageFiles(files: ArrayLike<File> | undefined | null): File[] {
  if (!files) return [];
  return Array.from(files).filter((f) => f.type.startsWith("image/"));
}

/** Extract image files from a clipboard/data-transfer item list. */
export function extractImagesFromItems(
  items: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | undefined | null,
): File[] {
  if (!items) return [];
  const out: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) out.push(file);
    }
  }
  return out;
}

// ─── Pills ────────────────────────────────────────────────────────────────────

export type AttachmentPillKind = "image" | "github" | "workspace";

export function attachmentPillKind(att: DraftAttachmentMeta): AttachmentPillKind {
  switch (att.kind) {
    case "image":
      return "image";
    case "github_issue":
    case "github_pr":
      return "github";
    case "review":
    case "browser_element":
      return "workspace";
  }
}

export function attachmentLabel(att: DraftAttachmentMeta): string {
  switch (att.kind) {
    case "image":
      return att.name;
    case "github_issue":
    case "github_pr":
      return `#${att.number} ${att.title}`.trim();
    case "review":
      return att.label;
    case "browser_element":
      return att.label;
  }
}

/** Stable identity for an attachment (for react keys + removal). */
export function attachmentId(att: DraftAttachmentMeta, index: number): string {
  if (att.kind === "image") return att.storageKey;
  if (att.kind === "github_issue" || att.kind === "github_pr") return `gh:${att.kind}:${att.number}`;
  return `att:${index}`;
}

// ─── Lightbox ───────────────────────────────────────────────────────────────

export interface LightboxState {
  open: boolean;
  storageKey?: string;
  label?: string;
}

export const INITIAL_LIGHTBOX: LightboxState = { open: false };

export function openLightbox(storageKey: string, label?: string): LightboxState {
  return { open: true, storageKey, label };
}

export function closeLightbox(): LightboxState {
  return { open: false };
}

// ─── Send serialization ────────────────────────────────────────────────────────

export interface SendAttachmentsPayload {
  images: StoredImage[];
  attachments: { prs: unknown[]; issues: unknown[] };
}

/**
 * Serialize draft attachments into the message payload:
 * - `image` → `{ mimeType, data }` pulled from the resolved bytes map (missing
 *   bytes are skipped, never crash).
 * - `github_pr` / `github_issue` → `attachments.prs` / `attachments.issues`.
 * - `review` / `browser_element` → merged into `attachments` under their kind.
 */
export function buildSendAttachments(
  attachments: DraftAttachmentMeta[],
  resolvedImages: Record<string, StoredImage>,
): SendAttachmentsPayload {
  const images: StoredImage[] = [];
  const prs: unknown[] = [];
  const issues: unknown[] = [];

  for (const att of attachments) {
    switch (att.kind) {
      case "image": {
        const bytes = resolvedImages[att.storageKey];
        if (bytes) images.push(bytes);
        break;
      }
      case "github_pr":
        prs.push({ number: att.number, title: att.title, url: att.url });
        break;
      case "github_issue":
        issues.push({ number: att.number, title: att.title, url: att.url });
        break;
      case "review":
      case "browser_element":
        // Workspace attachments travel as opaque metadata; passthrough schema
        // tolerates them. Grouped under issues[] is arbitrary; kept minimal.
        break;
    }
  }

  return { images, attachments: { prs, issues } };
}
