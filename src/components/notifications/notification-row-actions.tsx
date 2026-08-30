import Link from "next/link";
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
} from "@/domain/notifications";
import type { NotificationRecord } from "@/server/notifications";
import type { FriendLinkRequestStatus } from "@/server/friend-links";
import type { OrganizationInvitationState } from "@/server/organization-invitations";
import type { GroupJoinRequestState } from "@/server/group-join-requests";
import { FriendLinkRequestActions } from "./friend-link-request";
import { OrganizationInvitationActions } from "./organization-invitation";
import { GroupJoinRequestActions } from "./group-join-request";
import { GroupExpensePayerClaimActions } from "./group-expense-payer-claim";

type NotificationRowActionsProps = {
  notification: NotificationRecord;
  friendLinkRequestStatuses: Map<string, FriendLinkRequestStatus>;
  organizationInvitationStatuses: Map<string, OrganizationInvitationState>;
  groupJoinRequestStatuses: Map<string, GroupJoinRequestState>;
};

function friendLinkActions(notification: NotificationRecord, statuses: Map<string, FriendLinkRequestStatus>) {
  if (notification.type === NOTIFICATION_TYPES.friendLinkRequest) {
    const metadata = getFriendLinkRequestMetadata(notification.metadata);
    return metadata ? (
      <FriendLinkRequestActions
        requestId={metadata.requestId}
        friendId={metadata.friendId}
        status={statuses.get(metadata.requestId)}
      />
    ) : null;
  }
  const metadata = getFriendLinkRequestOutcomeMetadata(notification.metadata);
  return metadata ? (
    <Link className="text-link" href={`/app/friends/${encodeURIComponent(metadata.friendId)}`}>
      Open Friend
    </Link>
  ) : null;
}

function organizationActions(notification: NotificationRecord, statuses: Map<string, OrganizationInvitationState>) {
  if (notification.type === NOTIFICATION_TYPES.organizationInvitation) {
    const metadata = getOrganizationInvitationMetadata(notification.metadata);
    return metadata ? (
      <OrganizationInvitationActions
        invitationId={metadata.invitationId}
        status={statuses.get(metadata.invitationId)}
      />
    ) : null;
  }
  const metadata = getOrganizationInvitationOutcomeMetadata(notification.metadata);
  return metadata ? (
    <Link className="text-link" href={`/app/organizations/${encodeURIComponent(metadata.organizationId)}`}>
      Open organization
    </Link>
  ) : null;
}

function groupJoinActions(notification: NotificationRecord, statuses: Map<string, GroupJoinRequestState>) {
  if (notification.type === NOTIFICATION_TYPES.groupInvitation) {
    const metadata = getGroupInvitationMetadata(notification.metadata);
    return metadata ? (
      <GroupJoinRequestActions
        requestId={metadata.requestId}
        kind="member_invitation"
        status={statuses.get(metadata.requestId)}
      />
    ) : null;
  }
  if (notification.type === NOTIFICATION_TYPES.groupParticipantLinkRequest) {
    const metadata = getGroupParticipantLinkMetadata(notification.metadata);
    return metadata ? (
      <GroupJoinRequestActions
        requestId={metadata.requestId}
        kind="participant_link"
        status={statuses.get(metadata.requestId)}
      />
    ) : null;
  }
  if (notification.type === NOTIFICATION_TYPES.groupInvitationOutcome) {
    const metadata = getGroupInvitationOutcomeMetadata(notification.metadata);
    return metadata ? (
      <Link className="text-link" href={`/app/personal/groups/${encodeURIComponent(metadata.groupId)}`}>
        Open Group
      </Link>
    ) : null;
  }
  const metadata = getGroupParticipantLinkOutcomeMetadata(notification.metadata);
  return metadata ? (
    <Link className="text-link" href={`/app/personal/groups/${encodeURIComponent(metadata.groupId)}`}>
      Open Group
    </Link>
  ) : null;
}

function expenseActions(notification: NotificationRecord) {
  if (notification.type === NOTIFICATION_TYPES.groupExpensePayerClaim) {
    const metadata = getGroupExpensePayerClaimMetadata(notification.metadata);
    return metadata ? (
      <GroupExpensePayerClaimActions
        groupId={metadata.groupId}
        expenseId={metadata.expenseId}
      />
    ) : null;
  }
  const metadata = getGroupExpensePayerClaimOutcomeMetadata(notification.metadata);
  return metadata ? (
    <Link
      className="text-link"
      href={`/app/personal/groups/${encodeURIComponent(metadata.groupId)}/expenses/${encodeURIComponent(metadata.expenseId)}`}
    >
      Open expense
    </Link>
  ) : null;
}

function settlementActions(notification: NotificationRecord) {
  const metadata = notification.type === NOTIFICATION_TYPES.groupSettlementConfirmation
    ? getGroupSettlementConfirmationMetadata(notification.metadata)
    : getGroupSettlementOutcomeMetadata(notification.metadata);
  if (!metadata) return null;
  const label = notification.type === NOTIFICATION_TYPES.groupSettlementConfirmation ? "Review payment" : "Open payment";
  return (
    <Link
      className="text-link"
      href={`/app/personal/groups/${encodeURIComponent(metadata.groupId)}/settlements/${encodeURIComponent(metadata.settlementId)}`}
    >
      {label}
    </Link>
  );
}

function offsetActions(notification: NotificationRecord) {
  const metadata = notification.type === NOTIFICATION_TYPES.groupOffsetConfirmation
    ? getGroupOffsetConfirmationMetadata(notification.metadata)
    : getGroupOffsetOutcomeMetadata(notification.metadata);
  if (!metadata) return null;
  const label = notification.type === NOTIFICATION_TYPES.groupOffsetConfirmation ? "Review offset" : "Open offset";
  return (
    <Link
      className="text-link"
      href={`/app/personal/groups/${encodeURIComponent(metadata.groupId)}/settlements/offsets/${encodeURIComponent(metadata.offsetId)}`}
    >
      {label}
    </Link>
  );
}

export function NotificationRowActions({
  notification,
  friendLinkRequestStatuses,
  organizationInvitationStatuses,
  groupJoinRequestStatuses,
}: NotificationRowActionsProps) {
  if (notification.type === NOTIFICATION_TYPES.friendLinkRequest || notification.type === NOTIFICATION_TYPES.friendLinkRequestOutcome) {
    return friendLinkActions(notification, friendLinkRequestStatuses);
  }
  if (notification.type === NOTIFICATION_TYPES.organizationInvitation || notification.type === NOTIFICATION_TYPES.organizationInvitationOutcome) {
    return organizationActions(notification, organizationInvitationStatuses);
  }
  if (
    notification.type === NOTIFICATION_TYPES.groupInvitation ||
    notification.type === NOTIFICATION_TYPES.groupInvitationOutcome ||
    notification.type === NOTIFICATION_TYPES.groupParticipantLinkRequest ||
    notification.type === NOTIFICATION_TYPES.groupParticipantLinkOutcome
  ) {
    return groupJoinActions(notification, groupJoinRequestStatuses);
  }
  if (notification.type === NOTIFICATION_TYPES.groupExpensePayerClaim || notification.type === NOTIFICATION_TYPES.groupExpensePayerClaimOutcome) {
    return expenseActions(notification);
  }
  if (notification.type === NOTIFICATION_TYPES.groupSettlementConfirmation || notification.type === NOTIFICATION_TYPES.groupSettlementOutcome) {
    return settlementActions(notification);
  }
  if (notification.type === NOTIFICATION_TYPES.groupOffsetConfirmation || notification.type === NOTIFICATION_TYPES.groupOffsetOutcome) {
    return offsetActions(notification);
  }
  return null;
}
