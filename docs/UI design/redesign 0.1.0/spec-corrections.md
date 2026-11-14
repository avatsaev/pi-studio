# Spec corrections — Extension Dialogs Visual Spec.html

Filed during implementation of sprint-068-extension-ui-dialogs (task-009). These are documentation
defects found in the spec itself while building against it — not implementation choices, and not
requests to change the design. The HTML artifact was not edited (it's the designer's file); this is
a plain report for the designer to apply against it directly.

## 1. § 08's self-contradiction on the session-row tint

- § 08's own banner states: **"no row tint for needs-input (tints stay reserved for the failed
  state)"**.
- § 01's palette table lists `statusWarning · 12%` as **"callouts in this document only — not a
  session-row tint (see § 08)"**.
- But § 08's own **"Row fill"** entry, two paragraphs later in the same section, specifies: *"Left-
  edge accent bar, 2px, `statusWarning`, plus a faint `statusWarning` **10% wash** across the row —
  the same mechanism the active/selected row already uses..."* — a wash across the row **is** a row
  tint, and its opacity (10%) doesn't even match the 12% § 01 disclaims.

Three statements, two of which agree with each other and one of which directly contradicts both,
inside the same section. This needs resolving before sprint-069 implements the sidebar attention
signals — the correct answer (tint or no tint, and at what opacity if so) isn't recoverable from the
document as written.

## 2. § 01's palette table is missing values the document itself uses

The `SWATCH / TOKEN / USED FOR` table is presented as the complete token/opacity inventory for this
feature, but three values used elsewhere in the document aren't in it:

- The § 08 "Row fill" **10% wash** (see correction 1 above — whether or not the wash survives,
  either the value or its removal needs to be reflected here).
- The § 08 "Pulse" ring's **55%** opacity (*"grows to 4px in `statusWarning` 55% → transparent"*).
- **`--pi-color-accentBright`**, used repeatedly for the document's own section-number badges (e.g.
  the `12`/`13` heading numerals) — never listed as a design token anywhere in § 01.

An implementer building the token set from § 01 alone would miss all three.

## 3. Two wrong cross-references

Both point at unrelated sections; the content that actually belongs there is in § 12 ("Edge cases in
the payload") in both cases:

- § 02's "Control block" entry: *"flex row, 8px gap, `margin-top:10px`, `flex-wrap:wrap` with a 8px
  row-gap **(§ 09)**."* § 09 is "setWidget — pinned line blocks", unrelated to a select card's own
  control wrapping. The actual wrapping/stacking threshold rules live in § 12 (five-or-more-options
  stacking, past-six scrolling).
- § 03's select copy: *"Five or more options stack vertically as full-width buttons regardless of
  length **(§ 13)**."* § 13 is "Motion & interaction states" (animation/reduced-motion), not layout
  thresholds. Same fix: § 12.

## 4. § 00's wire table gives `editor` a `timeout?` field it can't have

The wire-payloads table lists `editor`'s fields as `title, prefill?, timeout?`. Pi's real `editor`
payload is `title` + `prefill` only — no `timeout` field exists on the wire for this method, making
it the one dialog kind with no deadline support. A deadline bar on an editor card is therefore
unreachable in practice; any implementation (including this sprint's) that tries to honor a
`timeout` on an editor payload is accommodating a field that will never arrive. This error
originated in the planning brief that fed the design, not in the visual design itself.

---

Implementation status: sprint-068's own `AskCard.tsx` sides with the *narrower* reading in every
case above — no row tint added anywhere in `web-client` (correction 1 is unresolved upstream, so
nothing was built against the disputed 10%/12% wash), `EDITOR_MAX_HEIGHT_PX`/deadline-bar code
explicitly has no `editor` case (`deadline.ts`'s own header notes editor has no timeout field), and
neither of the two mis-cited sections was followed for control-wrapping (task-005's `option-layout.ts`
was built directly against § 12's rules).
