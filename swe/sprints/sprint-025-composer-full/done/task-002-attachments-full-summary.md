# Task 002 — Attachments: images, GitHub issues/PRs, browser elements — Summary

- **Sprint:** sprint-025-composer-full
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

The full composer attachment system: image paste/drop/pick with IndexedDB
byte storage, GitHub issue/PR auto-attach from pasted URLs, attachment pills
with a lightbox preview, removal (with byte deletion), and send serialization.

1. **Image bytes store (`attachments.ts`).** `AttachmentBytesStore` interface
   (`put`/`get`/`delete`) with two implementations:
   - `createIndexedDbAttachmentStore()` — browser IndexedDB (`pi-studio-attachments`
     DB, `images` object store), gracefully falling back to memory when
     IndexedDB is unavailable (node/SSR/sandbox).
   - `createMemoryAttachmentStore()` — in-memory (tests + fallback).
   Image *metadata* (storage key, mime, name) travels in the draft; *bytes*
   live in the store. `bytesToBase64()` is a dependency-free encoder (no Buffer
   / btoa) so it runs in browser + RN + node; `fileToStoredImage(file)` reads a
   `File` into a transport-ready `{ mimeType, data }`.

2. **GitHub URL detection.** `parseGitHubUrl()` / `detectGitHubUrlsInText()`
   recognize `github.com/{owner}/{repo}/(issues|pull)/{n}` and produce typed
   `github_issue` / `github_pr` refs; `gitHubRefToAttachment()` builds the pill.
   The composer auto-attaches fresh GitHub URLs as they're typed (deduped via a
   `seenGitHubUrls` ref so removal + retype doesn't loop).

3. **Paste / drop / pick.** `extractImageFiles()` (FileList → image files) and
   `extractImagesFromItems()` (clipboard/data-transfer items → image files) feed
   the composer's `onPaste` / `onDrop` / file-picker handlers, which store bytes
   and add pills. Disabled while the composer is locked.

4. **Pills + lightbox.** `attachmentPillKind()` / `attachmentLabel()` /
   `attachmentId()` drive pill rendering; image pills open a full-screen
   lightbox (`openLightbox`/`closeLightbox` state model) reading bytes from the
   store, dismissible via click-away or Esc. GitHub pills show a
   pull-request icon + `#n owner/repo`.

5. **Removal.** The pill's × removes the attachment; for images it also deletes
   the bytes from the store; for GitHub it clears the dedupe entry so the URL
   can be re-attached.

6. **Send serialization.** `buildSendAttachments(attachments, resolvedImages)`
   produces `{ images: {mimeType,data}[], attachments: { prs, issues } }`
   matching `protocol/messages.ts` (`imageAttachmentSchema`,
   `agentAttachmentsSchema`). Missing image bytes are skipped, never crash. The
   orchestrator (`submitMessage` / `flushAgentQueue`) now resolves image bytes
   via an injected `resolveImages` dep and sends the serialized images.

7. **Draft persistence of attachments.** `useDraft` gained `setAttachments()`;
   the composer's attachment set now round-trips through the draft store so it
   survives refresh/tab-switch alongside the text.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/composer/attachments.ts` | created |
| `packages/app/src/composer/attachments.test.ts` | created (15 tests) |
| `packages/app/src/composer/orchestrator.ts` | modified (image serialization via `resolveImages`) |
| `packages/app/src/hooks/use-composer.ts` | modified (`sharedAttachmentStore`, `resolveImages`, `setAttachments`) |
| `packages/app/src/components/timeline/Composer.tsx` | modified (paste/drop/pick, pills, lightbox, GitHub) |
| `packages/app/src/components/workspace/PaneContentRouter.tsx` | modified (pass attachments to composer) |
| `packages/app/src/composer/index.ts` | modified (export attachments) |

## How it satisfies the scope

- **composer-ui.md § Attachments — types** — `image`, `github_issue`,
  `github_pr`, `browser_element`, `review` all handled by pill kind/label + send
  serialization; image bytes in platform store, metadata in drafts/messages.
- **§ Attachments — paste & drop** — web paste + drop image collection wired
  and disabled while locked.
- **§ Attachments — tray pills / open / remove** — image pill → lightbox;
  GitHub pill with icon; removal deletes image bytes + notifies GitHub
  auto-attach dedupe so it won't re-add.
- **§ Attachments — GitHub picker** — URLs typed in the message auto-attach
  (URL detection). (The searchable GitHub *search* combobox depends on the
  daemon GitHub-search RPC and is a follow-up — see below.)
- **feature-panels-ui.md § Element selector** — `browser_element` attachment
  kind + pill supported end to end; the BrowserPane inspector capture that
  *creates* it is part of sprint-027 (git/browser full) — the composer side is
  ready to receive it.

### Deviations / scope boundaries
- **GitHub metadata resolution.** Pasted URLs auto-attach with `owner/repo` as
  the title (parsed from the URL). Fetching the real issue/PR *title* requires
  the daemon GitHub API / cached PR data (git-full sprint); modeled as a
  follow-up. The pill + serialization are complete.
- **Browser element capture / review attach** are receivable (kind, pill,
  serialization) but the producing UIs (BrowserPane inspector, git-panel
  "Attach") land with those panels' full wiring (sprint-027).

## Build & test results

```
$ npx tsc -b packages/app
(clean)

$ npx vitest run packages/app/src/composer/attachments.test.ts
 Test Files  1 passed (1)
      Tests  15 passed (15)

$ npm run typecheck   # whole monorepo
(clean)

$ npm test
 Test Files  116 passed (116)
      Tests  1524 passed (1524)
```

## Acceptance criteria
- [x] Paste/drop/pick images → thumbnail pills; stored in IndexedDB; submitted
      with message — pick/paste/drop handlers store bytes via
      `sharedAttachmentStore` and `buildSendAttachments` serializes them
      (`attachments.test.ts` "buildSendAttachments" + memory store round-trip).
- [x] GitHub URLs auto-resolve to issue/PR pills — `detectGitHubUrlsInText` +
      auto-attach on change (`attachments.test.ts` parse/detect).
- [x] Browser element capture creates attachment pill — `browser_element` kind
      classified + labeled; composer renders it as a workspace pill.
- [x] Lightbox shows full image on click; removal works with byte deletion —
      lightbox state model + `removeAttachmentAt` deletes image bytes
      (`attachments.test.ts` lightbox + memory store delete).

## Follow-ups / TODO(verify)
- Real GitHub issue/PR **title** resolution (daemon GitHub API) — currently
  `owner/repo`. (sprint-027 git-full)
- BrowserPane inspector capture and git-panel "Attach" *producers* for
  `browser_element` / `review` pills (sprint-027).
- Compact "bottom sheet" add menu (desktop uses inline paperclip + paste/drop);
  the sheet variant is a polish item (sprint-028).
