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
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { useTabStore } from "../../stores/tab-store.js";
import type { Tab, TerminalTabData } from "../../stores/tab-store.js";
import { Spinner } from "../../components/primitives/Spinner.js";
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
  useEffect(() => {
    if (!client || slotRef.current !== null) return;
    let cancelled = false;

    const cwd = data.cwd || "~";

    void client.connection
      .request<CreateTerminalResponse>("create_terminal_request", { workspaceId: "", cwd })
      .then((res) => {
        if (cancelled) return;
        const created = res.terminal.slot;
        slotRef.current = created;
        setSlot(created);
        useTabStore.getState().updateData(tab.id, { slot: created });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
    // Runs once per mount; slot creation is idempotent via slotRef guard.
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
