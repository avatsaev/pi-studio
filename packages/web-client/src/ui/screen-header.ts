// ScreenHeader layout constants and padding computation.
// ui-components.md § Navigation chrome

import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  WINDOW_CHROME,
} from "@pi-studio-ui/platform/breakpoints.js";

export type HeaderVariant = "menu" | "back" | "title" | "icon-badge";
export type WindowControlSide = "left" | "right"; // macOS = left, Windows/Linux = right

export type HeaderPadding = {
  paddingLeft: number;
  paddingRight: number;
  height: number;
};

/**
 * Compute the effective header padding to avoid overlapping desktop window controls.
 * On non-desktop / mobile, returns zero extra padding.
 *
 * @param isDesktop - True when running in Electron desktop.
 * @param isMobile  - True when compact form factor.
 * @param os        - "macos" | "windowsLinux" (determines which side the controls are on).
 */
export function headerPadding(opts: {
  isDesktop: boolean;
  isMobile: boolean;
  os: "macos" | "windowsLinux";
}): HeaderPadding {
  const { isDesktop, isMobile, os } = opts;
  const height = isMobile ? HEADER_INNER_HEIGHT_MOBILE : HEADER_INNER_HEIGHT;

  if (!isDesktop) {
    return { paddingLeft: 0, paddingRight: 0, height };
  }

  const reserve = os === "macos" ? WINDOW_CHROME.macOS.width : WINDOW_CHROME.windowsLinux.width;
  const side: WindowControlSide = os === "macos" ? "left" : "right";

  return {
    paddingLeft: side === "left" ? reserve : 0,
    paddingRight: side === "right" ? reserve : 0,
    height,
  };
}

// Re-export shared constants for use in layout math.
export { HEADER_INNER_HEIGHT, HEADER_INNER_HEIGHT_MOBILE };
