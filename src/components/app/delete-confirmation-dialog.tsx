"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

type DeleteConfirmationDialogProps = {
  title: string;
  entityName: string;
  confirmLabel: string;
  pendingLabel: string;
  action: (formData: FormData) => void | Promise<void>;
};

function ConfirmButton({
  confirmLabel,
  pendingLabel,
}: {
  confirmLabel: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className="action-link delete-confirmation-dialog__confirm"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? pendingLabel : confirmLabel}
    </button>
  );
}

export function DeleteConfirmationDialog({
  title,
  entityName,
  confirmLabel,
  pendingLabel,
  action,
}: DeleteConfirmationDialogProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) {
      cancelRef.current?.focus();
      return;
    }
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.open = true;
    cancelRef.current?.focus();
  }, [open ]);

  function close() {
    setOpen(false);
    const dialog = dialogRef.current;
    if (dialog?.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.open = false;
    }
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        className="action-link action-link--quiet"
        type="button"
        onClick={() => setOpen(true)}
      >
        {confirmLabel}
      </button>
      {open ? (
        <dialog
          ref={dialogRef}
          className="delete-confirmation-dialog"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>
            {`This will permanently delete “${entityName}”. This action cannot be undone.`}
          </p>
          <div className="delete-confirmation-dialog__actions">
            <button
              ref={cancelRef}
              className="action-link action-link--quiet"
              type="button"
              onClick={close}
            >
              Cancel
            </button>
            <form action={action}>
              <ConfirmButton
                confirmLabel={confirmLabel}
                pendingLabel={pendingLabel}
              />
            </form>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
