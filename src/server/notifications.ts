import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requireSession } from "@/auth/require-session";
import { normalizeNotificationMetadata, NOTIFICATION_STATE_CHANGED_EVENT, type NotificationMetadata, type NotificationType } from "@/domain/notifications";
import { getDatabase } from "@/db/client";
import { notifications } from "@/db/schema";
import { publishRealtimeEvent } from "@/server/realtime";

export const NOTIFICATIONS_PAGE_SIZE = 20;

type NotificationStateChangeReason = "created" | "read" | "read_all";

export type NotificationRecord = typeof notifications.$inferSelect;

export type NotificationPage = {
  rows: NotificationRecord[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

function assertUserId(userId: string) {
  if (typeof userId !== "string" || !userId.trim()) throw new TypeError("A notification user id is required");
}

export function normalizeNotificationPage(value: unknown) {
  const page = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 1;
  if (!Number.isSafeInteger(page) || page < 1) return 1;
  return Math.min(page, 10_000);
}

function publishStateChange(recipientUserId: string, reason: NotificationStateChangeReason) {
  try {
    publishRealtimeEvent(recipientUserId, {
      type: NOTIFICATION_STATE_CHANGED_EVENT,
      data: { reason },
    });
  } catch {
    // Durable notification state must survive an unavailable freshness channel.
  }
}

export type CreateNotificationInput<T extends NotificationType = NotificationType> = {
  recipientUserId: string;
  type: T;
  metadata: NotificationMetadata[T];
  dedupeKey?: string | null;
};

export async function createNotification<T extends NotificationType>(input: CreateNotificationInput<T>) {
  assertUserId(input.recipientUserId);
  if (input.dedupeKey !== undefined && input.dedupeKey !== null && (input.dedupeKey.trim() === "" || input.dedupeKey.length > 160)) {
    throw new TypeError("Notification dedupe key is invalid");
  }

  const [created] = await getDatabase()
    .insert(notifications)
    .values({
      recipientUserId: input.recipientUserId,
      type: input.type,
      metadata: normalizeNotificationMetadata(input.type, input.metadata),
      dedupeKey: input.dedupeKey ?? null,
    })
    .returning();
  if (!created) throw new Error("Notification was not created");
  publishStateChange(input.recipientUserId, "created");
  return created;
}

export async function getUnreadNotificationCountForUser(recipientUserId: string) {
  assertUserId(recipientUserId);
  const [result] = await getDatabase()
    .select({ total: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, recipientUserId), isNull(notifications.readAt)));
  return Number(result?.total ?? 0);
}

export async function listNotificationsForUser(recipientUserId: string, requestedPage: unknown = 1): Promise<NotificationPage> {
  assertUserId(recipientUserId);
  const [result] = await getDatabase()
    .select({ total: sql<number>`count(*)::int` })
    .from(notifications)
    .where(eq(notifications.recipientUserId, recipientUserId));
  const totalItems = Number(result?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / NOTIFICATIONS_PAGE_SIZE));
  const page = Math.min(normalizeNotificationPage(requestedPage), totalPages);
  const rows = await getDatabase()
    .select()
    .from(notifications)
    .where(eq(notifications.recipientUserId, recipientUserId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(NOTIFICATIONS_PAGE_SIZE)
    .offset((page - 1) * NOTIFICATIONS_PAGE_SIZE);
  return { rows, page, pageSize: NOTIFICATIONS_PAGE_SIZE, totalItems, totalPages };
}

export async function getCurrentUserNotificationPage(requestedPage: unknown = 1) {
  const session = await requireSession();
  return listNotificationsForUser(session.user.id, requestedPage);
}

export async function getCurrentUserUnreadNotificationCount() {
  const session = await requireSession();
  return getUnreadNotificationCountForUser(session.user.id);
}

export async function markNotificationReadForUser(recipientUserId: string, notificationId: string) {
  assertUserId(recipientUserId);
  if (typeof notificationId !== "string" || !notificationId.trim()) return false;
  const [updated] = await getDatabase()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.recipientUserId, recipientUserId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  if (!updated) return false;
  publishStateChange(recipientUserId, "read");
  return true;
}

export async function markCurrentUserNotificationRead(notificationId: string) {
  const session = await requireSession();
  return markNotificationReadForUser(session.user.id, notificationId);
}

export async function markAllNotificationsReadForUser(recipientUserId: string) {
  assertUserId(recipientUserId);
  const updated = await getDatabase()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientUserId, recipientUserId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  if (updated.length > 0) publishStateChange(recipientUserId, "read_all");
  return updated.length;
}

export async function markAllCurrentUserNotificationsRead() {
  const session = await requireSession();
  return markAllNotificationsReadForUser(session.user.id);
}
