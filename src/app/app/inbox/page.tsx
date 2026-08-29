import type { Metadata } from "next";
import Link from "next/link";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { InboxLiveRefresh } from "@/components/notifications/inbox-live-refresh";
import { InboxIcon } from "@/components/notifications/inbox-icon";
import { RecordPagination } from "@/components/records/record-pagination";
import { getFriendLinkRequestMetadata, getGroupExpensePayerClaimMetadata, getGroupInvitationMetadata, getGroupOffsetConfirmationMetadata, getGroupParticipantLinkMetadata, getGroupSettlementConfirmationMetadata, getOrganizationInvitationMetadata, NOTIFICATION_TYPES, presentNotification } from "@/domain/notifications";
import { getCurrentUserNotificationPage, getCurrentUserUnreadNotificationCount } from "@/server/notifications";
import { getCurrentUserFriendLinkRequestStatuses } from "@/server/friend-links";
import { getCurrentUserOrganizationInvitationStatuses } from "@/server/organization-invitations";
import { getCurrentUserGroupJoinRequestStatuses } from "@/server/group-join-requests";
import { FriendLinkRequestActions } from "@/components/notifications/friend-link-request";
import { OrganizationInvitationActions } from "@/components/notifications/organization-invitation";
import { GroupJoinRequestActions } from "@/components/notifications/group-join-request";
import { GroupExpensePayerClaimActions } from "@/components/notifications/group-expense-payer-claim";
import { markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inbox" };

type InboxSearchParams = { page?: string | string[] };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function InboxPage({ searchParams }: { searchParams?: Promise<InboxSearchParams> }) {
  const query = searchParams ? await searchParams : {};
  const [page, unreadCount] = await Promise.all([
    getCurrentUserNotificationPage(first(query.page)),
    getCurrentUserUnreadNotificationCount(),
  ]);
  const friendLinkRequestIds = page.rows.flatMap((notification) => notification.type === NOTIFICATION_TYPES.friendLinkRequest ? [getFriendLinkRequestMetadata(notification.metadata)?.requestId].filter((id): id is string => Boolean(id)) : []);
  const organizationInvitationIds = page.rows.flatMap((notification) => notification.type === NOTIFICATION_TYPES.organizationInvitation ? [getOrganizationInvitationMetadata(notification.metadata)?.invitationId].filter((id): id is string => Boolean(id)) : []);
  const groupJoinRequestIds = page.rows.flatMap((notification) => {
    if (notification.type === NOTIFICATION_TYPES.groupInvitation) return [getGroupInvitationMetadata(notification.metadata)?.requestId].filter((id): id is string => Boolean(id));
    if (notification.type === NOTIFICATION_TYPES.groupParticipantLinkRequest) return [getGroupParticipantLinkMetadata(notification.metadata)?.requestId].filter((id): id is string => Boolean(id));
    return [];
  });
  const [friendLinkRequestStatuses, organizationInvitationStatuses, groupJoinRequestStatuses] = await Promise.all([
    getCurrentUserFriendLinkRequestStatuses(friendLinkRequestIds),
    getCurrentUserOrganizationInvitationStatuses(organizationInvitationIds),
    getCurrentUserGroupJoinRequestStatuses(groupJoinRequestIds),
  ]);

  return (
    <section className="app-page inbox-page" id="top">
      <InboxLiveRefresh />
      <div className="editorial-shell app-page__layout">
        <header className="app-page__header">
          <div>
            <p className="technical-label">Attention</p>
            <h1>Inbox</h1>
            <p className="app-page__lede">Keep the updates that need your attention close at hand.</p>
          </div>
          {unreadCount > 0 ? <form action={markAllNotificationsReadAction}><button className="action-link action-link--quiet" type="submit">Mark all as read</button></form> : null}
        </header>
        <div className="inbox-page__content" id="inbox-list">
          {page.rows.length > 0 ? (
            <ul className="inbox-list">
              {page.rows.map((notification) => {
                const presentation = presentNotification(notification.type, notification.metadata);
                const unread = notification.readAt === null;
                const linkMetadata = notification.type === NOTIFICATION_TYPES.friendLinkRequest ? getFriendLinkRequestMetadata(notification.metadata) : null;
                const invitationMetadata = notification.type === NOTIFICATION_TYPES.organizationInvitation ? getOrganizationInvitationMetadata(notification.metadata) : null;
                const groupInvitationMetadata = notification.type === NOTIFICATION_TYPES.groupInvitation ? getGroupInvitationMetadata(notification.metadata) : null;
                const groupLinkMetadata = notification.type === NOTIFICATION_TYPES.groupParticipantLinkRequest ? getGroupParticipantLinkMetadata(notification.metadata) : null;
                const expenseClaimMetadata = notification.type === NOTIFICATION_TYPES.groupExpensePayerClaim ? getGroupExpensePayerClaimMetadata(notification.metadata) : null;
                const settlementMetadata = notification.type === NOTIFICATION_TYPES.groupSettlementConfirmation ? getGroupSettlementConfirmationMetadata(notification.metadata) : null;
                const offsetMetadata = notification.type === NOTIFICATION_TYPES.groupOffsetConfirmation ? getGroupOffsetConfirmationMetadata(notification.metadata) : null;
                return (
                  <li className={`notification-row${unread ? " notification-row--unread" : ""}`} key={notification.id}>
                    <div className="notification-row__main">
                      <span className="notification-row__marker" aria-hidden="true"><InboxIcon /></span>
                      <div className="notification-row__copy">
                        <p className="technical-label">{presentation.label}</p>
                        <p className="notification-row__primary">{presentation.primary}</p>
                        {presentation.secondary ? <p className="notification-row__secondary">{presentation.secondary}</p> : null}
                      </div>
                      <span className="notification-row__time"><LocalDateTime iso={notification.createdAt.toISOString()} mode="date-time" /></span>
                    </div>
                    <div className="notification-row__state">
                      {unread ? <form action={markNotificationReadAction.bind(null, notification.id)}><button className="text-link" type="submit">Mark read</button></form> : <span>Read</span>}
                      {linkMetadata ? <FriendLinkRequestActions requestId={linkMetadata.requestId} status={friendLinkRequestStatuses.get(linkMetadata.requestId)} /> : null}
                      {invitationMetadata ? <OrganizationInvitationActions invitationId={invitationMetadata.invitationId} status={organizationInvitationStatuses.get(invitationMetadata.invitationId)} /> : null}
                      {groupInvitationMetadata ? <GroupJoinRequestActions requestId={groupInvitationMetadata.requestId} kind="member_invitation" status={groupJoinRequestStatuses.get(groupInvitationMetadata.requestId)} /> : null}
                      {groupLinkMetadata ? <GroupJoinRequestActions requestId={groupLinkMetadata.requestId} kind="participant_link" status={groupJoinRequestStatuses.get(groupLinkMetadata.requestId)} /> : null}
                      {expenseClaimMetadata ? <GroupExpensePayerClaimActions groupId={expenseClaimMetadata.groupId} expenseId={expenseClaimMetadata.expenseId} /> : null}
                      {settlementMetadata ? (
                        <Link
                          className="text-link"
                          href={`/app/personal/groups/${encodeURIComponent(settlementMetadata.groupId)}/settlements/${encodeURIComponent(settlementMetadata.settlementId)}`}
                        >
                          Review payment
                        </Link>
                      ) : null}
                      {offsetMetadata ? (
                        <Link
                          className="text-link"
                          href={`/app/personal/groups/${encodeURIComponent(offsetMetadata.groupId)}/settlements/offsets/${encodeURIComponent(offsetMetadata.offsetId)}`}
                        >
                          Review offset
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="inbox-page__empty">You’re all caught up.</p>}
          <RecordPagination page={page.page} pageSize={page.pageSize} totalItems={page.totalItems} totalPages={page.totalPages} href="/app/inbox" anchor="inbox-list" />
        </div>
      </div>
    </section>
  );
}
