// Platform module public surface.
export {
  breakpoints,
  getBreakpoint,
  isCompactFormFactor,
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
  WORKSPACE_SECONDARY_HEADER_HEIGHT,
  FOOTER_HEIGHT,
  MAX_CONTENT_WIDTH,
  COMPACT_FORM_FACTOR_WIDTH,
  WINDOW_CHROME,
  type Breakpoint,
} from "./breakpoints.js";
export {
  isWeb,
  isNative,
  getIsElectron,
  supportsDesktopPaneSplits,
  _resetElectronCache,
  STYLING_ENGINE_RULES,
} from "./gating.js";
export { hoverVisible, assertPointerEventsWebOnly } from "./hover.js";
export {
  resolvePosition,
  resolveOverlayMode,
  Z_ORDER,
  type Rect,
  type Side,
  type Align,
  type PositionInput,
  type ResolvedPosition,
  type OverlayMode,
} from "./overlay.js";
