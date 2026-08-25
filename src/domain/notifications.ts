export const NOTIFICATION_TYPES = {
  test: "system.test",
} as const;
export const NOTIFICATION_STATE_CHANGED_EVENT = "notification.state.changed";

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export type NotificationMetadata = {
  "system.test": { message: string };
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

export const notificationCatalog = {
  "system.test": {
    label: "System",
    parseMetadata: parseTestMetadata,
    present: (metadata: NotificationMetadata["system.test"]): NotificationPresentation => ({
      label: "System",
      primary: metadata.message,
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
  if (type !== NOTIFICATION_TYPES.test) return { label: "Update", primary: "You have a new notification." };
  const parsed = notificationCatalog[type].parseMetadata(metadata);
  return parsed ? notificationCatalog[type].present(parsed) : { label: "Update", primary: "You have a new notification." };
}
