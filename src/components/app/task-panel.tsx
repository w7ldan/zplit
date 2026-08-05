"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type TaskPanelProps = {
  open: boolean;
  title: string;
  description: string;
  triggerId: string;
  children: ReactNode;
};

function withoutCreateFlag() {
  const url = new URL(window.location.href);
  url.searchParams.delete("create");
  return `${url.pathname}${url.search}${url.hash}`;
}

function useOptionalRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

const panelExitFallbackMs = 260;

export function TaskPanel({ open, title, description, triggerId, children }: TaskPanelProps) {
  const router = useOptionalRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const openedRef = useRef(false);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const closeFrameRef = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      closingRef.current = false;
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog || openedRef.current) return;

    const activeElement = document.activeElement;
    triggerRef.current = activeElement instanceof HTMLElement && activeElement.dataset.taskTrigger ? activeElement : null;
    openedRef.current = true;
    closingRef.current = false;

    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.open = true;
    }

    const firstField = dialog.querySelector<HTMLElement>("input:not([type='hidden']), select, textarea") ?? dialog.querySelector<HTMLElement>("button");
    firstField?.focus();
  }, [open]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    if (closeFrameRef.current !== null) window.cancelAnimationFrame(closeFrameRef.current);
  }, []);

  function finalizeClose() {
    if (!closingRef.current) return;
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    if (closeFrameRef.current !== null) window.cancelAnimationFrame(closeFrameRef.current);
    closeTimerRef.current = null;
    closeFrameRef.current = null;
    const dialog = dialogRef.current;
    if (dialog?.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.open = false;
    }
    router?.replace(withoutCreateFlag(), { scroll: false });
    const trigger = triggerRef.current?.isConnected
      ? triggerRef.current
      : document.querySelector<HTMLElement>(`[data-task-trigger="${triggerId}"]`);
    trigger?.focus();
  }

  function close() {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced) {
      closeFrameRef.current = window.requestAnimationFrame(() => finalizeClose());
      closeTimerRef.current = window.setTimeout(() => finalizeClose(), 0);
    } else {
      closeTimerRef.current = window.setTimeout(() => finalizeClose(), panelExitFallbackMs);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={`task-panel${closing ? " task-panel--closing" : ""}`}
      aria-labelledby="task-panel-title"
      aria-describedby="task-panel-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onSubmit={(event) => {
        if (closingRef.current) event.preventDefault();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onTransitionEnd={(event) => {
        if (closing && event.target === event.currentTarget) finalizeClose();
      }}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) finalizeClose();
      }}
    >
      <div className="task-panel__surface">
        <div className="task-panel__header">
          <div>
            <p className="technical-label">NEW RECORD</p>
            <h2 id="task-panel-title">{title}</h2>
            <p id="task-panel-description">{description}</p>
          </div>
          <button className="task-panel__close" type="button" onClick={close} aria-label="Close panel" disabled={closing}>Close</button>
        </div>
        <div className="task-panel__body">{children}</div>
      </div>
    </dialog>
  );
}
