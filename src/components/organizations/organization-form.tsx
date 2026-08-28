"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { OrganizationActionState, OrganizationFormValues } from "@/domain/organization-contracts";

type OrganizationAction = (previousState: OrganizationActionState, formData: FormData) => Promise<OrganizationActionState>;

function SubmitButton({ edit }: { edit: boolean }) {
  const { pending } = useFormStatus();
  return <button className="action-link action-link--primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : edit ? "Save changes" : "Create organization"}</button>;
}

export function OrganizationForm({ action, initialValues, edit = false }: { action: OrganizationAction; initialValues?: OrganizationFormValues; edit?: boolean }) {
  const [state, formAction] = useActionState(action, { fieldErrors: {}, formError: "", values: initialValues ?? { name: "", description: "" } });
  return (
    <form className="organization-form" action={formAction} key={`${state.values.name}\u0000${state.values.description}`} noValidate>
      <div className="organization-form__field">
        <label htmlFor="organization-name">Name</label>
        <input id="organization-name" name="name" defaultValue={state.values.name} autoComplete="organization" aria-invalid={Boolean(state.fieldErrors.name)} aria-describedby="organization-name-error" />
        <p className="organization-form__field-error" id="organization-name-error">{state.fieldErrors.name || "\u00a0"}</p>
      </div>
      <div className="organization-form__field">
        <label htmlFor="organization-description">Description <span>(optional)</span></label>
        <textarea id="organization-description" name="description" rows={3} defaultValue={state.values.description} aria-invalid={Boolean(state.fieldErrors.description)} aria-describedby="organization-description-error" />
        <p className="organization-form__field-error" id="organization-description-error">{state.fieldErrors.description || "\u00a0"}</p>
      </div>
      {!edit ? <div className="organization-form__field"><label htmlFor="organization-avatar">Photo <span>(optional)</span></label><input id="organization-avatar" name="avatar" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="organization-avatar-help organization-avatar-error" /><p className="organization-form__help" id="organization-avatar-help">JPEG, PNG, or WebP. Zplit will normalize it safely.</p><p className="organization-form__field-error" id="organization-avatar-error">{state.fieldErrors.avatar || "\u00a0"}</p></div> : null}
      <p className="organization-form__message" role={state.formError && state.formError !== "Profile saved." ? "alert" : "status"} aria-live="polite">{state.formError || "\u00a0"}</p>
      <div className="organization-form__actions">{!edit ? <Link className="action-link action-link--quiet" href="/app/organizations">Cancel</Link> : null}<SubmitButton edit={edit} /></div>
    </form>
  );
}
