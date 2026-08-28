"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { GROUP_EXPENSE_STATE_CHANGED_EVENT } from "@/domain/group-accounting";
import { useRealtime } from "@/components/realtime/realtime-provider";

export function GroupExpenseLiveRefresh({ groupId, expenseId }: { groupId: string; expenseId?: string }) {
  const router = useRouter();
  const { openCount, subscribe } = useRealtime();

  useEffect(() => {
    if (openCount > 0) router.refresh();
  }, [openCount, router]);

  useEffect(() => subscribe(GROUP_EXPENSE_STATE_CHANGED_EVENT, (event) => {
    if (event.data.groupId !== groupId || expenseId && event.data.expenseId !== expenseId) return;
    router.refresh();
  }), [expenseId, groupId, router, subscribe]);

  return null;
}
