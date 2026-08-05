"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { FriendActionState } from "@/app/app/friends/actions";
import { friendPhoneFormValues, type FriendInputValues } from "@/domain/friend-input";
import { COUNTRY_CALLING_CODES, OTHER_COUNTRY_CODE } from "@/domain/country-calling-codes";

type FriendAction = (previousState: FriendActionState, formData: FormData) => Promise<FriendActionState>;

type FriendFormProps = {
  action: FriendAction;
  initialValues?: FriendInputValues;
  mode?: "create" | "edit";
};

const emptyValues: FriendInputValues = { name: "", phoneNumber: "", notes: "", countryCode: "+62", otherCountryCode: "", legacyPhoneNumber: "", phoneFieldsChanged: false };
const emptyActionState: FriendActionState = {
  fieldErrors: {},
  formError: "",
  values: emptyValues,
};

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  const label = mode === "create" ? "Add friend" : "Save changes";
  return (
    <button className="action-link action-link--primary friend-form__submit" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? (mode === "create" ? "Adding friend…" : "Saving changes…") : label}
    </button>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return <p className="friend-form__field-error" id={id}>{message || "\u00a0"}</p>;
}

export function FriendForm({ action, initialValues = emptyValues, mode = "create" }: FriendFormProps) {
  const [state, formAction] = useActionState(action, { ...emptyActionState, values: initialValues });
  const phoneValues = friendPhoneFormValues(state.values);
  const [selectedCountryCode, setSelectedCountryCode] = useState(phoneValues.countryCode);
  const markPhoneChanged = () => {
    const input = document.getElementById("friend-phone-fields-changed");
    if (input instanceof HTMLInputElement) input.value = "1";
  };
  return (
    <form key={`${state.values.name}\u0000${state.values.phoneNumber}\u0000${state.values.countryCode}\u0000${state.values.otherCountryCode}\u0000${state.values.notes}`} className="friend-form" action={formAction} noValidate>
      <div className="friend-form__field">
        <label htmlFor="friend-name">Name</label>
        <input
          id="friend-name"
          name="name"
          defaultValue={state.values.name}
          aria-invalid={Boolean(state.fieldErrors.name)}
          aria-describedby="friend-name-error"
          autoComplete="name"
        />
        <FieldError id="friend-name-error" message={state.fieldErrors.name} />
      </div>
      <div className="friend-form__field">
        <label htmlFor="friend-country-code">Country code</label>
        <select id="friend-country-code" name="countryCode" defaultValue={phoneValues.countryCode} onChange={(event) => { setSelectedCountryCode(event.target.value); markPhoneChanged(); }}>
          <option value="">No country code</option>
          {COUNTRY_CALLING_CODES.map((country) => <option key={country.value} value={country.value}>{country.label} {country.code}</option>)}
          <option value={OTHER_COUNTRY_CODE}>Other</option>
        </select>
        {selectedCountryCode === OTHER_COUNTRY_CODE ? <input id="friend-other-country-code" name="otherCountryCode" placeholder="+999" defaultValue={phoneValues.otherCountryCode} onChange={markPhoneChanged} aria-label="Other calling code" /> : null}
        <label htmlFor="friend-phone">Phone number</label>
        <input
          id="friend-phone"
          name="phoneNumber"
          defaultValue={phoneValues.phoneNumber}
          aria-invalid={Boolean(state.fieldErrors.phoneNumber)}
          aria-describedby="friend-phone-help friend-phone-error"
          autoComplete="tel"
          onChange={markPhoneChanged}
        />
        <p className="friend-form__help" id="friend-phone-help">Enter the national number without its domestic leading zero.</p>
        <input id="friend-phone-fields-changed" type="hidden" name="phoneFieldsChanged" defaultValue={phoneValues.legacyPhoneNumber ? "0" : "1"} />
        <input type="hidden" name="legacyPhoneNumber" value={phoneValues.legacyPhoneNumber} readOnly />
        <FieldError id="friend-phone-error" message={state.fieldErrors.phoneNumber} />
      </div>
      <div className="friend-form__field">
        <label htmlFor="friend-notes">Notes</label>
        <textarea
          id="friend-notes"
          name="notes"
          defaultValue={state.values.notes}
          aria-invalid={Boolean(state.fieldErrors.notes)}
          aria-describedby="friend-notes-error"
          rows={5}
        />
        <FieldError id="friend-notes-error" message={state.fieldErrors.notes} />
      </div>
      <p className="friend-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">
        {state.formError || "\u00a0"}
      </p>
      <SubmitButton mode={mode} />
    </form>
  );
}

type ArchiveAction = FriendAction;

function ArchiveSubmitButton({ archived }: { archived: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="action-link action-link--quiet friend-record__archive" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? (archived ? "Restoring…" : "Archiving…") : archived ? "Restore friend" : "Archive friend"}
    </button>
  );
}

export function FriendArchiveForm({ action, archived }: { action: ArchiveAction; archived: boolean }) {
  const [state, formAction] = useActionState(action, emptyActionState);
  return (
    <div className="friend-record__archive-wrap">
      <form action={formAction}>
        <ArchiveSubmitButton archived={archived} />
      </form>
      <p className="friend-form__message" role={state.formError ? "alert" : undefined} aria-live="polite">
        {state.formError || "\u00a0"}
      </p>
    </div>
  );
}
