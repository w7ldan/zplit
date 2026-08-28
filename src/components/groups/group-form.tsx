"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { GroupActionState, GroupFormValues } from "@/domain/group-contracts";

type GroupAction = (previousState: GroupActionState, formData: FormData) => Promise<GroupActionState>;

function SubmitButton({ edit }: { edit: boolean }) {
  const { pending } = useFormStatus();
  return <button className="action-link action-link--primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : edit ? "Save changes" : "Create group"}</button>;
}

export function GroupForm({ action, initialValues, edit = false }: { action: GroupAction; initialValues?: GroupFormValues; edit?: boolean }) {
  const [state, formAction] = useActionState(action, { fieldErrors: {}, formError: "", values: initialValues ?? { name: "", description: "" } });
  return <form className="group-form" action={formAction} key={`${state.values.name}\u0000${state.values.description}`} noValidate>
    <div className="group-form__field"><label htmlFor="group-name">Name</label><input id="group-name" name="name" defaultValue={state.values.name} autoComplete="off" aria-invalid={Boolean(state.fieldErrors.name)} aria-describedby="group-name-error" /><p className="group-form__field-error" id="group-name-error">{state.fieldErrors.name || "\u00a0"}</p></div>
    <div className="group-form__field"><label htmlFor="group-description">Description <span>(optional)</span></label><textarea id="group-description" name="description" rows={3} defaultValue={state.values.description} aria-invalid={Boolean(state.fieldErrors.description)} aria-describedby="group-description-error" /><p className="group-form__field-error" id="group-description-error">{state.fieldErrors.description || "\u00a0"}</p></div>
    {!edit ? <div className="group-form__field"><label htmlFor="group-avatar">Photo <span>(optional)</span></label><input id="group-avatar" name="avatar" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="group-avatar-help group-avatar-error" /><p className="group-form__help" id="group-avatar-help">JPEG, PNG, or WebP. Zplit will normalize it safely.</p><p className="group-form__field-error" id="group-avatar-error">{state.fieldErrors.avatar || "\u00a0"}</p></div> : null}
    <p className="group-form__message" role={state.formError && state.formError !== "Profile saved." ? "alert" : "status"} aria-live="polite">{state.formError || "\u00a0"}</p>
    <div className="group-form__actions">{!edit ? <Link className="action-link action-link--quiet" href="/app/personal/groups">Cancel</Link> : null}<SubmitButton edit={edit} /></div>
  </form>;
}
