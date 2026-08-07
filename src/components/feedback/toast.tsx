"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}

function ToastItem({ toast, dismiss, remove }: { toast: Toast; dismiss: (id: string) => void; remove: (id: string) => void }) {
  const [message, setMessage] = useState(toast.message);
  const [action, setAction] = useState(toast.action);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const [persistent, setPersistent] = useState(false);
  const remaining = useRef(toast.duration ?? 8000);
  const deadline = useRef<number | null>(null);
  const paused = hovered || focused || pending;

  useEffect(() => {
    if (!toast.exiting) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      remove(toast.id);
      return;
    }
    const timer = window.setTimeout(() => remove(toast.id), 160);
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
    <div
      className={`toast${toast.exiting ? " toast--exiting" : ""}`}
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
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
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
      <div className="toast-viewport" aria-label="Notifications">{toasts.map((toast) => <ToastItem key={toast.id} toast={toast} dismiss={dismissToast} remove={removeToast} />)}</div>
      {children}
    </ToastContext.Provider>
  );
}
