"use server";

import { redirect } from "next/navigation";
import {
  acceptInvitation,
  claimInvitation,
  createInvitedCredentialAccount,
  normalizeSuggestedName,
  validateInvitePassword,
  validateSuggestedName,
} from "@/auth/invitations";
import { getDatabase } from "@/db/client";

export type JoinActionState = {
  fieldErrors: { name?: string; password?: string; confirmPassword?: string };
  formError: string;
  values: { name: string; password: string; confirmPassword: string };
};

const initialJoinActionState: JoinActionState = {
  fieldErrors: {},
  formError: "",
  values: { name: "", password: "", confirmPassword: "" },
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
    return { ...initialJoinActionState, fieldErrors, values: { ...values, password: "", confirmPassword: "" } };
  }

  let invitation;
  try {
    invitation = await claimInvitation(getDatabase(), token);
  } catch {
    return { ...initialJoinActionState, values: { name: values.name, password: "", confirmPassword: "" }, formError: "This invitation is unavailable." };
  }
  if (!invitation) {
    return { ...initialJoinActionState, values: { name: values.name, password: "", confirmPassword: "" }, formError: "This invitation is invalid, expired, revoked, or already used." };
  }

  let user;
  try {
    user = await createInvitedCredentialAccount({ name: values.name, email: invitation.email, password: values.password });
    if (!user) throw new Error("Account was not created");
    const accepted = await acceptInvitation(getDatabase(), invitation.id, user.id);
    if (!accepted) throw new Error("Invitation was not accepted");
  } catch {
    return { ...initialJoinActionState, values: { name: values.name, password: "", confirmPassword: "" }, formError: "Unable to complete this invitation." };
  }

  redirect("/login?created=1");
}

export async function acceptInviteAction(token: string, previousState: JoinActionState, formData: FormData) {
  return acceptInvitationAction(token, previousState, formData);
}
