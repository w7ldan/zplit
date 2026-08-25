import type { Metadata } from "next";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import { InboxLiveRefresh } from "@/components/notifications/inbox-live-refresh";
import { InboxIcon } from "@/components/notifications/inbox-icon";
import { RecordPagination } from "@/components/records/record-pagination";
import { presentNotification } from "@/domain/notifications";
import { getCurrentUserNotificationPage, getCurrentUserUnreadNotificationCount } from "@/server/notifications";
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
