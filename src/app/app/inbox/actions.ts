"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/auth/require-session";
import { markAllCurrentUserNotificationsRead, markCurrentUserNotificationRead } from "@/server/notifications";
import { getDatabase } from "@/db/client";
import { respondToFriendLinkRequest, unlinkFriendLink } from "@/server/friend-links";

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
