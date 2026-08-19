import { describe, expect, it } from "vitest";
import { resolveBrandIcon, resolveBrandTitle } from "./build-brand.js";

describe("resolveBrandTitle", () => {
  it("falls back to the default when unset", () => {
    expect(resolveBrandTitle({})).toBe("Pi-Studio");
  });

  it("falls back to the default when blank/whitespace", () => {
    expect(resolveBrandTitle({ PI_STUDIO_BRAND_TITLE: "   " })).toBe("Pi-Studio");
  });

  it("trims and returns a custom title", () => {
    expect(resolveBrandTitle({ PI_STUDIO_BRAND_TITLE: "  Acme Coder  " })).toBe("Acme Coder");
  });
});

describe("resolveBrandIcon", () => {
  it("returns null when unset", () => {
    expect(resolveBrandIcon({})).toBeNull();
  });

  it("returns null when blank/whitespace", () => {
    expect(resolveBrandIcon({ PI_STUDIO_BRAND_ICON: "  " })).toBeNull();
  });

  it("resolves an svg icon", () => {
    expect(resolveBrandIcon({ PI_STUDIO_BRAND_ICON: "/brand/icon.svg" })).toEqual({
      sourcePath: "/brand/icon.svg",
      fileName: "brand-icon.svg",
      mime: "image/svg+xml",
    });
  });

  it("resolves a png icon, case-insensitively", () => {
    expect(resolveBrandIcon({ PI_STUDIO_BRAND_ICON: "./assets/Icon.PNG" })).toEqual({
      sourcePath: "./assets/Icon.PNG",
      fileName: "brand-icon.png",
      mime: "image/png",
    });
  });

  it("resolves an ico icon", () => {
    expect(resolveBrandIcon({ PI_STUDIO_BRAND_ICON: "icon.ico" })).toEqual({
      sourcePath: "icon.ico",
      fileName: "brand-icon.ico",
      mime: "image/x-icon",
    });
  });

  it("throws on an unsupported extension", () => {
    expect(() => resolveBrandIcon({ PI_STUDIO_BRAND_ICON: "icon.jpg" })).toThrow(
      /unsupported extension "\.jpg"/,
    );
  });

  it("throws when there is no extension at all", () => {
    expect(() => resolveBrandIcon({ PI_STUDIO_BRAND_ICON: "icon" })).toThrow(
      /unsupported extension "\(none\)"/,
    );
  });
});
