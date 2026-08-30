import { acceptFriendLinkRequestAction, declineFriendLinkRequestAction } from "@/app/app/inbox/actions";
import Link from "next/link";
import type { FriendLinkRequestStatus } from "@/server/friend-links";

export function FriendLinkRequestActions({
  requestId,
  friendId,
  status,
}: {
  requestId: string;
  friendId?: string;
  status?: FriendLinkRequestStatus;
}) {
  const link = friendId ? (
    <Link className="text-link" href={`/app/friends/${encodeURIComponent(friendId)}`}>
      Open Friend
    </Link>
  ) : null;
  if (status !== "pending") {
    return (
      <div className="notification-row__actions">
        <span>{status ? status[0].toUpperCase() + status.slice(1) : "No longer available"}</span>
        {link}
      </div>
    );
  }
  return (
    <div className="notification-row__actions">
      {link}
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
