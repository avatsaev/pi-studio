/**
 * ToastContext — global toast management (queue, show, copied, error).
 * Consumes the sprint-012 toast model (buildToastEntry, EscStack, etc.)
 * ui-components.md § Feedback — Toasts
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import {
  buildToastEntry,
  copiedToast,
  errorToast,
  remainingMs,
  type ToastEntry,
  type ToastOptions,
} from "../../ui/toast.js";

let _idCounter = 0;
function nextId(): string {
  return `toast-${++_idCounter}`;
}

export interface ToastContextValue {
  toasts: ToastEntry[];
  show(content: string, opts?: ToastOptions): void;
  copied(label?: string): void;
  error(message: string): void;
  dismiss(id: string): void;
  pauseTimer(id: string): void;
  resumeTimer(id: string): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t) { clearTimeout(t); timersRef.current.delete(id); }
    setToasts((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const scheduleExpiry = useCallback(
    (entry: ToastEntry) => {
      if (entry.durationMs === null) return; // sticky
      const t = setTimeout(() => dismiss(entry.id), entry.durationMs);
      timersRef.current.set(entry.id, t);
    },
    [dismiss],
  );

  const show = useCallback(
    (content: string, opts: ToastOptions = {}) => {
      const entry = buildToastEntry(nextId(), content, opts);
      setToasts((prev) => [...prev, entry]);
      scheduleExpiry(entry);
    },
    [scheduleExpiry],
  );

  const copied = useCallback(
    (label?: string) => {
      const { content, opts } = copiedToast(label);
      show(content, opts);
    },
    [show],
  );

  const error = useCallback(
    (message: string) => {
      const { content, opts } = errorToast(message);
      show(content, opts);
    },
    [show],
  );

  const pauseTimer = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t) { clearTimeout(t); timersRef.current.delete(id); }
    setToasts((prev) =>
      prev.map((e) => (e.id === id ? { ...e, paused: true } : e)),
    );
  }, []);

  const resumeTimer = useCallback(
    (id: string) => {
      setToasts((prev) =>
        prev.map((e) => {
          if (e.id !== id) return e;
          const entry = { ...e, paused: false };
          // Re-schedule with remaining time.
          const remaining = remainingMs(entry, null, Date.now());
          if (remaining !== null && remaining > 0) {
            const t = setTimeout(() => dismiss(id), remaining);
            timersRef.current.set(id, t);
          } else if (remaining !== null) {
            dismiss(id);
          }
          return entry;
        }),
      );
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider
      value={{ toasts, show, copied, error, dismiss, pauseTimer, resumeTimer }}
    >
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
