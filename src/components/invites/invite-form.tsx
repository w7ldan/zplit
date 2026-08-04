"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { InviteActionState } from "@/app/app/invites/actions";

type InviteAction = (previousState: InviteActionState, formData: FormData) => Promise<InviteActionState>;

const emptyState: InviteActionState = {
  fieldErrors: {},
  formError: "",
  values: { email: "", suggestedName: "" },
  invitation: null,
};

function FieldError({ id, message }: { id: string; message?: string }) {
  return <p className="invite-form__field-error" id={id}>{message || "\u00a0"}</p>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="action-link action-link--primary invite-form__submit" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Creating link…" : "Create invitation"}</button>;
}

export function InviteForm({ action }: { action: InviteAction }) {
  const [state, formAction] = useActionState(action, emptyState);
  return (
    <>
      <form className="invite-form" action={formAction} noValidate>
        <div className="invite-form__field">
          <label htmlFor="invite-email">Email address</label>
          <input id="invite-email" name="email" type="email" autoComplete="email" required defaultValue={state.values.email} aria-invalid={Boolean(state.fieldErrors.email)} aria-describedby="invite-email-error" />
          <FieldError id="invite-email-error" message={state.fieldErrors.email} />
        </div>
        <div className="invite-form__field">
          <label htmlFor="invite-suggested-name">Suggested name <span>(optional)</span></label>
          <input id="invite-suggested-name" name="suggestedName" autoComplete="name" defaultValue={state.values.suggestedName} aria-invalid={Boolean(state.fieldErrors.suggestedName)} aria-describedby="invite-suggested-name-error" />
          <FieldError id="invite-suggested-name-error" message={state.fieldErrors.suggestedName} />
        </div>
        <p className="invite-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
        <SubmitButton />
      </form>
      {state.invitation ? (
        <section className="invite-form__result" aria-label="Invitation ready" role="status">
          <p><strong>Invitation ready.</strong> Share this link with {state.invitation.email} before it expires.</p>
          <label htmlFor="invite-link">Temporary invitation link</label>
          <input id="invite-link" readOnly value={state.invitation.link} onFocus={(event) => event.currentTarget.select()} />
          <p className="technical-label">Expires {new Date(state.invitation.expiresAt).toLocaleString()}</p>
        </section>
      ) : null}
    </>
  );
}
