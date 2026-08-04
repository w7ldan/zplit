"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

type TaskPanelProps = {
  open: boolean;
  title: string;
  description: string;
  triggerId: string;
  children: ReactNode;
};

function clearCreateFlag() {
  const url = new URL(window.location.href);
  url.searchParams.delete("create");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function TaskPanel({ open, title, description, triggerId, children }: TaskPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open || visible === false) return;

    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.open = true;
    }

    const firstField = dialog.querySelector<HTMLElement>("input:not([type='hidden']), select, textarea") ?? dialog.querySelector<HTMLElement>("button");
    firstField?.focus();
  }, [open, visible]);

  function close() {
    const dialog = dialogRef.current;
    setVisible(false);
    if (dialog?.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.open = false;
    }
    clearCreateFlag();
    document.querySelector<HTMLElement>(`[data-task-trigger="${triggerId}"]`)?.focus();
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
