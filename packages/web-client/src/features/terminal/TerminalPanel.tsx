/**
 * TerminalPanel — @xterm/xterm mount + binary-frame streaming via `TerminalStreamRouter`
 * (POC `initTerminalPanel`, POC_TO_APP_PLAN_UI.md §4.6). Strict upgrade over the POC's 800ms
 * `capture_terminal_request` poll: the daemon pushes `Output`/`Snapshot`/`Restore` binary frames
 * directly over the one shared `DaemonClient` connection, demuxed by slot.
 *
 * Slot lifecycle: created once via `create_terminal_request`, then persisted onto the tab's
 * `TerminalTabData.slot` via `useTabStore.getState().updateData` so switching away and back to
 * this tab (kept mounted-but-hidden by `TabPanelHost`) never recreates the terminal. `TabPanelHost`
 * only unmounts a tab's panel when the tab leaves the store's `tabs[]` (i.e. real tab close, never
 * a tab switch) — this component's true-unmount effect below relies on exactly that invariant to
 * send `kill_terminal_request`, terminating the PTY server-side instead of leaking it forever.
 *
 * Mount vs. subscribe are two separate effects (sprint-052/task-001): the emulator (xterm + fit +
 * `onData`/`onResize`) mounts as soon as the container exists, independent of the slot, so
 * `onResize` is attached before the first `fitAddon.fit()` ever runs — closing the window where
 * xterm's one size-changing fit of the panel's life used to fire with no listener. The stream
 * subscription is keyed on `[client, slot]` instead, so a reconnect (new `client`) re-subscribes
 * without tearing down and rebuilding the emulator, preserving scrollback across it.
 *
 * PTY sizing (`terminals.md` § PTY size ownership) is a single seam, `claimSize`, behind two
 * independent gates: `isSizeAuthority` (permission — is this panel the visible renderer, in the
 * active workspace, as its pane's active tab?) and `shouldClaimSize` (validity + dedupe against
 * `believedSizeRef`, what we think the PTY currently is). Keeping knowledge and permission separate
 * is load-bearing: a *restored* terminal's PTY predates this client, so it believes nothing, and an
 * earlier revision that treated "never sent a size" as "not allowed to send one" left every
 * restored terminal ignoring resizes for its entire life. Every claim funnels through `onResize`
 * (real grid changes) or a `performRefit` reconcile (covers a panel that measured 0×0 while hidden
 * and would otherwise fit to an unchanged grid and stay silent).
 */

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { DaemonClient } from "@av-pi-studio/client";
import { TerminalStreamRouter } from "@av-pi-studio/client";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useIsTabVisible, useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import type { Tab, TerminalTabData } from "@pi-studio-ui/stores/tab-store.js";
import { isPaneActiveTab, useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { baseFontSize } from "@pi-studio-ui/theme/tokens.js";
import { isMeasurable, shouldClaimSize, type Grid } from "./terminal-size.js";
import styles from "./TerminalPanel.module.css";

export interface TerminalPanelProps {
  tab: Tab;
}

/** `cols`/`rows` echo the PTY's real size. Optional for the same reason as the subscribe echo
 * below: an older daemon may omit them, and a `{cols: undefined}` belief would never match a real
 * measurement, so every later fit would re-send a resize the PTY already has. */
interface CreateTerminalResponse {
  terminal: { slot: number; cols?: number; rows?: number };
}

/** `cols`/`rows` echo the PTY's real size; both optional so an older daemon that omits them is
 * handled without a version check (the client falls back to what it asked for). */
interface SubscribeTerminalResponse {
  cols?: number;
  rows?: number;
}

/** Status surface for the attach overlay (feature-panels-ui.md § Terminal pane → States). */
interface TerminalStatus {
  isAttaching: boolean;
  error: string | null;
}

/** Input typed before a slot exists is queued here, bounded, and flushed once the subscription
 * attaches successfully (feature-panels-ui.md § Input/keys). Cleared (not flushed) on a
 * subscribe error — a failed attach has nowhere correct to send queued bytes.
 *
 * Bounded in **bytes**, not chunks: one chunk is one `onData` payload, which for a paste is the
 * whole clipboard. A chunk-count cap would let 256 multi-megabyte pastes sit in memory. */
const MAX_PENDING_INPUT_BYTES = 64 * 1024;

const textEncoder = new TextEncoder();

// One TerminalStreamRouter per daemon connection — multiple terminal tabs share it rather than
// each opening its own frame demuxer over the same socket.
const routerByDaemon = new WeakMap<DaemonClient, TerminalStreamRouter>();

function routerFor(daemon: DaemonClient): TerminalStreamRouter {
  let router = routerByDaemon.get(daemon);
  if (!router) {
    router = new TerminalStreamRouter(daemon);
    router.start();
    routerByDaemon.set(daemon, router);
  }
  return router;
}

/**
 * Whether this panel is the client's **size authority** for its PTY: it is on screen right now, in
 * the workspace the user is looking at, as its own pane's visible tab. Only an authority may send a
 * Resize frame (`terminals.md` § PTY size ownership — "a passive observer never resizes what it is
 * only watching"; a background tab or a tab in a non-active workspace is exactly that).
 *
 * Deliberately NOT gated on `focusedPaneId` (nor on real DOM focus). Pane focus is which pane
 * receives keystrokes; it is not what makes a rendered grid authoritative. Gating on it meant the
 * frame's fate depended on transient focus state at the exact moment a resize landed — a split with
 * a non-terminal tab, a workspace switch, or a restore each moved focus elsewhere while this
 * terminal was still the thing visibly rendering, so its real size went unreported and the shell
 * kept painting to a stale width (wrong grid, background color stopping short of the rendered
 * columns, mangled wrapping). Visibility is stable and is what the user is actually looking at.
 *
 * Reads live store state (`.getState()`, not a subscribed value) so a decision made synchronously
 * inside a native event handler or an rAF callback — either of which can run before React has
 * re-rendered this component — never sees a stale answer.
 */
function isSizeAuthority(tabId: string): boolean {
  const tabState = useTabStore.getState();
  const tab = tabState.tabs.find((t) => t.id === tabId);
  if (!tab || tab.workspaceCwd !== tabState.activeWorkspaceCwd) return false;
  return isPaneActiveTab(useLayoutStore.getState().layouts[tab.workspaceCwd], tabId);
}

/** Dark palette matching the app's github-dark-ish default theme (theme/variants.ts "dark"). */
const TERMINAL_THEME = {
  background: "#181b1a",
  foreground: "#fafafa",
  cursor: "#a2b4d7",
  cursorAccent: "#181b1a",
  selectionBackground: "rgba(255,255,255,0.18)",
  black: "#18181b",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#f59e0b",
  blue: "#3b82f6",
  magenta: "#a855f7",
  cyan: "#14b8a6",
  white: "#d4d4d8",
  brightBlack: "#52525b",
  brightRed: "#f87171",
  brightGreen: "#4ade80",
  brightYellow: "#fbbf24",
  brightBlue: "#60a5fa",
  brightMagenta: "#c084fc",
  brightCyan: "#2dd4bf",
  brightWhite: "#fafafa",
};

export function TerminalPanel({ tab }: TerminalPanelProps) {
  const data = tab.data as TerminalTabData;
  const client = useConnectionStore((s) => s.client);
  // Per-pane, not `=== activeTabId`: with splits this terminal can be on screen in one pane while
  // another pane holds the workspace-active tab, and it must refit when it appears either way.
  const isVisible = useIsTabVisible(tab.id);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const slotRef = useRef<number | null>(data.slot);
  // Current stream router for the slot's subscription — set by the subscription effect, read by
  // the emulator's onData/onResize handlers (which cannot close over it: they are attached once,
  // in the mount effect, and must keep working across a reconnect that swaps the router).
  const routerRef = useRef<TerminalStreamRouter | null>(null);
  const pendingInputRef = useRef<Uint8Array[]>([]);
  // Running total of `pendingInputRef`'s byte lengths, so the bound is checked without re-summing
  // the queue on every keystroke.
  const pendingInputBytesRef = useRef(0);
  // What this client believes the PTY's grid currently is — from `create_terminal_request`'s echo,
  // or from the last size it successfully sent. Used ONLY to dedupe (`shouldClaimSize`); it is
  // deliberately not a permission flag. `null` just means "unknown", which is the normal state of
  // a *restored* terminal whose PTY predates this client, and is precisely the case that most
  // needs a resize (that PTY is usually still at its 80×24 spawn default).
  const believedSizeRef = useRef<Grid | null>(null);
  // Set by the mount effect once `claimSize` exists, cleared on its cleanup, so the separate
  // visibility effect below can reuse the one claim path instead of duplicating its logic.
  const claimSizeRef = useRef<((next: Grid | null) => void) | null>(null);
  // Coalesced-refit scheduler state (sprint-052/task-004): `refitTimerRef` is the ~60ms trailing
  // debounce so a continuous gesture (divider drag, window resize) settles before fitting;
  // `refitRafRef` aligns the actual `fit()` to a paint frame; `isFittingRef` is the re-entrancy
  // guard so a `fit()` the scheduler performs cannot itself schedule another refit through the
  // `ResizeObserver` it may perturb. All three are refs, not effect-local state, because both the
  // emulator effect's `ResizeObserver` and the separate visibility effect below must share one
  // scheduler.
  const refitTimerRef = useRef<number | null>(null);
  const refitRafRef = useRef<number | null>(null);
  const isFittingRef = useRef(false);
  // Mirrors `use-checkout-status.ts`'s convention: kept in sync every render so the unmount-only
  // kill effect below always sends the CURRENT client, never a stale mount-time closure (e.g.
  // after a reconnect swaps in a new `PiStudioClient` instance).
  const clientRef = useRef(client);
  clientRef.current = client;

  const [slot, setSlot] = useState<number | null>(data.slot);
  const [status, setStatus] = useState<TerminalStatus>({ isAttaching: true, error: null });

  /**
   * Measure the panel's current grid and offer it to `claimSize`. The one shape every reconcile
   * point shares (post-fit, on focus, post-attach), so the measure→validate→claim sequence exists
   * once instead of three times drifting apart. Safe to call at any time: `claimSize` gates on
   * authority and dedupes, and an unmeasurable panel (hidden, 0×0) resolves to `null` and no-ops.
   */
  const measureAndClaim = () => {
    const proposed = fitAddonRef.current?.proposeDimensions();
    claimSizeRef.current?.(isMeasurable(proposed) ? proposed : null);
  };

  // Performs the coalesced fit, then reconciles. Not memoized — it closes over nothing but refs, so
  // a fresh function identity every render is harmless; whichever render's closure a pending
  // timer/rAF captured behaves identically to the current one.
  const performRefit = () => {
    refitRafRef.current = null;
    isFittingRef.current = true;
    fitAddonRef.current?.fit();
    // `fit()` alone is not enough to guarantee a claim. It only fires `onResize` when the grid
    // *changes*, so a panel that attached while hidden — measured 0×0, kept its constructor grid —
    // can become visible, fit to that same grid, and emit nothing, leaving the PTY at whatever it
    // was. Reconciling here covers that.
    measureAndClaim();
    // Hold the guard for one more frame: a `fit()`-induced box perturbation (if any) is reported
    // by `ResizeObserver` asynchronously, and has reliably arrived by the next frame.
    requestAnimationFrame(() => {
      isFittingRef.current = false;
    });
  };

  const requestRefit = () => {
    if (refitTimerRef.current !== null) window.clearTimeout(refitTimerRef.current);
    refitTimerRef.current = window.setTimeout(() => {
      refitTimerRef.current = null;
      if (refitRafRef.current !== null) return; // already scheduled this frame
      refitRafRef.current = requestAnimationFrame(performRefit);
    }, 60);
  };

  // ─── Emulator mount: independent of the slot ───────────────────────────────────────────────
  // Constructs xterm + FitAddon as soon as the container exists, attaches `onData`/`onResize`
  // BEFORE the first `fit()` — this is the root-cause fix (sprint-052): the one size-changing fit
  // of the panel's life used to fire before any resize listener existed, so no `Resize` frame was
  // ever sent and the PTY stayed at the 80×24 default forever. `onData`/`onResize` read the
  // current slot/router from refs (not a closure) because this effect has an empty deps array and
  // outlives every slot/client change; `claimSize` below is the size-claim logic behind
  // `sendResize` this ordering fix exists to make deliverable at all.
  useEffect(() => {
    // Captured once: the cleanup below must detach from the same element it attached to, and reading
    // the ref again at teardown would be reading it after React may have already nulled it.
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      // An absolute px number, not a CSS var: xterm measures a cell from the computed style of its
      // own element and cannot resolve a var it was never given. The root font-size is left at the
      // browser default, so a rung's px value renders 1:1. (xterm 5.x renders to the DOM by
      // default — canvas/WebGL are addons this app does not load.)
      fontSize: baseFontSize.sm,
      scrollback: 5000,
      theme: TERMINAL_THEME,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    // The one and only place a `Resize` frame originates (`terminals.md` § PTY size ownership).
    // Two independent gates, which an earlier revision wrongly fused into a single "have I claimed
    // before?" flag: `isSizeAuthority` is *permission* (am I the visible renderer?), and
    // `shouldClaimSize` is *validity + dedupe* against what we believe the PTY already is. A
    // restored terminal believes nothing, so its first real measurement always reports — which is
    // the whole point: its PTY is still at the 80×24 spawn default.
    const claimSize = (next: Grid | null) => {
      if (!isSizeAuthority(tab.id)) return;
      const currentSlot = slotRef.current;
      const router = routerRef.current;
      if (currentSlot === null || !router) return;
      if (!shouldClaimSize(next, believedSizeRef.current)) return;
      believedSizeRef.current = next;
      router.sendResize(currentSlot, next.rows, next.cols);
    };

    const dataDisposable = terminal.onData((chunk) => {
      const currentSlot = slotRef.current;
      const router = routerRef.current;
      if (currentSlot === null || !router) {
        // Pre-slot keystroke: queue it (bounded) rather than dropping it silently — the
        // subscription effect flushes this once it attaches successfully.
        const bytes = textEncoder.encode(chunk);
        if (pendingInputBytesRef.current + bytes.length <= MAX_PENDING_INPUT_BYTES) {
          pendingInputRef.current.push(bytes);
          pendingInputBytesRef.current += bytes.length;
        }
        return;
      }
      router.sendInput(currentSlot, textEncoder.encode(chunk));
    });
    // Every genuine grid change funnels through here: `FitAddon.fit()` only calls
    // `terminal.resize()` when the dimensions actually change, so this fires for window resizes,
    // divider drags, splits/collapses and font changes, but not for a refit that lands on the same
    // grid. `claimSize`'s authority gate is what keeps a background/other-workspace panel silent.
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      claimSize({ cols, rows });
    });
    // Focus is not what confers authority (see `isSizeAuthority`), but it is a good moment to
    // reconcile: a click means the user is about to type, and a mismatched PTY width is what
    // mangles the line editor. `focusin`, not `focus`, because `focus` does not bubble and xterm
    // moves real focus to its own internal textarea.
    const handleFocus = () => {
      fitAddon.fit();
      measureAndClaim();
    };
    container.addEventListener("focusin", handleFocus);

    // First fit runs AFTER both handlers are wired — see the effect comment above.
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    claimSizeRef.current = claimSize;

    // Coalesced (task-004): the observer only requests a refit; `requestRefit`'s trailing debounce
    // + rAF alignment is what actually calls `fit()`, so a continuous gesture (divider drag,
    // window resize) produces one fit()+claim at rest instead of one per intermediate frame,
    // eliminating the flicker/SIGWINCH-storm a synchronous fit-per-callback used to cause. Two
    // guards on top: `isFittingRef` skips an echo from our own scheduled fit() (see
    // `performRefit`), and a zero-size entry (hidden panel) is skipped without even debouncing —
    // reading it off the entry avoids forcing an extra layout `getBoundingClientRect()` would.
    const resizeObserver = new ResizeObserver((entries) => {
      if (isFittingRef.current) return;
      const entry = entries[0];
      if (entry && (entry.contentRect.width === 0 || entry.contentRect.height === 0)) return;
      requestRefit();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (refitTimerRef.current !== null) window.clearTimeout(refitTimerRef.current);
      if (refitRafRef.current !== null) cancelAnimationFrame(refitRafRef.current);
      container.removeEventListener("focusin", handleFocus);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      claimSizeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Slot lifecycle: create once, persist onto the tab so re-opening reuses it ─────────────
  // React StrictMode double-invokes effects in dev: mount → cleanup → remount, synchronously,
  // on the SAME component instance (refs/state persist across all three phases — this is not
  // three separate mounts). Two things must hold across that: (1) the request fires exactly
  // once, and (2) whether to APPLY the eventual response is decided by whether the component is
  // mounted at RESPONSE time, not by a flag captured at REQUEST time.
  //
  // `requestStartedRef` gives (1): set the instant the request fires and never reset, so the
  // phantom-mount's cleanup-then-remount sees it's already in flight and never fires a second
  // `create_terminal_request` (this is what previously spawned two real PTYs from one Ctrl+T).
  //
  // `isMountedRef` gives (2): flipped true at the START of every effect invocation and false in
  // every cleanup, so it always reflects the LATEST phase. StrictMode's remount happens
  // synchronously, before the request's promise can possibly settle, so by response time
  // `isMountedRef.current` is back to `true` for a StrictMode phantom (correctly applies the
  // slot) — but stays `false` for a genuine fast real close (correctly kills the orphaned PTY
  // instead of leaking it or, as the previous buggy version did, killing a terminal that was
  // never actually torn down).
  const isMountedRef = useRef(false);
  const requestStartedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    if (!client || slotRef.current !== null || requestStartedRef.current) {
      return () => {
        isMountedRef.current = false;
      };
    }
    requestStartedRef.current = true;

    const cwd = data.cwd || "~";
    const proposed = fitAddonRef.current?.proposeDimensions();
    const grid: Grid | null = isMeasurable(proposed) ? proposed : null;

    void client.connection
      .request<CreateTerminalResponse>("create_terminal_request", {
        workspaceId: "",
        cwd,
        ...(grid ? { cols: grid.cols, rows: grid.rows } : {}),
      })
      .then((res) => {
        const created = res.terminal.slot;
        if (!isMountedRef.current) {
          // A real close happened with no remount after it — kill the PTY that finished
          // spawning after the tab was already gone, instead of leaking it.
          void client.connection
            .request("kill_terminal_request", { slot: created })
            .catch(() => {});
          return;
        }
        slotRef.current = created;
        setSlot(created);
        useTabStore.getState().updateData(tab.id, { slot: created });
        // Record the daemon's echo, not our request: if it clamped or defaulted, our belief must
        // match what the PTY really is or the first dedupe check would wrongly suppress a needed
        // resize. Recorded even when we couldn't measure — the echo is then the 80×24 spawn default,
        // and knowing that beats believing nothing, since the panel's first real measurement will
        // differ and correctly report. An older daemon that echoes nothing leaves the belief `null`
        // ("unknown"), which is handled everywhere; seeding `{cols: undefined}` would not be.
        const echoed = { cols: res.terminal.cols, rows: res.terminal.rows };
        believedSizeRef.current = isMeasurable(echoed) ? echoed : null;
      })
      .catch((err: unknown) => {
        if (!isMountedRef.current) return;
        setStatus({ isAttaching: false, error: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        // Reset only after the promise settles — by then StrictMode's synchronous
        // mount→cleanup→remount window has long passed, so this can never reopen the
        // double-fire race. It DOES allow a legitimate retry (e.g. `client` changed because of
        // a reconnect after the first attempt failed) instead of leaving the tab stuck forever.
        requestStartedRef.current = false;
      });

    return () => {
      isMountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, tab.id]);

  // ─── True unmount only: kill the PTY server-side ───────────────────────────────────────────
  // Runs its cleanup exactly once, when this component itself unmounts (real tab close, per
  // `TabPanelHost`'s "hidden but alive" model — a tab switch never unmounts). An empty deps array
  // means React never re-runs the effect body itself; only the cleanup fires, and only on
  // unmount, so this never races the slot-creation effect above or double-kills on a client
  // change. Without this, every closed terminal tab leaked its PTY process forever.
  //
  // For a REATTACH (this tab opened with a non-null `data.slot` from the very first render —
  // `use-terminal-restore.ts`, or the create-effect above once it has resolved) `slotRef.current`
  // is non-null from the start, so StrictMode's synchronous mount→cleanup→remount phantom cycle
  // would fire this cleanup and kill the PTY immediately on mount — unlike a freshly created
  // terminal, where `slotRef.current` is still `null` during that same phantom window (see the
  // create-effect's own comment) and so never hits this path. Deferred via `setTimeout`, exactly
  // like the create-effect's response handler: by the time it fires, StrictMode's remount has
  // already flipped `isMountedRef` back to `true` if this was a phantom unmount, so the kill is
  // skipped; a genuine close never remounts, so `isMountedRef` stays `false` and the kill proceeds.
  useEffect(() => {
    return () => {
      const currentSlot = slotRef.current;
      if (currentSlot === null) return;
      setTimeout(() => {
        if (isMountedRef.current) return; // StrictMode remounted synchronously — not a real close
        void clientRef.current?.connection
          .request("kill_terminal_request", { slot: currentSlot })
          .catch(() => {});
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Stream subscription: keyed on [client, slot], independent of the emulator ─────────────
  // Split from the emulator mount so a reconnect (new `client`) re-subscribes without tearing
  // down and rebuilding xterm, which used to lose all scrollback on every reconnect.
  useEffect(() => {
    if (!client || slot === null) return;

    setStatus({ isAttaching: true, error: null });

    const router = routerFor(client.connection);
    routerRef.current = router;

    // `reset()`, not `clear()`: `clear()` only empties the viewport/scrollback, leaving the
    // emulator's modes (alt-screen, DECSTBM scroll margins, charset selection, wraparound/origin
    // modes, cursor visibility) carried over from whatever the previous stream left behind — a
    // snapshot replayed into stale modes renders confined to the wrong scroll region or with the
    // wrong charset (sprint-052/task-005; `terminals.md` § Restore / snapshot, tier 1). `reset()`
    // clears modes too, so the replay always lands on a clean slate. Shared by both handlers so
    // they cannot diverge — `onRestore` (tier 2, sprint-053) needs the identical treatment.
    const replay = (chunk: Uint8Array) => {
      terminalRef.current?.reset();
      terminalRef.current?.write(chunk);
    };
    const unsubscribeSlot = router.subscribeSlot(slot, {
      onOutput: (chunk) => terminalRef.current?.write(chunk),
      onSnapshot: replay,
      onRestore: replay,
    });

    let cancelled = false;
    // Send our measured grid WITH the subscribe request, not after it. The daemon resizes the PTY
    // before emitting the Snapshot, so a full-screen app (htop, vim) repaints at our width instead
    // of us replaying its 80-column byte stream into a much wider emulator and rendering scrambled
    // text. A client-side resize after attach is fundamentally too late: the snapshot is emitted
    // synchronously inside the daemon's subscribe, so those bytes are already on the wire.
    // Only send an authoritative measurement: a hidden panel measures 0×0 (`isMeasurable` false),
    // and it must not claim — its `performRefit` reconcile covers it once it becomes visible.
    const attachProposal = fitAddonRef.current?.proposeDimensions();
    const attachGrid: Grid | null =
      isMeasurable(attachProposal) && isSizeAuthority(tab.id) ? attachProposal : null;
    void client.connection
      .request<SubscribeTerminalResponse>("subscribe_terminal_request", {
        slot,
        ...(attachGrid ? { cols: attachGrid.cols, rows: attachGrid.rows } : {}),
      })
      .then((res) => {
        if (cancelled) return;
        setStatus({ isAttaching: false, error: null });
        // Flush input queued while no slot/router existed yet (feature-panels-ui.md §
        // Input/keys: "bounded pending queue flushed once attached + error-free").
        const pending = pendingInputRef.current;
        pendingInputRef.current = [];
        pendingInputBytesRef.current = 0;
        for (const bytes of pending) router.sendInput(slot, bytes);
        // Seed belief from the daemon's echo of the PTY's real size — including the case where we
        // sent nothing, which is how a hidden panel learns what it is attached to instead of
        // guessing. Falls back to what we asked for if an older daemon doesn't echo, and to `null`
        // ("unknown") if we asked for nothing either.
        const echoed = { cols: res?.cols, rows: res?.rows };
        believedSizeRef.current = isMeasurable(echoed) ? echoed : attachGrid;
        // Reconcile anything that changed while the request was in flight (the pane could have been
        // resized, or this panel could have just become the authority). Deduped against the belief
        // just seeded, so it is a no-op in the common case.
        measureAndClaim();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A failed attach has nowhere correct to send queued bytes — drop rather than flush.
        pendingInputRef.current = [];
        pendingInputBytesRef.current = 0;
        setStatus({ isAttaching: false, error: err instanceof Error ? err.message : String(err) });
      });

    return () => {
      cancelled = true;
      unsubscribeSlot();
      routerRef.current = null;
      void client.connection.request("unsubscribe_terminal_request", { slot }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, slot]);

  // ─── Re-fit whenever this tab becomes visible ─────────────────────────────────────────────
  // The `ResizeObserver` above catches divider drags and window resizes on its own (it observes
  // this panel's own box, which is what `TabPanelHost` sizes per pane); this covers the
  // hidden → visible transition, where the box was 0×0 while `display:none`. Routed through
  // `requestRefit` rather than fitting directly so it shares the same coalescing — a tab switch
  // during/adjacent to a layout gesture doesn't add a second immediate fit. No explicit claim
  // here: the refit's `fit()` fires `onResize` if the grid really changed, and that is the one
  // claim path. This is what makes a workspace switch self-correcting — the newly visible panel
  // becomes the size authority and its first non-zero measurement reports itself.
  useEffect(() => {
    if (!isVisible) return;
    requestRefit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.terminal} />
      {status.error ? (
        <div className={styles.statusOverlay}>Terminal error: {status.error}</div>
      ) : status.isAttaching ? (
        <div className={styles.statusOverlay}>
          <Spinner size="sm" /> Starting terminal…
        </div>
      ) : null}
    </div>
  );
}
