import { normalizeUuid } from "@/domain/record-retrieval";
import { isOrganizationInvitationRole, type OrganizationInvitationRole } from "@/domain/organization-permissions";

export const NOTIFICATION_TYPES = {
  test: "system.test",
  friendLinkRequest: "friend.link.request",
  organizationInvitation: "organization.invitation",
  groupInvitation: "group.invitation",
  groupParticipantLinkRequest: "group.participant.link.request",
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
  "organization.invitation": {
    invitationId: string;
    organizationId: string;
    organizationName: string;
    inviterDisplayName: string;
    role: OrganizationInvitationRole;
    expiresAt: string;
  };
  "group.invitation": {
    requestId: string;
    groupId: string;
    groupName: string;
    requesterDisplayName: string;
    requesterUsername: string | null;
    expiresAt: string;
  };
  "group.participant.link.request": {
    requestId: string;
    groupId: string;
    groupName: string;
    requesterDisplayName: string;
    requesterUsername: string | null;
    participantDisplayName: string;
    participantLabel: string | null;
    expiresAt: string;
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

function parseOrganizationInvitationMetadata(value: unknown): NotificationMetadata["organization.invitation"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 6) return null;
  const invitationId = normalizeUuid(record.invitationId);
  const organizationId = normalizeUuid(record.organizationId);
  if (!invitationId || !organizationId) return null;
  if (typeof record.organizationName !== "string" || !record.organizationName.trim() || record.organizationName.length > 160) return null;
  if (typeof record.inviterDisplayName !== "string" || !record.inviterDisplayName.trim() || record.inviterDisplayName.length > 120) return null;
  if (!isOrganizationInvitationRole(record.role)) return null;
  if (typeof record.expiresAt !== "string" || Number.isNaN(Date.parse(record.expiresAt))) return null;
  return {
    invitationId,
    organizationId,
    organizationName: record.organizationName.trim(),
    inviterDisplayName: record.inviterDisplayName.trim(),
    role: record.role,
    expiresAt: new Date(record.expiresAt).toISOString(),
  };
}

function requesterFields(record: Record<string, unknown>) {
  if (typeof record.requesterDisplayName !== "string" || !record.requesterDisplayName.trim() || record.requesterDisplayName.length > 120) return null;
  if (record.requesterUsername !== null && (typeof record.requesterUsername !== "string" || !/^[a-z0-9][a-z0-9._]*[a-z0-9]$/.test(record.requesterUsername))) return null;
  return { requesterDisplayName: record.requesterDisplayName.trim(), requesterUsername: record.requesterUsername as string | null };
}

function parseGroupInvitationMetadata(value: unknown): NotificationMetadata["group.invitation"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 6) return null;
  const requestId = normalizeUuid(record.requestId);
  const groupId = normalizeUuid(record.groupId);
  const requester = requesterFields(record);
  if (!requestId || !groupId || !requester) return null;
  if (typeof record.groupName !== "string" || !record.groupName.trim() || record.groupName.length > 160) return null;
  if (typeof record.expiresAt !== "string" || Number.isNaN(Date.parse(record.expiresAt))) return null;
  return { requestId, groupId, groupName: record.groupName.trim(), ...requester, expiresAt: new Date(record.expiresAt).toISOString() };
}

function parseGroupParticipantLinkMetadata(value: unknown): NotificationMetadata["group.participant.link.request"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 8) return null;
  const requestId = normalizeUuid(record.requestId);
  const groupId = normalizeUuid(record.groupId);
  const requester = requesterFields(record);
  if (!requestId || !groupId || !requester) return null;
  if (typeof record.groupName !== "string" || !record.groupName.trim() || record.groupName.length > 160) return null;
  if (typeof record.participantDisplayName !== "string" || !record.participantDisplayName.trim() || record.participantDisplayName.length > 160) return null;
  if (record.participantLabel !== null && (typeof record.participantLabel !== "string" || !record.participantLabel.trim() || record.participantLabel.length > 120)) return null;
  if (typeof record.expiresAt !== "string" || Number.isNaN(Date.parse(record.expiresAt))) return null;
  return {
    requestId,
    groupId,
    groupName: record.groupName.trim(),
    ...requester,
    participantDisplayName: record.participantDisplayName.trim(),
    participantLabel: typeof record.participantLabel === "string" ? record.participantLabel.trim() : null,
    expiresAt: new Date(record.expiresAt).toISOString(),
  };
}

export function getFriendLinkRequestMetadata(value: unknown) {
  return parseFriendLinkRequestMetadata(value);
}

export function getOrganizationInvitationMetadata(value: unknown) {
  return parseOrganizationInvitationMetadata(value);
}

export function getGroupInvitationMetadata(value: unknown) {
  return parseGroupInvitationMetadata(value);
}

export function getGroupParticipantLinkMetadata(value: unknown) {
  return parseGroupParticipantLinkMetadata(value);
}

function roleLabel(role: OrganizationInvitationRole) {
  return role[0]?.toUpperCase() + role.slice(1);
}

function requesterLabel(metadata: { requesterDisplayName: string; requesterUsername: string | null }) {
  return `${metadata.requesterDisplayName}${metadata.requesterUsername ? ` @${metadata.requesterUsername}` : ""}`;
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
  "organization.invitation": {
    label: "Organization invitation",
    parseMetadata: parseOrganizationInvitationMetadata,
    present: (metadata: NotificationMetadata["organization.invitation"]): NotificationPresentation => ({
      label: "Organization invitation",
      primary: `${metadata.inviterDisplayName} invited you to join ${metadata.organizationName} as ${roleLabel(metadata.role)}.`,
    }),
  },
  "group.invitation": {
    label: "Group invitation",
    parseMetadata: parseGroupInvitationMetadata,
    present: (metadata: NotificationMetadata["group.invitation"]): NotificationPresentation => ({
      label: "Group invitation",
      primary: `${requesterLabel(metadata)} invited you to join ${metadata.groupName}.`,
    }),
  },
  "group.participant.link.request": {
    label: "Group account link",
    parseMetadata: parseGroupParticipantLinkMetadata,
    present: (metadata: NotificationMetadata["group.participant.link.request"]): NotificationPresentation => ({
      label: "Group account link",
      primary: `${requesterLabel(metadata)} wants to link your Zplit account to “${metadata.participantDisplayName}${metadata.participantLabel ? ` · ${metadata.participantLabel}` : ""}” in ${metadata.groupName}.`,
      secondary: "This links your account to an existing Group participant.",
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
