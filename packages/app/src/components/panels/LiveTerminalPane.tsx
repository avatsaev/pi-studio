/**
 * LiveTerminalPane — terminal pane wired to LIVE daemon PTY data.
 *
 * Flow: `create_terminal_request` → obtain a slot → `subscribe_terminal_request`
 * → the daemon pipes per-slot binary frames which the TerminalStreamRouter
 * demuxes into live output. Input keystrokes are sent back as binary Input
 * frames; a ResizeObserver sends Resize frames. Replaces the static
 * INITIAL_TERMINAL_PANE stub on the active pane path.
 *
 * A lightweight ANSI-stripped renderer is used (no xterm dependency in the web
 * build); it still displays real, live PTY output from the daemon.
 *
 * clean-room-scope/features/terminals.md, features/feature-panels-ui.md
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { TerminalStreamRouter } from "@av-pi-studio/client";
import styles from "./TerminalPane.module.css";
import { useClient } from "../../hooks/client-context.js";

// Strip ANSI escape / control sequences for the plain-text renderer.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[PX^_].*?\x1b\\|\x1b[@-Z\\-_]|[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
const MAX_BUFFER = 200_000;

type TerminalStatus = "connecting" | "connected" | "error";

export interface LiveTerminalPaneProps {
  serverId: string;
  workspaceId: string;
  terminalId: string;
  cwd: string | undefined;
  isActive: boolean;
}

interface DaemonLike {
  request<T = unknown>(type: string, payload?: unknown): Promise<T>;
}

export function LiveTerminalPane({ workspaceId, cwd, isActive }: LiveTerminalPaneProps) {
  const client = useClient();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const slotRef = useRef<number | null>(null);
  const routerRef = useRef<TerminalStreamRouter | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const decoderRef = useRef<TextDecoder | null>(null);

  // Create + subscribe the terminal once per mount.
  useEffect(() => {
    if (!client) return;
    const daemon = client.connection as unknown as DaemonLike & ConstructorParameters<typeof TerminalStreamRouter>[0];
    const decoder = new TextDecoder();
    decoderRef.current = decoder;
    const router = new TerminalStreamRouter(daemon);
    router.start();
    routerRef.current = router;

    let cancelled = false;
    let unsubSlot: (() => void) | null = null;

    const append = (data: Uint8Array) =>
      setText((prev) => (prev + decoder.decode(data, { stream: true })).slice(-MAX_BUFFER));
    const replace = (data: Uint8Array) => setText(decoder.decode(data));

    void (async () => {
      try {
        const res = await daemon.request<{ terminal?: { slot?: number } }>("create_terminal_request", {
          workspaceId,
          cwd,
          cols: 80,
          rows: 24,
        });
        const slot = res?.terminal?.slot;
        if (cancelled || typeof slot !== "number") {
          if (!cancelled) setStatus("error");
          return;
        }
        slotRef.current = slot;
        unsubSlot = router.subscribeSlot(slot, {
          onOutput: append,
          onSnapshot: replace,
          onRestore: replace,
        });
        await daemon.request("subscribe_terminal_request", { slot });
        if (!cancelled) setStatus("connected");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      unsubSlot?.();
      const slot = slotRef.current;
      if (slot != null) void daemon.request("unsubscribe_terminal_request", { slot }).catch(() => {});
      router.stop();
    };
  }, [client, workspaceId, cwd]);

  // Resize: estimate cols/rows from the body size and send a Resize frame.
  useEffect(() => {
    if (!isActive) return;
    const el = bodyRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const slot = slotRef.current;
        const router = routerRef.current;
        if (slot == null || !router) return;
        const rect = el.getBoundingClientRect();
        const cols = Math.max(1, Math.floor(rect.width / 8));
        const rows = Math.max(1, Math.floor(rect.height / 18));
        router.sendResize(slot, rows, cols);
      }, 120);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [isActive]);

  // Autoscroll to the newest output.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const slot = slotRef.current;
    const router = routerRef.current;
    if (slot == null || !router) return;
    const seq = keyToSequence(e);
    if (seq == null) return;
    e.preventDefault();
    router.sendInput(slot, new TextEncoder().encode(seq));
  }, []);

  const display = text.replace(ANSI_RE, "");

  return (
    <div className={styles.container}>
      <div
        ref={bodyRef}
        className={styles.terminalBody}
        role="textbox"
        aria-label="Terminal"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        style={{
          outline: "none",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontFamily: "var(--pi-font-mono, monospace)",
          fontSize: "var(--pi-font-size-xs, 12px)",
          lineHeight: 1.5,
          color: "var(--pi-terminal-fg, var(--pi-color-foreground))",
          background: "var(--pi-terminal-bg, var(--pi-color-surfaceWorkspace))",
          padding: "8px",
          overflow: "auto",
          height: "100%",
        }}
      >
        {display}
        {status === "error" && (
          <div style={{ color: "var(--pi-color-statusDanger)" }}>Terminal unavailable.</div>
        )}
      </div>
      <div className={styles.statusBar}>
        <span>{cwd ? (cwd.split("/").filter(Boolean).at(-1) ?? "terminal") : "terminal"}</span>
        <span>{status}</span>
      </div>
    </div>
  );
}

/** Translate a keydown into a byte sequence to send to the PTY. */
function keyToSequence(e: React.KeyboardEvent<HTMLDivElement>): string | null {
  if (e.metaKey) return null; // leave browser/OS shortcuts alone
  const { key, ctrlKey } = e;
  if (ctrlKey && key.length === 1 && /[a-zA-Z]/.test(key)) {
    return String.fromCharCode(key.toUpperCase().charCodeAt(0) - 64); // Ctrl-A..Z
  }
  switch (key) {
    case "Enter": return "\r";
    case "Backspace": return "\x7f";
    case "Tab": return "\t";
    case "Escape": return "\x1b";
    case "ArrowUp": return "\x1b[A";
    case "ArrowDown": return "\x1b[B";
    case "ArrowRight": return "\x1b[C";
    case "ArrowLeft": return "\x1b[D";
    case "Home": return "\x1b[H";
    case "End": return "\x1b[F";
    case "Delete": return "\x1b[3~";
    default:
      return key.length === 1 ? key : null;
  }
}
