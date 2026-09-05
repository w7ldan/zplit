import "server-only";

import {
  getFriendLinkRequestMetadata,
  getFriendLinkRequestOutcomeMetadata,
  getGroupExpensePayerClaimMetadata,
  getGroupExpensePayerClaimOutcomeMetadata,
  getGroupInvitationMetadata,
  getGroupInvitationOutcomeMetadata,
  getGroupOffsetConfirmationMetadata,
  getGroupOffsetOutcomeMetadata,
  getGroupParticipantLinkMetadata,
  getGroupParticipantLinkOutcomeMetadata,
  getGroupSettlementConfirmationMetadata,
  getGroupSettlementOutcomeMetadata,
  getOrganizationInvitationMetadata,
  getOrganizationInvitationOutcomeMetadata,
  NOTIFICATION_TYPES,
  presentNotification,
} from "@/domain/notifications";
import { getCurrentUserFriendLinkRequestStatuses, type FriendLinkRequestStatus } from "@/server/friend-links";
import { getCurrentUserOrganizationInvitationStatuses, type OrganizationInvitationState } from "@/server/organization-invitations";
import { getCurrentUserGroupJoinRequestStatuses, type GroupJoinRequestState } from "@/server/group-join-requests";
import {
  getCurrentUserNotificationPage,
  getCurrentUserUnreadNotificationCount,
  type NotificationRecord,
} from "@/server/notifications";

export type InboxRowAction =
  | { kind: "friend"; requestId: string; status?: FriendLinkRequestStatus }
  | { kind: "organization"; invitationId: string; status?: OrganizationInvitationState }
  | { kind: "group"; requestId: string; requestKind: "member_invitation" | "participant_link"; status?: GroupJoinRequestState }
  | { kind: "expense"; groupId: string; expenseId: string }
  | { kind: "link"; href: string; label: string }
  | null;

function notificationAction(notification: NotificationRecord): InboxRowAction {
  const { type, metadata } = notification;
  switch (type) {
    case NOTIFICATION_TYPES.friendLinkRequest: {
      const parsed = getFriendLinkRequestMetadata(metadata);
      return parsed ? { kind: "friend", requestId: parsed.requestId } : null;
    }
    case NOTIFICATION_TYPES.friendLinkRequestOutcome: {
      const parsed = getFriendLinkRequestOutcomeMetadata(metadata);
      return parsed ? { kind: "link", href: `/app/friends/${encodeURIComponent(parsed.friendId)}`, label: "Open Friend" } : null;
    }
    case NOTIFICATION_TYPES.organizationInvitation: {
      const parsed = getOrganizationInvitationMetadata(metadata);
      return parsed ? { kind: "organization", invitationId: parsed.invitationId } : null;
    }
    case NOTIFICATION_TYPES.organizationInvitationOutcome: {
      const parsed = getOrganizationInvitationOutcomeMetadata(metadata);
      return parsed ? { kind: "link", href: `/app/organizations/${encodeURIComponent(parsed.organizationId)}`, label: "Open organization" } : null;
    }
    case NOTIFICATION_TYPES.groupInvitation: {
      const parsed = getGroupInvitationMetadata(metadata);
      return parsed ? { kind: "group", requestId: parsed.requestId, requestKind: "member_invitation" } : null;
    }
    case NOTIFICATION_TYPES.groupParticipantLinkRequest: {
      const parsed = getGroupParticipantLinkMetadata(metadata);
      return parsed ? { kind: "group", requestId: parsed.requestId, requestKind: "participant_link" } : null;
    }
    default:
      return groupFinancialOrOutcomeAction(notification);
  }
}

function groupFinancialOrOutcomeAction({ type, metadata }: NotificationRecord): InboxRowAction {
  switch (type) {
    case NOTIFICATION_TYPES.groupInvitationOutcome:
    case NOTIFICATION_TYPES.groupParticipantLinkOutcome: {
      const parsed = type === NOTIFICATION_TYPES.groupInvitationOutcome
        ? getGroupInvitationOutcomeMetadata(metadata)
        : getGroupParticipantLinkOutcomeMetadata(metadata);
      return parsed ? { kind: "link", href: `/app/personal/groups/${encodeURIComponent(parsed.groupId)}`, label: "Open Group" } : null;
    }
    case NOTIFICATION_TYPES.groupExpensePayerClaim: {
      const parsed = getGroupExpensePayerClaimMetadata(metadata);
      return parsed ? { kind: "expense", groupId: parsed.groupId, expenseId: parsed.expenseId } : null;
    }
    case NOTIFICATION_TYPES.groupExpensePayerClaimOutcome: {
      const parsed = getGroupExpensePayerClaimOutcomeMetadata(metadata);
      return parsed ? {
        kind: "link",
        href: `/app/personal/groups/${encodeURIComponent(parsed.groupId)}/expenses/${encodeURIComponent(parsed.expenseId)}`,
        label: "Open expense",
      } : null;
    }
    case NOTIFICATION_TYPES.groupSettlementConfirmation:
    case NOTIFICATION_TYPES.groupSettlementOutcome: {
      const parsed = type === NOTIFICATION_TYPES.groupSettlementConfirmation
        ? getGroupSettlementConfirmationMetadata(metadata)
        : getGroupSettlementOutcomeMetadata(metadata);
      return parsed ? {
        kind: "link",
        href: `/app/personal/groups/${encodeURIComponent(parsed.groupId)}/settlements/${encodeURIComponent(parsed.settlementId)}`,
        label: type === NOTIFICATION_TYPES.groupSettlementConfirmation ? "Review payment" : "Open payment",
      } : null;
    }
    case NOTIFICATION_TYPES.groupOffsetConfirmation:
    case NOTIFICATION_TYPES.groupOffsetOutcome: {
      const parsed = type === NOTIFICATION_TYPES.groupOffsetConfirmation
        ? getGroupOffsetConfirmationMetadata(metadata)
        : getGroupOffsetOutcomeMetadata(metadata);
      return parsed ? {
        kind: "link",
        href: `/app/personal/groups/${encodeURIComponent(parsed.groupId)}/settlements/offsets/${encodeURIComponent(parsed.offsetId)}`,
        label: type === NOTIFICATION_TYPES.groupOffsetConfirmation ? "Review offset" : "Open offset",
      } : null;
    }
    default:
      return null;
  }
}

export async function getCurrentUserInboxPage(requestedPage?: string) {
  const [page, unreadCount] = await Promise.all([
    getCurrentUserNotificationPage(requestedPage),
    getCurrentUserUnreadNotificationCount(),
  ]);
  const rows = page.rows.map((notification) => ({
    ...notification,
    presentation: presentNotification(notification.type, notification.metadata),
    action: notificationAction(notification),
  }));
  const [friendStatuses, organizationStatuses, groupStatuses] = await Promise.all([
    getCurrentUserFriendLinkRequestStatuses(rows.flatMap(({ action }) => action?.kind === "friend" ? [action.requestId] : [])),
    getCurrentUserOrganizationInvitationStatuses(rows.flatMap(({ action }) => action?.kind === "organization" ? [action.invitationId] : [])),
    getCurrentUserGroupJoinRequestStatuses(rows.flatMap(({ action }) => action?.kind === "group" ? [action.requestId] : [])),
  ]);
  for (const { action } of rows) {
    if (action?.kind === "friend") action.status = friendStatuses.get(action.requestId);
    if (action?.kind === "organization") action.status = organizationStatuses.get(action.invitationId);
    if (action?.kind === "group") action.status = groupStatuses.get(action.requestId);
  }
  return { ...page, rows, unreadCount };
}
