/**
 * Button — pressable with variant/size/state, styled from --pi-* CSS variables.
 * ui-components.md § Pressables
 */

import { type ReactNode, type Ref, type ButtonHTMLAttributes } from "react";
import { clsx } from "clsx";
import { Loader2 } from "lucide-react";
import styles from "./Button.module.css";
import {
  type ButtonVariant,
  type ButtonSize,
  BUTTON_MIN_HEIGHT,
  BUTTON_PADDING_H,
  BUTTON_FONT_SIZE,
  BUTTON_ICON_SIZE,
  resolveButtonState,
} from "@pi-studio-ui/ui/button.js";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  trailing?: ReactNode;
  iconOnly?: boolean;
  children?: ReactNode;
  // React 19: function components accept `ref` as a normal prop; this component still has to
  // read it and place it itself (no auto-forwarding) — sprint-068/task-008 needs it to focus a
  // card's primary/dismissing control from a plain `useRef`, the same way `TextInput`/`TextArea`
  // already support via `forwardRef`.
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "default",
  size = "md",
  loading = false,
  disabled = false,
  leftIcon,
  trailing,
  iconOnly = false,
  children,
  style,
  className,
  ref,
  ...rest
}: ButtonProps) {
  const { opacity } = resolveButtonState({
    variant,
    pressed: false,
    disabled: disabled ?? false,
    loading,
  });
  const isDisabled = disabled || loading;

  const iconPx = BUTTON_ICON_SIZE[size];

  return (
    <button
      ref={ref}
      className={clsx(styles.btn, styles[variant], iconOnly && styles.iconOnly, className)}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      style={{
        minHeight: BUTTON_MIN_HEIGHT[size],
        paddingLeft: iconOnly ? undefined : BUTTON_PADDING_H[size],
        paddingRight: iconOnly ? undefined : BUTTON_PADDING_H[size],
        fontSize: BUTTON_FONT_SIZE[size],
        opacity,
        ...(iconOnly ? { width: BUTTON_MIN_HEIGHT[size] } : {}),
        ...style,
      }}
      {...rest}
    >
      {loading ? (
        <Loader2 className={styles.loadingSpinner} size={iconPx} aria-hidden />
      ) : leftIcon ? (
        <span aria-hidden style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          {leftIcon}
        </span>
      ) : null}
      {children}
      {trailing && !loading && (
        <span aria-hidden style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          {trailing}
        </span>
      )}
    </button>
  );
}
