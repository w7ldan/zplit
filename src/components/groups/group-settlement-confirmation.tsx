"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { GroupSettlementConfirmationState } from "@/domain/group-contracts";

type ConfirmationAction = (
  previousState: GroupSettlementConfirmationState,
  formData: FormData,
) => Promise<GroupSettlementConfirmationState>;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="action-link action-link--primary"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Confirming payment…" : "Confirm payment received"}
    </button>
  );
}

export function GroupSettlementConfirmation({
  action,
}: {
  action: ConfirmationAction;
}) {
  const [state, formAction] = useActionState(action, { error: "" });
  const router = useRouter();

  useEffect(() => {
    if (state.success || state.error) router.refresh();
  }, [router, state.error, state.success]);

  return (
    <section className="group-settlement__confirmation" aria-labelledby="group-settlement-confirm-heading">
      <h2 id="group-settlement-confirm-heading">Review before confirming</h2>
      <p>Confirm only when this payment matches the money you received.</p>
      <form action={formAction}>
        <SubmitButton />
      </form>
      <p
        className="group-settlement__message"
        role={state.error ? "alert" : "status"}
        aria-live="polite"
      >
        {state.error || state.success || "\u00a0"}
      </p>
    </section>
  );
}
