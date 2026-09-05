"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { AvatarFileValidationError, validateAvatarFile } from "@/domain/avatar-file";
import type { OrganizationActionState, OrganizationFormValues, OrganizationInvitationActionState } from "@/domain/organization-contracts";
import { isOrganizationInvitationRole } from "@/domain/organization-permissions";
import { normalizeUserAvatar } from "@/server/user-avatars";
import {
  addPersonalFriendAsOrganizationExpenseContact,
  archiveOrganization,
  createOrganization,
  deleteOrganization,
  OrganizationError,
  restoreOrganization,
  updateOrganization,
} from "@/server/organizations";
import {
  addPersonalFriendAsOrganizationParticipant,
  createLocalOrganizationParticipant,
  organizationParticipantErrorMessage,
} from "@/server/organization-participants";
import {
  createOrganizationInvitation,
  OrganizationInvitationError,
  revokeOrganizationInvitation,
  searchOrganizationInvitationUsers,
} from "@/server/organization-invitations";
import { listPersonalFriendCandidates } from "@/server/collaboration-candidates";
import { requireOrganizationAccess } from "@/server/organizations";
import type { SearchableOption } from "@/components/records/searchable-combobox";

export type { OrganizationActionState, OrganizationFormValues, OrganizationInvitationActionState } from "@/domain/organization-contracts";

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
  } catch (error) {
    if (error instanceof OrganizationError && error.code === "ledger_not_empty") {
      revalidatePath("/app/organizations");
      redirect(`/app/organizations/${organizationId}/settings?error=ledger_not_empty`);
    }
    if (
      error instanceof OrganizationError &&
      (error.code === "not_found" || error.code === "not_member" || error.code === "forbidden" || error.code === "invalid_id")
    ) {
      // Do not reveal ownership or membership details through the response.
      revalidatePath("/app/organizations");
      redirect("/app/organizations");
    }
    throw error;
  }
  revalidatePath("/app/organizations");
  redirect("/app/organizations");
}

export async function archiveOrganizationAction(organizationId: string) {
  const session = await requireSession();
  await archiveOrganization(getDatabase(), organizationId, session.user.id);
  revalidatePath("/app/organizations");
  revalidatePath(`/app/organizations/${organizationId}`);
  redirect(`/app/organizations/${organizationId}`);
}

export async function restoreOrganizationAction(organizationId: string) {
  const session = await requireSession();
  await restoreOrganization(getDatabase(), organizationId, session.user.id);
  revalidatePath("/app/organizations");
  revalidatePath(`/app/organizations/${organizationId}`);
  redirect(`/app/organizations/${organizationId}`);
}

function memberOption(candidate: Awaited<ReturnType<typeof listPersonalFriendCandidates>>[number]): SearchableOption {
  return candidate.kind === "local"
    ? { id: `personalFriend:${candidate.personalFriendId}`, label: `${candidate.displayName} · ${candidate.label ?? "Local friend"}` }
    : { id: candidate.userId!, label: `${candidate.displayName} · @${candidate.username} · Zplit friend` };
}

export async function searchOrganizationInvitationOptions(organizationId: string, query = ""): Promise<SearchableOption[]> {
  const session = await requireSession();
  try {
    if (!query.trim()) return [];
    const database = getDatabase();
    const access = await requireOrganizationAccess(database, organizationId, session.user.id);
    const friends = access.can("members.invite") || access.can("members.manage")
      ? (await listPersonalFriendCandidates(database, session.user.id, { kind: "organization", id: organizationId }, query))
        .filter((friend) => access.can("members.manage") || friend.kind !== "local")
      : [];
    const users = access.can("members.invite")
      ? await searchOrganizationInvitationUsers(database, organizationId, session.user.id, query)
      : [];
    const friendIds = new Set(friends.map((friend) => friend.userId));
    return [
      ...friends.map(memberOption),
      ...users
        .filter((user) => !friendIds.has(user.id))
        .map((user) => ({ id: user.id, label: `${user.displayName} · @${user.username} · Zplit user` })),
    ];
  } catch {
    return [];
  }
}

export async function searchOrganizationInvitationUserOptions(organizationId: string, query = ""): Promise<SearchableOption[]> {
  const session = await requireSession();
  try {
    if (!query.trim()) return [];
    return (await searchOrganizationInvitationUsers(getDatabase(), organizationId, session.user.id, query)).map((user) => ({
      id: user.id,
      label: `${user.displayName} · @${user.username}`,
    }));
  } catch {
    return [];
  }
}

export async function createLocalOrganizationParticipantAction(organizationId: string, formData: FormData) {
  const session = await requireSession();
  try {
    await createLocalOrganizationParticipant(getDatabase(), organizationId, session.user.id, {
      displayName: typeof formData.get("displayName") === "string" ? String(formData.get("displayName")) : "",
      label: typeof formData.get("label") === "string" ? String(formData.get("label")) : "",
    });
  } catch {
    // The Organization People page refetches canonical state below.
  }
  revalidatePath(`/app/organizations/${organizationId}`);
  revalidatePath(`/app/organizations/${organizationId}/people`);
}

export async function invitePersonalFriendToOrganizationAction(
  organizationId: string,
  userId: string,
  formData: FormData,
) {
  const role = formData.get("role");
  if (!isOrganizationInvitationRole(role)) return;
  const session = await requireSession();
  try {
    await createOrganizationInvitation(getDatabase(), organizationId, session.user.id, { targetUserId: userId, role });
  } catch {
    // The Organization People page refetches canonical state below.
  }
  revalidatePath(`/app/organizations/${organizationId}`);
  revalidatePath(`/app/organizations/${organizationId}/people`);
}

export async function addPersonalFriendAsOrganizationExpenseContactAction(
  organizationId: string,
  personalFriendId: string,
) {
  const session = await requireSession();
  try {
    await addPersonalFriendAsOrganizationExpenseContact(
      getDatabase(),
      organizationId,
      session.user.id,
      personalFriendId,
    );
  } catch {
    // The Organization People page refetches canonical state below.
  }
  revalidatePath(`/app/organizations/${organizationId}`);
  revalidatePath(`/app/organizations/${organizationId}/people`);
  revalidatePath(`/app/organizations/${organizationId}/friends`);
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
    duplicate: "That user or member already has a pending invitation.",
    not_found: "This invitation is no longer available.",
    resolved: "This invitation is no longer pending.",
    expired: "This invitation has expired.",
    stale_authority: "This invitation is no longer available.",
    conflict: "This invitation could not be completed.",
    participant_not_found: "This member is no longer available.",
  }[error.code];
}

export async function createOrganizationInvitationAction(organizationId: string, previousState: OrganizationInvitationActionState, formData: FormData): Promise<OrganizationInvitationActionState> {
  const selectedTarget = formData.get("targetUserId");
  const legacyUsername = formData.get("username");
  const targetUserId = typeof selectedTarget === "string"
    ? selectedTarget
    : typeof legacyUsername === "string"
      ? legacyUsername
      : "";
  const roleValue = formData.get("role") ?? "member";
  if (!isOrganizationInvitationRole(roleValue)) return { error: "Choose Member, Treasurer, or Admin.", values: { targetUserId, role: previousState.values.role } };
  if (!targetUserId.trim()) return { error: "Choose an existing Zplit username.", values: { targetUserId, role: roleValue } };
  const session = await requireSession();
  try {
    if (targetUserId.startsWith("personalFriend:")) {
      await addPersonalFriendAsOrganizationParticipant(getDatabase(), organizationId, session.user.id, targetUserId.slice("personalFriend:".length));
      revalidatePath(`/app/organizations/${organizationId}`);
      revalidatePath(`/app/organizations/${organizationId}/people`);
      return { error: "Member added.", values: { targetUserId: "", role: "member" } };
    }
    const canonicalUserId = targetUserId.startsWith("user:") ? targetUserId.slice("user:".length) : targetUserId;
    const participantId = formData.get("participantId");
    await createOrganizationInvitation(getDatabase(), organizationId, session.user.id, {
      targetUserId: canonicalUserId,
      ...(typeof participantId === "string" && participantId ? { participantId } : {}),
      role: roleValue,
    });
  } catch (error) {
    if (targetUserId.startsWith("personalFriend:")) {
      return { error: organizationParticipantErrorMessage(error), values: { targetUserId, role: roleValue } };
    }
    return { error: organizationInvitationErrorMessage(error), values: { targetUserId, role: roleValue } };
  }
  revalidatePath(`/app/organizations/${organizationId}`);
  return { error: "Invitation sent.", values: { targetUserId: "", role: "member" } };
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
