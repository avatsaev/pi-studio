import { describe, expect, it } from "vitest";
import {
  EXTERNAL_DRAG_MIME,
  PATH_REF_MIME,
  composerDropProps,
  encodePathRef,
  externalDragKind,
  hasPathRef,
  isInComposerDrop,
  pathDragStartHandler,
  readExternalDrag,
  readPathRef,
  resolveExternalDropRegion,
  yieldsToComposer,
} from "./external-drag.js";
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

describe("path-ref drag", () => {
  it("never makes a pane see a folder drag, and leaves a file row as `path`", () => {
    expect(externalDragKind([MOVE_MIME, PATH_REF_MIME])).toBeNull();
    expect(externalDragKind([MOVE_MIME, EXTERNAL_DRAG_MIME.path, PATH_REF_MIME])).toBe("path");
  });

  it("is invisible to readExternalDrag", () => {
    const folder = transfer({ [MOVE_MIME]: "/r/d", [PATH_REF_MIME]: "/r/d/" });
    expect(readExternalDrag(folder.types, folder.read)).toBeNull();
  });

  it("round-trips a file and a folder through encode/read", () => {
    const file = transfer({ [PATH_REF_MIME]: encodePathRef("/r/a.ts", false) });
    expect(hasPathRef(file.types)).toBe(true);
    expect(readPathRef(file.types, file.read)).toBe("/r/a.ts");

    const folder = transfer({ [PATH_REF_MIME]: encodePathRef("/r/src", true) });
    expect(readPathRef(folder.types, folder.read)).toBe("/r/src/");
  });

  it("gives a folder exactly one trailing slash", () => {
    expect(encodePathRef("/r/src/", true)).toBe("/r/src/");
    expect(encodePathRef("/r/src//", true)).toBe("/r/src/");
  });

  it("is null when absent or blank", () => {
    expect(hasPathRef([MOVE_MIME])).toBe(false);
    expect(readPathRef([MOVE_MIME], () => "x")).toBeNull();
    const blank = transfer({ [PATH_REF_MIME]: "  \n" });
    expect(readPathRef(blank.types, blank.read)).toBeNull();
  });
});

describe("yieldsToComposer", () => {
  it("yields only for a path-ref drag inside a composer zone", () => {
    expect(yieldsToComposer([MOVE_MIME, EXTERNAL_DRAG_MIME.path, PATH_REF_MIME], true)).toBe(true);
    expect(yieldsToComposer([MOVE_MIME, PATH_REF_MIME], true)).toBe(true);
  });

  it("does not yield for a drag without a path-ref (chat row, timeline link)", () => {
    expect(yieldsToComposer([EXTERNAL_DRAG_MIME.chat], true)).toBe(false);
    expect(yieldsToComposer([EXTERNAL_DRAG_MIME.path], true)).toBe(false);
  });

  it("does not yield outside a composer zone", () => {
    expect(yieldsToComposer([MOVE_MIME, EXTERNAL_DRAG_MIME.path, PATH_REF_MIME], false)).toBe(
      false,
    );
  });
});

describe("composer drop zone marker", () => {
  it("is found by the same lookup that reads it back", () => {
    const [attr] = Object.keys(composerDropProps());
    const zone = { closest: (selector: string) => (selector === `[${attr}]` ? zone : null) };
    expect(isInComposerDrop(zone as unknown as EventTarget)).toBe(true);
    expect(isInComposerDrop({ closest: () => null } as unknown as EventTarget)).toBe(false);
    expect(isInComposerDrop(null)).toBe(false);
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

/** A `DataTransfer` stand-in that only needs `setData`/`effectAllowed`, matching
 * `pathDragStartHandler`'s minimal event shape. */
function fakeDataTransfer() {
  const written: Record<string, string> = {};
  return {
    written,
    dataTransfer: {
      setData: (mime: string, value: string) => {
        written[mime] = value;
      },
      effectAllowed: "none" as DataTransfer["effectAllowed"],
    },
  };
}

describe("pathDragStartHandler", () => {
  it("writes the path-kind payload and sets a copy/move effect (FileLink, InlineImage drag sources)", () => {
    const { written, dataTransfer } = fakeDataTransfer();
    pathDragStartHandler("/repo/notes.md")({ dataTransfer });
    expect(written).toEqual({ [EXTERNAL_DRAG_MIME.path]: "/repo/notes.md" });
    expect(dataTransfer.effectAllowed).toBe("copyMove");
  });

  it("is a fresh closure per path — two handlers for two paths never cross-write", () => {
    const a = fakeDataTransfer();
    const b = fakeDataTransfer();
    pathDragStartHandler("/repo/a.md")({ dataTransfer: a.dataTransfer });
    pathDragStartHandler("/repo/b.md")({ dataTransfer: b.dataTransfer });
    expect(a.written).toEqual({ [EXTERNAL_DRAG_MIME.path]: "/repo/a.md" });
    expect(b.written).toEqual({ [EXTERNAL_DRAG_MIME.path]: "/repo/b.md" });
  });
});
