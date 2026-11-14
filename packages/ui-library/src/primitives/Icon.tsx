/**
 * Icon — lucide-react wrapper honouring iconSize tokens.
 * ui-components.md § Icons
 */

import { type LucideIcon } from "lucide-react";

/** Token name → pixel size (matches design-system.md § iconSize). */
export type IconSizeToken = "xs" | "sm" | "md" | "lg";
const ICON_SIZE_PX: Record<IconSizeToken, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
};

export interface IconProps {
  icon: LucideIcon;
  size?: IconSizeToken | number;
  /** CSS color value OR a --pi-color-* CSS variable reference. */
  color?: string;
  className?: string;
  "aria-hidden"?: boolean;
  "aria-label"?: string;
}

export function Icon({
  icon: LucideComponent,
  size = "md",
  color = "currentColor",
  className,
  ...ariaProps
}: IconProps) {
  const px = typeof size === "number" ? size : ICON_SIZE_PX[size];
  return (
    <LucideComponent
      size={px}
      color={color}
      className={className}
      aria-hidden={ariaProps["aria-hidden"]}
      aria-label={ariaProps["aria-label"]}
    />
  );
}

export { ICON_SIZE_PX };
