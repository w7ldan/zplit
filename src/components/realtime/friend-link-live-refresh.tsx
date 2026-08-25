"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/components/realtime/realtime-provider";
import { FRIEND_LINK_STATE_CHANGED_EVENT } from "@/domain/friend-links";

export function FriendLinkLiveRefresh({ friendId }: { friendId: string }) {
  const router = useRouter();
  const { openCount, subscribe } = useRealtime();
  useEffect(() => {
    if (openCount > 0) router.refresh();
  }, [openCount, router]);
  useEffect(() => subscribe(FRIEND_LINK_STATE_CHANGED_EVENT, (event) => {
    if (event.data.friendId === friendId) router.refresh();
  }), [friendId, router, subscribe]);
  return null;
}
