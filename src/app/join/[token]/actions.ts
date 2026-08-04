"use server";

import { redirect } from "next/navigation";
import {
  acceptInvitation,
  INVITATION_UNAVAILABLE_ERROR,
  normalizeSuggestedName,
  validateInvitePassword,
  validateSuggestedName,
} from "@/auth/invitations";
import { getDatabase } from "@/db/client";

export type JoinActionState = {
  fieldErrors: { name?: string; password?: string; confirmPassword?: string };
  formError: string;
  values: { name: string };
};

const initialJoinActionState: JoinActionState = {
  fieldErrors: {},
  formError: "",
  values: { name: "" },
};

function valuesFromForm(formData: FormData) {
  return {
    name: normalizeSuggestedName(formData.get("name")),
    password: typeof formData.get("password") === "string" ? formData.get("password") as string : "",
    confirmPassword: typeof formData.get("confirmPassword") === "string" ? formData.get("confirmPassword") as string : "",
  };
}

export async function acceptInvitationAction(
  token: string,
  _previousState: JoinActionState,
  formData: FormData,
): Promise<JoinActionState> {
  const values = valuesFromForm(formData);
  const fieldErrors: JoinActionState["fieldErrors"] = {};
  if (!validateSuggestedName(values.name)) fieldErrors.name = "Enter your name using 120 characters or fewer.";
  const passwordError = validateInvitePassword(values.password);
  if (passwordError) fieldErrors.password = passwordError;
  if (values.password !== values.confirmPassword) fieldErrors.confirmPassword = "Passwords do not match.";
  if (Object.keys(fieldErrors).length > 0) {
    return { ...initialJoinActionState, fieldErrors, values: { name: values.name } };
  }

  try {
    await acceptInvitation(getDatabase(), token, { name: values.name, password: values.password });
  } catch {
    return { ...initialJoinActionState, values: { name: values.name }, formError: INVITATION_UNAVAILABLE_ERROR };
  }

  redirect("/login?joined=1");
}

export async function acceptInviteAction(token: string, previousState: JoinActionState, formData: FormData) {
  return acceptInvitationAction(token, previousState, formData);
}
