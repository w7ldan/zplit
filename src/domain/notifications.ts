export const NOTIFICATION_TYPES = {
  test: "system.test",
  friendLinkRequest: "friend.link.request",
} as const;
export const NOTIFICATION_STATE_CHANGED_EVENT = "notification.state.changed";

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export type NotificationMetadata = {
  "system.test": { message: string };
  "friend.link.request": {
    requestId: string;
    requesterDisplayName: string;
    requesterUsername: string;
    friendName: string;
  };
};

export type NotificationPresentation = {
  label: string;
  primary: string;
  secondary?: string;
};

const MAX_MESSAGE_LENGTH = 240;

function parseTestMetadata(value: unknown): NotificationMetadata["system.test"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.message !== "string") return null;
  const message = record.message.trim();
  if (!message || message.length > MAX_MESSAGE_LENGTH) return null;
  return { message };
}

function parseFriendLinkRequestMetadata(value: unknown): NotificationMetadata["friend.link.request"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4) return null;
  if (typeof record.requestId !== "string" || !/^[0-9a-f-]{36}$/.test(record.requestId)) return null;
  if (typeof record.requesterDisplayName !== "string" || !record.requesterDisplayName.trim() || record.requesterDisplayName.length > 120) return null;
  if (typeof record.requesterUsername !== "string" || !/^[a-z0-9][a-z0-9._]*[a-z0-9]$/.test(record.requesterUsername)) return null;
  if (typeof record.friendName !== "string" || !record.friendName.trim() || record.friendName.length > 120) return null;
  return {
    requestId: record.requestId,
    requesterDisplayName: record.requesterDisplayName.trim(),
    requesterUsername: record.requesterUsername,
    friendName: record.friendName.trim(),
  };
}

export function getFriendLinkRequestMetadata(value: unknown) {
  return parseFriendLinkRequestMetadata(value);
}

export const notificationCatalog = {
  "system.test": {
    label: "System",
    parseMetadata: parseTestMetadata,
    present: (metadata: NotificationMetadata["system.test"]): NotificationPresentation => ({
      label: "System",
      primary: metadata.message,
    }),
  },
  "friend.link.request": {
    label: "Friend link",
    parseMetadata: parseFriendLinkRequestMetadata,
    present: (metadata: NotificationMetadata["friend.link.request"]): NotificationPresentation => ({
      label: "Friend link request",
      primary: `${metadata.requesterDisplayName} @${metadata.requesterUsername} wants to link “${metadata.friendName}”.`,
      secondary: "Identity confirmation only.",
    }),
  },
} as const;

export function normalizeNotificationMetadata<T extends NotificationType>(type: T, value: unknown): NotificationMetadata[T] {
  const definition = notificationCatalog[type];
  if (!definition) throw new TypeError(`Unsupported notification type ${type}`);
  const metadata = definition.parseMetadata(value);
  if (!metadata) throw new TypeError(`Invalid metadata for notification type ${type}`);
  return metadata as NotificationMetadata[T];
}

export function presentNotification(type: string, metadata: unknown): NotificationPresentation {
  const definition = notificationCatalog[type as NotificationType];
  if (!definition) return { label: "Update", primary: "You have a new notification." };
  const parsed = definition.parseMetadata(metadata);
  return parsed ? definition.present(parsed as never) : { label: "Update", primary: "You have a new notification." };
}
