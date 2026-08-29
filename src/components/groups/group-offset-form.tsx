"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { GroupOffsetActionState, GroupOffsetCounterpartyOption } from "@/domain/group-contracts";
import { formatRupiah } from "@/domain/rupiah";

type OffsetAction = (
  previousState: GroupOffsetActionState,
  formData: FormData,
) => Promise<GroupOffsetActionState>;

const emptyState: GroupOffsetActionState = {
  error: "",
  values: { counterpartyParticipantId: "" },
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      className="action-link action-link--primary"
      type="submit"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Proposing offset…" : "Propose offset"}
    </button>
  );
}

export function GroupOffsetForm({
  action,
  initiatorName,
  counterparties,
}: {
  action: OffsetAction;
  initiatorName: string;
  counterparties: GroupOffsetCounterpartyOption[];
}) {
  const [state, formAction] = useActionState(action, emptyState);
  const [counterpartyId, setCounterpartyId] = useState(
    state.values.counterpartyParticipantId || counterparties[0]?.id || "",
  );
  const selected = counterparties.find(
    (counterparty) => counterparty.id === counterpartyId,
  ) ?? counterparties[0];

  return (
    <form className="group-settlement-form group-offset-form" action={formAction}>
      <p className="group-settlement-form__context">
        You are proposing this offset as <strong>{initiatorName}</strong>. The counterparty must confirm it before it records any cancellation.
      </p>
      <div className="group-settlement-form__field">
        <label htmlFor="group-offset-counterparty">Offset with</label>
        <select
          id="group-offset-counterparty"
          name="counterpartyParticipantId"
          value={counterpartyId}
          onChange={(event) => setCounterpartyId(event.target.value)}
          required
          aria-describedby="group-offset-counterparty-help group-offset-error"
        >
          {counterparties.map((counterparty) => (
            <option key={counterparty.id} value={counterparty.id}>
              {counterparty.displayName}{counterparty.label ? ` · ${counterparty.label}` : ""}
            </option>
          ))}
        </select>
        <p className="group-settlement-form__help" id="group-offset-counterparty-help">
          The server computes the full reciprocal amount automatically. You cannot choose individual obligations.
        </p>
      </div>
      <div className="group-settlement-form__balance" aria-live="polite">
        <span>Automatic full offset amount</span>
        <strong>{formatRupiah(selected?.offsetAmount ?? 0)}</strong>
        <p>No money moves. This remains pending with no effect until the counterparty confirms.</p>
      </div>
      <SubmitButton />
      <p
        className="group-settlement-form__message"
        id="group-offset-error"
        role={state.error ? "alert" : "status"}
        aria-live="polite"
      >
        {state.error || "\u00a0"}
      </p>
    </form>
  );
}
