"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { GroupExpenseConfirmationState } from "@/domain/group-contracts";

type ConfirmationAction = (previousState: GroupExpenseConfirmationState, formData: FormData) => Promise<GroupExpenseConfirmationState>;

function useOptionalRouter() {
  try { return useRouter(); } catch { return null; }
}

function ConfirmButton() {
  const { pending } = useFormStatus();
  return <button className="action-link action-link--primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Confirming…" : "Confirm I paid"}</button>;
}

export function GroupExpenseConfirmation({ action }: { action: ConfirmationAction }) {
  const [state, formAction] = useActionState(action, { error: "" });
  const router = useOptionalRouter();
  useEffect(() => {
    if (state.success) router?.refresh();
  }, [router, state.success]);
  return <div className="group-expense__confirmation"><p>Confirming creates the expense’s participant-to-participant obligations.</p><form action={formAction}><ConfirmButton /></form><p className="group-expense__message" role={state.error ? "alert" : "status"} aria-live="polite">{state.error || state.success || "\u00a0"}</p></div>;
}
