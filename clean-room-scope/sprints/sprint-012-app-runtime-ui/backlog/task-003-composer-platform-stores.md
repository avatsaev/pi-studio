# Task 003 — Composer, platform gating, client stores

- **Sprint:** sprint-012-app-runtime-ui
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-002

## Goal
Implement the composer surface, the cross-platform gating rules, and the client-side draft/attachment
stores.

## Scope references
- `clean-room-scope/architecture/client-app-runtime.md` § Composer, § Platform gating, § Platform rules
- `clean-room-scope/architecture/persistence.md` § Client-side stores (app)

## What to build
- `Composer` (`composer/`): input, toolbar, tracks, attachments, drafts; submit creates/sends a
  prompt (optimistic UI-only message deduped later by provider message id).
- Platform gating utilities: `isWeb`, `isNative`, `getIsElectron()`, `useIsCompactFormFactor()`;
  prefer Metro file extensions (`.web`/`.native`/`.electron`) over big `if` blocks; never raw DOM
  without `isWeb`; never `onPointerEnter/Leave`; hover only on web (`isHovered || isNative || isCompact`).
- Draft store (AsyncStorage `pi-studio-drafts` v2): `{ drafts: Record<draftKey, { input:{text,images},
  lifecycle: active|abandoned|sent, updatedAt, version }>, createModalDraft }`.
- Web attachment bytes store (IndexedDB `pi-studio-attachment-bytes`, store `attachments`);
  `AttachmentMetadata` shape.

## Out of scope
- Subagents track + tab/archive client rules (task-004). Native packaging.

## Acceptance criteria
- [ ] Submitting the composer sends a prompt; the optimistic message is UI-only and later deduped by id.
- [ ] Drafts persist/restore via AsyncStorage v2 with lifecycle states.
- [ ] Web attachment bytes round-trip through IndexedDB keyed by attachment id.
- [ ] Hover-to-show controls are always visible on native and hover-gated on web.

## Test / verification plan
- Tests: `npx vitest run packages/app/.../drafts.test.ts`, `.../platform-gating.test.ts` — draft
  lifecycle, attachment store round-trip, gating helpers.

## Notes
- `useUnistyles()` is forbidden; use Unistyles theme tokens (see original docs/unistyles.md).
