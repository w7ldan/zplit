import { acceptFriendLinkRequestAction, declineFriendLinkRequestAction } from "@/app/app/inbox/actions";
import type { FriendLinkRequestStatus } from "@/server/friend-links";

export function FriendLinkRequestActions({ requestId, status }: { requestId: string; status?: FriendLinkRequestStatus }) {
  if (status !== "pending") return <span>{status ? status[0].toUpperCase() + status.slice(1) : "No longer available"}</span>;
  return (
    <div className="notification-row__actions">
      <form action={acceptFriendLinkRequestAction.bind(null, requestId)}>
        <button className="text-link" type="submit">
          Accept
        </button>
      </form>
      <form action={declineFriendLinkRequestAction.bind(null, requestId)}>
        <button className="text-link" type="submit">
          Decline
        </button>
      </form>
    </div>
  );
}
