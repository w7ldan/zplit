import { normalizeUuid } from "@/domain/record-retrieval";
import { isOrganizationInvitationRole, type OrganizationInvitationRole } from "@/domain/organization-permissions";

export const NOTIFICATION_TYPES = {
  test: "system.test",
  friendLinkRequest: "friend.link.request",
  friendLinkRequestOutcome: "friend.link.request.outcome",
  organizationInvitation: "organization.invitation",
  organizationInvitationOutcome: "organization.invitation.outcome",
  groupInvitation: "group.invitation",
  groupInvitationOutcome: "group.invitation.outcome",
  groupParticipantLinkRequest: "group.participant.link.request",
  groupParticipantLinkOutcome: "group.participant.link.outcome",
  groupExpensePayerClaim: "group.expense.payer.claim",
  groupExpensePayerClaimOutcome: "group.expense.payer.claim.outcome",
  groupSettlementConfirmation: "group.settlement.confirmation",
  groupSettlementOutcome: "group.settlement.outcome",
  groupOffsetConfirmation: "group.offset.confirmation",
  groupOffsetOutcome: "group.offset.outcome",
} as const;
export const NOTIFICATION_STATE_CHANGED_EVENT = "notification.state.changed";

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export type NotificationMetadata = {
  "system.test": { message: string };
  "friend.link.request": {
    requestId: string;
    friendId?: string;
    requesterDisplayName: string;
    requesterUsername: string;
    friendName: string;
  };
  "friend.link.request.outcome": {
    requestId: string;
    friendId: string;
    status: "accepted" | "declined";
  };
  "organization.invitation": {
    invitationId: string;
    organizationId: string;
    organizationName: string;
    inviterDisplayName: string;
    role: OrganizationInvitationRole;
    expiresAt: string;
  };
  "organization.invitation.outcome": {
    invitationId: string;
    organizationId: string;
    status: "accepted" | "declined";
  };
  "group.invitation": {
    requestId: string;
    groupId: string;
    groupName: string;
    requesterDisplayName: string;
    requesterUsername: string | null;
    expiresAt: string;
  };
  "group.invitation.outcome": {
    requestId: string;
    groupId: string;
    status: "accepted" | "declined";
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
  "group.participant.link.outcome": {
    requestId: string;
    groupId: string;
    status: "accepted" | "declined";
  };
  "group.expense.payer.claim": {
    expenseId: string;
    groupId: string;
    groupName: string;
    description: string;
  };
  "group.expense.payer.claim.outcome": {
    expenseId: string;
    groupId: string;
    description: string;
    status: "confirmed" | "rejected";
  };
  "group.settlement.confirmation": {
    settlementId: string;
    groupId: string;
    groupName: string;
    senderParticipantId: string;
    senderDisplayName: string;
  };
  "group.settlement.outcome": {
    settlementId: string;
    groupId: string;
    status: "confirmed";
  };
  "group.offset.confirmation": {
    offsetId: string;
    groupId: string;
    groupName: string;
    initiatorParticipantId: string;
    initiatorDisplayName: string;
  };
  "group.offset.outcome": {
    offsetId: string;
    groupId: string;
    status: "confirmed";
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
  if (Object.keys(record).length !== 4 && Object.keys(record).length !== 5) return null;
  if (typeof record.requestId !== "string" || !/^[0-9a-f-]{36}$/.test(record.requestId)) return null;
  const friendId = record.friendId === undefined ? undefined : normalizeUuid(record.friendId);
  if (Object.keys(record).length === 5 && !friendId) return null;
  if (typeof record.requesterDisplayName !== "string" || !record.requesterDisplayName.trim() || record.requesterDisplayName.length > 120) return null;
  if (typeof record.requesterUsername !== "string" || !/^[a-z0-9][a-z0-9._]*[a-z0-9]$/.test(record.requesterUsername)) return null;
  if (typeof record.friendName !== "string" || !record.friendName.trim() || record.friendName.length > 120) return null;
  return {
    requestId: record.requestId,
    ...(friendId ? { friendId } : {}),
    requesterDisplayName: record.requesterDisplayName.trim(),
    requesterUsername: record.requesterUsername,
    friendName: record.friendName.trim(),
  };
}

function parseFriendLinkRequestOutcomeMetadata(value: unknown): NotificationMetadata["friend.link.request.outcome"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) return null;
  const requestId = normalizeUuid(record.requestId);
  const friendId = normalizeUuid(record.friendId);
  if (!requestId || !friendId || (record.status !== "accepted" && record.status !== "declined")) return null;
  return { requestId, friendId, status: record.status };
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

function parseOrganizationInvitationOutcomeMetadata(value: unknown): NotificationMetadata["organization.invitation.outcome"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) return null;
  const invitationId = normalizeUuid(record.invitationId);
  const organizationId = normalizeUuid(record.organizationId);
  if (!invitationId || !organizationId || (record.status !== "accepted" && record.status !== "declined")) return null;
  return { invitationId, organizationId, status: record.status };
}

function requesterFields(record: Record<string, unknown>) {
  if (typeof record.requesterDisplayName !== "string" || !record.requesterDisplayName.trim() || record.requesterDisplayName.length > 120) return null;
  if (record.requesterUsername !== null && (typeof record.requesterUsername !== "string" || !/^[a-z0-9][a-z0-9._]*[a-z0-9]$/.test(record.requesterUsername))) return null;
  return { requesterDisplayName: record.requesterDisplayName.trim(), requesterUsername: record.requesterUsername as string | null };
}

function groupRequestFields(value: unknown, fieldCount: number) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== fieldCount) return null;
  const requestId = normalizeUuid(record.requestId);
  const groupId = normalizeUuid(record.groupId);
  const requester = requesterFields(record);
  if (!requestId || !groupId || !requester) return null;
  if (typeof record.groupName !== "string" || !record.groupName.trim() || record.groupName.length > 160) return null;
  if (typeof record.expiresAt !== "string" || Number.isNaN(Date.parse(record.expiresAt))) return null;
  return { record, requestId, groupId, requester, groupName: record.groupName.trim(), expiresAt: new Date(record.expiresAt).toISOString() };
}

function parseGroupInvitationMetadata(value: unknown): NotificationMetadata["group.invitation"] | null {
  const fields = groupRequestFields(value, 6);
  if (!fields) return null;
  return { requestId: fields.requestId, groupId: fields.groupId, groupName: fields.groupName, ...fields.requester, expiresAt: fields.expiresAt };
}

function parseGroupInvitationOutcomeMetadata(value: unknown): NotificationMetadata["group.invitation.outcome"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) return null;
  const requestId = normalizeUuid(record.requestId);
  const groupId = normalizeUuid(record.groupId);
  if (!requestId || !groupId || (record.status !== "accepted" && record.status !== "declined")) return null;
  return { requestId, groupId, status: record.status };
}

function parseGroupParticipantLinkMetadata(value: unknown): NotificationMetadata["group.participant.link.request"] | null {
  const fields = groupRequestFields(value, 8);
  if (!fields) return null;
  const { record } = fields;
  if (typeof record.participantDisplayName !== "string" || !record.participantDisplayName.trim() || record.participantDisplayName.length > 160) return null;
  if (record.participantLabel !== null && (typeof record.participantLabel !== "string" || !record.participantLabel.trim() || record.participantLabel.length > 120)) return null;
  return {
    requestId: fields.requestId,
    groupId: fields.groupId,
    groupName: fields.groupName,
    ...fields.requester,
    participantDisplayName: record.participantDisplayName.trim(),
    participantLabel: typeof record.participantLabel === "string" ? record.participantLabel.trim() : null,
    expiresAt: fields.expiresAt,
  };
}

function parseGroupParticipantLinkOutcomeMetadata(value: unknown): NotificationMetadata["group.participant.link.outcome"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) return null;
  const requestId = normalizeUuid(record.requestId);
  const groupId = normalizeUuid(record.groupId);
  if (!requestId || !groupId || (record.status !== "accepted" && record.status !== "declined")) return null;
  return { requestId, groupId, status: record.status };
}

function parseGroupExpensePayerClaimMetadata(value: unknown): NotificationMetadata["group.expense.payer.claim"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4) return null;
  const expenseId = normalizeUuid(record.expenseId);
  const groupId = normalizeUuid(record.groupId);
  if (!expenseId || !groupId) return null;
  if (typeof record.groupName !== "string" || !record.groupName.trim() || record.groupName.length > 160) return null;
  if (typeof record.description !== "string" || !record.description.trim() || record.description.length > 200) return null;
  return { expenseId, groupId, groupName: record.groupName.trim(), description: record.description.trim() };
}

function parseGroupExpensePayerClaimOutcomeMetadata(value: unknown): NotificationMetadata["group.expense.payer.claim.outcome"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4) return null;
  const expenseId = normalizeUuid(record.expenseId);
  const groupId = normalizeUuid(record.groupId);
  if (!expenseId || !groupId) return null;
  if (typeof record.description !== "string" || !record.description.trim() || record.description.length > 200) return null;
  if (record.status !== "confirmed" && record.status !== "rejected") return null;
  return { expenseId, groupId, description: record.description.trim(), status: record.status };
}

function parseGroupSettlementConfirmationMetadata(value: unknown): NotificationMetadata["group.settlement.confirmation"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 5) return null;
  const settlementId = normalizeUuid(record.settlementId);
  const groupId = normalizeUuid(record.groupId);
  const senderParticipantId = normalizeUuid(record.senderParticipantId);
  if (!settlementId || !groupId || !senderParticipantId) return null;
  if (typeof record.groupName !== "string" || !record.groupName.trim() || record.groupName.length > 160) return null;
  if (typeof record.senderDisplayName !== "string" || !record.senderDisplayName.trim() || record.senderDisplayName.length > 160) return null;
  return {
    settlementId,
    groupId,
    groupName: record.groupName.trim(),
    senderParticipantId,
    senderDisplayName: record.senderDisplayName.trim(),
  };
}

function parseGroupSettlementOutcomeMetadata(value: unknown): NotificationMetadata["group.settlement.outcome"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) return null;
  const settlementId = normalizeUuid(record.settlementId);
  const groupId = normalizeUuid(record.groupId);
  if (!settlementId || !groupId || record.status !== "confirmed") return null;
  return { settlementId, groupId, status: "confirmed" };
}

function parseGroupOffsetConfirmationMetadata(value: unknown): NotificationMetadata["group.offset.confirmation"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 5) return null;
  const offsetId = normalizeUuid(record.offsetId);
  const groupId = normalizeUuid(record.groupId);
  const initiatorParticipantId = normalizeUuid(record.initiatorParticipantId);
  if (!offsetId || !groupId || !initiatorParticipantId) return null;
  if (typeof record.groupName !== "string" || !record.groupName.trim() || record.groupName.length > 160) return null;
  if (typeof record.initiatorDisplayName !== "string" || !record.initiatorDisplayName.trim() || record.initiatorDisplayName.length > 160) return null;
  return {
    offsetId,
    groupId,
    groupName: record.groupName.trim(),
    initiatorParticipantId,
    initiatorDisplayName: record.initiatorDisplayName.trim(),
  };
}

function parseGroupOffsetOutcomeMetadata(value: unknown): NotificationMetadata["group.offset.outcome"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3) return null;
  const offsetId = normalizeUuid(record.offsetId);
  const groupId = normalizeUuid(record.groupId);
  if (!offsetId || !groupId || record.status !== "confirmed") return null;
  return { offsetId, groupId, status: "confirmed" };
}

export function getFriendLinkRequestMetadata(value: unknown) {
  return parseFriendLinkRequestMetadata(value);
}

export function getFriendLinkRequestOutcomeMetadata(value: unknown) {
  return parseFriendLinkRequestOutcomeMetadata(value);
}

export function getOrganizationInvitationMetadata(value: unknown) {
  return parseOrganizationInvitationMetadata(value);
}

export function getOrganizationInvitationOutcomeMetadata(value: unknown) {
  return parseOrganizationInvitationOutcomeMetadata(value);
}

export function getGroupInvitationMetadata(value: unknown) {
  return parseGroupInvitationMetadata(value);
}

export function getGroupInvitationOutcomeMetadata(value: unknown) {
  return parseGroupInvitationOutcomeMetadata(value);
}

export function getGroupParticipantLinkMetadata(value: unknown) {
  return parseGroupParticipantLinkMetadata(value);
}

export function getGroupParticipantLinkOutcomeMetadata(value: unknown) {
  return parseGroupParticipantLinkOutcomeMetadata(value);
}

export function getGroupExpensePayerClaimMetadata(value: unknown) {
  return parseGroupExpensePayerClaimMetadata(value);
}

export function getGroupExpensePayerClaimOutcomeMetadata(value: unknown) {
  return parseGroupExpensePayerClaimOutcomeMetadata(value);
}

export function getGroupSettlementConfirmationMetadata(value: unknown) {
  return parseGroupSettlementConfirmationMetadata(value);
}

export function getGroupSettlementOutcomeMetadata(value: unknown) {
  return parseGroupSettlementOutcomeMetadata(value);
}

export function getGroupOffsetConfirmationMetadata(value: unknown) {
  return parseGroupOffsetConfirmationMetadata(value);
}

export function getGroupOffsetOutcomeMetadata(value: unknown) {
  return parseGroupOffsetOutcomeMetadata(value);
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
  "friend.link.request.outcome": {
    label: "Friend link outcome",
    parseMetadata: parseFriendLinkRequestOutcomeMetadata,
    present: (metadata: NotificationMetadata["friend.link.request.outcome"]): NotificationPresentation => ({
      label: "Friend link outcome",
      primary: `Your Friend link request was ${metadata.status}.`,
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
  "organization.invitation.outcome": {
    label: "Organization invitation outcome",
    parseMetadata: parseOrganizationInvitationOutcomeMetadata,
    present: (metadata: NotificationMetadata["organization.invitation.outcome"]): NotificationPresentation => ({
      label: "Organization invitation outcome",
      primary: `Your Organization invitation was ${metadata.status}.`,
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
  "group.invitation.outcome": {
    label: "Group invitation outcome",
    parseMetadata: parseGroupInvitationOutcomeMetadata,
    present: (metadata: NotificationMetadata["group.invitation.outcome"]): NotificationPresentation => ({
      label: "Group invitation outcome",
      primary: `Your Group invitation was ${metadata.status}.`,
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
  "group.participant.link.outcome": {
    label: "Group account link outcome",
    parseMetadata: parseGroupParticipantLinkOutcomeMetadata,
    present: (metadata: NotificationMetadata["group.participant.link.outcome"]): NotificationPresentation => ({
      label: "Group account link outcome",
      primary: `Your Group account link request was ${metadata.status}.`,
    }),
  },
  "group.expense.payer.claim": {
    label: "Group expense confirmation",
    parseMetadata: parseGroupExpensePayerClaimMetadata,
    present: (metadata: NotificationMetadata["group.expense.payer.claim"]): NotificationPresentation => ({
      label: "Group expense confirmation",
      primary: `Review the claim that you paid “${metadata.description}” in ${metadata.groupName}.`,
      secondary: "Confirm that you paid it or reject the claim.",
    }),
  },
  "group.expense.payer.claim.outcome": {
    label: "Group expense outcome",
    parseMetadata: parseGroupExpensePayerClaimOutcomeMetadata,
    present: (metadata: NotificationMetadata["group.expense.payer.claim.outcome"]): NotificationPresentation => ({
      label: "Group expense outcome",
      primary: `Your payer claim for “${metadata.description}” was ${metadata.status}.`,
    }),
  },
  "group.settlement.confirmation": {
    label: "Group payment confirmation",
    parseMetadata: parseGroupSettlementConfirmationMetadata,
    present: (metadata: NotificationMetadata["group.settlement.confirmation"]): NotificationPresentation => ({
      label: "Group payment confirmation",
      primary: `${metadata.senderDisplayName} recorded a payment to you in ${metadata.groupName}.`,
      secondary: "Confirmation is required.",
    }),
  },
  "group.settlement.outcome": {
    label: "Group payment outcome",
    parseMetadata: parseGroupSettlementOutcomeMetadata,
    present: (metadata: NotificationMetadata["group.settlement.outcome"]): NotificationPresentation => ({
      label: "Group payment outcome",
      primary: `Your Group payment was ${metadata.status}.`,
    }),
  },
  "group.offset.confirmation": {
    label: "Group offset confirmation",
    parseMetadata: parseGroupOffsetConfirmationMetadata,
    present: (metadata: NotificationMetadata["group.offset.confirmation"]): NotificationPresentation => ({
      label: "Group offset confirmation",
      primary: `${metadata.initiatorDisplayName} proposed an offset with you in ${metadata.groupName}.`,
      secondary: "No money moves; confirmation is required.",
    }),
  },
  "group.offset.outcome": {
    label: "Group offset outcome",
    parseMetadata: parseGroupOffsetOutcomeMetadata,
    present: (metadata: NotificationMetadata["group.offset.outcome"]): NotificationPresentation => ({
      label: "Group offset outcome",
      primary: `Your Group offset proposal was ${metadata.status}.`,
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
