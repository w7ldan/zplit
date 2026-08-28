"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { GroupExpenseConfirmationState } from "@/domain/group-contracts";

type ConfirmationAction = (previousState: GroupExpenseConfirmationState, formData: FormData) => Promise<GroupExpenseConfirmationState>;

function useOptionalRouter() {
  try { return useRouter(); } catch { return null; }
}

function SubmitButton({ label, pendingLabel, disabled = false }: { label: string; pendingLabel: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button className="action-link action-link--primary" type="submit" disabled={disabled || pending} aria-busy={pending}>{pending ? pendingLabel : label}</button>;
}

export function GroupExpenseConfirmation({ confirmAction, rejectAction }: { confirmAction: ConfirmationAction; rejectAction: ConfirmationAction }) {
  const [pendingDecision, setPendingDecision] = useState<"confirm" | "reject" | null>(null);
  const [confirmState, confirmFormAction] = useActionState(async (previousState: GroupExpenseConfirmationState, formData: FormData) => {
    const nextState = await confirmAction(previousState, formData);
    if (nextState.error) setPendingDecision(null);
    return nextState;
  }, { error: "" });
  const [rejectState, rejectFormAction] = useActionState(async (previousState: GroupExpenseConfirmationState, formData: FormData) => {
    const nextState = await rejectAction(previousState, formData);
    if (nextState.error) setPendingDecision(null);
    return nextState;
  }, { error: "" });
  const router = useOptionalRouter();
  useEffect(() => {
    if (confirmState.success || rejectState.success) router?.refresh();
  }, [confirmState.success, rejectState.success, router]);
  const error = confirmState.error || rejectState.error;
  return <div className="group-expense__confirmation"><p>Confirm that you paid this expense, or reject the claim that you paid it.</p><div className="group-expense__actions"><form action={confirmFormAction} onSubmit={() => setPendingDecision("confirm")}><SubmitButton label="Confirm I paid" pendingLabel="Confirming…" disabled={pendingDecision !== null} /></form><form action={rejectFormAction} onSubmit={() => setPendingDecision("reject")}><SubmitButton label="Reject claim" pendingLabel="Rejecting…" disabled={pendingDecision !== null} /></form></div><p className="group-expense__message" role={error ? "alert" : "status"} aria-live="polite">{error || "\u00a0"}</p></div>;
}

export function GroupExpenseVoid({ action }: { action: ConfirmationAction }) {
  const [state, formAction] = useActionState(action, { error: "" });
  const [understood, setUnderstood] = useState(false);
  const router = useOptionalRouter();
  useEffect(() => {
    if (state.success) router?.refresh();
  }, [router, state.success]);
  return <details className="group-expense__void"><summary className="text-link">Void expense</summary><div><p>This keeps the expense in history but removes its current balance effect. It is not a hard delete.</p><form action={formAction}><label className="group-expense__void-confirm"><input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} aria-describedby="group-expense-void-error" /><span>I understand this reverses the current balance effect.</span></label><p className="group-expense__message" id="group-expense-void-error" role={state.error ? "alert" : "status"} aria-live="polite">{state.error || "\u00a0"}</p><SubmitButton label="Void expense" pendingLabel="Voiding…" disabled={!understood} /></form></div></details>;
}
