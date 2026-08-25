"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { AvatarFileValidationError, validateAvatarFile } from "@/domain/avatar-file";
import { isOrganizationInvitationRole, type OrganizationInvitationRole } from "@/domain/organization-permissions";
import { normalizeUserAvatar } from "@/server/user-avatars";
import { createOrganization, deleteOrganization, OrganizationError, updateOrganization } from "@/server/organizations";
import {
  createOrganizationInvitation,
  OrganizationInvitationError,
  revokeOrganizationInvitation,
  searchOrganizationInvitationUsers,
} from "@/server/organization-invitations";
import type { SearchableOption } from "@/components/records/searchable-combobox";

export type OrganizationFormValues = { name: string; description: string };
export type OrganizationActionState = { fieldErrors: Partial<Record<keyof OrganizationFormValues | "avatar", string>>; formError: string; values: OrganizationFormValues };
export type OrganizationInvitationActionState = { error: string; values: { username: string; role: OrganizationInvitationRole } };

function valuesFromForm(formData: FormData) {
  return { name: typeof formData.get("name") === "string" ? String(formData.get("name")) : "", description: typeof formData.get("description") === "string" ? String(formData.get("description")) : "" };
}

function validate(values: OrganizationFormValues): OrganizationActionState | null {
  const fieldErrors: OrganizationActionState["fieldErrors"] = {};
  if (!values.name.trim()) fieldErrors.name = "Enter an organization name.";
  else if (values.name.trim().length > 160) fieldErrors.name = "Use 160 characters or fewer.";
  if (values.description.trim().length > 1000) fieldErrors.description = "Use 1,000 characters or fewer.";
  return Object.keys(fieldErrors).length > 0 ? { fieldErrors, formError: "Please correct the marked fields.", values } : null;
}

async function readAvatar(formData: FormData) {
  const value = formData.get("avatar");
  if (!(value instanceof File) || value.size === 0) return undefined;
  try {
    return normalizeUserAvatar(validateAvatarFile({ bytes: new Uint8Array(await value.arrayBuffer()), filename: value.name, mediaType: value.type.trim().toLowerCase() }));
  } catch (error) {
    if (error instanceof AvatarFileValidationError) throw error;
    throw new AvatarFileValidationError("This avatar image could not be processed.");
  }
}

export async function createOrganizationAction(_previousState: OrganizationActionState, formData: FormData): Promise<OrganizationActionState> {
  const values = valuesFromForm(formData);
  const invalid = validate(values);
  if (invalid) return invalid;
  const session = await requireSession();
  let organization;
  try {
    const avatar = await readAvatar(formData);
    organization = await createOrganization(getDatabase(), session.user.id, { ...values, avatar });
  } catch (error) {
    if (error instanceof AvatarFileValidationError) return { fieldErrors: { avatar: error.message }, formError: "Please choose a valid image.", values };
    return { fieldErrors: {}, formError: error instanceof OrganizationError && error.code === "invalid_input" ? "Please correct the organization details." : "Unable to create this organization.", values };
  }
  revalidatePath("/app/organizations");
  redirect(`/app/organizations/${organization.id}`);
}

export async function updateOrganizationAction(organizationId: string, _previousState: OrganizationActionState, formData: FormData): Promise<OrganizationActionState> {
  const values = valuesFromForm(formData);
  const invalid = validate(values);
  if (invalid) return invalid;
  const session = await requireSession();
  try {
    await updateOrganization(getDatabase(), organizationId, session.user.id, values);
  } catch (error) {
    return { fieldErrors: {}, formError: error instanceof OrganizationError && error.code === "forbidden" ? "You do not have permission to edit this organization." : "Unable to save this organization.", values };
  }
  revalidatePath("/app/organizations");
  revalidatePath(`/app/organizations/${organizationId}`);
  return { fieldErrors: {}, formError: "Profile saved.", values };
}

export async function deleteOrganizationAction(organizationId: string) {
  const session = await requireSession();
  try {
    await deleteOrganization(getDatabase(), organizationId, session.user.id);
  } catch {
    // Do not reveal ownership or membership details through the response.
  }
  revalidatePath("/app/organizations");
  redirect("/app/organizations");
}

export async function searchOrganizationInvitationOptions(organizationId: string, query = ""): Promise<SearchableOption[]> {
  const session = await requireSession();
  try {
    return (await searchOrganizationInvitationUsers(getDatabase(), organizationId, session.user.id, query)).map((user) => ({ id: user.username, label: `${user.displayName} · @${user.username}` }));
  } catch {
    return [];
  }
}

function organizationInvitationErrorMessage(error: unknown) {
  if (!(error instanceof OrganizationInvitationError)) return "Unable to send this invitation.";
  return {
    invalid_id: "This organization is unavailable.",
    forbidden: "You do not have permission to invite this role.",
    invalid_role: "Choose Member, Treasurer, or Admin.",
    invalid_target: "Choose an existing Zplit username.",
    self: "You cannot invite yourself.",
    already_member: "That user is already a member of this organization.",
    duplicate: "That user already has a pending invitation.",
    not_found: "This invitation is no longer available.",
    resolved: "This invitation is no longer pending.",
    expired: "This invitation has expired.",
    stale_authority: "This invitation is no longer available.",
    conflict: "This invitation could not be completed.",
  }[error.code];
}

export async function createOrganizationInvitationAction(organizationId: string, previousState: OrganizationInvitationActionState, formData: FormData): Promise<OrganizationInvitationActionState> {
  const username = typeof formData.get("username") === "string" ? String(formData.get("username")) : "";
  const roleValue = formData.get("role") ?? "member";
  if (!isOrganizationInvitationRole(roleValue)) return { error: "Choose Member, Treasurer, or Admin.", values: { username, role: previousState.values.role } };
  if (!username.trim()) return { error: "Choose an existing Zplit username.", values: { username, role: roleValue } };
  const session = await requireSession();
  try {
    await createOrganizationInvitation(getDatabase(), organizationId, session.user.id, { username, role: roleValue });
  } catch (error) {
    return { error: organizationInvitationErrorMessage(error), values: { username, role: roleValue } };
  }
  revalidatePath(`/app/organizations/${organizationId}`);
  return { error: "Invitation sent.", values: { username: "", role: "member" } };
}

export async function revokeOrganizationInvitationAction(organizationId: string, invitationId: string) {
  const session = await requireSession();
  try {
    await revokeOrganizationInvitation(getDatabase(), organizationId, session.user.id, invitationId);
  } catch {
    // The organization page refetches canonical invitation state below.
  }
  revalidatePath(`/app/organizations/${organizationId}`);
}
