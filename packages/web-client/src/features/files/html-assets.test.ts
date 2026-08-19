import { describe, expect, it } from "vitest";
import {
  ASSET_LIMITS,
  confineAssetRef,
  confinementRoot,
  dataUri,
  extractCssUrlRefs,
  extractLocalAssetRefs,
  mimeForAssetPath,
  rewriteCssUrls,
  rewriteHtmlAssetRefs,
  withinAssetCaps,
} from "./html-assets.js";

const ROOT = "/ws";
const DOC_DIR = "/ws/reports";

describe("extractLocalAssetRefs", () => {
  it("finds every scanned context in a realistic fixture document", () => {
    const source = `
      <html><head>
        <link rel="stylesheet" href="style.css">
        <script src="app.js"></script>
      </head><body>
        <img src="logo.png" alt="logo">
        <img srcset="logo.png 1x, logo@2x.png 2x">
        <picture><source src="hero.avif" srcset="hero.avif, hero@2x.avif 2x"></picture>
        <video src="clip.mp4" poster="poster.png"></video>
        <audio src="beep.mp3"></audio>
      </body></html>
    `;
    const refs = extractLocalAssetRefs(source);
    const raws = refs.map((r) => r.raw).toSorted();
    expect(raws).toEqual(
      [
        "style.css",
        "app.js",
        "logo.png",
        "logo@2x.png",
        "hero.avif",
        "hero@2x.avif",
        "clip.mp4",
        "poster.png",
        "beep.mp3",
      ].toSorted(),
    );
    expect(refs.find((r) => r.raw === "style.css")?.context).toBe("style");
    expect(refs.find((r) => r.raw === "app.js")?.context).toBe("script");
    expect(refs.find((r) => r.raw === "logo.png")?.context).toBe("image");
    expect(refs.find((r) => r.raw === "hero.avif")?.context).toBe("media");
    expect(refs.find((r) => r.raw === "clip.mp4")?.context).toBe("media");
    expect(refs.find((r) => r.raw === "poster.png")?.context).toBe("media");
    expect(refs.find((r) => r.raw === "beep.mp3")?.context).toBe("media");
  });

  it("does not false-positive on text content, data:, mailto:, or scheme: refs", () => {
    const source = `
      <p>see logo.png for details</p>
      <img src="data:image/png;base64,AAAA">
      <a href="mailto:foo@bar.com">mail</a>
      <script src="https://cdn.example.com/lib.js"></script>
      <img src="//other.example.com/x.png">
      <img src="#nothing">
      <img src="">
    `;
    expect(extractLocalAssetRefs(source)).toEqual([]);
  });

  it("ignores a <link> without rel=stylesheet", () => {
    const source = '<link rel="preload" as="font" href="font.woff2">';
    expect(extractLocalAssetRefs(source)).toEqual([]);
  });

  it("recognizes rel containing stylesheet among other tokens, case-insensitively", () => {
    const source = '<link rel="ICON StyleSheet" href="style.css">';
    expect(extractLocalAssetRefs(source)).toEqual([{ raw: "style.css", context: "style" }]);
  });

  it("handles uppercase tags and attributes", () => {
    const source = '<IMG SRC="logo.png">';
    expect(extractLocalAssetRefs(source)).toEqual([{ raw: "logo.png", context: "image" }]);
  });

  it("handles attribute order variations", () => {
    const source = '<link href="style.css" rel="stylesheet">';
    expect(extractLocalAssetRefs(source)).toEqual([{ raw: "style.css", context: "style" }]);
  });

  it("handles single-quoted and unquoted attribute values", () => {
    expect(extractLocalAssetRefs("<img src='logo.png'>")).toEqual([
      { raw: "logo.png", context: "image" },
    ]);
    expect(extractLocalAssetRefs("<img src=logo.png>")).toEqual([
      { raw: "logo.png", context: "image" },
    ]);
  });

  it("de-duplicates a ref referenced from two attributes, first context wins", () => {
    const source = '<img src="logo.png"><img srcset="logo.png 1x">';
    const refs = extractLocalAssetRefs(source);
    expect(refs.filter((r) => r.raw === "logo.png")).toHaveLength(1);
  });

  it("matches an entity-bearing ref as authored, without decoding", () => {
    const source = '<img src="a&amp;b.png">';
    expect(extractLocalAssetRefs(source)).toEqual([{ raw: "a&amp;b.png", context: "image" }]);
  });
});

describe("confinementRoot", () => {
  it("narrows to docDir when the workspace root is the home directory", () => {
    expect(confinementRoot("/home/user/reports", "/home/user", "/home/user")).toBe(
      "/home/user/reports",
    );
  });

  it("passes the workspace root through otherwise", () => {
    expect(confinementRoot("/ws/reports", "/ws", "/home/user")).toBe("/ws");
  });

  it("passes the workspace root through when homeDir is unknown", () => {
    expect(confinementRoot("/ws/reports", "/ws", null)).toBe("/ws");
  });
});

describe("confineAssetRef", () => {
  it("accepts an in-root relative ref", () => {
    expect(confineAssetRef("style.css", DOC_DIR, ROOT, "style")).toEqual({
      kind: "local",
      raw: "style.css",
      path: "/ws/reports/style.css",
      context: "style",
    });
  });

  it("accepts a nested relative ref", () => {
    expect(confineAssetRef("img/logo.png", DOC_DIR, ROOT, "image")).toEqual({
      kind: "local",
      raw: "img/logo.png",
      path: "/ws/reports/img/logo.png",
      context: "image",
    });
  });

  it("accepts an absolute in-workspace path", () => {
    expect(confineAssetRef("/ws/other/logo.png", DOC_DIR, ROOT, "image")).toEqual({
      kind: "local",
      raw: "/ws/other/logo.png",
      path: "/ws/other/logo.png",
      context: "image",
    });
  });

  it("rejects an absolute out-of-workspace path", () => {
    expect(confineAssetRef("/etc/passwd", DOC_DIR, ROOT, "image")).toEqual({
      kind: "skip",
      raw: "/etc/passwd",
      reason: "outside-workspace",
    });
  });

  it("rejects a plain .. traversal", () => {
    expect(confineAssetRef("../../../.ssh/id_rsa", DOC_DIR, ROOT, "image")).toEqual({
      kind: "skip",
      raw: "../../../.ssh/id_rsa",
      reason: "outside-workspace",
    });
  });

  it("rejects the percent-encoded .. spelling (%2e%2e%2f)", () => {
    const raw = "%2e%2e%2f%2e%2e%2f%2e%2e%2f.ssh/id_rsa";
    expect(confineAssetRef(raw, DOC_DIR, ROOT, "image")).toEqual({
      kind: "skip",
      raw,
      reason: "outside-workspace",
    });
  });

  it("rejects %2F-encoded separators used to smuggle a traversal", () => {
    const raw = "foo%2F..%2F..%2F..%2Fetc%2Fpasswd";
    expect(confineAssetRef(raw, DOC_DIR, ROOT, "image")).toEqual({
      kind: "skip",
      raw,
      reason: "outside-workspace",
    });
  });

  it("rejects a sibling directory sharing the root as a bare string prefix", () => {
    expect(confineAssetRef("/ws-evil/logo.png", DOC_DIR, ROOT, "image")).toEqual({
      kind: "skip",
      raw: "/ws-evil/logo.png",
      reason: "outside-workspace",
    });
  });

  it("accepts the root itself as a boundary (path === root)", () => {
    expect(confineAssetRef("/ws", DOC_DIR, ROOT, "image")).toEqual({
      kind: "local",
      raw: "/ws",
      path: "/ws",
      context: "image",
    });
  });

  it("expands and accepts a ~-prefixed ref that resolves under the root", () => {
    expect(
      confineAssetRef("~/reports/logo.png", DOC_DIR, "/home/user", "image", "/home/user"),
    ).toEqual({
      kind: "local",
      raw: "~/reports/logo.png",
      path: "/home/user/reports/logo.png",
      context: "image",
    });
  });

  it("skips a ~-prefixed ref as unsupported when homeDir is unavailable", () => {
    expect(confineAssetRef("~/logo.png", DOC_DIR, ROOT, "image")).toEqual({
      kind: "skip",
      raw: "~/logo.png",
      reason: "unsupported",
    });
  });

  it.each([
    ["data:image/png;base64,AAAA", "external"],
    ["mailto:foo@bar.com", "external"],
    ["https://cdn.example.com/x.js", "external"],
    ["//other.example.com/x.png", "external"],
    ["#fragment", "unsupported"],
    ["", "unsupported"],
    ["   ", "unsupported"],
  ] as const)("classifies %s as skip:%s", (raw, reason) => {
    expect(confineAssetRef(raw, DOC_DIR, ROOT, "image")).toEqual({ kind: "skip", raw, reason });
  });

  it("matches an entity-bearing ref as authored — no entity decoding in the confinement path", () => {
    expect(confineAssetRef("a&amp;b.png", DOC_DIR, ROOT, "image")).toEqual({
      kind: "local",
      raw: "a&amp;b.png",
      path: "/ws/reports/a&amp;b.png",
      context: "image",
    });
  });
});

describe("cap arithmetic", () => {
  it("expresses caps once in ASSET_LIMITS", () => {
    expect(ASSET_LIMITS).toEqual({
      maxCount: 64,
      maxBytesPerAsset: 2 * 1024 * 1024,
      maxBytesTotal: 16 * 1024 * 1024,
    });
  });

  it("rejects once maxCount is reached", () => {
    expect(withinAssetCaps(64, 0, 1)).toBe(false);
    expect(withinAssetCaps(63, 0, 1)).toBe(true);
  });

  it("rejects a single asset over the per-asset cap", () => {
    expect(withinAssetCaps(0, 0, ASSET_LIMITS.maxBytesPerAsset + 1)).toBe(false);
    expect(withinAssetCaps(0, 0, ASSET_LIMITS.maxBytesPerAsset)).toBe(true);
  });

  it("rejects an asset that would push the running total over the total cap", () => {
    const almostFull = ASSET_LIMITS.maxBytesTotal - 100;
    expect(withinAssetCaps(1, almostFull, 101)).toBe(false);
    expect(withinAssetCaps(1, almostFull, 100)).toBe(true);
  });
});

describe("mimeForAssetPath", () => {
  it.each([
    ["style.css", "text/css"],
    ["app.js", "text/javascript"],
    ["logo.png", "image/png"],
    ["photo.JPG", "image/jpeg"],
    ["icon.svg", "image/svg+xml"],
    ["font.woff2", "font/woff2"],
    ["clip.mp4", "video/mp4"],
    ["beep.mp3", "audio/mpeg"],
    ["noext", "application/octet-stream"],
    ["dir.with.dots/noext", "application/octet-stream"],
  ] as const)("%s -> %s", (path, mime) => {
    expect(mimeForAssetPath(path)).toBe(mime);
  });
});

describe("dataUri", () => {
  it("builds a base64 data: URI", () => {
    const bytes = new TextEncoder().encode("hi");
    expect(dataUri("text/plain", bytes)).toBe("data:text/plain;base64,aGk=");
  });

  it("round-trips a large payload through chunked base64 encoding", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    const uri = dataUri("application/octet-stream", bytes);
    const b64 = uri.slice(uri.indexOf(",") + 1);
    const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});

describe("rewriteHtmlAssetRefs", () => {
  it("substitutes a single-value attribute in a scanned context", () => {
    const source = '<img src="logo.png">';
    const out = rewriteHtmlAssetRefs(source, { "logo.png": "data:image/png;base64,AAAA" });
    expect(out).toBe('<img src="data:image/png;base64,AAAA">');
  });

  it("does not touch an unscanned attribute even when its value matches a key", () => {
    const source = '<img src="logo.png" alt="logo.png">';
    const out = rewriteHtmlAssetRefs(source, { "logo.png": "data:image/png;base64,AAAA" });
    expect(out).toBe('<img src="data:image/png;base64,AAAA" alt="logo.png">');
  });

  it("does not touch document text that happens to match a ref", () => {
    const source = "<p>see logo.png for details</p>";
    expect(rewriteHtmlAssetRefs(source, { "logo.png": "data:x" })).toBe(source);
  });

  it("does not touch an attribute on a tag it does not scan (e.g. <a href>)", () => {
    const source = '<a href="logo.png">link</a>';
    expect(rewriteHtmlAssetRefs(source, { "logo.png": "data:x" })).toBe(source);
  });

  it("ignores a <link> without rel=stylesheet", () => {
    const source = '<link rel="preload" href="style.css">';
    expect(rewriteHtmlAssetRefs(source, { "style.css": "data:x" })).toBe(source);
  });

  it("is a no-op when assets is empty", () => {
    const source = '<img src="logo.png">';
    expect(rewriteHtmlAssetRefs(source, {})).toBe(source);
  });

  it("preserves original tag/attribute name casing and upgrades unquoted values to quoted", () => {
    const source = "<IMG SRC=logo.png>";
    const out = rewriteHtmlAssetRefs(source, { "logo.png": "data:image/png;base64,AAAA" });
    expect(out).toBe('<IMG SRC="data:image/png;base64,AAAA">');
  });

  it("rewrites a srcset round-trip, preserving descriptors and the data: URI's own comma", () => {
    const source = '<img srcset="logo.png 2x, logo@3x.png 3x">';
    const out = rewriteHtmlAssetRefs(source, {
      "logo.png": "data:image/png;base64,AAAA",
      "logo@3x.png": "data:image/png;base64,BBBB",
    });
    expect(out).toBe('<img srcset="data:image/png;base64,AAAA 2x, data:image/png;base64,BBBB 3x">');
  });

  it("rewrites only the matched entries of a partially-resolved srcset", () => {
    const source = '<img srcset="logo.png 1x, remote.png 2x">';
    const out = rewriteHtmlAssetRefs(source, { "logo.png": "data:image/png;base64,AAAA" });
    expect(out).toBe('<img srcset="data:image/png;base64,AAAA 1x, remote.png 2x">');
  });
});

describe("extractCssUrlRefs", () => {
  it("finds quoted and unquoted url() refs", () => {
    const css = `
      body { background: url("bg.png"); }
      .x { background: url('bg2.png'); }
      .y { background: url(bg3.png); }
    `;
    const refs = extractCssUrlRefs(css);
    expect(refs.map((r) => r.raw).toSorted()).toEqual(["bg.png", "bg2.png", "bg3.png"]);
  });

  it("labels a url() inside @font-face as font, and others as image", () => {
    const css = `
      @font-face { font-family: "X"; src: url("font.woff2") format("woff2"); }
      body { background: url("bg.png"); }
    `;
    const refs = extractCssUrlRefs(css);
    expect(refs.find((r) => r.raw === "font.woff2")?.context).toBe("font");
    expect(refs.find((r) => r.raw === "bg.png")?.context).toBe("image");
  });

  it("excludes a data:/remote url()", () => {
    const css = 'body { background: url("data:image/png;base64,AAAA"); }';
    expect(extractCssUrlRefs(css)).toEqual([]);
  });
});

describe("rewriteCssUrls", () => {
  it("substitutes a quoted url()", () => {
    const css = 'body { background: url("bg.png"); }';
    expect(rewriteCssUrls(css, { "bg.png": "data:image/png;base64,AAAA" })).toBe(
      'body { background: url("data:image/png;base64,AAAA"); }',
    );
  });

  it("substitutes an unquoted url()", () => {
    const css = "body { background: url(bg.png); }";
    expect(rewriteCssUrls(css, { "bg.png": "data:image/png;base64,AAAA" })).toBe(
      'body { background: url("data:image/png;base64,AAAA"); }',
    );
  });

  it("leaves an unmatched url() untouched", () => {
    const css = 'body { background: url("other.png"); }';
    expect(rewriteCssUrls(css, { "bg.png": "data:x" })).toBe(css);
  });

  it("is a no-op when assets is empty", () => {
    const css = 'body { background: url("bg.png"); }';
    expect(rewriteCssUrls(css, {})).toBe(css);
  });
});
