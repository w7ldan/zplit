"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { NOTIFICATION_STATE_CHANGED_EVENT } from "@/domain/notifications";
import { useRealtime } from "@/components/realtime/realtime-provider";

export function InboxLiveRefresh() {
  const router = useRouter();
  const { openCount, subscribe } = useRealtime();

  useEffect(() => {
    if (openCount > 0) router.refresh();
  }, [openCount, router]);

  useEffect(() => subscribe(NOTIFICATION_STATE_CHANGED_EVENT, () => router.refresh()), [router, subscribe]);
  return null;
}
