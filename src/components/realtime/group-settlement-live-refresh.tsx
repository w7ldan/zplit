"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { GROUP_SETTLEMENT_CHANGED_EVENT } from "@/domain/group-settlements";
import { useRealtime } from "@/components/realtime/realtime-provider";

export function GroupSettlementLiveRefresh({
  groupId,
  settlementId,
}: {
  groupId: string;
  settlementId?: string;
}) {
  const router = useRouter();
  const { openCount, subscribe } = useRealtime();

  useEffect(() => {
    if (openCount > 0) router.refresh();
  }, [openCount, router]);

  useEffect(
    () => subscribe(GROUP_SETTLEMENT_CHANGED_EVENT, (event) => {
      if (
        event.data.groupId !== groupId ||
        settlementId && event.data.settlementId !== settlementId
      ) return;
      router.refresh();
    }),
    [groupId, router, settlementId, subscribe],
  );

  return null;
}
