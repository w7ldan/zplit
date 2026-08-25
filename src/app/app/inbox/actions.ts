"use server";

import { revalidatePath } from "next/cache";
import { markAllCurrentUserNotificationsRead, markCurrentUserNotificationRead } from "@/server/notifications";

export async function markNotificationReadAction(notificationId: string) {
  await markCurrentUserNotificationRead(notificationId);
  revalidatePath("/app/inbox");
}

export async function markAllNotificationsReadAction() {
  await markAllCurrentUserNotificationsRead();
  revalidatePath("/app/inbox");
}
