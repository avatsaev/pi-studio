/**
 * `shouldReplayPaneLayout` — the pure replay gate `usePaneLayoutBoot`'s second effect calls
 * directly. Extracted for direct unit testing (no jsdom test environment in this repo); the hook
 * itself is thin glue over this function plus `reopenClientTabs`/`installActiveWorkspaceRestore`.
 */

import { describe, expect, it } from "vitest";
import { shouldReplayPaneLayout } from "./use-pane-layout.js";

describe("shouldReplayPaneLayout", () => {
  it("does not replay while the viewer-settings store is unhydrated (loaded: false)", () => {
    expect(shouldReplayPaneLayout("open", false, false)).toBe(false);
  });

  it("does not replay before the connection reaches open, even once loaded", () => {
    expect(shouldReplayPaneLayout("connecting", true, false)).toBe(false);
    expect(shouldReplayPaneLayout("idle", true, false)).toBe(false);
  });

  it("replays exactly once when both status is open and loaded flips true", () => {
    // Simulates the hook's own ref-guarded effect across a sequence of (status, loaded) pairs.
    let replayed = false;
    let fireCount = 0;
    const transitions: Array<[string, boolean]> = [
      ["connecting", false],
      ["open", false], // status open first, settings not yet hydrated — must not fire
      ["open", true], // the flip — must fire exactly here
      ["open", true], // no-op re-render with the same values — must not fire again
    ];
    for (const [status, loaded] of transitions) {
      if (shouldReplayPaneLayout(status, loaded, replayed)) {
        fireCount++;
        replayed = true;
      }
    }
    expect(fireCount).toBe(1);
  });

  it("a later status churn after the replay does not run it again", () => {
    let replayed = true; // already replayed once
    expect(shouldReplayPaneLayout("connecting", true, replayed)).toBe(false);
    expect(shouldReplayPaneLayout("open", true, replayed)).toBe(false);
    replayed = false;
    // Sanity: with the ref reset it WOULD fire — proves the assertions above are gated by
    // `replayed`, not by status/loaded coincidentally being falsy.
    expect(shouldReplayPaneLayout("open", true, replayed)).toBe(true);
  });
});
