import Link from "next/link";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import type { GroupJoinRequestKind } from "@/domain/group-join-requests";
import type { GroupJoinRequestState } from "@/server/group-join-requests";
import { acceptGroupJoinRequestAction, declineGroupJoinRequestAction } from "@/app/app/inbox/actions";

function statusLabel(status: GroupJoinRequestState["status"]) {
  return status[0]?.toUpperCase() + status.slice(1);
}

export function GroupJoinRequestActions({ requestId, kind, status }: { requestId: string; kind: GroupJoinRequestKind; status?: GroupJoinRequestState }) {
  if (!status) return <span>No longer available</span>;
  if (status.status === "pending") {
    return (
      <div className="notification-row__actions">
        <span>
          Expires <LocalDateTime iso={status.expiresAt.toISOString()} mode="date" />
        </span>
        <form action={acceptGroupJoinRequestAction.bind(null, requestId)}>
          <button className="text-link" type="submit">
            {kind === "participant_link" ? "Accept link" : "Accept"}
          </button>
        </form>
        <form action={declineGroupJoinRequestAction.bind(null, requestId)}>
          <button className="text-link" type="submit">
            Decline
          </button>
        </form>
      </div>
    );
  }
  if (status.status === "accepted") return (
      <div className="notification-row__actions">
        <span>{kind === "participant_link" ? "Linked" : "Joined"}</span>
        <Link className="text-link" href={`/app/personal/groups/${status.groupId}`}>
          Open Group
        </Link>
      </div>
    );
  return <span>{statusLabel(status.status)}</span>;
}
