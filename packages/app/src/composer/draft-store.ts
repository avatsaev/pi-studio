// Composer draft store.
// clean-room-scope/features/composer-ui.md § Data & Persistence

import type { LayoutStorage } from "../workspace/layout-store.js";

export type DraftAttachmentMeta =
  | { kind: "image"; storageKey: string; mimeType: string; name: string }
  | { kind: "github_issue"; number: number; title: string; url: string }
  | { kind: "github_pr"; number: number; title: string; url: string }
  | { kind: "review"; label: string; url?: string }
  | { kind: "browser_element"; label: string };

export type DraftLifecycle = "active" | "abandoned" | "sent";

export type ComposerDraft = {
  key: string;
  text: string;
  attachments: DraftAttachmentMeta[];
  lifecycle: DraftLifecycle;
};

export const DRAFTS_STORE_KEY = "pi-studio-drafts-v2";

export function draftStoreKey(draftKey: string): string {
  return `${DRAFTS_STORE_KEY}:${draftKey}`;
}

export class DraftStore {
  constructor(private readonly storage: LayoutStorage) {}

  load(draftKey: string): ComposerDraft {
    const raw = this.storage.getItem(draftStoreKey(draftKey));
    if (!raw) return { key: draftKey, text: "", attachments: [], lifecycle: "active" };
    try {
      return JSON.parse(raw) as ComposerDraft;
    } catch {
      return { key: draftKey, text: "", attachments: [], lifecycle: "active" };
    }
  }

  save(draft: ComposerDraft): void {
    if (draft.lifecycle === "active" && !draft.text && draft.attachments.length === 0) {
      this.storage.setItem(draftStoreKey(draft.key), "");
    } else {
      this.storage.setItem(draftStoreKey(draft.key), JSON.stringify(draft));
    }
  }

  setText(draftKey: string, text: string): ComposerDraft {
    const draft = { ...this.load(draftKey), text };
    this.save(draft);
    return draft;
  }

  addAttachment(draftKey: string, attachment: DraftAttachmentMeta): ComposerDraft {
    const draft = this.load(draftKey);
    const updated = { ...draft, attachments: [...draft.attachments, attachment] };
    this.save(updated);
    return updated;
  }

  removeAttachment(draftKey: string, index: number): ComposerDraft {
    const draft = this.load(draftKey);
    const updated = { ...draft, attachments: draft.attachments.filter((_, i) => i !== index) };
    this.save(updated);
    return updated;
  }

  markSent(draftKey: string): void {
    const draft = { ...this.load(draftKey), lifecycle: "sent" as const, text: "", attachments: [] };
    this.save(draft);
  }

  markAbandoned(draftKey: string): void {
    const draft = { ...this.load(draftKey), lifecycle: "abandoned" as const };
    this.save(draft);
  }

  restore(draftKey: string, text: string): ComposerDraft {
    const draft = { ...this.load(draftKey), text, lifecycle: "active" as const };
    this.save(draft);
    return draft;
  }
}
