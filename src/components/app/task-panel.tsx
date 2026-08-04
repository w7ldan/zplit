"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
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

export function TaskPanel({ open, title, description, triggerId, children }: TaskPanelProps) {
  const router = useOptionalRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const openedRef = useRef(false);
  const closingRef = useRef(false);

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

  function close() {
    if (closingRef.current) return;
    closingRef.current = true;
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

  return (
    <dialog
      ref={dialogRef}
      className="task-panel"
      aria-labelledby="task-panel-title"
      aria-describedby="task-panel-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="task-panel__surface">
        <div className="task-panel__header">
          <div>
            <p className="technical-label">NEW RECORD</p>
            <h2 id="task-panel-title">{title}</h2>
            <p id="task-panel-description">{description}</p>
          </div>
          <button className="task-panel__close" type="button" onClick={close} aria-label="Close panel">Close</button>
        </div>
        <div className="task-panel__body">{children}</div>
      </div>
    </dialog>
  );
}
