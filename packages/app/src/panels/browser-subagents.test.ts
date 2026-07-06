import { describe, expect, it } from "vitest";
import {
  applyNavError,
  applyNavigation,
  applyNavLoaded,
  browserDescriptorLabel,
  BROWSER_SHORTCUTS,
  browserPaneVariant,
  buildArchiveConfirm,
  buildSubagentChip,
  closeArchiveConfirm,
  INITIAL_BROWSER_NAV,
  INITIAL_TRACK_STATE,
  openArchiveConfirm,
  shouldRenderTrack,
  toggleTrack,
  trackHeaderLabel,
  trackMembers,
  unsupportedBrowserMessage,
  validateBrowserUrl,
  validateNewTabRequest,
  type SubagentEntry,
} from "./index.js";

// ─── Browser pane ─────────────────────────────────────────────────────────

describe("browser pane", () => {
  it("variant is electron only when isElectron=true", () => {
    expect(browserPaneVariant(true)).toBe("electron");
    expect(browserPaneVariant(false)).toBe("unsupported");
    expect(unsupportedBrowserMessage()).toContain("desktop app");
  });

  it("validateBrowserUrl accepts http/https/about:blank; rejects others; auto-prefixes bare hosts", () => {
    expect(validateBrowserUrl("https://example.com").valid).toBe(true);
    expect(validateBrowserUrl("http://localhost:3000").valid).toBe(true);
    expect(validateBrowserUrl("about:blank").valid).toBe(true);
    expect(validateBrowserUrl("ftp://example.com")).toMatchObject({ valid: false });
    const auto = validateBrowserUrl("example.com");
    expect(auto.valid).toBe(true);
    if (auto.valid) expect(auto.normalized).toContain("https://example.com");
    expect(validateBrowserUrl("not a url at all :// bad")).toMatchObject({ valid: false });
  });

  it("navigation state updates correctly", () => {
    let nav = applyNavigation(INITIAL_BROWSER_NAV, "https://pi.studio");
    expect(nav.isLoading).toBe(true);
    nav = applyNavLoaded(nav, { title: "Pi Studio", canGoBack: false, canGoForward: false });
    expect(nav.isLoading).toBe(false);
    expect(nav.title).toBe("Pi Studio");
    nav = applyNavError(nav, "ERR_CONNECTION_REFUSED");
    expect(nav.lastError).toBe("ERR_CONNECTION_REFUSED");
  });

  it("browserDescriptorLabel prefers title, then hostname, then fallback", () => {
    expect(browserDescriptorLabel({ ...INITIAL_BROWSER_NAV, title: "Page Title" })).toBe("Page Title");
    expect(browserDescriptorLabel({ ...INITIAL_BROWSER_NAV, url: "https://example.com/path" })).toBe("example.com");
    expect(browserDescriptorLabel(INITIAL_BROWSER_NAV)).toBe("Browser");
  });

  it("validateNewTabRequest only allows http/https/about:blank", () => {
    expect(validateNewTabRequest("https://example.com").valid).toBe(true);
    expect(validateNewTabRequest("file:///etc/passwd")).toMatchObject({ valid: false });
  });

  it("BROWSER_SHORTCUTS includes focus-url, reload, dev-tools", () => {
    expect(BROWSER_SHORTCUTS.map((s) => s.action)).toContain("focus-url");
    expect(BROWSER_SHORTCUTS.map((s) => s.action)).toContain("reload");
  });
});

// ─── Subagents track ──────────────────────────────────────────────────────

const makeAgent = (id: string, status: SubagentEntry["status"] = "idle", opts: Partial<SubagentEntry> = {}): SubagentEntry => ({
  agentId: id,
  parentAgentId: "parent",
  title: `Agent ${id}`,
  status,
  createdAt: Date.now(),
  isArchived: false,
  isPendingArchive: false,
  ...opts,
});

describe("subagents track", () => {
  it("trackMembers excludes archived and pending-archive agents, sorts by createdAt", () => {
    const agents = [
      makeAgent("a", "running", { createdAt: 2000 }),
      makeAgent("b", "idle", { createdAt: 1000 }),
      makeAgent("c", "idle", { isArchived: true, createdAt: 500 }),
      makeAgent("d", "idle", { isPendingArchive: true, createdAt: 3000 }),
    ];
    const members = trackMembers(agents, "parent");
    expect(members.map((m) => m.agentId)).toEqual(["b", "a"]);
  });

  it("trackHeaderLabel includes running count when any run", () => {
    const all = [makeAgent("a", "running"), makeAgent("b", "idle")];
    const members = trackMembers(all, "parent");
    expect(trackHeaderLabel(members)).toBe("2 subagents · 1 running");
    expect(trackHeaderLabel([makeAgent("a", "idle")])).toBe("1 subagent");
  });

  it("buildSubagentChip maps fields correctly", () => {
    const chip = buildSubagentChip(makeAgent("x", "needs_attention"));
    expect(chip.agentId).toBe("x");
    expect(chip.needsAttention).toBe(true);
    expect(buildSubagentChip(makeAgent("y")).label).toBe("Agent y");
    expect(buildSubagentChip({ ...makeAgent("z"), title: undefined }).label).toBe("Loading…");
  });

  it("archive confirm warns when running", () => {
    const running = buildArchiveConfirm(makeAgent("r", "running"));
    expect(running.isRunning).toBe(true);
    expect(running.message).toContain("stop");
    const idle = buildArchiveConfirm(makeAgent("i", "idle"));
    expect(idle.isRunning).toBe(false);
    expect(idle.message).not.toContain("stop");
  });

  it("openArchiveConfirm / closeArchiveConfirm track confirmed agentId", () => {
    let state = openArchiveConfirm(INITIAL_TRACK_STATE, "agent-1");
    expect(state.archiveConfirmId).toBe("agent-1");
    state = closeArchiveConfirm(state);
    expect(state.archiveConfirmId).toBeUndefined();
  });

  it("toggleTrack flips expanded flag; shouldRenderTrack is false for empty entries", () => {
    expect(toggleTrack(INITIAL_TRACK_STATE).expanded).toBe(true);
    expect(shouldRenderTrack([])).toBe(false);
    expect(shouldRenderTrack([makeAgent("a")])).toBe(true);
  });
});
