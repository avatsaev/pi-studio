// Overlays module — public surface.
export { Portal, PORTAL_ROOT_ID, type PortalProps } from "./Portal.js";
export { ToastProvider, useToast, type ToastContextValue } from "./ToastContext.js";
export { ToastHost } from "./Toast.js";
export {
  AdaptiveSheet,
  type AdaptiveSheetProps,
} from "./Dialog.js";
export { TooltipProvider, Tooltip, type TooltipProps } from "./Tooltip.js";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./DropdownMenu.js";
export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
} from "./Popover.js";
export {
  resolveOverlayMode,
  Z_ORDER,
  toastQueueReducer,
  newToastId,
  type OverlayMode,
  type ToastQueueAction,
} from "./overlays-logic.js";
