"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { GROUP_SETTLEMENT_CHANGED_EVENT } from "@/domain/group-settlements";
import { GROUP_OFFSET_CHANGED_EVENT } from "@/domain/group-offsets";
import { useRealtime } from "@/components/realtime/realtime-provider";

export function GroupSettlementLiveRefresh({
  groupId,
  settlementId,
  offsetId,
}: {
  groupId: string;
  settlementId?: string;
  offsetId?: string;
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

  useEffect(
    () => subscribe(GROUP_OFFSET_CHANGED_EVENT, (event) => {
      if (
        event.data.groupId !== groupId ||
        offsetId && event.data.offsetId !== offsetId
      ) return;
      router.refresh();
    }),
    [groupId, offsetId, router, subscribe],
  );

  return null;
}
