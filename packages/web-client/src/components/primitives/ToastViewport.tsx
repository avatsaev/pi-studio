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
  const storeToasts = useToastStore((s) => s.toasts).slice(0, MAX_VISIBLE_TOASTS);
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

  useEffect(() => {
    const currentIds = storeToasts.map((t) => t.id);
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
      setExitingIds((prev) => prev.filter((id) => !removed.includes(id)));
      for (const id of removed) cacheRef.current.delete(id);
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [storeToasts]);

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
