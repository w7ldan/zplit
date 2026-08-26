"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRealtime } from "@/components/realtime/realtime-provider";
import { InboxIcon } from "./inbox-icon";

type InboxControlProps = {
  initialUnreadCount: number;
  active?: boolean;
};

function displayUnreadCount(count: number) {
  return count > 99 ? "99+" : String(count);
}

export function InboxControl({ initialUnreadCount, active = false }: InboxControlProps) {
  const { openCount, notificationStateVersion } = useRealtime();
  const [unreadCount, setUnreadCount] = useState(Math.max(0, initialUnreadCount));
  const refreshUnread = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/notifications/unread", { cache: "no-store", signal });
    if (!response.ok) return;
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "unreadCount" in body && typeof body.unreadCount === "number" && Number.isSafeInteger(body.unreadCount) && body.unreadCount >= 0) {
      setUnreadCount(body.unreadCount);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this is an async canonical-state refetch.
    void refreshUnread(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [openCount, refreshUnread]);

  useEffect(() => {
    if (notificationStateVersion > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- this is an async canonical-state refetch.
      void refreshUnread().catch(() => undefined);
    }
  }, [notificationStateVersion, refreshUnread]);

  const label = unreadCount > 0 ? `Inbox, ${unreadCount} unread` : "Inbox";
  return (
    <Link href="/app/inbox" className={`inbox-control${active ? " inbox-control--active" : ""}`} aria-label={label} aria-current={active ? "page" : undefined}>
      <InboxIcon />
      {unreadCount > 0 ? <span className="inbox-control__count" aria-hidden="true">{displayUnreadCount(unreadCount)}</span> : null}
    </Link>
  );
}

export { displayUnreadCount };
