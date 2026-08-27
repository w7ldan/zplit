"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { AvatarFileValidationError, validateAvatarFile } from "@/domain/avatar-file";
import { normalizeUserAvatar } from "@/server/user-avatars";
import { createExternalParticipant, createGroup, deleteExternalParticipant, deleteGroup, GroupError, removeGroupMember, updateExternalParticipant, updateGroup, updateGroupMemberRole } from "@/server/groups";
import type { SearchableOption } from "@/components/records/searchable-combobox";
import {
  createGroupInvitation,
  createGroupParticipantLinkRequest,
  GroupJoinRequestError,
  revokeGroupJoinRequest,
  searchGroupJoinUsers,
} from "@/server/group-join-requests";

export type GroupFormValues = { name: string; description: string };
export type GroupActionState = { fieldErrors: Partial<Record<keyof GroupFormValues | "avatar", string>>; formError: string; values: GroupFormValues };
export type GroupJoinRequestActionState = { error: string; values: { username: string } };

function valuesFromForm(formData: FormData): GroupFormValues {
  return { name: typeof formData.get("name") === "string" ? String(formData.get("name")) : "", description: typeof formData.get("description") === "string" ? String(formData.get("description")) : "" };
}

function validate(values: GroupFormValues): GroupActionState | null {
  const fieldErrors: GroupActionState["fieldErrors"] = {};
  if (!values.name.trim()) fieldErrors.name = "Enter a group name.";
  else if (values.name.trim().length > 160) fieldErrors.name = "Use 160 characters or fewer.";
  if (values.description.trim().length > 1000) fieldErrors.description = "Use 1,000 characters or fewer.";
  return Object.keys(fieldErrors).length ? { fieldErrors, formError: "Please correct the marked fields.", values } : null;
}

async function readAvatar(formData: FormData) {
  const value = formData.get("avatar");
  if (!(value instanceof File) || value.size === 0) return undefined;
  try { return normalizeUserAvatar(validateAvatarFile({ bytes: new Uint8Array(await value.arrayBuffer()), filename: value.name, mediaType: value.type.trim().toLowerCase() })); }
  catch (error) { if (error instanceof AvatarFileValidationError) throw error; throw new AvatarFileValidationError("This avatar image could not be processed."); }
}

export async function createGroupAction(_previousState: GroupActionState, formData: FormData): Promise<GroupActionState> {
  const values = valuesFromForm(formData);
  const invalid = validate(values);
  if (invalid) return invalid;
  const session = await requireSession();
  let group;
  try {
    group = await createGroup(getDatabase(), session.user.id, { ...values, avatar: await readAvatar(formData) });
  } catch (error) {
    if (error instanceof AvatarFileValidationError) return { fieldErrors: { avatar: error.message }, formError: "Please choose a valid image.", values };
    return { fieldErrors: {}, formError: error instanceof GroupError && error.code === "invalid_input" ? "Please correct the group details." : "Unable to create this group.", values };
  }
  revalidatePath("/app/personal");
  revalidatePath("/app/personal/groups");
  redirect(`/app/personal/groups/${group.id}`);
}

export async function updateGroupAction(groupId: string, _previousState: GroupActionState, formData: FormData): Promise<GroupActionState> {
  const values = valuesFromForm(formData);
  const invalid = validate(values);
  if (invalid) return invalid;
  const session = await requireSession();
  try { await updateGroup(getDatabase(), groupId, session.user.id, values); }
  catch (error) { return { fieldErrors: {}, formError: error instanceof GroupError && error.code === "forbidden" ? "You do not have permission to edit this group." : "Unable to save this group.", values }; }
  revalidatePath("/app/personal");
  revalidatePath("/app/personal/groups");
  revalidatePath(`/app/personal/groups/${groupId}`);
  return { fieldErrors: {}, formError: "Profile saved.", values };
}

export async function deleteGroupAction(groupId: string) {
  const session = await requireSession();
  try { await deleteGroup(getDatabase(), groupId, session.user.id); } catch { /* keep deletion details private */ }
  revalidatePath("/app/personal");
  revalidatePath("/app/personal/groups");
  redirect("/app/personal/groups");
}

function participantValues(formData: FormData) { return { displayName: typeof formData.get("displayName") === "string" ? String(formData.get("displayName")) : "", label: typeof formData.get("label") === "string" ? String(formData.get("label")) : "" }; }

export async function createExternalParticipantAction(groupId: string, formData: FormData) {
  const session = await requireSession();
  try { await createExternalParticipant(getDatabase(), groupId, session.user.id, participantValues(formData)); } catch { /* page refetches canonical state */ }
  revalidatePath(`/app/personal/groups/${groupId}`);
  revalidatePath(`/app/personal/groups/${groupId}/people`);
}

export async function updateExternalParticipantAction(groupId: string, participantId: string, formData: FormData) {
  const session = await requireSession();
  try { await updateExternalParticipant(getDatabase(), groupId, session.user.id, participantId, participantValues(formData)); } catch { /* page refetches canonical state */ }
  revalidatePath(`/app/personal/groups/${groupId}`);
  revalidatePath(`/app/personal/groups/${groupId}/people`);
}

export async function deleteExternalParticipantAction(groupId: string, participantId: string) {
  const session = await requireSession();
  try { await deleteExternalParticipant(getDatabase(), groupId, session.user.id, participantId); } catch { /* page refetches canonical state */ }
  revalidatePath(`/app/personal/groups/${groupId}`);
  revalidatePath(`/app/personal/groups/${groupId}/people`);
}

export async function updateGroupMemberRoleAction(groupId: string, targetUserId: string, formData: FormData) {
  const session = await requireSession();
  const role = formData.get("role");
  if (role === "admin" || role === "member") {
    try { await updateGroupMemberRole(getDatabase(), groupId, session.user.id, targetUserId, role); } catch { /* page refetches canonical state */ }
  }
  revalidatePath(`/app/personal/groups/${groupId}`);
  revalidatePath(`/app/personal/groups/${groupId}/people`);
}

export async function removeGroupMemberAction(groupId: string, targetUserId: string) {
  const session = await requireSession();
  try { await removeGroupMember(getDatabase(), groupId, session.user.id, targetUserId); } catch { /* page refetches canonical state */ }
  revalidatePath(`/app/personal/groups/${groupId}`);
  revalidatePath(`/app/personal/groups/${groupId}/people`);
}

export async function searchGroupJoinUserOptions(groupId: string, query = ""): Promise<SearchableOption[]> {
  const session = await requireSession();
  try {
    return (await searchGroupJoinUsers(getDatabase(), groupId, session.user.id, query)).map((user) => ({ id: user.username, label: `${user.displayName} · @${user.username}` }));
  } catch {
    return [];
  }
}

function groupJoinRequestErrorMessage(error: unknown, operation: "invite" | "link") {
  if (!(error instanceof GroupJoinRequestError)) return operation === "invite" ? "Unable to send this invitation." : "Unable to send this link request.";
  return {
    invalid_id: "This Group is unavailable.",
    forbidden: "You do not have permission to manage Group people.",
    invalid_target: "Choose an existing Zplit username.",
    self: "You cannot choose your own account.",
    already_member: "That user is already a member of this Group.",
    registered_participant: "That user already has a registered participant in this Group.",
    duplicate: "That user or participant already has a pending request.",
    not_found: "This request is no longer available.",
    resolved: "This request is no longer pending.",
    expired: "This request has expired.",
    stale_authority: "This request is no longer available.",
    participant_not_found: "This external participant is no longer available.",
    already_linked: "This participant is already linked.",
    conflict: "This request could not be completed.",
  }[error.code];
}

function joinUsername(formData: FormData) {
  return typeof formData.get("username") === "string" ? String(formData.get("username")) : "";
}

export async function createGroupInvitationAction(groupId: string, _previousState: GroupJoinRequestActionState, formData: FormData): Promise<GroupJoinRequestActionState> {
  const username = joinUsername(formData);
  if (!username.trim()) return { error: "Choose an existing Zplit username.", values: { username } };
  const session = await requireSession();
  try {
    await createGroupInvitation(getDatabase(), groupId, session.user.id, username);
  } catch (error) {
    return { error: groupJoinRequestErrorMessage(error, "invite"), values: { username } };
  }
  revalidatePath(`/app/personal/groups/${groupId}`);
  revalidatePath(`/app/personal/groups/${groupId}/people`);
  return { error: "Invitation sent.", values: { username: "" } };
}

export async function createGroupParticipantLinkRequestAction(groupId: string, participantId: string, _previousState: GroupJoinRequestActionState, formData: FormData): Promise<GroupJoinRequestActionState> {
  const username = joinUsername(formData);
  if (!username.trim()) return { error: "Choose an existing Zplit username.", values: { username } };
  const session = await requireSession();
  try {
    await createGroupParticipantLinkRequest(getDatabase(), groupId, participantId, session.user.id, username);
  } catch (error) {
    return { error: groupJoinRequestErrorMessage(error, "link"), values: { username } };
  }
  revalidatePath(`/app/personal/groups/${groupId}`);
  revalidatePath(`/app/personal/groups/${groupId}/people`);
  return { error: "Link request sent.", values: { username: "" } };
}

export async function revokeGroupJoinRequestAction(groupId: string, requestId: string) {
  const session = await requireSession();
  try {
    await revokeGroupJoinRequest(getDatabase(), groupId, session.user.id, requestId);
  } catch {
    // The Group People page refetches canonical request state.
  }
  revalidatePath(`/app/personal/groups/${groupId}`);
  revalidatePath(`/app/personal/groups/${groupId}/people`);
}
