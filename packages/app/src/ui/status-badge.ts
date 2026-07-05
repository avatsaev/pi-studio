// StatusBadge + Alert variant contracts.
// ui-components.md § Surfaces / badges / chips / avatars

export type StatusBadgeVariant = "success" | "error" | "muted";

// Token keys for each status badge variant (bg, border, text).
export type BadgeTokens = {
  bg: string;
  border: string;
  text: string;
};

export function statusBadgeTokens(variant: StatusBadgeVariant): BadgeTokens {
  switch (variant) {
    case "success":
      return { bg: "success", border: "statusSuccess", text: "successForeground" };
    case "error":
      return { bg: "destructive", border: "statusDanger", text: "destructiveForeground" };
    case "muted":
      return { bg: "surface2", border: "border", text: "foregroundMuted" };
  }
}

export type AlertVariant = "default" | "info" | "success" | "warning" | "error";

export type AlertIconInfo = {
  /** Lucide icon name string for the alert variant. */
  icon: string;
  /** Theme token key for the icon/border/title accent color. */
  accentToken: string;
};

export function alertIconInfo(variant: AlertVariant): AlertIconInfo {
  switch (variant) {
    case "default":
      return { icon: "info", accentToken: "foregroundMuted" };
    case "info":
      return { icon: "info", accentToken: "accent" };
    case "success":
      return { icon: "check-circle", accentToken: "success" };
    case "warning":
      return { icon: "triangle-alert", accentToken: "statusWarning" };
    case "error":
      return { icon: "circle-x", accentToken: "destructive" };
  }
}

// AttachmentPill remove-button visibility — mirrors hover-to-show pattern.
export function attachmentPillRemoveVisible(
  isNativeCtx: boolean,
  isCompact: boolean,
  hovered: boolean,
): boolean {
  return isNativeCtx || isCompact || hovered;
}
