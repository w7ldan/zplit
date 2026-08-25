import { acceptFriendLinkRequestAction, declineFriendLinkRequestAction, unlinkFriendLinkRequestAction } from "@/app/app/inbox/actions";
import type { FriendLinkRequestStatus } from "@/server/friend-links";

export function FriendLinkRequestActions({ requestId, status, requesterUsername }: { requestId: string; status?: FriendLinkRequestStatus; requesterUsername?: string }) {
  if (status === "connected") {
    return <div className="notification-row__actions"><span>Active friend</span><details className="notification-row__unlink"><summary className="text-link">Unlink</summary><div><p>Unlink @{requesterUsername}?</p><p>This removes the Zplit account connection. Existing Friend balances and history remain unchanged.</p><form action={unlinkFriendLinkRequestAction.bind(null, requestId)}><button className="action-link action-link--quiet" type="submit">Unlink</button></form></div></details></div>;
  }
  if (status === "disconnected") return <span>Disconnected</span>;
  if (status !== "pending") return <span>{status ? status[0].toUpperCase() + status.slice(1) : "No longer available"}</span>;
  return <div className="notification-row__actions"><form action={acceptFriendLinkRequestAction.bind(null, requestId)}><button className="text-link" type="submit">Accept</button></form><form action={declineFriendLinkRequestAction.bind(null, requestId)}><button className="text-link" type="submit">Decline</button></form></div>;
}
