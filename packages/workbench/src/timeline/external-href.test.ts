import { describe, expect, it } from "vitest";
import { classifyExternalHref } from "./external-href.js";

describe("classifyExternalHref", () => {
  it.each(["https://example.com", "mailto:a@b.c", "file:///x"])("%s is a url", (href) => {
    expect(classifyExternalHref(href)).toBe("url");
  });

  it.each(["", "  ", "#", "#usage"])("%j is in-page", (href) => {
    expect(classifyExternalHref(href)).toBe("in-page");
  });
});
