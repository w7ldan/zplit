"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { DeletionImpact } from "@/domain/ledger-repository";

export type DeleteRecordActionState = { formError: string; impact?: DeletionImpact; impactRevision?: string };
export type DeleteRecordAction = (
  previousState: DeleteRecordActionState,
  formData: FormData,
) => Promise<DeleteRecordActionState>;

type DeleteRecordFormProps = {
  action: DeleteRecordAction;
  recordType: "outing" | "expense" | "repayment";
  impact: DeletionImpact;
  impactRevision: string;
};

const copy = {
  outing: {
    label: "Delete outing",
    pending: "Deleting outing…",
    consequence: "Deleting this outing removes the outing record and any dependent ledger data confirmed below.",
  },
  expense: {
    label: "Delete expense",
    pending: "Deleting expense…",
    consequence: "Deleting this expense removes the expense and any dependent ledger data confirmed below.",
  },
  repayment: {
    label: "Delete repayment",
    pending: "Deleting repayment…",
    consequence: "Deleting this repayment removes the repayment record and any allocation links confirmed below.",
  },
} as const;

function impactHasDependents(impact: DeletionImpact) {
  return impact.recordType === "outing"
    ? impact.expenseCount > 0 || impact.receiptCount > 0 || impact.shareCount > 0 || impact.allocationCount > 0
    : impact.recordType === "expense"
      ? impact.receiptCount > 0 || impact.shareCount > 0 || impact.allocationCount > 0
      : impact.allocationCount > 0;
}

function countLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function dependencySummary(impact: DeletionImpact) {
  if (impact.recordType === "outing") {
    return `Also permanently delete ${countLabel(impact.expenseCount, "expense")} and their related ${countLabel(impact.receiptCount, "receipt")}, ${countLabel(impact.shareCount, "share")}, and ${countLabel(impact.allocationCount, "allocation")}.`;
  }
  if (impact.recordType === "expense") {
    return `Also permanently delete this expense’s ${countLabel(impact.receiptCount, "receipt")}, ${countLabel(impact.shareCount, "share")}, and ${countLabel(impact.allocationCount, "allocation")}.`;
  }
  return `Also permanently remove this repayment’s ${countLabel(impact.allocationCount, "allocation")}.`;
}

function cascadeLabel(impact: DeletionImpact) {
  if (impact.recordType === "outing") return `Also delete ${countLabel(impact.expenseCount, "expense")} and related data`;
  if (impact.recordType === "expense") return "Also delete this expense’s related data";
  return `Also remove ${countLabel(impact.allocationCount, "allocation")}`;
}

function submitLabel(recordType: DeleteRecordFormProps["recordType"], impact: DeletionImpact, hasDependents: boolean) {
  if (!hasDependents) return copy[recordType].label;
  if (recordType === "outing") return `Delete outing and ${impact.recordType === "outing" ? impact.expenseCount : 0} expenses`;
  if (recordType === "expense") return "Delete expense and related data";
  return `Delete repayment and ${impact.recordType === "repayment" ? impact.allocationCount : 0} allocations`;
}

function SubmitButton({ recordType, impact, confirmed, cascadeConfirmed }: { recordType: DeleteRecordFormProps["recordType"]; impact: DeletionImpact; confirmed: boolean; cascadeConfirmed: boolean }) {
  const { pending } = useFormStatus();
  const hasDependents = impactHasDependents(impact);
  return (
    <button className="action-link delete-record-form__submit" type="submit" disabled={!confirmed || (hasDependents && !cascadeConfirmed) || pending} aria-busy={pending}>
      {pending ? copy[recordType].pending : submitLabel(recordType, impact, hasDependents)}
    </button>
  );
}

export function DeleteRecordForm({ action, recordType, impact, impactRevision }: DeleteRecordFormProps) {
  const [state, formAction] = useActionState(action, { formError: "" });
  const effectiveImpact = state.impact ?? impact;
  const effectiveImpactRevision = state.impactRevision ?? impactRevision;
  return <DeleteRecordFormRevision key={effectiveImpactRevision} state={state} formAction={formAction} recordType={recordType} impact={effectiveImpact} impactRevision={effectiveImpactRevision} />;
}

type DeleteRecordFormRevisionProps = Omit<DeleteRecordFormProps, "action"> & {
  state: DeleteRecordActionState;
  formAction: (formData: FormData) => void;
};

function DeleteRecordFormRevision({ state, formAction, recordType, impact, impactRevision }: DeleteRecordFormRevisionProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [cascadeConfirmed, setCascadeConfirmed] = useState(false);
  const details = copy[recordType];
  const hasDependents = impactHasDependents(impact);
  const errorId = `delete-${recordType}-error`;

  return (
    <section className="delete-record-form" aria-labelledby={`delete-${recordType}-heading`}>
      <p className="technical-label">DELETE RECORD</p>
      <h2 id={`delete-${recordType}-heading`}>{details.label}</h2>
      <p>{details.consequence}</p>
      {hasDependents ? (
        <div className="delete-record-form__summary" role="alert">
          <p>{dependencySummary(impact)}</p>
          {impact.recordType !== "repayment" && impact.allocationCount > 0 ? <p>The repayment records remain, but the removed amounts will become unallocated.</p> : null}
          {impact.recordType === "repayment" && impact.allocationCount > 0 ? <p>Expense shares remain; only this repayment’s allocation links are removed.</p> : null}
        </div>
      ) : null}
      <form action={formAction}>
        <input type="hidden" name="impactRevision" value={impactRevision} />
        <label className="delete-record-form__confirm">
          <input type="checkbox" name="confirm" value="delete" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} aria-describedby={errorId} />
          <span>Confirm deletion</span>
        </label>
        {hasDependents ? (
          <label className="delete-record-form__confirm delete-record-form__confirm--cascade">
            <input type="checkbox" name="confirmCascade" value="delete-dependents" checked={cascadeConfirmed} onChange={(event) => setCascadeConfirmed(event.target.checked)} aria-describedby={errorId} />
            <span>{cascadeLabel(impact)}</span>
          </label>
        ) : null}
        <p className="delete-record-form__message" id={errorId} role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
        <SubmitButton recordType={recordType} impact={impact} confirmed={confirmed} cascadeConfirmed={cascadeConfirmed} />
      </form>
    </section>
  );
}

const deletedMessages: Record<string, string> = {
  "/app/trips": "Trip deleted.",
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
