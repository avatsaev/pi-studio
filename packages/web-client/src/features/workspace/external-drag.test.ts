import { describe, expect, it } from "vitest";
import {
  EXTERNAL_DRAG_MIME,
  externalDragKind,
  readExternalDrag,
  resolveExternalDropRegion,
} from "./external-drag.js";
import { containsPoint } from "./pane-dnd.js";
import type { PaneNode } from "./pane-tree.js";

/** The Files tree's row-move MIME — present on the same transfer as a file's open MIME. */
const MOVE_MIME = "application/x-pi-studio-path";
const BODY = { left: 100, top: 200, width: 400, height: 300 };

describe("externalDragKind", () => {
  it("recognises each kind by its own MIME", () => {
    expect(externalDragKind([EXTERNAL_DRAG_MIME.chat])).toBe("chat");
    expect(externalDragKind([EXTERNAL_DRAG_MIME.path])).toBe("path");
  });

  it("ignores drags a pane must not accept", () => {
    // An OS file drag, a text selection, and the tree's own row-move drag: a move is not an open, so
    // the move MIME alone must never make a pane a drop target.
    expect(externalDragKind(["Files"])).toBeNull();
    expect(externalDragKind(["text/plain", "text/uri-list"])).toBeNull();
    expect(externalDragKind([MOVE_MIME])).toBeNull();
    expect(externalDragKind([])).toBeNull();
  });

  it("reads a file row's transfer, which carries move and open together", () => {
    // One gesture, two meanings: the tree still sees its move payload, the pane sees an open.
    expect(externalDragKind([MOVE_MIME, EXTERNAL_DRAG_MIME.path])).toBe("path");
  });
});

/** A `DataTransfer` stand-in: `types` lists what it holds, `read` mirrors `getData`'s "" for a miss. */
const transfer = (entries: Record<string, string>) => ({
  types: Object.keys(entries),
  read: (mime: string) => entries[mime] ?? "",
});

describe("readExternalDrag", () => {
  it("decodes the payload for the kind its types advertise", () => {
    const chat = transfer({ [EXTERNAL_DRAG_MIME.chat]: "s-1" });
    expect(readExternalDrag(chat.types, chat.read)).toEqual({ kind: "chat", value: "s-1" });

    const file = transfer({ [MOVE_MIME]: "/w/a.ts", [EXTERNAL_DRAG_MIME.path]: "/w/a.ts" });
    expect(readExternalDrag(file.types, file.read)).toEqual({ kind: "path", value: "/w/a.ts" });
  });

  it("treats a recognised drag with no usable value as no payload", () => {
    // `getData` answers "" for a type it does not hold, and a blank id/path is not actionable.
    const blank = transfer({ [EXTERNAL_DRAG_MIME.chat]: "   " });
    expect(readExternalDrag(blank.types, blank.read)).toBeNull();
    expect(readExternalDrag([EXTERNAL_DRAG_MIME.path], () => "")).toBeNull();
  });

  it("is null for a drag that is not ours", () => {
    const os = transfer({ "text/plain": "hello" });
    expect(readExternalDrag(os.types, os.read)).toBeNull();
  });
});

describe("resolveExternalDropRegion", () => {
  const leaf: PaneNode = { kind: "leaf", id: "P0" };

  it("reads the same regions an internal drag would", () => {
    const centre = { x: 300, y: 350 };
    expect(resolveExternalDropRegion(leaf, "P0", centre, BODY)).toBe("center");
    expect(resolveExternalDropRegion(leaf, "P0", { x: 110, y: 350 }, BODY)).toBe("left");
    expect(resolveExternalDropRegion(leaf, "P0", { x: 490, y: 350 }, BODY)).toBe("right");
    expect(resolveExternalDropRegion(leaf, "P0", { x: 300, y: 210 }, BODY)).toBe("top");
    expect(resolveExternalDropRegion(leaf, "P0", { x: 300, y: 490 }, BODY)).toBe("bottom");
  });

  it("degrades only the illegal edge, so the preview is always the outcome", () => {
    // `D` sits at MAX_PANE_DEPTH inside a row. A left/right drop is a *sibling insert* into that row
    // — depth unchanged, always legal — while top/bottom would have to nest one level deeper and is
    // refused. Both branches must be resolved here, once, not re-derived by each caller.
    const deep: PaneNode = {
      kind: "split",
      direction: "row",
      children: [
        { kind: "leaf", id: "A" },
        {
          kind: "split",
          direction: "column",
          children: [
            { kind: "leaf", id: "B" },
            {
              kind: "split",
              direction: "row",
              children: [
                { kind: "leaf", id: "C" },
                { kind: "leaf", id: "D" },
              ],
              sizes: [0.5, 0.5],
            },
          ],
          sizes: [0.5, 0.5],
        },
      ],
      sizes: [0.5, 0.5],
    };
    expect(resolveExternalDropRegion(deep, "D", { x: 110, y: 350 }, BODY)).toBe("left");
    expect(resolveExternalDropRegion(deep, "D", { x: 300, y: 490 }, BODY)).toBe("center");
  });
});

describe("containsPoint", () => {
  it("includes the edges and excludes anything outside", () => {
    expect(containsPoint(BODY, { x: 100, y: 200 })).toBe(true);
    expect(containsPoint(BODY, { x: 500, y: 500 })).toBe(true);
    expect(containsPoint(BODY, { x: 99, y: 350 })).toBe(false);
    expect(containsPoint(BODY, { x: 300, y: 501 })).toBe(false);
  });

  it("rejects every point of a zero-size box", () => {
    // A pane mid-layout measures 0×0; it must not swallow the drop.
    expect(containsPoint({ left: 10, top: 10, width: 0, height: 0 }, { x: 10, y: 10 })).toBe(true);
    expect(containsPoint({ left: 10, top: 10, width: 0, height: 0 }, { x: 11, y: 10 })).toBe(false);
  });
});
