"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DeletionImpact } from "@/domain/ledger-repository";
import { formatRupiah } from "@/domain/rupiah";

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

function consequence(recordType: DeleteRecordFormProps["recordType"], impact: DeletionImpact) {
  if (recordType === "expense" && impact.allocationCount > 0) {
    return "Deleting this expense removes its shares. Zplit will automatically reassign affected repayment amounts to other outstanding expenses for the same friend where possible. Repayment amounts will not change; money that cannot be reassigned remains unallocated.";
  }
  return copy[recordType].consequence;
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
      <p>{consequence(recordType, impact)}</p>
      {hasDependents ? (
        <div className="delete-record-form__summary" role="alert">
          <p>{dependencySummary(impact)}</p>
          {impact.recordType === "outing" && impact.allocationCount > 0 ? <p>The repayment records remain, but the removed amounts will become unallocated.</p> : null}
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

type DeleteFeedback = { message: string; reviewRepayments: boolean };

const deletedMessages: Record<string, DeleteFeedback> = {
  "/app/trips": { message: "Trip deleted.", reviewRepayments: false },
  "/app/outings": { message: "Outing deleted.", reviewRepayments: false },
  "/app/expenses": { message: "Expense deleted.", reviewRepayments: false },
  "/app/repayments": { message: "Repayment deleted.", reviewRepayments: false },
};

function queryAmount(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : undefined;
}

function deletedFeedback(url: URL): DeleteFeedback | undefined {
  const normal = deletedMessages[url.pathname];
  if (!normal || url.pathname !== "/app/expenses") return normal;
  const reallocated = queryAmount(url.searchParams.get("reallocated"));
  const unallocated = queryAmount(url.searchParams.get("unallocated"));
  if (reallocated === undefined || unallocated === undefined || reallocated === 0 && unallocated === 0) return normal;
  if (unallocated === 0) return { message: `Expense deleted. ${formatRupiah(reallocated)} of repayment allocations was reassigned to other outstanding expenses.`, reviewRepayments: false };
  if (reallocated > 0) return { message: `Expense deleted. ${formatRupiah(reallocated)} was reassigned. ${formatRupiah(unallocated)} remains unallocated.`, reviewRepayments: true };
  return { message: `Expense deleted. ${formatRupiah(unallocated)} from affected repayments remains unallocated because there was no remaining outstanding capacity.`, reviewRepayments: true };
}

export function DeleteConfirmation({ message }: { message?: string }) {
  const router = useRouter();
  const [visibleFeedback, setVisibleFeedback] = useState<DeleteFeedback | undefined>(message ? { message, reviewRepayments: false } : undefined);

  useEffect(() => {
    const url = new URL(window.location.href);
    const hasDeletedFlag = url.searchParams.get("deleted") === "1";
    const feedback = message ? { message, reviewRepayments: false } : hasDeletedFlag ? deletedFeedback(url) : undefined;
    if (!feedback) return;
    if (hasDeletedFlag) {
      url.searchParams.delete("deleted");
      url.searchParams.delete("reallocated");
      url.searchParams.delete("unallocated");
      router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
    }
    const revealTimer = window.setTimeout(() => setVisibleFeedback(feedback), 0);
    const timer = window.setTimeout(() => setVisibleFeedback(undefined), 4000);
    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(timer);
    };
  }, [message, router]);

  return visibleFeedback ? <p className="record-confirmation" role="status" aria-live="polite">{visibleFeedback.message}{visibleFeedback.reviewRepayments ? <> <Link href="/app/repayments?allocation=needs">Review repayments</Link></> : null}</p> : null;
}
