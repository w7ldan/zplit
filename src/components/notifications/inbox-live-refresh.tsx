"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/components/realtime/realtime-provider";

export function InboxLiveRefresh() {
  const router = useRouter();
  const { openCount, notificationStateVersion } = useRealtime();

  useEffect(() => {
    if (openCount > 0) router.refresh();
  }, [openCount, router]);

  useEffect(() => {
    if (notificationStateVersion > 0) router.refresh();
  }, [notificationStateVersion, router]);
  return null;
}
