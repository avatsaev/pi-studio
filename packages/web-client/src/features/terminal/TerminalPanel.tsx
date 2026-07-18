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
 */

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { DaemonClient } from "@av-pi-studio/client";
import { TerminalStreamRouter } from "@av-pi-studio/client";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import type { Tab, TerminalTabData } from "@pi-studio-ui/stores/tab-store.js";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import styles from "./TerminalPanel.module.css";

export interface TerminalPanelProps {
  tab: Tab;
}

interface CreateTerminalResponse {
  terminal: { slot: number };
}

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
  const activeTabId = useTabStore((s) => s.activeTabId);
  const isActive = activeTabId === tab.id;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const slotRef = useRef<number | null>(data.slot);
  // Mirrors `use-checkout-status.ts`'s convention: kept in sync every render so the unmount-only
  // kill effect below always sends the CURRENT client, never a stale mount-time closure (e.g.
  // after a reconnect swaps in a new `PiStudioClient` instance).
  const clientRef = useRef(client);
  clientRef.current = client;

  const [slot, setSlot] = useState<number | null>(data.slot);
  const [error, setError] = useState<string | null>(null);

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

    void client.connection
      .request<CreateTerminalResponse>("create_terminal_request", { workspaceId: "", cwd })
      .then((res) => {
        const created = res.terminal.slot;
        if (!isMountedRef.current) {
          // A real close happened with no remount after it — kill the PTY that finished
          // spawning after the tab was already gone, instead of leaking it.
          void client.connection.request("kill_terminal_request", { slot: created }).catch(() => {});
          return;
        }
        slotRef.current = created;
        setSlot(created);
        useTabStore.getState().updateData(tab.id, { slot: created });
      })
      .catch((err: unknown) => {
        if (!isMountedRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
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
  useEffect(() => {
    return () => {
      const currentSlot = slotRef.current;
      if (currentSlot === null) return;
      void clientRef.current?.connection
        .request("kill_terminal_request", { slot: currentSlot })
        .catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── xterm mount (once slot + container are ready) ─────────────────────────────────────────
  useEffect(() => {
    if (!client || slot === null || !containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: TERMINAL_THEME,
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const router = routerFor(client.connection);
    const unsubscribeSlot = router.subscribeSlot(slot, {
      onOutput: (chunk) => terminal.write(chunk),
      onSnapshot: (chunk) => {
        terminal.clear();
        terminal.write(chunk);
      },
      onRestore: (chunk) => terminal.write(chunk),
    });

    void client.connection.request("subscribe_terminal_request", { slot }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });

    const dataDisposable = terminal.onData((chunk) => {
      router.sendInput(slot, new TextEncoder().encode(chunk));
    });
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      router.sendResize(slot, rows, cols);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      unsubscribeSlot();
      void client.connection.request("unsubscribe_terminal_request", { slot }).catch(() => {});
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, slot]);

  // ─── Re-fit whenever this tab becomes the active (visible) one ────────────────────────────
  useEffect(() => {
    if (!isActive) return;
    fitAddonRef.current?.fit();
  }, [isActive]);

  if (error) {
    return (
      <div className={styles.wrap}>
        <div className={styles.status}>Terminal error: {error}</div>
      </div>
    );
  }

  if (slot === null) {
    return (
      <div className={styles.wrap}>
        <div className={styles.status}>
          <Spinner size="sm" /> Starting terminal…
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div ref={containerRef} className={styles.terminal} />
    </div>
  );
}
