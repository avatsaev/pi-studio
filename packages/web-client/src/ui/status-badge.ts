// StatusBadge + Alert variant contracts.
// ui-components.md § Surfaces / badges / chips / avatars

export type StatusBadgeVariant = "success" | "error" | "muted";

// Single semantic token per variant — text color AND a translucent tint of the SAME token as
// background (matches `ChangesPanel.module.css`'s `.added`/`.modified`/`.deleted` convention).
// Never split bg/border/text across different token families (e.g. `success` vs `statusSuccess`)
// — they can diverge in the theme (dark mode's `success` aliases the blue accent, not green),
// producing a badge with mismatched border/background colors.
export type BadgeTokens = {
  token: string;
};

export function statusBadgeTokens(variant: StatusBadgeVariant): BadgeTokens {
  switch (variant) {
    case "success":
      return { token: "statusSuccess" };
    case "error":
      return { token: "statusDanger" };
    case "muted":
      return { token: "foregroundMuted" };
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
