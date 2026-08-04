"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/auth/require-session";
import { getAuth } from "@/auth/runtime";
import { createInvitation, normalizeInvitationEmail, normalizeSuggestedName, validateInvitationEmail, validateSuggestedName, revokeInvitation } from "@/auth/invitations";
import { getDatabase } from "@/db/client";

export type InviteActionState = {
  fieldErrors: { email?: string; suggestedName?: string };
  formError: string;
  values: { email: string; suggestedName: string };
  invitation: { link: string; email: string; expiresAt: string } | null;
};

const initialInviteActionState: InviteActionState = {
  fieldErrors: {},
  formError: "",
  values: { email: "", suggestedName: "" },
  invitation: null,
};

function valuesFromForm(formData: FormData) {
  return {
    email: normalizeInvitationEmail(formData.get("email")),
    suggestedName: normalizeSuggestedName(formData.get("suggestedName")),
  };
}

function invitationLink(baseURL: string, token: string) {
  return `${baseURL.replace(/\/+$/, "")}/join/${encodeURIComponent(token)}`;
}

export async function createInviteAction(
  _previousState: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const session = await requireSession();
  const values = valuesFromForm(formData);
  const fieldErrors: InviteActionState["fieldErrors"] = {};
  if (!validateInvitationEmail(values.email)) fieldErrors.email = "Enter a valid email address.";
  if (values.suggestedName && !validateSuggestedName(values.suggestedName)) fieldErrors.suggestedName = "Use 120 characters or fewer.";
  if (Object.keys(fieldErrors).length > 0) return { ...initialInviteActionState, fieldErrors, values };

  try {
    const { invitation, token } = await createInvitation(getDatabase(), {
      email: values.email,
      suggestedName: values.suggestedName || null,
      createdByUserId: session.user.id,
    });
    const baseURL = getAuth().options.baseURL;
    if (typeof baseURL !== "string") throw new Error("BETTER_AUTH_URL is unavailable");
    revalidatePath("/app/invites");
    return {
      ...initialInviteActionState,
      values,
      invitation: {
        link: invitationLink(baseURL, token),
        email: invitation.email,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    };
  } catch {
    return { ...initialInviteActionState, values, formError: "Unable to create this invitation." };
  }
}

export async function revokeInviteAction(id: string, _formData: FormData) {
  void _formData;
  const session = await requireSession();
  await revokeInvitation(getDatabase(), id, session.user.id);
  revalidatePath("/app/invites");
}
