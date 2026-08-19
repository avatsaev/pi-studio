import { describe, expect, it } from "vitest";
import {
  HTML_SANDBOX_TOKENS,
  HTML_PREVIEW_BLOCKING_CSP,
  PREVIEW_BASE_HREF,
  assembleHtmlPreview,
} from "./html-sandbox.js";

describe("HTML_SANDBOX_TOKENS", () => {
  it("contains allow-scripts", () => {
    expect(HTML_SANDBOX_TOKENS).toContain("allow-scripts");
  });

  it("never contains allow-same-origin, allow-top-navigation*, or allow-popups", () => {
    const forbidden = [
      "allow-same-origin",
      "allow-top-navigation",
      "allow-top-navigation-by-user-activation",
      "allow-top-navigation-to-custom-protocols",
      "allow-popups",
    ];
    for (const token of forbidden) {
      expect(HTML_SANDBOX_TOKENS).not.toContain(token);
    }
    // Belt-and-braces: no token in the frozen list may even start with these prefixes, in case a
    // future token variant (e.g. a new "allow-top-navigation-*" the spec adds later) is missed by
    // the exact-match list above.
    for (const token of HTML_SANDBOX_TOKENS) {
      expect(token.startsWith("allow-top-navigation")).toBe(false);
      expect(token).not.toBe("allow-same-origin");
      expect(token).not.toBe("allow-popups");
    }
  });
});

describe("HTML_PREVIEW_BLOCKING_CSP", () => {
  it("carries data: for every inlined-asset channel", () => {
    for (const directive of ["img-src", "style-src", "script-src", "font-src", "media-src"]) {
      const re = new RegExp(`${directive}[^;]*\\bdata:`);
      expect(HTML_PREVIEW_BLOCKING_CSP).toMatch(re);
    }
  });

  it("defaults to deny", () => {
    expect(HTML_PREVIEW_BLOCKING_CSP).toContain("default-src 'none'");
  });
});

describe("assembleHtmlPreview — CSP injection", () => {
  it("injects the blocking CSP as the first <head> child when blockRemote is true", () => {
    const out = assembleHtmlPreview("<html><head><title>x</title></head><body></body></html>", {
      blockRemote: true,
    });
    const headStart = out.indexOf("<head>") + "<head>".length;
    expect(out.slice(headStart, headStart + 6)).toBe("<meta ");
    expect(out).toContain(HTML_PREVIEW_BLOCKING_CSP);
  });

  it("injects nothing CSP-related when blockRemote is false", () => {
    const out = assembleHtmlPreview("<html><head></head><body></body></html>", {
      blockRemote: false,
    });
    expect(out).not.toContain("Content-Security-Policy");
  });
});

describe("assembleHtmlPreview — base injection", () => {
  it("injects the .invalid base when the source declares none", () => {
    const out = assembleHtmlPreview("<html><head></head><body></body></html>", {
      blockRemote: false,
    });
    expect(out).toContain(`<base href="${PREVIEW_BASE_HREF}">`);
  });

  it("leaves a document declaring its own <base> untouched (no second base injected)", () => {
    const source = '<html><head><base href="https://example.com/"></head><body></body></html>';
    const out = assembleHtmlPreview(source, { blockRemote: false });
    expect(out).toBe(source);
  });

  it("recognizes a self-closing <base/> as already declared", () => {
    const source = '<html><head><base href="https://example.com/"/></head><body></body></html>';
    const out = assembleHtmlPreview(source, { blockRemote: false });
    expect(out).toBe(source);
  });

  it("injects the fragment-anchor click interceptor alongside an injected base", () => {
    const out = assembleHtmlPreview("<html><head></head><body></body></html>", {
      blockRemote: false,
    });
    expect(out).toContain('addEventListener("click"');
    expect(out).toContain("scrollIntoView");
  });

  it("does not inject the fragment-anchor script when the document already declares a base", () => {
    const source = '<html><head><base href="https://example.com/"></head><body></body></html>';
    const out = assembleHtmlPreview(source, { blockRemote: false });
    expect(out).not.toContain("scrollIntoView");
  });
});

describe("assembleHtmlPreview — <head> detection", () => {
  it("finds a <head> with attributes", () => {
    const out = assembleHtmlPreview('<html><head lang="en"></head><body></body></html>', {
      blockRemote: false,
    });
    expect(out).toContain('<head lang="en"><base');
  });

  it("finds an uppercase <HEAD> and injects into it rather than synthesizing a second one", () => {
    const out = assembleHtmlPreview("<HTML><HEAD></HEAD><BODY></BODY></HTML>", {
      blockRemote: false,
    });
    expect(out).toContain(`<HEAD><base href="${PREVIEW_BASE_HREF}">`);
    expect(out.match(/<base/g)?.length).toBe(1);
  });

  it("synthesizes a <head> right after <html> when the document has none", () => {
    const out = assembleHtmlPreview("<html><body>hi</body></html>", { blockRemote: false });
    expect(out).toContain(`<html><head><base href="${PREVIEW_BASE_HREF}">`);
    expect(out).toContain("</head><body>hi</body></html>");
  });

  it("prepends a synthesized <head> when the document has neither <head> nor <html>", () => {
    const out = assembleHtmlPreview("<body>hi</body>", { blockRemote: false });
    expect(out.startsWith(`<head><base href="${PREVIEW_BASE_HREF}">`)).toBe(true);
    expect(out).toContain("</head><body>hi</body>");
  });

  it("does not touch a <header> element (must not false-match on the head/header prefix)", () => {
    const out = assembleHtmlPreview("<html><header>nav</header><body></body></html>", {
      blockRemote: false,
    });
    // No <head> found -> synthesizes one after <html>, leaving <header> untouched.
    expect(out).toContain("<header>nav</header>");
    expect(out.match(/<head>/g)?.length).toBe(1);
  });
});

describe("assembleHtmlPreview — asset substitution", () => {
  it("substitutes a supplied asset ref only inside a scanned attribute context", () => {
    const source = '<html><body><img src="logo.png" alt="logo.png"></body></html>';
    const out = assembleHtmlPreview(source, {
      blockRemote: false,
      assets: { "logo.png": "data:image/png;base64,AAAA" },
    });
    expect(out).toContain('src="data:image/png;base64,AAAA"');
    // `alt` is not one of the tag/attribute contexts `html-assets.ts` scans (sprint-064) — the
    // seam is "the scanned attribute contexts only", never a blind whole-document value match, so
    // `alt`'s text happening to equal the same ref string is left exactly as authored.
    expect(out).toContain('alt="logo.png"');
  });

  it("does not touch document text that happens to match a ref", () => {
    const source = "<html><body><p>see logo.png for details</p></body></html>";
    const out = assembleHtmlPreview(source, {
      blockRemote: false,
      assets: { "logo.png": "data:image/png;base64,AAAA" },
    });
    expect(out).toContain("<p>see logo.png for details</p>");
  });

  it("is a no-op when assets is empty or omitted", () => {
    const source = '<html><body><img src="logo.png"></body></html>';
    expect(assembleHtmlPreview(source, { blockRemote: false, assets: {} })).toContain(
      'src="logo.png"',
    );
    expect(assembleHtmlPreview(source, { blockRemote: false })).toContain('src="logo.png"');
  });

  it("supports single-quoted source attribute values, normalized to double quotes on rewrite", () => {
    const source = "<html><body><img src='logo.png'></body></html>";
    const out = assembleHtmlPreview(source, {
      blockRemote: false,
      assets: { "logo.png": "data:image/png;base64,AAAA" },
    });
    // `html-assets.ts`'s rewrite always emits double-quoted values regardless of the original
    // quote style — the same substitution has to work for an unquoted source value too, and a
    // `data:` URI is never safe unquoted.
    expect(out).toContain('src="data:image/png;base64,AAAA"');
  });
});
