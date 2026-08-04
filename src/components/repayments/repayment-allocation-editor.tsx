"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import type { RepaymentAllocationPlan } from "@/domain/ledger-repository";
import { formatRupiah, parseRupiah } from "@/domain/rupiah";
import type { RepaymentAllocationActionState } from "@/app/app/repayments/actions";

type RepaymentAllocationAction = (
  previousState: RepaymentAllocationActionState,
  formData: FormData,
) => Promise<RepaymentAllocationActionState>;

type RepaymentAllocationEditorProps = {
  action: RepaymentAllocationAction;
  plan: RepaymentAllocationPlan;
};

const emptyActionState: RepaymentAllocationActionState = { fieldErrors: {}, formError: "", values: [] };

function initialValues(plan: RepaymentAllocationPlan) {
  return plan.shares.map((share) => ({
    expenseShareId: share.expenseShareId,
    amountRupiah: share.currentAllocation ? share.currentAllocation.toString() : "",
  }));
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="action-link action-link--primary repayment-allocation-editor__submit" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Saving allocations…" : "Save allocations"}
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return <p className="repayment-allocation-editor__field-error" id={id} role={message ? "alert" : undefined}>{message || "\u00a0"}</p>;
}

export function RepaymentAllocationEditor({ action, plan }: RepaymentAllocationEditorProps) {
  const values = initialValues(plan);
  const [state, formAction] = useActionState(action, { ...emptyActionState, values });
  const [draftAmounts, setDraftAmounts] = useState<Record<string, string>>(() => Object.fromEntries(values.map((value) => [value.expenseShareId, value.amountRupiah])));

  if (plan.shares.length === 0) {
    return (
      <div className="repayment-allocation-editor repayment-allocation-editor--empty">
        <p className="technical-label">REPAYMENT ALLOCATIONS</p>
        <p>No outstanding shares for this friend.</p>
        <Link className="action-link" href="/app/expenses">Go to Expenses <span aria-hidden="true">→</span></Link>
      </div>
    );
  }

  const allocatedAmount = plan.shares.reduce((total, share) => total + (parseRupiah(draftAmounts[share.expenseShareId] ?? "") ?? 0), 0);
  const unallocatedAmount = Math.max(plan.amount - allocatedAmount, 0);

  return (
    <div className="repayment-allocation-editor">
      <p className="technical-label">REPAYMENT ALLOCATIONS</p>
      <h2>Apply the received money</h2>
      <div className="repayment-allocation-editor__totals" aria-live="polite">
        <div><span className="technical-label">Repayment amount</span><strong>{formatRupiah(plan.amount)}</strong></div>
        <div><span className="technical-label">Allocated</span><strong>{formatRupiah(allocatedAmount)}</strong></div>
        <div><span className="technical-label">Unallocated</span><strong>{formatRupiah(unallocatedAmount)}</strong></div>
      </div>
      <form className="repayment-allocation-editor__form" action={formAction} noValidate>
        <p className="repayment-allocation-editor__help">Enter a whole-rupiah amount. A blank field removes this allocation.</p>
        {plan.shares.map((share) => {
          const fieldErrorId = `repayment-allocation-${share.expenseShareId}-error`;
          const helpId = `repayment-allocation-${share.expenseShareId}-help`;
          return (
            <div className="repayment-allocation-editor__row" key={share.expenseShareId}>
              <div className="repayment-allocation-editor__details">
                <p className="repayment-allocation-editor__description">{share.expenseDescription}</p>
                <p className="repayment-allocation-editor__outing">{share.outingTitle} · <LocalDateTime iso={share.outingOccurredAt.toISOString()} mode="date" /></p>
                <dl>
                  <div><dt>Original amount owed</dt><dd>{formatRupiah(share.amountOwed)}</dd></div>
                  <div><dt>Repaid through other repayments</dt><dd>{formatRupiah(share.allocatedByOtherRepayments)}</dd></div>
                  <div><dt>Capacity available to this repayment</dt><dd>{formatRupiah(share.capacityAvailable)}</dd></div>
                </dl>
              </div>
              <div className="repayment-allocation-editor__field">
                <input type="hidden" name="expenseShareId" value={share.expenseShareId} />
                <label htmlFor={`repayment-allocation-${share.expenseShareId}`}>Amount to allocate to {share.expenseDescription}</label>
                <input
                  id={`repayment-allocation-${share.expenseShareId}`}
                  name="amountRupiah"
                  type="text"
                  inputMode="numeric"
                  value={draftAmounts[share.expenseShareId] ?? ""}
                  onChange={(event) => setDraftAmounts((current) => ({ ...current, [share.expenseShareId]: event.target.value }))}
                  aria-invalid={Boolean(state.fieldErrors[share.expenseShareId])}
                  aria-describedby={`${helpId} ${fieldErrorId}`}
                  autoComplete="off"
                />
                <p className="repayment-allocation-editor__help" id={helpId}>Blank removes this allocation.</p>
                <FieldError id={fieldErrorId} message={state.fieldErrors[share.expenseShareId]} />
              </div>
            </div>
          );
        })}
        <p className="repayment-allocation-editor__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
        <SubmitButton />
      </form>
    </div>
  );
}
