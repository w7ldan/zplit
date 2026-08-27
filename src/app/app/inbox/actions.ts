"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/auth/require-session";
import { markAllCurrentUserNotificationsRead, markCurrentUserNotificationRead } from "@/server/notifications";
import { getDatabase } from "@/db/client";
import { respondToFriendLinkRequest, unlinkFriendLink } from "@/server/friend-links";
import { acceptOrganizationInvitation, declineOrganizationInvitation } from "@/server/organization-invitations";
import { acceptGroupJoinRequest, declineGroupJoinRequest } from "@/server/group-join-requests";

export async function markNotificationReadAction(notificationId: string) {
  await markCurrentUserNotificationRead(notificationId);
  revalidatePath("/app/inbox");
}

export async function markAllNotificationsReadAction() {
  await markAllCurrentUserNotificationsRead();
  revalidatePath("/app/inbox");
}

export async function acceptFriendLinkRequestAction(requestId: string) {
  const session = await requireSession();
  try {
    await respondToFriendLinkRequest(getDatabase(), session.user.id, requestId, "accept");
  } catch {
    // The request may already have been resolved by a competing action; the DB state is authoritative.
  }
  revalidatePath("/app/inbox");
}

export async function declineFriendLinkRequestAction(requestId: string) {
  const session = await requireSession();
  try {
    await respondToFriendLinkRequest(getDatabase(), session.user.id, requestId, "decline");
  } catch {
    // The request may already have been resolved by a competing action; the DB state is authoritative.
  }
  revalidatePath("/app/inbox");
}

export async function unlinkFriendLinkRequestAction(requestId: string) {
  const session = await requireSession();
  try {
    await unlinkFriendLink(getDatabase(), session.user.id, { requestId });
  } catch {
    // The Inbox refetches canonical state after a competing unlink.
  }
  revalidatePath("/app/inbox");
  revalidatePath("/app/friends");
}

export async function acceptOrganizationInvitationAction(invitationId: string) {
  const session = await requireSession();
  try {
    const result = await acceptOrganizationInvitation(getDatabase(), session.user.id, invitationId);
    revalidatePath(`/app/organizations/${result.organizationId}`);
    revalidatePath("/app/organizations");
  } catch {
    // The Inbox refetches canonical state after a competing or stale response.
  }
  revalidatePath("/app/inbox");
}

export async function declineOrganizationInvitationAction(invitationId: string) {
  const session = await requireSession();
  try {
    await declineOrganizationInvitation(getDatabase(), session.user.id, invitationId);
  } catch {
    // The Inbox refetches canonical state after a competing or stale response.
  }
  revalidatePath("/app/inbox");
}

export async function acceptGroupJoinRequestAction(requestId: string) {
  const session = await requireSession();
  try {
    const result = await acceptGroupJoinRequest(getDatabase(), session.user.id, requestId);
    revalidatePath(`/app/personal/groups/${result.groupId}`);
    revalidatePath(`/app/personal/groups/${result.groupId}/people`);
    revalidatePath("/app/personal/groups");
  } catch {
    // The Inbox refetches canonical state after a competing or stale response.
  }
  revalidatePath("/app/inbox");
}

export async function declineGroupJoinRequestAction(requestId: string) {
  const session = await requireSession();
  try {
    await declineGroupJoinRequest(getDatabase(), session.user.id, requestId);
  } catch {
    // The Inbox refetches canonical state after a competing or stale response.
  }
  revalidatePath("/app/inbox");
}
