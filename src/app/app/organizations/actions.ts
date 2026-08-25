"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { AvatarFileValidationError, validateAvatarFile } from "@/domain/avatar-file";
import { normalizeUserAvatar } from "@/server/user-avatars";
import { createOrganization, deleteOrganization, OrganizationError, updateOrganization } from "@/server/organizations";

export type OrganizationFormValues = { name: string; description: string };
export type OrganizationActionState = { fieldErrors: Partial<Record<keyof OrganizationFormValues | "avatar", string>>; formError: string; values: OrganizationFormValues };

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
    return { fieldErrors: {}, formError: error instanceof OrganizationError && error.code === "not_owner" ? "Only the organization owner can edit this profile." : "Unable to save this organization.", values };
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
