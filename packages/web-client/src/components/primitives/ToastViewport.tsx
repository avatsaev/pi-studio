/**
 * ToastViewport — single top-anchored toast stack, portalled to `document.body` (`Dialog.tsx`'s
 * `Portal` precedent; this app has no dedicated named overlay-root element, so `document.body`
 * matches what Radix's own `Portal` already defaults to for every other overlay). Mount exactly
 * once, at the app-shell level — `WorkspacePage.tsx`. ui-components.md § Feedback; visual spec §
 * 01 (`surface1` + per-variant rail), § 11 (stacking), § 13 (reduced motion).
 *
 * Exit animation is owned here, not in `toast-store.ts`: the store's `dismiss` is an immediate,
 * synchronous array removal — kept deliberately simple and Node-testable (task-005's own test
 * plan). This component instead keeps a small local cache of every toast it has rendered, and — on
 * noticing an id leave the store's array, from *either* auto-dismiss or a manual close click, both
 * of which only ever mutate the store — renders it a little longer with an `.exiting` class so its
 * opacity/slide transition can play, before dropping it from local state. Reduced motion skips the
 * lingering entirely: the exiting id is dropped in the same tick it leaves the store (§ 13).
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Icon } from "./Icon.js";
import { useToastStore, MAX_VISIBLE_TOASTS } from "@pi-studio-ui/stores/toast-store.js";
import { toastTokens, type ToastEntry } from "@pi-studio-ui/ui/toast.js";
import styles from "./ToastViewport.module.css";

const EXIT_MS = 180;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function ToastViewport() {
  // The store's own array: its identity changes only when the store does. The exit effect below
  // keys on it — keying on the sliced copy (a new array every render) re-ran the effect on every
  // render, and its cleanup cancelled the pending exit timer, stranding an invisible toast that
  // kept swallowing clicks on whatever sat under it.
  const toasts = useToastStore((s) => s.toasts);
  const storeToasts = toasts.slice(0, MAX_VISIBLE_TOASTS);
  const dismiss = useToastStore((s) => s.dismiss);
  const pause = useToastStore((s) => s.pause);
  const resume = useToastStore((s) => s.resume);

  // Render-phase cache update (not an effect): a memoization of "the last known content for every
  // id currently in the store", safe to mutate during render because it is idempotent per render
  // and never read until after this same render commits.
  const cacheRef = useRef<Map<string, ToastEntry>>(new Map());
  for (const t of storeToasts) cacheRef.current.set(t.id, t);

  const prevIdsRef = useRef<string[]>([]);
  const [exitingIds, setExitingIds] = useState<string[]>([]);
  // One timer per exit batch, cleared only on unmount — never by a later store change, which
  // would otherwise strand a toast still mid-exit when another one leaves within `EXIT_MS`.
  const exitTimersRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const timers = exitTimersRef.current;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const currentIds = toasts.slice(0, MAX_VISIBLE_TOASTS).map((t) => t.id);
    const currentSet = new Set(currentIds);
    const removed = prevIdsRef.current.filter((id) => !currentSet.has(id));
    prevIdsRef.current = currentIds;
    if (removed.length === 0) return;
    if (prefersReducedMotion()) {
      for (const id of removed) cacheRef.current.delete(id);
      return;
    }
    setExitingIds((prev) => [...prev, ...removed]);
    const timer = window.setTimeout(() => {
      exitTimersRef.current.delete(timer);
      setExitingIds((prev) => prev.filter((id) => !removed.includes(id)));
      for (const id of removed) cacheRef.current.delete(id);
    }, EXIT_MS);
    exitTimersRef.current.add(timer);
  }, [toasts]);

  const rendered: ToastEntry[] = [
    ...storeToasts,
    ...exitingIds
      .filter((id) => !storeToasts.some((t) => t.id === id))
      .map((id) => cacheRef.current.get(id))
      .filter((t): t is ToastEntry => t !== undefined),
  ];

  if (rendered.length === 0) return null;

  return createPortal(
    <div className={styles.viewport} role="status" aria-live="polite">
      {rendered.map((toast) => {
        const { token } = toastTokens(toast.variant);
        const isExiting =
          exitingIds.includes(toast.id) && !storeToasts.some((t) => t.id === toast.id);
        return (
          <div
            key={toast.id}
            className={isExiting ? `${styles.toast} ${styles.exiting}` : styles.toast}
            style={
              token ? ({ "--toast-rail": `var(--pi-color-${token})` } as CSSProperties) : undefined
            }
            onMouseEnter={() => pause(toast.id)}
            onMouseLeave={() => resume(toast.id)}
          >
            <span className={styles.content}>{toast.content}</span>
            <button
              type="button"
              className={styles.close}
              aria-label="Dismiss"
              onClick={() => dismiss(toast.id)}
            >
              <Icon icon={X} size="xs" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
