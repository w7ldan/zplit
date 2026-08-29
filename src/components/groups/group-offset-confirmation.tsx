"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { GroupOffsetConfirmationState } from "@/domain/group-contracts";

type ConfirmationAction = (
  previousState: GroupOffsetConfirmationState,
  formData: FormData,
) => Promise<GroupOffsetConfirmationState>;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="action-link action-link--primary"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Confirming offset…" : "Confirm offset"}
    </button>
  );
}

export function GroupOffsetConfirmation({ action }: { action: ConfirmationAction }) {
  const [state, formAction] = useActionState(action, { error: "" });
  const router = useRouter();

  useEffect(() => {
    if (state.success || state.error) router.refresh();
  }, [router, state.error, state.success]);

  return (
    <section className="group-settlement__confirmation" aria-labelledby="group-offset-confirm-heading">
      <h2 id="group-offset-confirm-heading">Review before confirming</h2>
      <p>Confirm only when you agree to cancel the equal reciprocal obligations. No money moves.</p>
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
