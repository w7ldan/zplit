import Link from "next/link";
import { LocalDateTime } from "@/components/editorial/local-date-time";
import type { OrganizationInvitationState } from "@/server/organization-invitations";
import { acceptOrganizationInvitationAction, declineOrganizationInvitationAction } from "@/app/app/inbox/actions";

function statusLabel(status: OrganizationInvitationState["status"]) {
  return status[0]?.toUpperCase() + status.slice(1);
}

export function OrganizationInvitationActions({ invitationId, status }: { invitationId: string; status?: OrganizationInvitationState }) {
  if (!status) return <span>No longer available</span>;
  if (status.status === "pending") {
    return <div className="notification-row__actions"><span>Expires <LocalDateTime iso={status.expiresAt.toISOString()} mode="date" /></span><form action={acceptOrganizationInvitationAction.bind(null, invitationId)}><button className="text-link" type="submit">Accept</button></form><form action={declineOrganizationInvitationAction.bind(null, invitationId)}><button className="text-link" type="submit">Decline</button></form></div>;
  }
  if (status.status === "accepted") {
    return <div className="notification-row__actions"><span>Joined</span><Link className="text-link" href={`/app/organizations/${status.organizationId}`}>Open organization</Link></div>;
  }
  return <span>{statusLabel(status.status)}</span>;
}
