"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { JoinActionState } from "@/app/join/[token]/actions";

type JoinAction = (previousState: JoinActionState, formData: FormData) => Promise<JoinActionState>;

const emptyState: JoinActionState = {
  fieldErrors: {},
  formError: "",
  values: { username: "", name: "" },
};

function FieldError({ id, message }: { id: string; message?: string }) {
  return <p className="invite-signup-form__field-error" id={id}>{message || "\u00a0"}</p>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="action-link action-link--primary invite-signup-form__submit" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Creating account…" : "Create account"}</button>;
}

export function InviteSignupForm({ email, suggestedName, action }: { email: string; suggestedName?: string | null; action: JoinAction }) {
  const [state, formAction] = useActionState(action, { ...emptyState, values: { username: "", name: suggestedName ?? "" } });
  return (
    <form className="invite-signup-form" action={formAction} noValidate>
      <div className="invite-signup-form__invitee">
        <span className="technical-label">Invited email</span>
        <strong>{email}</strong>
      </div>
      <div className="invite-signup-form__field">
        <label htmlFor="join-username">Username</label>
        <input id="join-username" name="username" autoComplete="username" required defaultValue={state.values.username} aria-invalid={Boolean(state.fieldErrors.username)} aria-describedby="join-username-error" />
        <FieldError id="join-username-error" message={state.fieldErrors.username} />
      </div>
      <div className="invite-signup-form__field">
        <label htmlFor="join-name">Your name</label>
        <input id="join-name" name="name" autoComplete="name" required defaultValue={state.values.name} aria-invalid={Boolean(state.fieldErrors.name)} aria-describedby="join-name-error" />
        <FieldError id="join-name-error" message={state.fieldErrors.name} />
      </div>
      <div className="invite-signup-form__field">
        <label htmlFor="join-password">Password</label>
        <input id="join-password" name="password" type="password" autoComplete="new-password" required aria-invalid={Boolean(state.fieldErrors.password)} aria-describedby="join-password-error" />
        <FieldError id="join-password-error" message={state.fieldErrors.password} />
      </div>
      <div className="invite-signup-form__field">
        <label htmlFor="join-confirm-password">Confirm password</label>
        <input id="join-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required aria-invalid={Boolean(state.fieldErrors.confirmPassword)} aria-describedby="join-confirm-password-error" />
        <FieldError id="join-confirm-password-error" message={state.fieldErrors.confirmPassword} />
      </div>
      <p className="invite-signup-form__hint">Use 16–128 characters. You will sign in through the normal login page after creating the account.</p>
      <p className="invite-signup-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">{state.formError || "\u00a0"}</p>
      <SubmitButton />
    </form>
  );
}
