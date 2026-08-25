"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { UsernameActionState, UsernameFormAction } from "@/app/app/settings/actions";
import { formatUsername } from "@/domain/username";

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button className="action-link action-link--primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save username"}</button>;
}

export function UsernameSettings({ username, action }: { username?: string | null; action: UsernameFormAction }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<UsernameActionState, FormData>(action, { error: "", value: username ?? "" });
  const formId = "settings-username-form";

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="settings-page__username">
      <div className="settings-page__username-current">
        <span>{formatUsername(username)}</span>
        <button ref={trigger} className="text-link" type="button" aria-expanded={open} aria-controls={formId} onClick={() => setOpen(true)}>{username ? "Edit" : "Set username"}</button>
      </div>
      {open ? (
        <div className="settings-page__disclosure" id={formId}>
          <p className="technical-label">EDIT USERNAME</p>
          <form key={state.value} className="username-form" action={formAction} noValidate>
            <div className="username-form__field">
              <label htmlFor="settings-username">Username</label>
              <input id="settings-username" name="username" autoComplete="username" defaultValue={state.value} required aria-invalid={Boolean(state.error)} aria-describedby="settings-username-error" />
              <p className="username-form__field-error" id="settings-username-error" role={state.error ? "alert" : undefined}>{state.error || "\u00a0"}</p>
            </div>
            <p className="username-form__hint">3–20 characters: letters, numbers, dots, or underscores. It will display as @{"username"}.</p>
            <div className="username-form__actions">
              <button className="action-link action-link--quiet" type="button" onClick={close}>Cancel</button>
              <SubmitButton />
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
