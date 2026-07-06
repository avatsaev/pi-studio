// Core DOM primitives — public surface.
// ui-components.md § Pressables, Inputs, Icons, Surfaces, Feedback, Status, Scroll

export { Button, type ButtonProps } from "./Button.js";
export { Icon, type IconProps, type IconSizeToken, ICON_SIZE_PX } from "./Icon.js";
export { StatusDot, type StatusDotProps } from "./StatusDot.js";
export { StatusBadge, type StatusBadgeProps } from "./StatusBadge.js";
export { Avatar, type AvatarProps } from "./Avatar.js";
export { ShortcutHint, type ShortcutProps } from "./Shortcut.js";
export { Spinner, type SpinnerProps, type SpinnerSize } from "./Spinner.js";
export { Divider, type DividerProps } from "./Divider.js";
export { Switch, type SwitchProps } from "./Switch.js";
export { Surface, type SurfaceProps } from "./Surface.js";
export { TextInput, TextArea, type TextInputProps, type TextAreaProps } from "./TextInput.js";
export { ScrollArea, type ScrollAreaProps } from "./ScrollArea.js";
export { Checkbox, type CheckboxProps } from "./Checkbox.js";
export { Select, Combobox, type SelectProps, type ComboboxProps } from "./Select.js";
export { useHover, type UseHoverReturn } from "./useHover.js";

// Helpers (testable pure functions)
export {
  hoverVisible,
  buttonAriaAttrs,
  buttonInlineStyle,
  buttonIconPx,
  surfaceBgVar,
  statusDotVisible,
  type SurfaceElevation,
  type ButtonAriaAttrs,
  type ButtonInlineStyle,
} from "./helpers.js";
