# Task 002 — Attachments: images, GitHub issues/PRs, browser elements

- **Sprint:** sprint-025-composer-full
- **Status:** done
- **Estimated size:** L
- **Depends on:** task-001

## Goal
Build the full attachment system: image paste/drop/pick, GitHub issue/PR auto-attach from URL,
browser element capture, and the attachment pill UI with lightbox preview.

## Scope references
- `clean-room-scope/features/composer-ui.md` § attachments
- `clean-room-scope/features/feature-panels-ui.md` § browser element capture

## What to build
- **Image attachments**: handle paste (ClipboardEvent), drop (DragEvent), and file picker (input
  type=file). Store image bytes in IndexedDB (via KV store) with a generated storage key. Show
  thumbnail pill in composer; click → lightbox overlay with full image.
- **GitHub attachments**: detect GitHub issue/PR URLs pasted into composer; resolve metadata (number,
  title) via a lightweight fetch or from cached PR data; show as typed pill (issue icon + #number).
- **Browser element capture**: when BrowserPane captures an element (via inspector), auto-attach as
  `browser_element` pill with label; clicking shows the captured screenshot.
- **Review/PR context attach**: from the git panel, "Attach" button adds a review comment or failed
  check as a `review` pill.
- **Attachment lightbox**: modal overlay showing full-size image or captured element; Esc/click-away
  to dismiss.
- **Attachment removal**: X button on each pill; confirm for images (bytes deleted from KV).
- **Serialization**: on submit, attachments are serialized as metadata in the user message payload;
  image bytes sent as binary frame or base64 (per protocol spec).

## Acceptance criteria
- [ ] Paste/drop/pick images: shown as thumbnail pills; stored in IndexedDB; submitted with message.
- [ ] GitHub URLs auto-resolve to issue/PR pills.
- [ ] Browser element capture creates attachment pill.
- [ ] Lightbox shows full image on click; removal works with confirmation for images.

## Test / verification plan
- Image: simulate paste event → verify pill rendered + bytes in KV.
- GitHub: paste "https://github.com/org/repo/issues/123" → verify issue pill.
- Removal: remove image → verify KV entry deleted.
- Lightbox: click pill → verify overlay shown.
