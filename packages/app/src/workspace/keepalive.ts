// Mounted-tab keepalive LRU.
// clean-room-scope/features/workspace-ui.md § Mounted-tab keepalive

export const DEFAULT_MOUNTED_TAB_CAP = 3;

export function nextMountedTabLru(previous: readonly string[], activeTabId: string | undefined, cap = DEFAULT_MOUNTED_TAB_CAP): string[] {
  if (!activeTabId) return previous.slice(0, cap);
  return [activeTabId, ...previous.filter((id) => id !== activeTabId)].slice(0, cap);
}

export function mountedTabState(tabId: string, activeTabId: string | undefined, lru: readonly string[]): "active" | "mounted-hidden" | "unmounted" {
  if (tabId === activeTabId) return "active";
  return lru.includes(tabId) ? "mounted-hidden" : "unmounted";
}

export function mountedHiddenStyle(state: "active" | "mounted-hidden" | "unmounted"):
  | { display: "contents"; pointerEvents: "auto" }
  | { display: "none"; pointerEvents: "none" }
  | { display: "contents"; pointerEvents: "none"; hidden: true } {
  if (state === "active") return { display: "contents", pointerEvents: "auto" };
  if (state === "mounted-hidden") return { display: "contents", pointerEvents: "none", hidden: true };
  return { display: "none", pointerEvents: "none" };
}
