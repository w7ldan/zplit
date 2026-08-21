"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastAction = {
  label: string;
  onAction: () => void | string | Promise<void | string>;
};

export type ToastOptions = {
  message: string;
  action?: ToastAction;
  duration?: number;
};

type Toast = ToastOptions & { id: string; exiting?: boolean };

type ToastContextValue = {
  showToast: (options: ToastOptions) => string;
  dismissToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);
let nextToastId = 0;
const TOAST_EXIT_DURATION = 220;
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}

function ToastItem({ toast, dismiss, remove }: { toast: Toast; dismiss: (id: string) => void; remove: (id: string) => void }) {
  const [message, setMessage] = useState(toast.message);
  const [action, setAction] = useState(toast.action);
  const [entering, setEntering] = useState(() => !prefersReducedMotion());
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const [persistent, setPersistent] = useState(false);
  const remaining = useRef(toast.duration ?? 8000);
  const deadline = useRef<number | null>(null);
  const paused = hovered || focused || pending;

  useEffect(() => {
    if (!entering) return;
    const frame = window.requestAnimationFrame(() => setEntering(false));
    return () => window.cancelAnimationFrame(frame);
  }, [entering]);

  useEffect(() => {
    if (!toast.exiting) return;
    if (prefersReducedMotion()) {
      remove(toast.id);
      return;
    }
    const timer = window.setTimeout(() => remove(toast.id), TOAST_EXIT_DURATION);
    return () => window.clearTimeout(timer);
  }, [remove, toast.exiting, toast.id]);

  useEffect(() => {
    if (paused || persistent || toast.exiting) return;
    if (remaining.current <= 0) {
      dismiss(toast.id);
      return;
    }
    const expiresAt = Date.now() + remaining.current;
    deadline.current = expiresAt;
    const timer = window.setTimeout(() => dismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      if (deadline.current === expiresAt) remaining.current = Math.max(0, expiresAt - Date.now());
      deadline.current = null;
    };
  }, [dismiss, paused, persistent, toast.exiting, toast.id]);

  const runAction = async () => {
    if (!action || pending) return;
    setPending(true);
    try {
      const failure = await action.onAction();
      if (typeof failure === "string" && failure) {
        setMessage(failure);
        setAction(undefined);
        setPersistent(true);
      } else {
        dismiss(toast.id);
      }
    } catch {
      setMessage("Undo unavailable: the archive could not be reversed.");
      setAction(undefined);
      setPersistent(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="toast__position" data-toast-id={toast.id}>
      <div
        className={`toast${entering && !toast.exiting ? " toast--entering" : ""}${toast.exiting ? " toast--exiting" : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        <span className="toast__message">{message}</span>
        {action ? <button className="toast__action" type="button" onClick={runAction} disabled={pending}>{pending ? "Undoing…" : action.label}</button> : null}
        <button className="toast__dismiss" type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">×</button>
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const viewport = useRef<HTMLDivElement>(null);
  const previousToastPositions = useRef(new Map<string, number>());
  const repositionFrame = useRef<number | null>(null);

  useIsomorphicLayoutEffect(() => {
    const viewportElement = viewport.current;
    if (!viewportElement) return;
    const elements = Array.from(viewportElement.querySelectorAll<HTMLElement>("[data-toast-id]"));
    const reducedMotion = prefersReducedMotion();
    const nextPositions = new Map<string, number>();
    let moved = false;

    for (const element of elements) {
      const id = element.dataset.toastId;
      if (!id) continue;
      const top = element.getBoundingClientRect().top;
      const previousTop = previousToastPositions.current.get(id);
      nextPositions.set(id, top);
      if (!reducedMotion && previousTop !== undefined) {
        const offset = previousTop - top;
        if (Math.abs(offset) > 0.5) {
          element.style.setProperty("transition", "none");
          element.style.setProperty("--toast-layout-offset", `${offset}px`);
          moved = true;
        } else {
          element.style.removeProperty("transition");
          element.style.removeProperty("--toast-layout-offset");
        }
      } else {
        element.style.removeProperty("transition");
        element.style.removeProperty("--toast-layout-offset");
      }
    }
    previousToastPositions.current = nextPositions;

    if (reducedMotion || !moved) return;
    repositionFrame.current = window.requestAnimationFrame(() => {
      for (const element of elements) {
        element.style.removeProperty("transition");
        element.style.removeProperty("--toast-layout-offset");
      }
      repositionFrame.current = null;
    });

    return () => {
      if (repositionFrame.current !== null) {
        window.cancelAnimationFrame(repositionFrame.current);
        repositionFrame.current = null;
      }
      for (const element of elements) {
        element.style.removeProperty("transition");
        element.style.removeProperty("--toast-layout-offset");
      }
    };
  }, [toasts]);

  const showToast = useCallback((options: ToastOptions) => {
    const id = `toast-${++nextToastId}`;
    setToasts((current) => [...current, { ...options, id }].slice(-2));
    return id;
  }, []);
  const removeToast = useCallback((id: string) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const dismissToast = useCallback((id: string) => setToasts((current) => current.map((toast) => toast.id === id && !toast.exiting ? { ...toast, exiting: true } : toast)), []);
  const context = useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast]);

  return (
    <ToastContext.Provider value={context}>
      <div ref={viewport} className="toast-viewport" aria-label="Notifications">{toasts.map((toast) => <ToastItem key={toast.id} toast={toast} dismiss={dismissToast} remove={removeToast} />)}</div>
      {children}
    </ToastContext.Provider>
  );
}
