"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

export type DeleteRecordActionState = { formError: string };
export type DeleteRecordAction = (
  previousState: DeleteRecordActionState,
  formData: FormData,
) => Promise<DeleteRecordActionState>;

type DeleteRecordFormProps = {
  action: DeleteRecordAction;
  recordType: "outing" | "expense" | "repayment";
};

const copy = {
  outing: {
    label: "Delete outing",
    pending: "Deleting outing…",
    consequence: "Deleting this outing removes the outing record. It can be deleted only when it has no expenses.",
    restriction: "Move or delete this outing's expenses first.",
  },
  expense: {
    label: "Delete expense",
    pending: "Deleting expense…",
    consequence: "Deleting this expense removes its unallocated shares. It cannot be deleted while a share has a repayment allocation.",
    restriction: "Remove repayment allocations before deleting this expense.",
  },
  repayment: {
    label: "Delete repayment",
    pending: "Deleting repayment…",
    consequence: "Deleting this repayment removes the money-received record. It can be deleted only when it has no allocations.",
    restriction: "Remove this repayment's allocations before deleting it.",
  },
} as const;

function SubmitButton({ recordType, confirmed }: { recordType: DeleteRecordFormProps["recordType"]; confirmed: boolean }) {
  const { pending } = useFormStatus();
  const details = copy[recordType];
  return (
    <button className="action-link delete-record-form__submit" type="submit" disabled={!confirmed || pending} aria-busy={pending}>
      {pending ? details.pending : details.label}
    </button>
  );
}

export function DeleteRecordForm({ action, recordType }: DeleteRecordFormProps) {
  const [state, formAction] = useActionState(action, { formError: "" });
  const [confirmed, setConfirmed] = useState(false);
  const details = copy[recordType];
  const errorId = `delete-${recordType}-error`;

  return (
    <section className="delete-record-form" aria-labelledby={`delete-${recordType}-heading`}>
      <p className="technical-label">DELETE RECORD</p>
      <h2 id={`delete-${recordType}-heading`}>{details.label}</h2>
      <p>{details.consequence}</p>
      <p className="delete-record-form__restriction">{details.restriction}</p>
      <form action={formAction}>
        <label className="delete-record-form__confirm">
          <input type="checkbox" name="confirm" value="delete" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} aria-describedby={errorId} />
          <span>Confirm deletion</span>
        </label>
        <p className="delete-record-form__message" id={errorId} role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
        <SubmitButton recordType={recordType} confirmed={confirmed} />
      </form>
    </section>
  );
}

const deletedMessages: Record<string, string> = {
  "/app/outings": "Outing deleted.",
  "/app/expenses": "Expense deleted.",
  "/app/repayments": "Repayment deleted.",
};

export function DeleteConfirmation({ message }: { message?: string }) {
  const router = useRouter();
  const [visibleMessage, setVisibleMessage] = useState(message);

  useEffect(() => {
    const url = new URL(window.location.href);
    const hasDeletedFlag = url.searchParams.get("deleted") === "1";
    const resolvedMessage = message ?? (hasDeletedFlag ? deletedMessages[url.pathname] : undefined);
    if (!resolvedMessage) return;
    if (hasDeletedFlag) {
      url.searchParams.delete("deleted");
      router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    }
    const revealTimer = window.setTimeout(() => setVisibleMessage(resolvedMessage), 0);
    const timer = window.setTimeout(() => setVisibleMessage(undefined), 4000);
    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(timer);
    };
  }, [message, router]);

  return visibleMessage ? <p className="record-confirmation" role="status" aria-live="polite">{visibleMessage}</p> : null;
}
